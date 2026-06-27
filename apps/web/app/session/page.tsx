'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Session, Message, HitlRequest } from '@e2e-bridge/shared';
import { api } from '@/lib/api';
import { storage } from '@/lib/storage';
import { useServerSocket, sendMessage } from '@/lib/ws';
import { looksLikeSlashCommand, parseSlashCommand, KNOWN_COMMANDS } from '@e2e-bridge/shared';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  attachments?: string[];
  streaming?: boolean;
}

function SessionPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('id') ?? '';

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [hitl, setHitl] = useState<HitlRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { connected, events, wsRef } = useServerSocket({ autoSubscribe: true });

  // Load session + history on mount
  useEffect(() => {
    if (!storage.getToken()) { router.replace('/'); return; }
    (async () => {
      try {
        const [s, h] = await Promise.all([api.getSession(sessionId), api.history(sessionId)]);
        setSession(s);
        setMessages(h.messages.map((m: Message) => ({
          id: m.id, role: m.role, content: m.content, attachments: m.attachments,
        })));
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [sessionId, router]);

  // Stream events: append/append-delta/mark-streaming
  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (!last || last.type !== 'session.output.delta') {
      // Handle other event types
      if (last && last.type === 'session.message') {
        const msg = last.message;
        // Replace streaming placeholder if same content; otherwise append.
        setMessages((prev) => {
          const last2 = prev[prev.length - 1];
          if (last2 && last2.streaming && last2.role === msg.role) {
            return [...prev.slice(0, -1), { ...last2, content: msg.content, streaming: false }];
          }
          return [...prev, { id: msg.id, role: msg.role, content: msg.content, attachments: msg.attachments }];
        });
      } else if (last && last.type === 'session.completed') {
        // mark any streaming complete
        setMessages((prev) => prev.map((m) => m.streaming ? { ...m, streaming: false } : m));
      } else if (last && last.type === 'hitl.requested') {
        setHitl(last.request);
      } else if (last && last.type === 'hitl.decided') {
        setHitl((h) => h && h.id === last.hitl_id ? null : h);
      } else if (last && last.type === 'session.status_changed') {
        setSession((s) => s ? { ...s, status: last.to } : s);
      }
      return;
    }
    const ev = last;
    if (ev.session_id !== sessionId) return;
    setMessages((prev) => {
      const last2 = prev[prev.length - 1];
      if (last2 && last2.streaming && last2.role === 'assistant') {
        return [...prev.slice(0, -1), { ...last2, content: last2.content + ev.delta }];
      }
      return [...prev, { id: 'stream_' + ev.index, role: 'assistant', content: ev.delta, streaming: true }];
    });
  }, [events.length, sessionId]);

  const sendUser = async () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setError(null);
    // Local echo for the user message
    setMessages((prev) => [...prev, { id: 'local_' + Date.now(), role: 'user', content: text }]);
    try {
      if (looksLikeSlashCommand(text)) {
        const cmd = parseSlashCommand(text);
        if (cmd) {
          // Send via WS for fast path
          sendMessage(wsRef.current, { type: 'send_command', session_id: sessionId, command: cmd });
        } else {
          setError(`Unknown slash command: ${text}`);
        }
      } else {
        // Send via WS so the server can stream events back
        sendMessage(wsRef.current, { type: 'send_message', session_id: sessionId, content: text });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const stop = async () => {
    try { await api.stopSession(sessionId); } catch (e) { setError((e as Error).message); }
  };
  const kill = async () => {
    try { await api.killSession(sessionId); } catch (e) { setError((e as Error).message); }
  };

  const triggerHitl = async () => {
    try { await api.testHitl(sessionId); } catch (e) { setError((e as Error).message); }
  };

  const onUpload = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      const att = await api.upload(file);
      // Attach to next message OR append as a system note
      setMessages((prev) => [...prev, {
        id: 'att_' + att.id,
        role: 'system',
        content: `📎 ${att.filename} (${att.mime}, ${att.size} bytes) uploaded as ${att.id}`,
        attachments: [att.id],
      }]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const allEvents = useMemo(() => events, [events]);

  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="col" style={{ gap: 4 }}>
          <Link href="/dashboard" className="muted">← back</Link>
          <h1 className="h1">{session?.title ?? session?.repo_path ?? sessionId}</h1>
          {session && (
            <div className="row" style={{ gap: 6 }}>
              <span className={`tag ${session.status === 'completed' ? 'good' : session.status === 'failed' || session.status === 'killed' ? 'danger' : ''}`}>{session.status}</span>
              <span className="muted code" style={{ fontSize: 12 }}>{session.id}</span>
              <span className="muted code" style={{ fontSize: 12 }}>{session.repo_path}</span>
            </div>
          )}
        </div>
        <div className="row">
          <span className={`tag ${connected ? 'good' : 'danger'}`}>WS {connected ? 'live' : 'off'}</span>
          <button onClick={() => void stop()}>Stop</button>
          <button onClick={() => void kill()}>Kill</button>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginTop: 12 }}>{error}</div>}

      <div className="card" style={{ marginTop: 16, minHeight: 360 }}>
        {messages.length === 0 && <div className="muted">No messages yet. Send a prompt or a slash command.</div>}
        {messages.map((m) => (
          <div key={m.id} className="col" style={{ gap: 4, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <div className="row" style={{ gap: 8 }}>
              <span className={`tag ${m.role === 'user' ? '' : m.role === 'assistant' ? 'good' : 'warn'}`}>{m.role}</span>
              {m.streaming && <span className="muted" style={{ fontSize: 12 }}>streaming…</span>}
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
            {m.attachments && m.attachments.length > 0 && (
              <div className="muted code" style={{ fontSize: 12 }}>attachments: {m.attachments.join(', ')}</div>
            )}
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendUser(); }
            }}
            placeholder="Type a message, or a slash command: /help /skills /skill browser-webbridge-testing /stop /kill …"
            rows={3}
            style={{ flex: 1, resize: 'vertical' }}
          />
          <div className="col" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button onClick={() => void sendUser()} disabled={!input.trim()}>Send</button>
            <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,text/plain,application/pdf"
                disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); }}
                style={{ display: 'none' }}
              />
              <span className="tag">{uploading ? 'uploading…' : '📎 upload'}</span>
            </label>
          </div>
        </div>
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          Slash commands: {KNOWN_COMMANDS.map((c) => `/${c}`).join('  ')}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => void triggerHitl()} style={{ background: '#3a2c1a' }}>🧪 Trigger fake HITL (dev)</button>
        </div>
      </div>

      {hitl && (
        <div className="card" style={{ marginTop: 12, borderColor: 'var(--warn)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="h2">⚠ HITL required</div>
            <span className="tag warn">risk: {hitl.risk_level}</span>
          </div>
          <div style={{ marginTop: 6 }}><b>Action:</b> <span className="code">{hitl.action}</span></div>
          <div className="muted" style={{ marginTop: 4 }}><b>Reason:</b> {hitl.reason}</div>
          {hitl.evidence.length > 0 && (
            <ul style={{ marginTop: 6 }}>
              {hitl.evidence.map((e, i) => <li key={i} className="muted code" style={{ fontSize: 12 }}>{e}</li>)}
            </ul>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <button onClick={() => void api.hitlDecide(hitl.id, 'approve').catch((e) => setError((e as Error).message))} style={{ background: '#1a3a25' }}>Approve</button>
            <button onClick={() => void api.hitlDecide(hitl.id, 'reject').catch((e) => setError((e as Error).message))} style={{ background: '#3a1a1a' }}>Reject</button>
            <button onClick={() => void api.hitlDecide(hitl.id, 'modify', prompt('Modify note:') ?? undefined).catch((e) => setError((e as Error).message))}>Modify</button>
            <button onClick={() => void api.hitlDecide(hitl.id, 'abort').catch((e) => setError((e as Error).message))}>Abort</button>
          </div>
        </div>
      )}

      <details style={{ marginTop: 16 }}>
        <summary className="muted" style={{ cursor: 'pointer' }}>Trace events ({allEvents.length})</summary>
        <div className="card" style={{ marginTop: 6, maxHeight: 240, overflow: 'auto' }}>
          {allEvents.slice(-50).reverse().map((ev, i) => (
            <div key={i} className="muted code" style={{ fontSize: 12, padding: '2px 0' }}>
              {ev.ts}  {ev.type}
            </div>
          ))}
        </div>
      </details>
    </main>
  );
}

// Next.js static export requires a Suspense boundary around useSearchParams().
export default function SessionPage() {
  return (
    <Suspense fallback={<main style={{ padding: 24 }}>Loading…</main>}>
      <SessionPageInner />
    </Suspense>
  );
}
