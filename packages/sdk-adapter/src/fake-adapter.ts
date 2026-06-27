import type { Event, Command, Id, Message } from '@e2e-bridge/shared';
import { nowIso, chunkText } from './util.js';
import type {
  ClaudeSessionAdapter, CreateSessionInput, SessionHandle,
  MessageInput, SessionSummary,
} from './types.js';

/**
 * FakeAdapter — deterministic, no external deps.
 * Used for M3 demo runs and for unit-testing the runner without a real Claude.
 *
 * Emits the same event shape a real Claude Agent SDK adapter would emit, so
 * the runner code is identical for both.
 */
export class FakeAdapter implements ClaudeSessionAdapter {
  private sessions = new Map<Id, SessionHandle>();
  private tickMs = 80;
  private chunkSize = 6;

  constructor(opts?: { tickMs?: number; chunkSize?: number }) {
    if (opts?.tickMs)    this.tickMs = opts.tickMs;
    if (opts?.chunkSize) this.chunkSize = opts.chunkSize;
  }

  async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    const handle: SessionHandle = {
      id: 'fake_' + Math.random().toString(36).slice(2, 14),
      claude_session_id: input.claude_session_id,
    };
    this.sessions.set(handle.id, handle);
    return handle;
  }

  async *sendMessage(sessionId: Id, input: MessageInput): AsyncGenerator<Event, void, unknown> {
    const startEv: Event = { type: 'session.started', ts: nowIso(), session_id: sessionId, runner_id: 'fake-adapter' };
    yield startEv;
    const text = this.buildReply(input.content);
    for await (const ev of this.stream(sessionId, text)) yield ev;
  }

  async *sendCommand(sessionId: Id, command: Command): AsyncGenerator<Event, void, unknown> {
    const recv: Event = {
      type: 'command.received',
      ts: nowIso(),
      session_id: sessionId,
      command,
      from_user: 'adapter',
    };
    yield recv;
    if (command.name === 'skill') {
      const inv: Event = {
        type: 'skill.invoked',
        ts: nowIso(),
        session_id: sessionId,
        skill: command.skill,
        args: command.args,
      };
      yield inv;
    }
    const reply = this.commandReply(command);
    for await (const ev of this.stream(sessionId, reply)) yield ev;
  }

  async stopSession(_sessionId: Id): Promise<void> {
    // FakeAdapter has no in-flight work; nothing to stop.
  }

  async killSession(_sessionId: Id): Promise<void> {
    // FakeAdapter has no in-flight work; nothing to kill.
  }

  async listSessions(): Promise<SessionSummary[]> {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      repo_path: '~',
      status: 'completed',
      created_at: nowIso(),
      updated_at: nowIso(),
      history_count: 0,
    }));
  }

  // -------- internals --------

  private async *stream(sessionId: Id, text: string): AsyncGenerator<Event, void, unknown> {
    const chunks = chunkText(text, this.chunkSize);
    let i = 0;
    while (i < chunks.length) {
      const chunk = chunks[i] ?? '';
      const ev: Event = {
        type: 'session.output.delta',
        ts: nowIso(),
        session_id: sessionId,
        delta: chunk,
        index: i,
      };
      yield ev;
      i++;
      await sleep(this.tickMs);
    }
    const msg: Message = {
      id: 'm_' + Math.random().toString(36).slice(2, 10),
      session_id: sessionId,
      role: 'assistant',
      content: text,
      created_at: nowIso(),
    };
    const msgEv: Event = {
      type: 'session.message',
      ts: nowIso(),
      session_id: sessionId,
      message: msg,
    };
    yield msgEv;
    const doneEv: Event = {
      type: 'session.completed',
      ts: nowIso(),
      session_id: sessionId,
      result: { length: text.length },
    };
    yield doneEv;
  }

  private buildReply(content: string): string {
    const t = content.trim();
    if (!t) return '(empty)';
    if (t.startsWith('/')) return `[fake-adapter] received ${t}`;
    if (/summarize|summary/i.test(t)) return `Fake summary: ${t}. (Real Claude SDK adapter ships in M4.)`;
    if (/^(hi|hello)\b/i.test(t)) return `Hello from FakeAdapter. Try /help, /skills, or /skill browser-webbridge-testing.`;
    return `FakeAdapter echo: ${t}`;
  }

  private commandReply(c: Command): string {
    switch (c.name) {
      case 'help':
        return 'Available: /help /new /sessions /status /stop /kill /skills /skill <name> /browser /screenshot /trace /review /test /clear';
      case 'skills':
        return 'Installed: browser-webbridge-testing, playwright-test-skill, code-review-skill, trace-analysis-skill';
      case 'clear':
        return '(fake-adapter) context cleared';
      case 'status':
        return 'Status: ok (fake-adapter)';
      case 'sessions':
        return '(fake-adapter) no sessions';
      case 'stop':
      case 'kill':
        return 'Stopped.';
      default:
        return `[fake-adapter] Command /${c.name} acknowledged.`;
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
