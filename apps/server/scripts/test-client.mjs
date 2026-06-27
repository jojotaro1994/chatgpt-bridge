#!/usr/bin/env node
/**
 * Smoke test for the e2e-bridge server (M2 acceptance).
 *
 * Steps:
 *   1. POST /api/auth/test with the env-loaded ADMIN_TOKEN
 *   2. POST /api/sessions → assert session.created event arrives on /ws/app
 *   3. POST /api/sessions/:id/messages "hello" → assert session.output.delta + session.message
 *   4. POST /api/sessions/:id/commands { name: 'skills' } → assert reply
 *   5. POST /api/sessions/:id/test-hitl → assert hitl.requested
 *   6. POST /api/hitl/:id/decision { decision: 'approve' } → assert hitl.decided
 *   7. POST /api/sessions/:id/stop → assert session.stopped
 *
 * Exits non-zero on any failure.
 *
 * Usage:
 *   ADMIN_TOKEN=... node apps/server/scripts/test-client.mjs http://127.0.0.1:3000
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const TOKEN = process.env.ADMIN_TOKEN;
if (!TOKEN) {
  console.error('ADMIN_TOKEN env required');
  process.exit(2);
}

const fetchJson = async (path, init = {}) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'authorization': `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, body };
};

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  ', msg);
};

// Collect events from WS
function connectWs() {
  const wsUrl = BASE.replace(/^http/, 'ws') + '/ws/app?token=' + encodeURIComponent(TOKEN);
  const ws = new WebSocket(wsUrl);
  const events = [];
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.type === 'event') events.push(m.event);
    } catch {}
  });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ws open timeout')), 5000);
    ws.on('open', () => { clearTimeout(t); resolve({ ws, events }); });
    ws.on('error', (e) => { clearTimeout(t); reject(e); });
  });
}

(async () => {
  console.log('1) /health');
  {
    const res = await fetch(BASE + '/health');
    const j = await res.json();
    assert(res.status === 200 && j.ok === true, 'GET /health ok');
  }

  console.log('2) /api/auth/test');
  {
    const res = await fetchJson('/api/auth/test', { method: 'POST', body: JSON.stringify({ token: TOKEN }) });
    assert(res.status === 200 && res.body.ok === true, 'POST /api/auth/test ok');
  }

  console.log('3) /api/auth/test (bad)');
  {
    const res = await fetchJson('/api/auth/test', { method: 'POST', body: JSON.stringify({ token: 'wrong' }) });
    assert(res.status === 401, 'POST /api/auth/test bad → 401');
  }

  console.log('4) WS /ws/app + create session');
  const { ws, events } = await connectWs();
  // send hello
  ws.send(JSON.stringify({ type: 'hello', token: TOKEN }));
  // subscribe to ALL events (omit session_id)
  ws.send(JSON.stringify({ type: 'subscribe' }));
  await sleep(80);

  const created = await fetchJson('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ repo_path: '~/repos/example', title: 'smoke' }),
  });
  assert(created.status === 201, 'POST /api/sessions 201');
  const sessionId = created.body.id;
  console.log('   session', sessionId);

  await sleep(150);
  const sawCreated = events.some((e) => e.type === 'session.created' && e.session.id === sessionId);
  const sawStarted = events.some((e) => e.type === 'session.started' && e.session_id === sessionId);
  assert(sawCreated, 'event session.created received');
  assert(sawStarted, 'event session.started received');

  console.log('5) send message → stream');
  events.length = 0;
  await fetchJson(`/api/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content: 'summarize this repo' }),
  });
  await sleep(2000); // wait for stream to complete (24 chars / 6 per chunk * 80ms = ~320ms)
  const sawMsg       = events.some((e) => e.type === 'session.message' && e.session_id === sessionId && e.message.role === 'user');
  const sawDelta     = events.some((e) => e.type === 'session.output.delta' && e.session_id === sessionId);
  const sawCompleted = events.some((e) => e.type === 'session.completed' && e.session_id === sessionId);
  assert(sawMsg, 'event session.message (user) received');
  assert(sawDelta, 'event session.output.delta received');
  assert(sawCompleted, 'event session.completed received');

  console.log('6) /api/sessions/:id/commands /skills');
  events.length = 0;
  await fetchJson(`/api/sessions/${sessionId}/commands`, {
    method: 'POST',
    body: JSON.stringify({ name: 'skills' }),
  });
  await sleep(3000);
  const sawSkillMsg = events.some((e) => e.type === 'session.message' && e.session_id === sessionId && e.message.role === 'assistant');
  assert(sawSkillMsg, 'assistant reply to /skills received');

  console.log('7) /api/sessions/:id/test-hitl → decide');
  events.length = 0;
  const hitl = await fetchJson(`/api/sessions/${sessionId}/test-hitl`, { method: 'POST', body: '{}' });
  assert(hitl.status === 201, 'POST test-hitl 201');
  const hitlId = hitl.body.id;
  await sleep(100);
  const sawHitlRequested = events.some((e) => e.type === 'hitl.requested' && e.request.id === hitlId);
  assert(sawHitlRequested, 'event hitl.requested received');

  const decide = await fetchJson(`/api/hitl/${hitlId}/decision`, {
    method: 'POST',
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert(decide.status === 200 && decide.body.status === 'approved', 'POST hitl decision approved');
  await sleep(100);
  const sawHitlDecided = events.some((e) => e.type === 'hitl.decided' && e.hitl_id === hitlId);
  assert(sawHitlDecided, 'event hitl.decided received');

  console.log('8) /api/sessions/:id/stop');
  events.length = 0;
  const stop = await fetchJson(`/api/sessions/${sessionId}/stop`, { method: 'POST', body: '{}' });
  assert(stop.status === 200, 'POST stop ok');
  await sleep(100);
  const sawStopped = events.some((e) => e.type === 'session.stopped' && e.session_id === sessionId);
  assert(sawStopped, 'event session.stopped received');

  console.log('9) /api/sessions');
  const list = await fetchJson('/api/sessions');
  assert(list.status === 200 && Array.isArray(list.body.items), 'GET /api/sessions ok');

  console.log('10) /api/devices');
  const devs = await fetchJson('/api/devices');
  assert(devs.status === 200 && Array.isArray(devs.body.devices), 'GET /api/devices ok');

  console.log('11) /api/skills');
  const skills = await fetchJson('/api/skills');
  assert(skills.status === 200 && skills.body.skills.length >= 4, 'GET /api/skills ok');

  ws.close();
  console.log('\nALL M2 SMOKE TESTS PASSED ✓');
  process.exit(0);
})().catch((e) => {
  console.error('UNEXPECTED:', e);
  process.exit(1);
});
