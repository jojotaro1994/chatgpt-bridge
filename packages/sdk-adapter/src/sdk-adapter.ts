import { randomBytes } from 'node:crypto';
import { query, type Options, type SDKMessage, type SDKUserMessage, type CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import type { Event, Command, Id, Message } from '@e2e-bridge/shared';
import type {
  ClaudeSessionAdapter, CreateSessionInput, SessionHandle,
  MessageInput, SessionSummary,
} from './types.js';
import { nowIso } from './util.js';
import { SkillRegistry, resolveDefaultSkillsDir } from './skill-registry.js';

/**
 * ClaudeAgentSdkAdapter — real Claude Agent SDK integration (M4).
 *
 * Wraps `@anthropic-ai/claude-agent-sdk`'s `query()` to drive Claude Code as
 * a library. The runner spawns one adapter per session; each session keeps
 * a single SDK query alive (multi-turn) and feeds user messages through an
 * input channel while emitting unified Events to the runner.
 *
 * NOT parsing TUI. Not bypassing Claude auth — requires `ANTHROPIC_API_KEY`
 * (or another SDK-supported credential source) in the runner's env.
 *
 * Security:
 *   - `canUseTool` defaults to auto-allow (TODO: HITL wiring)
 *   - Per-message content sanitized via zod in `@e2e-bridge/shared`
 *   - No shell escape; everything goes through SDK's own tool sandboxing
 */
export interface ClaudeAgentSdkOptions {
  /** ANTHROPIC_API_KEY (or omit to inherit from env) */
  apiKey?: string;
  /** e.g. 'claude-sonnet-4-5'. Omit for SDK default. */
  model?: string;
  /** Default cwd for the SDK query (Claude Code's working directory). */
  defaultCwd?: string;
  /** Custom tool permission hook — see SDK docs. */
  canUseTool?: CanUseTool;
  /** Anthropic max effort level. */
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  /** Directory containing <skill-name>/SKILL.md files. Auto-resolved if omitted. */
  skillsDir?: string;
}

export class ClaudeAgentSdkAdapter implements ClaudeSessionAdapter {
  private sessions = new Map<Id, SessionState>();
  private skillRegistry: SkillRegistry;

  constructor(private opts: ClaudeAgentSdkOptions = {}) {
    if (opts.apiKey) process.env['ANTHROPIC_API_KEY'] = opts.apiKey;
    this.skillRegistry = new SkillRegistry(opts.skillsDir ?? resolveDefaultSkillsDir(opts.defaultCwd));
  }

  async createSession(input: CreateSessionInput): Promise<SessionHandle> {
    return {
      id: 'sdk_' + randomId(),
      claude_session_id: undefined, // SDK assigns on first query
    };
  }

  async *sendMessage(sessionId: Id, input: MessageInput): AsyncGenerator<Event, void, unknown> {
    const session = this.getOrCreateSession(sessionId);
    if (session.busy) {
      yield {
        type: 'error',
        ts: nowIso(),
        code: 'SESSION_BUSY',
        message: 'Another send is in flight on this session',
      };
      return;
    }
    session.busy = true;
    try {
      // Tag the session id into events emitted by the pump
      session.tagSessionId(sessionId);
      session.sendUserMessage(input.content, input.attachments);

      yield {
        type: 'session.started',
        ts: nowIso(),
        session_id: sessionId,
        runner_id: 'sdk-adapter',
      };

      for await (const ev of session.consumeTurn()) {
        yield ev;
      }
    } finally {
      session.busy = false;
    }
  }

  async *sendCommand(sessionId: Id, command: Command): AsyncGenerator<Event, void, unknown> {
    // /skills — list installed skills
    if (command.name === 'skills') {
      const skills = this.skillRegistry.list();
      const text = skills.length === 0
        ? '(no skills installed in ' + this.skillRegistry.dir + ')'
        : 'Installed skills:\n' + skills.map((s) => `  - ${s.name}: ${s.description}`).join('\n');
      yield* this.sendMessage(sessionId, { content: text });
      return;
    }

    // /skill <name> — invoke a skill by reading its SKILL.md and injecting
    // its body as a structured user message, then emitting skill.invoked.
    if (command.name === 'skill') {
      const skill = this.skillRegistry.get(command.skill);
      if (!skill) {
        yield {
          type: 'session.failed',
          ts: nowIso(),
          session_id: sessionId,
          error: `Skill not found: ${command.skill}`,
        };
        return;
      }
      yield {
        type: 'skill.invoked',
        ts: nowIso(),
        session_id: sessionId,
        skill: command.skill,
        args: command.args,
      };
      const prompt = `<skill name="${command.skill}">\n${skill.body}\n</skill>\n\nFollow the instructions in the skill above. Begin now.`;
      yield* this.sendMessage(sessionId, { content: prompt });
      return;
    }

    // Other slash commands — forward as a user message; the SDK processes
    // them natively (no special handling needed).
    const text = commandToText(command);
    yield* this.sendMessage(sessionId, { content: text });
  }

  async stopSession(sessionId: Id): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) s.stop();
  }

  async killSession(sessionId: Id): Promise<void> {
    const s = this.sessions.get(sessionId);
    if (s) s.kill();
  }

  async listSessions(): Promise<SessionSummary[]> {
    return Array.from(this.sessions.values())
      .filter((s) => s.alive)
      .map((s) => ({
        id: s.sessionId,
        repo_path: s.opts.defaultCwd ?? '~',
        status: s.busy ? 'running' : 'completed',
        created_at: s.createdAt,
        updated_at: nowIso(),
        history_count: 0,
      }));
  }

  private getOrCreateSession(sessionId: Id): SessionState {
    let s = this.sessions.get(sessionId);
    if (s) return s;
    s = new SessionState(sessionId, this.opts);
    this.sessions.set(sessionId, s);
    return s;
  }
}

// ---------------------------------------------------------------------------
// SessionState — owns the long-running SDK query, multiplexes input/output
// ---------------------------------------------------------------------------

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
  | { type: 'document'; source: { type: 'base64'; media_type: string; data: string } };

class Channel<T> {
  private buffer: T[] = [];
  private resolvers: Array<(r: IteratorResult<T>) => void> = [];
  private _closed = false;
  push(item: T): void {
    if (this._closed) return;
    const r = this.resolvers.shift();
    if (r) r({ value: item, done: false });
    else this.buffer.push(item);
  }
  close(): void {
    this._closed = true;
    for (const r of this.resolvers) r({ value: undefined, done: true });
    this.resolvers = [];
  }
  get closed(): boolean { return this._closed; }
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.buffer.length > 0) { yield this.buffer.shift()!; continue; }
      if (this._closed) return;
      const r: IteratorResult<T> = await new Promise((resolve) => this.resolvers.push(resolve));
      if (r.done) return;
      yield r.value;
    }
  }
}

class SessionState {
  readonly createdAt = nowIso();
  readonly in = new Channel<SDKUserMessage>();
  readonly out = new Channel<Event>();
  busy = false;
  alive = true;
  private queryStarted = false;
  private queryDone = false;
  private abort = new AbortController();
  private currentSessionId: Id = '';

  constructor(public readonly sessionId: Id, public readonly opts: ClaudeAgentSdkOptions) {}

  tagSessionId(id: Id): void { this.currentSessionId = id; }

  sendUserMessage(text: string, attachments?: Id[]): void {
    const content = buildContent(text, attachments);
    this.in.push({
      type: 'user',
      message: { role: 'user', content: content as never },
      parent_tool_use_id: null,
    });
  }

  stop(): void {
    try { this.abort.abort(); } catch { /* ignore */ }
    this.alive = false;
    this.in.close();
    this.out.close();
  }

  kill(): void { this.stop(); }

  /** Drain events from the pump until a `result` message arrives. */
  async *consumeTurn(): AsyncGenerator<Event, void, unknown> {
    this.ensurePump();
    while (true) {
      // Wait for next event or pump-end
      const iter = this.out[Symbol.asyncIterator]();
      const r = await iter.next();
      if (r.done) return;
      const ev = r.value;
      yield ev;
      if (ev.type === 'session.completed' || ev.type === 'session.failed') return;
    }
  }

  private ensurePump(): void {
    if (this.queryStarted) return;
    this.queryStarted = true;
    // Fire-and-forget background pump
    void this.runPump();
  }

  private async runPump(): Promise<void> {
    const options: Options = {
      cwd: this.opts.defaultCwd,
      model: this.opts.model,
      includePartialMessages: true,
      abortController: this.abort,
      canUseTool: this.opts.canUseTool,
      effort: this.opts.effort,
    };
    let queryGen: AsyncGenerator<SDKMessage, void>;
    try {
      queryGen = query({ prompt: this.in, options });
    } catch (err) {
      this.out.push({
        type: 'session.failed',
        ts: nowIso(),
        session_id: this.currentSessionId,
        error: 'query() threw: ' + String((err as Error).message ?? err),
      });
      this.queryDone = true;
      this.out.close();
      return;
    }

    try {
      for await (const sdkMsg of queryGen) {
        const events = mapSdkMessage(sdkMsg, this.currentSessionId);
        for (const ev of events) this.out.push(ev);
        if (sdkMsg.type === 'result') break;
      }
    } catch (err) {
      this.out.push({
        type: 'session.failed',
        ts: nowIso(),
        session_id: this.currentSessionId,
        error: String((err as Error).message ?? err),
      });
    } finally {
      this.queryDone = true;
      this.out.close();
    }
  }
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

function commandToText(c: Command): string {
  // Slash commands are forwarded verbatim — the SDK interprets them.
  switch (c.name) {
    case 'help': return '/help';
    case 'new': return `/new ${c.repo_path}`;
    case 'sessions': return '/sessions';
    case 'status': return '/status';
    case 'stop': return '/stop';
    case 'kill': return '/kill';
    case 'skills': return '/skills';
    case 'skill': return `/skill ${c.skill}`;
    case 'browser': return `/browser ${c.action}${c.target ? ' ' + c.target : ''}`;
    case 'screenshot': return '/screenshot';
    case 'trace': return '/trace';
    case 'review': return `/review ${c.target}`;
    case 'test': return `/test ${c.goal}`;
    case 'clear': return '/clear';
  }
}

function buildContent(text: string, attachments: Id[] | undefined): string | ContentBlock[] {
  if (!attachments || attachments.length === 0) return text;
  const blocks: ContentBlock[] = [{ type: 'text', text }];
  for (const a of attachments) {
    // Attachments arrive as opaque ids from the server (uploaded files).
    // The runner is expected to resolve them to either base64 (image) or
    // file path. For now, treat short opaque strings as inline base64 image.
    if (looksLikeBase64Image(a)) {
      blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: a } });
    } else {
      // Pass as a text reference — the agent can ask follow-up questions
      blocks.push({ type: 'text', text: `[attachment: ${a}]` });
    }
  }
  return blocks;
}

function looksLikeBase64Image(s: string): boolean {
  return /^[A-Za-z0-9+/=]{200,}$/.test(s) && s.length > 200;
}

/**
 * Map a single SDKMessage to zero or more unified Events.
 * BetaRawMessageStreamEvent is intentionally untyped (avoids pulling the
 * Anthropic SDK just for these) — we sniff on `.type` strings.
 */
function mapSdkMessage(msg: SDKMessage, sessionId: Id): Event[] {
  const ts = nowIso();
  const out: Event[] = [];

  // stream_event: partial deltas
  if (msg.type === 'stream_event') {
    const ev = (msg as unknown as { event: { type?: string; delta?: { type?: string; text?: string }; index?: number } }).event;
    if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') {
      out.push({
        type: 'session.output.delta',
        ts,
        session_id: sessionId,
        delta: ev.delta.text,
        index: ev.index ?? 0,
      });
    }
    return out;
  }

  // assistant message — extract text and tool_use blocks
  if (msg.type === 'assistant') {
    const message = (msg as unknown as { message?: { content?: unknown[] }; uuid?: string }).message;
    if (message && Array.isArray(message.content)) {
      let accumulatedText = '';
      for (const block of message.content) {
        const b = block as { type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> };
        if (b.type === 'text' && typeof b.text === 'string') {
          accumulatedText += b.text;
        } else if (b.type === 'tool_use' && b.id && b.name) {
          out.push({
            type: 'tool.call',
            ts,
            session_id: sessionId,
            tool_call_id: b.id,
            tool: b.name,
            args: b.input ?? {},
          });
        }
      }
      if (accumulatedText) {
        const m: Message = {
          id: (msg as unknown as { uuid?: string }).uuid ?? 'm_' + Math.random().toString(36).slice(2, 10),
          session_id: sessionId,
          role: 'assistant',
          content: accumulatedText,
          created_at: ts,
        };
        out.push({ type: 'session.message', ts, session_id: sessionId, message: m });
      }
    }
    return out;
  }

  // user message containing tool_result
  if (msg.type === 'user') {
    const m = (msg as unknown as { message?: { content?: unknown[] } }).message;
    if (m && Array.isArray(m.content)) {
      for (const block of m.content) {
        const b = block as { type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean };
        if (b.type === 'tool_result' && b.tool_use_id) {
          out.push({
            type: 'tool.result',
            ts,
            session_id: sessionId,
            tool_call_id: b.tool_use_id,
            result: b.content ?? null,
            is_error: b.is_error,
          });
        }
      }
    }
    return out;
  }

  // result message — final
  if (msg.type === 'result') {
    const r = msg as unknown as {
      subtype?: string;
      total_cost_usd?: number;
      num_turns?: number;
      errors?: string[];
      result?: string;
    };
    if (r.subtype === 'success') {
      out.push({
        type: 'session.completed',
        ts,
        session_id: sessionId,
        result: { cost_usd: r.total_cost_usd, turns: r.num_turns, text: r.result },
      });
    } else {
      out.push({
        type: 'session.failed',
        ts,
        session_id: sessionId,
        error: (r.errors ?? [r.subtype ?? 'unknown']).filter(Boolean).join('; '),
      });
    }
    return out;
  }

  // Other message types (system, status, auth_status, …): ignored for now.
  // Add mappings as needed.
  return out;
}

function randomId(): string {
  return randomBytes(12).toString('base64url');
}
