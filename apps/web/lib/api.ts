import type {
  Session, Message, Attachment, HitlRequest, Device,
} from '@e2e-bridge/shared';
import { storage } from './storage';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = storage.getServerUrl().replace(/\/+$/, '');
  if (!base) throw new Error('server URL not set');
  const token = storage.getToken();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      'authorization': `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = (body?.error ?? { code: 'INTERNAL', message: 'request failed' });
    throw new ApiError(res.status, err.code, err.message);
  }
  return body as T;
}

export const api = {
  health: () => request<{ ok: boolean; ts: string }>('/health'),
  devices: () => request<{ devices: Device[] }>('/api/devices'),
  sessions: () => request<{ items: Session[]; total: number }>('/api/sessions'),
  getSession: (id: string) => request<Session>(`/api/sessions/${id}`),
  createSession: (body: { repo_path: string; title?: string }) =>
    request<Session>('/api/sessions', { method: 'POST', body: JSON.stringify(body) }),
  sendMessage: (id: string, content: string, attachments?: string[]) =>
    request<Message>(`/api/sessions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content, attachments }),
    }),
  sendCommand: (id: string, command: unknown) =>
    request<{ accepted: boolean; command: unknown }>(`/api/sessions/${id}/commands`, {
      method: 'POST',
      body: JSON.stringify(command),
    }),
  stopSession: (id: string) => request<{ ok: boolean }>(`/api/sessions/${id}/stop`, { method: 'POST', body: '{}' }),
  killSession: (id: string) => request<{ ok: boolean }>(`/api/sessions/${id}/kill`, { method: 'POST', body: '{}' }),
  history: (id: string) => request<{ session: Session; messages: Message[] }>(`/api/sessions/${id}/history`),
  skills: () => request<{ skills: { name: string; description: string }[] }>('/api/skills'),
  testHitl: (id: string) =>
    request<HitlRequest>(`/api/sessions/${id}/test-hitl`, { method: 'POST', body: '{}' }),
  hitlDecide: (id: string, decision: 'approve' | 'reject' | 'modify' | 'abort', note?: string) =>
    request<HitlRequest>(`/api/hitl/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify({ decision, note }),
    }),
  upload: async (file: File): Promise<Attachment> => {
    const base = storage.getServerUrl().replace(/\/+$/, '');
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${base}/api/uploads`, {
      method: 'POST',
      headers: { 'authorization': `Bearer ${storage.getToken()}` },
      body: fd,
    });
    if (!res.ok) {
      const t = await res.text();
      let body: unknown; try { body = JSON.parse(t); } catch { body = null; }
      const err = (body as { error?: { code: string; message: string } } | null)?.error ?? { code: 'INTERNAL', message: 'upload failed' };
      throw new ApiError(res.status, err.code, err.message);
    }
    return res.json();
  },
};
