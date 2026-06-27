'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { storage } from '@/lib/storage';
import { api, ApiError } from '@/lib/api';

export default function SetupPage() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState(storage.getServerUrl() || 'http://39.107.221.39');
  const [token, setToken] = useState(storage.getToken());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      storage.setServerUrl(serverUrl.trim());
      storage.setToken(token.trim());
      // Sanity-check the token
      await api.health();
      router.push('/dashboard');
    } catch (err) {
      const msg = err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : (err as Error).message;
      setError(msg);
      storage.clear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <main style={{ maxWidth: 480, margin: '60px auto', padding: 24 }}>
      <div className="col">
        <h1 className="h1">e2e-bridge</h1>
        <p className="muted">Remote control for local Claude Code sessions.</p>

        <form onSubmit={submit} className="col">
          <label className="col" style={{ gap: 4 }}>
            <span className="muted">Server URL</span>
            <input
              type="url"
              required
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://39.107.221.39"
            />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="muted">Admin token</span>
            <input
              type="password"
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="from server's ADMIN_TOKEN env"
            />
          </label>
          {error && <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
        </form>

        <div className="card">
          <div className="h2">How to get a token</div>
          <p className="muted" style={{ marginTop: 6 }}>
            SSH to the ECS host and read <span className="kbd">.env</span> on the server.
            The token is set via <span className="kbd">ADMIN_TOKEN</span> at boot.
            Never share it; never paste it into chat.
          </p>
        </div>
      </div>
    </main>
  );
}
