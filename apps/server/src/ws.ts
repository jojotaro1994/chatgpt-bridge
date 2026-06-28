import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server } from 'node:http';
import {
  WsClientToServer, WsRunnerToServer,
  type WsServerToClient, type WsServerToRunner,
  type Event, type Device,
} from '@e2e-bridge/shared';
import { logger } from './logger.js';
import { safeEq, consumeRunnerPairingToken } from './auth.js';
import { runnerManager } from './runner-manager.js';
import { store } from './store.js';
import { dispatcher, type Unsubscribe } from './dispatcher.js';
import { fakeRunner } from './fake.js';
import { newId, nowIso } from './ids.js';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';

const RUNNER_REPO_ALLOWLIST = (process.env.RUNNER_REPO_ALLOWLIST ?? '~').split(',').map((s) => s.trim()).filter(Boolean);
const HEARTBEAT_MS = 30_000;

// ----------------------------------------------------------------------------
// Attach WebSocketServer to existing HTTP server (noServer: true)
// ----------------------------------------------------------------------------

export function attachWs(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname === '/ws/app') {
      wss.handleUpgrade(req, socket, head, (ws) => handleClientWs(ws, req));
    } else if (url.pathname === '/ws/runner') {
      wss.handleUpgrade(req, socket, head, (ws) => handleRunnerWs(ws, req));
    } else {
      socket.destroy();
    }
  });

  return wss;
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function sendToClient(ws: WebSocket, msg: WsServerToClient): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendToRunner(ws: WebSocket, msg: WsServerToRunner): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}

function sendErr(ws: WebSocket, code: string, message: string): void {
  sendToClient(ws, { type: 'error', code, message });
}

function authHeadersFromReq(req: IncomingMessage): string | null {
  // Browser WS clients can't easily set Authorization; accept ?token= query
  // for /ws/app too (token comes from URL bar on phone browser, not header).
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  return url.searchParams.get('token');
}

// ----------------------------------------------------------------------------
// Client WS handler (/ws/app)
// ----------------------------------------------------------------------------

function handleClientWs(ws: WebSocket, req: IncomingMessage): void {
  let authed = false;
  const subs: Unsubscribe[] = [];

  ws.on('message', (raw) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); }
    catch { return sendErr(ws, 'BAD_JSON', 'invalid JSON'); }

    const result = WsClientToServer.safeParse(parsed);
    if (!result.success) return sendErr(ws, 'BAD_REQUEST', result.error.issues[0]?.message ?? 'invalid envelope');

    const msg = result.data;

    // First message must be `hello` with a valid token.
    if (!authed) {
      if (msg.type !== 'hello') return sendErr(ws, 'UNAUTHORIZED', 'hello first');
      if (!safeEq(msg.token, ADMIN_TOKEN)) return sendErr(ws, 'UNAUTHORIZED', 'bad token');
      authed = true;
      sendToClient(ws, {
        type: 'hello_ack',
        user_id: 'admin',
        server_version: '0.0.1',
      });
      logger.info('client ws authed');
      return;
    }

    switch (msg.type) {
      case 'ping':
        sendToClient(ws, { type: 'pong' });
        return;

      case 'subscribe': {
        const off = dispatcher.subscribe(msg.session_id ?? null, (ev: Event) => {
          sendToClient(ws, { type: 'event', event: ev });
        });
        subs.push(off);
        return;
      }

      case 'unsubscribe': {
        for (let i = subs.length - 1; i >= 0; i--) {
          const off = subs[i]!;
          off();
          subs.splice(i, 1);
        }
        return;
      }

      case 'send_message': {
        const session = store.getSession(msg.session_id);
        if (!session) return sendErr(ws, 'NOT_FOUND', 'session not found');
        if (msg.content.length > 100_000) return sendErr(ws, 'BAD_REQUEST', 'content too large');
        const userMsg = store.appendMessage({
          session_id: session.id,
          role: 'user',
          content: msg.content,
          attachments: msg.attachments,
        });
        dispatcher.dispatch({ type: 'session.message', ts: nowIso(), session_id: session.id, message: userMsg });
        void fakeRunner.onClientMessage(session, msg.content);
        return;
      }

      case 'send_command': {
        const session = store.getSession(msg.session_id);
        if (!session) return sendErr(ws, 'NOT_FOUND', 'session not found');
        fakeRunner.onClientCommand(session, msg.command, 'admin');
        return;
      }

      case 'hitl_decide': {
        const hitl = store.getHitl(msg.hitl_id);
        if (!hitl) return sendErr(ws, 'NOT_FOUND', 'hitl not found');
        if (hitl.status !== 'pending') return sendErr(ws, 'HITL_NOT_PENDING', `status=${hitl.status}`);
        const status = ({
          approve: 'approved', reject: 'rejected', modify: 'modified', abort: 'aborted',
        } as const)[msg.decision];
        const updated = { ...hitl, status, decision: msg.decision, decision_note: msg.note, decided_at: nowIso(), decided_by: 'admin' };
        store.putHitl(updated);
        dispatcher.dispatch({
          type: 'hitl.decided',
          ts: nowIso(),
          hitl_id: hitl.id,
          decision: msg.decision,
          decided_by: 'admin',
          note: msg.note,
        });
        return;
      }

      case 'hello':
        return sendErr(ws, 'BAD_REQUEST', 'already authed');
    }
  });

  ws.on('close', () => {
    for (const off of subs) off();
    logger.info('client ws closed');
  });

  // Heartbeat
  const hb = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      sendToClient(ws, { type: 'pong' });
    } else {
      clearInterval(hb);
    }
  }, HEARTBEAT_MS);

  // Allow ?token=... query auth too
  const qToken = authHeadersFromReq(req);
  if (qToken && safeEq(qToken, ADMIN_TOKEN)) {
    // pre-auth not allowed; client must still send hello first.
    // But we permit a "pre-hello" path: if a query token matches, auto-hello_ack
    // when they send any message. Simplest: just log for now.
    logger.debug('client ws connected with query token');
  }
}

// ----------------------------------------------------------------------------
// Runner WS handler (/ws/runner)
// ----------------------------------------------------------------------------

function handleRunnerWs(ws: WebSocket, req: IncomingMessage): void {
  let authed = false;
  let runnerId: string | null = null;

  ws.on('message', (raw) => {
    let parsed: unknown;
    try { parsed = JSON.parse(raw.toString()); }
    catch { return sendErr(ws, 'BAD_JSON', 'invalid JSON'); }

    const result = WsRunnerToServer.safeParse(parsed);
    if (!result.success) return sendErr(ws, 'BAD_REQUEST', result.error.issues[0]?.message ?? 'invalid envelope');

    const msg = result.data;

    if (!authed) {
      if (msg.type !== 'hello') return sendErr(ws, 'UNAUTHORIZED', 'hello first');
      if (!consumeRunnerPairingToken(msg.pairing_token)) return sendErr(ws, 'UNAUTHORIZED', 'bad pairing token');
      authed = true;
      runnerId = newId('r');
      const device: Device = store.upsertDevice({
        id: runnerId,
        name: msg.device.name,
        type: msg.device.type,
        runner_version: msg.device.runner_version,
        status: 'online',
        last_seen: nowIso(),
        capabilities: msg.capabilities,
      });
      dispatcher.dispatch({ type: 'device.online', ts: nowIso(), device });
      runnerManager.add(runnerId, ws);
      sendToRunner(ws, {
        type: 'hello_ack',
        runner_id: runnerId,
        config: { repo_allowlist: RUNNER_REPO_ALLOWLIST, heartbeat_interval_ms: HEARTBEAT_MS },
      });
      logger.info('runner ws authed', { runner_id: runnerId, name: msg.device.name });
      return;
    }

    switch (msg.type) {
      case 'pong':
        // Heartbeat ack from runner; nothing to do.
        return;
      case 'event':
        if (!runnerId) return;
        store.upsertDevice({ ...store.getDevice(runnerId)!, status: 'online', last_seen: nowIso() } as Device);
        dispatcher.dispatch(msg.event);
        return;
    }
  });

  ws.on('close', () => {
    if (runnerId) {
      runnerManager.remove(runnerId);
      store.upsertDevice({ ...store.getDevice(runnerId)!, status: 'offline', last_seen: nowIso() } as Device);
      dispatcher.dispatch({ type: 'device.offline', ts: nowIso(), device_id: runnerId });
      logger.info('runner ws closed', { runner_id: runnerId });
    }
  });

  const hb = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      sendToRunner(ws, { type: 'ping' });
    } else {
      clearInterval(hb);
    }
  }, HEARTBEAT_MS);
}
