import type {
  Session, Message, Attachment, HitlRequest, Device,
} from '@e2e-bridge/shared';
import { newId, nowIso } from './ids.js';

/**
 * In-memory store. Replace with SQLite in a later milestone if durability is needed.
 * Maps keyed by id; secondary indexes for lookups by session/repo/etc.
 */
export class Store {
  readonly sessions   = new Map<string, Session>();
  readonly messages   = new Map<string, Message>();        // message_id -> Message
  readonly attachments= new Map<string, Attachment>();    // upload_id -> Attachment
  readonly hitl       = new Map<string, HitlRequest>();   // hitl_id -> HitlRequest
  readonly devices    = new Map<string, Device>();        // device_id -> Device

  /** message_id -> messages keyed by session_id */
  readonly messagesBySession = new Map<string, Set<string>>();

  createSession(input: { repo_path: string; title?: string; claude_session_id?: string; runner_id?: string | null }): Session {
    const ts = nowIso();
    const session: Session = {
      id: newId('s'),
      status: 'created',
      runner_id: input.runner_id ?? null,
      repo_path: input.repo_path,
      title: input.title,
      claude_session_id: input.claude_session_id,
      created_at: ts,
      updated_at: ts,
      history_count: 0,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  updateSession(id: string, patch: Partial<Session>): Session | undefined {
    const s = this.sessions.get(id);
    if (!s) return undefined;
    const next: Session = { ...s, ...patch, updated_at: nowIso() };
    this.sessions.set(id, next);
    return next;
  }

  listSessions(filter?: { status?: Session['status'] }): Session[] {
    const all = Array.from(this.sessions.values()).sort((a, b) =>
      b.created_at.localeCompare(a.created_at),
    );
    return filter?.status ? all.filter((s) => s.status === filter.status) : all;
  }

  appendMessage(msg: Omit<Message, 'id' | 'created_at'> & { id?: string; created_at?: string }): Message {
    const m: Message = {
      id: msg.id ?? newId('m'),
      session_id: msg.session_id,
      role: msg.role,
      content: msg.content,
      attachments: msg.attachments,
      created_at: msg.created_at ?? nowIso(),
    };
    this.messages.set(m.id, m);
    const set = this.messagesBySession.get(m.session_id) ?? new Set<string>();
    set.add(m.id);
    this.messagesBySession.set(m.session_id, set);
    const s = this.sessions.get(m.session_id);
    if (s) this.updateSession(s.id, { history_count: set.size });
    return m;
  }

  listMessages(sessionId: string): Message[] {
    const ids = this.messagesBySession.get(sessionId);
    if (!ids) return [];
    return Array.from(ids)
      .map((id) => this.messages.get(id))
      .filter((m): m is Message => !!m)
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }

  putAttachment(att: Attachment): void {
    this.attachments.set(att.id, att);
  }

  getAttachment(id: string): Attachment | undefined {
    return this.attachments.get(id);
  }

  putHitl(req: HitlRequest): HitlRequest {
    this.hitl.set(req.id, req);
    return req;
  }

  getHitl(id: string): HitlRequest | undefined {
    return this.hitl.get(id);
  }

  upsertDevice(d: Device): Device {
    const prev = this.devices.get(d.id);
    const merged: Device = { ...prev, ...d };
    this.devices.set(d.id, merged);
    return merged;
  }

  listDevices(): Device[] {
    return Array.from(this.devices.values()).sort((a, b) =>
      b.last_seen.localeCompare(a.last_seen),
    );
  }

  getDevice(id: string): Device | undefined {
    return this.devices.get(id);
  }
}

/** Singleton store, exported for tests and CLI tools. */
export const store = new Store();
