import type {
  Event, Session, Message, Command, HitlRequest, Id,
} from '@e2e-bridge/shared';
import { newId, nowIso } from './ids.js';
import { logger } from './logger.js';
import { dispatcher } from './dispatcher.js';
import { store } from './store.js';

/**
 * FakeRunner — stands in for a real local Runner (M3) and Claude Agent SDK (M4).
 *
 * It listens for client messages/commands on a session and synthesizes a
 * believable event stream:
 *   session.started → many session.output.delta → session.message (assistant) → session.completed
 *
 * Some slash commands have tailored fake responses (/help, /skills, /skill).
 */
export class FakeRunner {
  private timers = new Map<string, NodeJS.Timeout>();
  private tickHandles = new Map<string, NodeJS.Timeout>();

  constructor(
    private opts: {
      /** Delay between delta chunks (ms). Default 80. */
      tickMs?: number;
      /** Characters per delta. Default 6. */
      chunkSize?: number;
    } = {},
  ) {}

  /** Called when a session is freshly created. Marks started and schedules a "hi". */
  onSessionCreated(session: Session): void {
    dispatcher.dispatch({
      type: 'session.started',
      ts: nowIso(),
      session_id: session.id,
      runner_id: 'fake-runner',
    });
    store.updateSession(session.id, { status: 'running' });
    this.dispatchStatus(session.id, 'created', 'running');
  }

  /** Called when a client message arrives on a session. */
  async onClientMessage(session: Session, userContent: string): Promise<void> {
    // Persist user message (caller already did this, but be defensive — append again if missing)
    if (!store.listMessages(session.id).some((m) => m.role === 'user' && m.content === userContent)) {
      store.appendMessage({
        session_id: session.id,
        role: 'user',
        content: userContent,
      });
    }

    // Build a tailored fake reply based on user content
    const reply = this.buildReply(session, userContent);
    await this.streamReply(session.id, reply);
  }

  /** Called when a slash command arrives on a session. */
  async onClientCommand(session: Session, command: Command, fromUser: string): Promise<void> {
    // Audit
    dispatcher.dispatch({
      type: 'command.received',
      ts: nowIso(),
      session_id: session.id,
      command,
      from_user: fromUser,
    });

    // Some commands have tailored behaviour
    switch (command.name) {
      case 'help': {
        const reply = [
          'Available slash commands:',
          '  /help, /new, /sessions, /status, /stop, /kill',
          '  /skills, /skill <name>, /browser, /screenshot',
          '  /trace, /review <target>, /test <goal>, /clear',
        ].join('\n');
        await this.streamReply(session.id, reply);
        dispatcher.dispatch({
          type: 'command.executed',
          ts: nowIso(),
          session_id: session.id,
          command,
          result: { reply_chars: reply.length },
        });
        return;
      }
      case 'skills': {
        const reply = [
          'Installed skills:',
          '  - browser-webbridge-testing',
          '  - playwright-test-skill',
          '  - code-review-skill',
          '  - trace-analysis-skill',
          'Use /skill <name> to invoke one.',
        ].join('\n');
        await this.streamReply(session.id, reply);
        return;
      }
      case 'skill': {
        dispatcher.dispatch({
          type: 'skill.invoked',
          ts: nowIso(),
          session_id: session.id,
          skill: command.skill,
          args: command.args,
        });
        const reply = `[fake-runner] Invoked skill "${command.skill}". ` +
          'Real Claude Agent SDK invocation comes in M4.';
        await this.streamReply(session.id, reply);
        return;
      }
      case 'stop':
      case 'kill':
        this.onStop(session.id, command.name === 'kill' ? 'user' : 'user');
        return;
      case 'sessions':
        await this.streamReply(session.id, this.fakeSessionsList());
        return;
      case 'status':
        await this.streamReply(session.id, this.fakeStatus(session));
        return;
      case 'clear':
        await this.streamReply(session.id, '(fake-runner) context cleared (no-op in M2).');
        return;
      default: {
        const reply = `[fake-runner] Command /${command.name} received. ` +
          'No specific handler in M2 fake — echoed back.';
        await this.streamReply(session.id, reply);
      }
    }
  }

  /** Stop a session: cancel pending ticks, emit session.stopped. */
  onStop(sessionId: string, by: 'user' | 'system' | 'runner' = 'user'): void {
    const handle = this.tickHandles.get(sessionId);
    if (handle) {
      clearTimeout(handle);
      this.tickHandles.delete(sessionId);
    }
    const t = this.timers.get(sessionId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(sessionId);
    }
    const prev = store.getSession(sessionId)?.status ?? 'running';
    dispatcher.dispatch({
      type: 'session.stopped',
      ts: nowIso(),
      session_id: sessionId,
      by,
    });
    store.updateSession(sessionId, { status: by === 'user' ? 'stopped' : 'killed' });
    this.dispatchStatus(sessionId, prev, by === 'user' ? 'stopped' : 'killed');
  }

  // ---------- internals ----------

  private async streamReply(sessionId: string, text: string): Promise<void> {
    const chunkSize = this.opts.chunkSize ?? 6;
    const tickMs    = this.opts.tickMs ?? 80;

    // Cancel any prior in-flight stream on the same session
    const prior = this.tickHandles.get(sessionId);
    if (prior) {
      clearTimeout(prior);
      this.tickHandles.delete(sessionId);
    }

    const chunks = chunkText(text, chunkSize);
    let i = 0;
    let accumulated = '';

    return new Promise<void>((resolve) => {
      const tick = () => {
        if (i >= chunks.length) {
          this.tickHandles.delete(sessionId);
          // Persist full assistant message
          const msg: Message = store.appendMessage({
            session_id: sessionId,
            role: 'assistant',
            content: accumulated,
          });
          dispatcher.dispatch({
            type: 'session.message',
            ts: nowIso(),
            session_id: sessionId,
            message: msg,
          });
          // Mark completed
          const prev = store.getSession(sessionId)?.status ?? 'running';
          store.updateSession(sessionId, { status: 'completed' });
          this.dispatchStatus(sessionId, prev, 'completed');
          dispatcher.dispatch({
            type: 'session.completed',
            ts: nowIso(),
            session_id: sessionId,
            result: { length: accumulated.length },
          });
          resolve();
          return;
        }
        const chunk = chunks[i]!;
        accumulated += chunk;
        dispatcher.dispatch({
          type: 'session.output.delta',
          ts: nowIso(),
          session_id: sessionId,
          delta: chunk,
          index: i,
        });
        i++;
        this.tickHandles.set(sessionId, setTimeout(tick, tickMs));
      };
      // Kick off async
      this.tickHandles.set(sessionId, setTimeout(tick, tickMs));
    });
  }

  private dispatchStatus(sessionId: string, from: Session['status'], to: Session['status']): void {
    if (from === to) return;
    dispatcher.dispatch({
      type: 'session.status_changed',
      ts: nowIso(),
      session_id: sessionId,
      from,
      to,
    });
  }

  private buildReply(session: Session, userContent: string): string {
    const trimmed = userContent.trim();
    if (!trimmed) return `(empty message)`;

    // Try to be a little smart: echo / acknowledge common shapes.
    if (trimmed.startsWith('/')) {
      return `[fake-runner] You typed ${trimmed}. Use the structured send_command WS message to invoke real commands.`;
    }
    if (/summarize|summary/i.test(trimmed)) {
      return `Fake summary of ${session.repo_path}: this is a placeholder until M4 wires Claude Agent SDK.`;
    }
    if (/hello|hi\b/i.test(trimmed)) {
      return `Hello from fake-runner. Session ${session.id} is alive. Try /help, /skills, or send a /skill browser-webbridge-testing.`;
    }
    return `Fake reply to: "${trimmed}". Real Claude streaming comes in M4 (Claude Agent SDK).`;
  }

  private fakeSessionsList(): string {
    const all = store.listSessions();
    if (all.length === 0) return '(no sessions)';
    return all
      .slice(0, 20)
      .map((s) => `  ${s.id}  ${s.status.padEnd(9)}  ${s.repo_path}`)
      .join('\n');
  }

  private fakeStatus(s: Session): string {
    return [
      `Session ${s.id}`,
      `  status      : ${s.status}`,
      `  repo_path   : ${s.repo_path}`,
      `  runner      : ${s.runner_id ?? '(none)'}`,
      `  history     : ${s.history_count} messages`,
      `  created_at  : ${s.created_at}`,
      `  updated_at  : ${s.updated_at}`,
    ].join('\n');
  }
}

function chunkText(s: string, size: number): string[] {
  if (size <= 0) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

/** Singleton fake runner. */
export const fakeRunner = new FakeRunner({ tickMs: 80, chunkSize: 6 });
