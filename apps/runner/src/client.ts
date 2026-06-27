import WebSocket from 'ws';
import {
  WsRunnerToServer, WsServerToRunner,
  type Event, type Id, type Device,
} from '@e2e-bridge/shared';
import type { ClaudeSessionAdapter } from '@e2e-bridge/sdk-adapter';
import { nowIso } from './ids.js';
import { logger } from './logger.js';

const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS  = 30_000;

export interface RunnerClientOptions {
  serverUrl: string;
  pairingToken: string;
  device: { name: string; type: Device['type']; runner_version: string };
  capabilities: string[];
  adapter: ClaudeSessionAdapter;
}

/**
 * Outbound WS client to the server. Reconnects with exponential back-off.
 * Sends `hello` on connect, registers the device, then forwards server-driven
 * `run_message` / `run_command` to the adapter and streams the resulting
 * events back to the server.
 */
export class RunnerClient {
  private ws: WebSocket | null = null;
  private connected = false;
  private reconnectAttempt = 0;
  private stopping = false;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private opts: RunnerClientOptions) {}

  async start(): Promise<void> {
    this.stopping = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.ws) {
      try { this.ws.close(1000, 'shutdown'); } catch { /* ignore */ }
    }
  }

  private async connect(): Promise<void> {
    if (this.stopping) return;
    logger.info('connecting to server', { url: this.opts.serverUrl });
    const ws = new WebSocket(this.opts.serverUrl);
    this.ws = ws;

    ws.on('open', () => {
      // Send hello immediately
      this.sendToServer({
        type: 'hello',
        pairing_token: this.opts.pairingToken,
        device: {
          name: this.opts.device.name,
          type: this.opts.device.type,
          runner_version: this.opts.device.runner_version,
        },
        capabilities: this.opts.capabilities,
      });
    });

    ws.on('message', (raw) => {
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString()); } catch { return; }
      const result = WsServerToRunner.safeParse(parsed);
      if (!result.success) {
        logger.warn('invalid envelope from server', { issues: result.error.issues });
        return;
      }
      this.handleServerMessage(result.data);
    });

    ws.on('close', (code, reason) => {
      this.connected = false;
      if (this.heartbeat) { clearInterval(this.heartbeat); this.heartbeat = null; }
      logger.info('ws closed', { code, reason: String(reason) });
      if (!this.stopping) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      logger.warn('ws error', { err: String(err) });
    });
  }

  private scheduleReconnect(): void {
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt));
    this.reconnectAttempt++;
    logger.info('reconnecting', { in_ms: delay });
    setTimeout(() => this.connect(), delay).unref();
  }

  private handleServerMessage(msg: WsServerToRunner): void {
    switch (msg.type) {
      case 'hello_ack':
        this.connected = true;
        this.reconnectAttempt = 0;
        logger.info('runner paired', { runner_id: msg.runner_id });
        this.startHeartbeat();
        return;
      case 'ping':
        // Ack with same `ping` shape is implicit; server doesn't expect pong from runner
        return;
      case 'run_message':
        void this.handleRunMessage(msg.session_id, msg.content, msg.attachments);
        return;
      case 'run_command':
        void this.handleRunCommand(msg.session_id, msg.command);
        return;
    }
  }

  private async handleRunMessage(sessionId: Id, content: string, attachments?: Id[]): Promise<void> {
    try {
      const events = this.opts.adapter.sendMessage(sessionId, { content, attachments });
      for await (const ev of events) {
        this.emitEvent(ev);
      }
    } catch (err) {
      logger.error('adapter.sendMessage failed', { err: String(err), session_id: sessionId });
      this.emitEvent({
        type: 'session.failed',
        ts: nowIso(),
        session_id: sessionId,
        error: String((err as Error).message ?? err),
      });
    }
  }

  private async handleRunCommand(sessionId: Id, command: import('@e2e-bridge/shared').Command): Promise<void> {
    try {
      // Stop/kill: drive adapter + emit session.stopped ourselves
      if (command.name === 'stop' || command.name === 'kill') {
        if (command.name === 'stop') await this.opts.adapter.stopSession(sessionId);
        else await this.opts.adapter.killSession(sessionId);
        this.emitEvent({
          type: 'session.stopped',
          ts: nowIso(),
          session_id: sessionId,
          by: 'runner',
        });
        return;
      }

      const events = this.opts.adapter.sendCommand(sessionId, command);
      for await (const ev of events) this.emitEvent(ev);
    } catch (err) {
      logger.error('adapter.sendCommand failed', { err: String(err), session_id: sessionId });
      this.emitEvent({
        type: 'session.failed',
        ts: nowIso(),
        session_id: sessionId,
        error: String((err as Error).message ?? err),
      });
    }
  }

  private emitEvent(ev: Event): void {
    this.sendToServer({ type: 'event', event: ev });
  }

  private sendToServer(msg: WsRunnerToServer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      // Server pings us; we don't need to ping back in M3. Future: send 'event: device.heartbeat'
    }, 30_000);
  }
}
