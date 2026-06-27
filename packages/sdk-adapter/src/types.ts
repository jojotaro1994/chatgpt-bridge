import type {
  Event, Command, Id,
} from '@e2e-bridge/shared';

export interface CreateSessionInput {
  repo_path: string;
  title?: string;
  claude_session_id?: string;
}

export interface SessionHandle {
  id: Id;
  claude_session_id?: string;
}

export interface MessageInput {
  content: string;
  attachments?: Id[];
}

export interface SessionSummary {
  id: Id;
  repo_path: string;
  status: 'created' | 'running' | 'completed' | 'failed' | 'stopped' | 'killed';
  created_at: string;
  updated_at: string;
  history_count: number;
}

/**
 * Adapter interface for "anything that can drive a Claude session".
 *
 * Three implementations live in this package:
 *   - FakeAdapter         — emits scripted events (M3 demo / tests)
 *   - ClaudeCliAdapter    — spawns `claude` CLI with --output-format stream-json (M4)
 *   - ClaudeAgentSdkAdapter — uses @anthropic-ai/claude-agent-sdk if installed (M4)
 */
export interface ClaudeSessionAdapter {
  /** Boot a new session for the given repo. */
  createSession(input: CreateSessionInput): Promise<SessionHandle>;

  /** Send a free-form user message and yield events as they arrive. */
  sendMessage(sessionId: Id, input: MessageInput): AsyncIterable<Event>;

  /** Send a structured slash command and yield events. */
  sendCommand(sessionId: Id, command: Command): AsyncIterable<Event>;

  /** Graceful stop: cancel in-flight work. The runner emits session.stopped. */
  stopSession(sessionId: Id): Promise<void>;

  /** Force kill: tear down without waiting. The runner emits session.stopped. */
  killSession(sessionId: Id): Promise<void>;

  /** List known sessions. */
  listSessions(): Promise<SessionSummary[]>;
}
