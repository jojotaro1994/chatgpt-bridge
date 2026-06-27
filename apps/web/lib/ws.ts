'use client';

import { useEffect, useRef, useState } from 'react';
import type { Event, WsServerToClient } from '@e2e-bridge/shared';
import { storage } from './storage';

export type ServerMessage = WsServerToClient;

export function useServerSocket(opts: {
  /** auto-subscribe to all events on connect */
  autoSubscribe?: boolean;
  onEvent?: (e: Event) => void;
} = {}) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<Event[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const base = storage.getServerUrl().replace(/\/+$/, '');
    const token = storage.getToken();
    if (!base || !token) return;

    const wsUrl = base.replace(/^http/, 'ws') + '/ws/app?token=' + encodeURIComponent(token);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'hello', token }));
      if (opts.autoSubscribe) {
        ws.send(JSON.stringify({ type: 'subscribe' }));
      }
      setConnected(true);
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);
    ws.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as ServerMessage;
        if (parsed.type === 'event') {
          setEvents((prev) => [...prev, parsed.event]);
          opts.onEvent?.(parsed.event);
        }
      } catch { /* ignore */ }
    };

    return () => { ws.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { connected, events, wsRef, setEvents };
}

/** Send a typed message over the existing socket. */
export function sendMessage(ws: WebSocket | null, msg: unknown) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(msg));
}
