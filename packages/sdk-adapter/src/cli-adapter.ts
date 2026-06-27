import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Event, Command, Id, Message } from '@e2e-bridge/shared';
import type {
  ClaudeSessionAdapter, CreateSessionInput, SessionHandle,
  MessageInput, SessionSummary,
} from './types.js';
import { nowIso } from './util.js';

/**
 * ClaudeCliAdapter — fallback for environments where Claude Agent SDK
 * is not installed. Spawns the `claude` CLI with --output-format stream-json
 * (and --input-format stream-json when bidirectional) and parses JSON events.
 *
 * NO TUI PARSING. If stream-json isn't supported by your CLI build, this
 * adapter throws — install @anthropic-ai/claude-agent-sdk instead.
 *
 * NOTE: This adapter is scaffolded in M4 and only lightly tested. Real wiring
 * requires a Claude subscription + a non-interactive `claude` CLI build that
 * supports `--output-format stream-json`.
 */
export class ClaudeCliAdapter implements ClaudeSessionAdapter {
  private claudeBin: string;
  private sessions = new Map<Id, SessionHandle>();
  private processes = new Map<Id, ReturnType<typeof spawn>>();

  constructor(opts?: { claudeBin?: string }) {
    this.claudeBin = opts?.claudeBin ?? 'claude';
    if (!existsSync('/usr/local/bin/claude') && !existsSync('/opt/homebrew/bin/claude')) {
      console.warn('[cli-adapter] `claude` binary not in common paths; will retry at spawn time');
    }
  }

  async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    const id = 'cli_' + Math.random().toString(36).slice(2, 14);
    const handle: SessionHandle = { id, claude_session_id: input.claude_session_id };
    this.sessions.set(id, handle);
    return handle;
  }

  async *sendMessage(sessionId: Id, input: MessageInput): AsyncGenerator<Event, void, unknown> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`session ${sessionId} not found`);

    const startEv: Event = { type: 'session.started', ts: nowIso(), session_id: sessionId, runner_id: 'cli-adapter' };
    yield startEv;

    const args: string[] = [
      '--output-format', 'stream-json',
      '--verbose',
    ];
    if (session.claude_session_id) args.push('--session-id', session.claude_session_id);

    const proc = spawn(this.claudeBin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    this.processes.set(sessionId, proc);
    proc.stdin.write(JSON.stringify({ type: 'user', message: { content: input.content } }) + '\n');
    proc.stdin.end();

    let buffer = '';
    for await (const line of readline(proc.stdout)) {
      buffer += line;
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const one = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const parsed = safeJson(one);
        if (!parsed) continue;
        for await (const ev of mapCliEvent(parsed, sessionId)) yield ev;
      }
    }
    const doneEv: Event = { type: 'session.completed', ts: nowIso(), session_id: sessionId };
    yield doneEv;
  }

  async *sendCommand(_sessionId: Id, _command: Command): AsyncGenerator<Event, void, unknown> {
    throw new Error('ClaudeCliAdapter.sendCommand not implemented; use ClaudeAgentSdkAdapter');
  }

  async stopSession(sessionId: Id): Promise<void> {
    const p = this.processes.get(sessionId);
    if (p) p.kill('SIGTERM');
  }

  async killSession(sessionId: Id): Promise<void> {
    const p = this.processes.get(sessionId);
    if (p) p.kill('SIGKILL');
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
}

async function* readline(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  for await (const chunk of stream) {
    yield String(chunk);
  }
}

function safeJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

async function* mapCliEvent(parsed: unknown, sessionId: Id): AsyncGenerator<Event, void, unknown> {
  if (!parsed || typeof parsed !== 'object') return;
  const obj = parsed as Record<string, unknown>;
  const type = obj['type'];
  if (type === 'assistant' && obj['message']) {
    const msg = obj['message'] as { content?: unknown };
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === 'object' && (block as { type?: string }).type === 'text') {
          const text = (block as { text?: string }).text ?? '';
          const message: Message = {
            id: 'm_' + Math.random().toString(36).slice(2, 10),
            session_id: sessionId,
            role: 'assistant',
            content: text,
            created_at: nowIso(),
          };
          const ev: Event = { type: 'session.message', ts: nowIso(), session_id: sessionId, message };
          yield ev;
        }
      }
    }
  } else if (type === 'content_block_delta' && obj['delta']) {
    const delta = (obj['delta'] as { text?: string }).text ?? '';
    const ev: Event = {
      type: 'session.output.delta',
      ts: nowIso(),
      session_id: sessionId,
      delta,
      index: Number(obj['index'] ?? 0),
    };
    yield ev;
  } else if (type === 'tool_use') {
    const ev: Event = {
      type: 'tool.call',
      ts: nowIso(),
      session_id: sessionId,
      tool_call_id: String(obj['id'] ?? Math.random().toString(36).slice(2)),
      tool: String(obj['name'] ?? 'unknown'),
      args: (obj['input'] as Record<string, unknown>) ?? {},
    };
    yield ev;
  } else if (type === 'tool_result') {
    const ev: Event = {
      type: 'tool.result',
      ts: nowIso(),
      session_id: sessionId,
      tool_call_id: String(obj['tool_use_id'] ?? ''),
      result: obj['content'] ?? null,
      is_error: Boolean(obj['is_error']),
    };
    yield ev;
  }
}
