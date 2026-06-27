'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Session, Device } from '@e2e-bridge/shared';
import { api, ApiError } from '@/lib/api';
import { storage } from '@/lib/storage';
import { useServerSocket } from '@/lib/ws';

export default function Dashboard() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [skills, setSkills] = useState<{ name: string; description: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { connected, events } = useServerSocket({ autoSubscribe: true });

  const refresh = async () => {
    try {
      const [{ items }, { devices: devs }, { skills: sk }] = await Promise.all([
        api.sessions(),
        api.devices(),
        api.skills(),
      ]);
      setSessions(items);
      setDevices(devs);
      setSkills(sk);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  useEffect(() => {
    if (!storage.getToken() || !storage.getServerUrl()) {
      router.replace('/');
      return;
    }
    void refresh();
  }, [router]);

  // Refresh list when a session event arrives
  useEffect(() => {
    if (events.length === 0) return;
    const last = events[events.length - 1];
    if (last?.type === 'session.created' || last?.type === 'session.completed'
        || last?.type === 'session.stopped' || last?.type === 'session.failed'
        || last?.type === 'session.started') {
      void refresh();
    }
  }, [events.length]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const repo = window.prompt('Repo path (must be in runner allowlist):', '~/repos/example');
      if (!repo) return;
      const s = await api.createSession({ repo_path: repo });
      router.push(`/session/${s.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 920, margin: '0 auto', padding: 24 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 className="h1">e2e-bridge</h1>
        <div className="row">
          <span className={`tag ${connected ? 'good' : 'danger'}`}>WS {connected ? 'connected' : 'disconnected'}</span>
          <button onClick={() => { storage.clear(); router.replace('/'); }}>Logout</button>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)', marginTop: 12 }}>{error}</div>}

      <div className="col" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="h2">Devices ({devices.length})</div>
            <button onClick={() => void refresh()}>Refresh</button>
          </div>
          <div className="divider" />
          {devices.length === 0 && <div className="muted">No devices online. Start a runner locally (see apps/runner).</div>}
          {devices.map((d) => (
            <div key={d.id} className="row" style={{ justifyContent: 'space-between', padding: '6px 0' }}>
              <div className="col" style={{ gap: 2 }}>
                <div>{d.name}</div>
                <div className="muted code" style={{ fontSize: 12 }}>{d.type} · v{d.runner_version} · {d.id}</div>
              </div>
              <span className={`tag ${d.status === 'online' ? 'good' : 'danger'}`}>{d.status}</span>
            </div>
          ))}
        </div>

        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div className="h2">Sessions ({sessions.length})</div>
            <button onClick={() => void create()} disabled={busy}>New session</button>
          </div>
          <div className="divider" />
          {sessions.length === 0 && <div className="muted">No sessions yet.</div>}
          {sessions.map((s) => (
            <Link key={s.id} href={`/session?id=${encodeURIComponent(s.id)}`} style={{ display: 'block', padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="col" style={{ gap: 2 }}>
                  <div>{s.title ?? s.repo_path}</div>
                  <div className="muted code" style={{ fontSize: 12 }}>{s.id} · {s.repo_path}</div>
                </div>
                <span className={`tag ${s.status === 'completed' ? 'good' : s.status === 'failed' || s.status === 'killed' ? 'danger' : ''}`}>{s.status}</span>
              </div>
            </Link>
          ))}
        </div>

        <div className="card">
          <div className="h2">Skills ({skills.length})</div>
          <div className="divider" />
          {skills.map((s) => (
            <div key={s.name} className="col" style={{ gap: 2, padding: '6px 0' }}>
              <div className="code">/{s.name}</div>
              <div className="muted">{s.description}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
