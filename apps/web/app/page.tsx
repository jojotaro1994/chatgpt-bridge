'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { storage } from '@/lib/storage';
import { api, ApiError } from '@/lib/api';

export default function SetupPage() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState(storage.getServerUrl() || 'http://39.107.221.39');
  const [adminToken, setAdminToken] = useState(storage.getAdminToken());
  const [deviceName, setDeviceName] = useState(
    storage.getDeviceName() || `phone-${Math.random().toString(36).slice(2, 6)}`,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [alreadyPaired, setAlreadyPaired] = useState(!!storage.getToken());

  const pairAndGo = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const base = serverUrl.trim().replace(/\/+$/, '');
      if (!base) throw new Error('server URL required');
      if (!adminToken.trim()) throw new Error('admin token required');
      if (!deviceName.trim()) throw new Error('device name required');

      storage.setServerUrl(base);
      storage.setAdminToken(adminToken.trim());
      storage.setDeviceName(deviceName.trim());

      // Step 1: issue a device token via /api/pair (admin-only)
      const paired = await api.pair({
        name: deviceName.trim(),
        platform: 'web',
      });

      // Step 2: replace admin token with device token; admin token can be discarded.
      storage.setToken(paired.token);
      storage.setDeviceId(paired.device.id);
      storage.clearAdminToken();

      // Step 3: sanity-check by hitting /api/devices (admin-only endpoint).
      // Device tokens get 403 here; that's expected. We just want to confirm
      // the device token works for normal endpoints.
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

  if (alreadyPaired) {
    return (
      <main style={{ maxWidth: 480, margin: '60px auto', padding: 24 }}>
        <h1 className="h1">e2e-bridge</h1>
        <p className="muted" style={{ marginTop: 6 }}>Already paired on this device.</p>
        <div className="card">
          <div className="muted" style={{ fontSize: 12 }}>device id</div>
          <div className="code" style={{ fontSize: 12, wordBreak: 'break-all' }}>{storage.getDeviceId()}</div>
        </div>
        <div className="col" style={{ marginTop: 12 }}>
          <button onClick={() => router.push('/dashboard')}>Go to dashboard</button>
          <button onClick={() => { storage.clear(); setAlreadyPaired(false); }}
                  style={{ background: '#3a1a1a' }}>Unpair this device</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 480, margin: '60px auto', padding: 24 }}>
      <div className="col">
        <h1 className="h1">e2e-bridge</h1>
        <p className="muted">Pair this device with the control server.</p>

        <form onSubmit={pairAndGo} className="col">
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
            <span className="muted">Device name</span>
            <input
              required
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder="my-iphone"
            />
          </label>
          <label className="col" style={{ gap: 4 }}>
            <span className="muted">Admin token (one-time, used to pair this device)</span>
            <input
              type="password"
              required
              value={adminToken}
              onChange={(e) => setAdminToken(e.target.value)}
              placeholder="from server's ADMIN_TOKEN env"
            />
          </label>
          {error && <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>}
          <button type="submit" disabled={busy}>{busy ? 'Pairing…' : 'Pair & connect'}</button>
        </form>

        <div className="card">
          <div className="h2">How pairing works</div>
          <p className="muted" style={{ marginTop: 6 }}>
            One-time: the admin token issues a <em>device token</em> for this browser.
            The device token is what this device uses from then on. The admin
            token is forgotten from this device after pairing. To unpair, use
            <span className="kbd"> /api/pair/revoke </span> on the server.
          </p>
          <p className="muted" style={{ marginTop: 6 }}>
            Get the admin token: SSH to ECS host and read
            <span className="kbd"> /opt/claude-control-deploy/.env.tok</span> or
            <span className="kbd"> .env</span> on the server.
          </p>
        </div>
      </div>
    </main>
  );
}
