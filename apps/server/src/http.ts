import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';
import Busboy from 'busboy';
import {
  Attachment, HitlRequest, HitlDecision,
  type Session, type HitlRequest as HitlRequestT, type Command,
} from '@e2e-bridge/shared';
import { newId, nowIso } from './ids.js';
import { logger } from './logger.js';
import { isValidAdminToken, bearerToken } from './auth.js';
import { store } from './store.js';
import { dispatcher } from './dispatcher.js';
import { fakeRunner } from './fake.js';

const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? '';
const UPLOAD_DIR  = process.env.UPLOAD_DIR ?? '/tmp/e2e-bridge-uploads';
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type Handler = (ctx: HttpCtx) => Promise<void> | void;

interface HttpCtx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  method: string;
  params: Record<string, string>;
  body?: unknown;
  userId?: string;
}

// ----------------------------------------------------------------------------
// Tiny router
// ----------------------------------------------------------------------------

type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler };

function compileRoute(method: string, pattern: string, handler: Handler): Route {
  const keys: string[] = [];
  const re = new RegExp(
    '^\\/?' +  // optional leading slash on path
      pattern
        .replace(/^\/+/, '')
        .split('/')
        .filter(Boolean)
        .map((seg) => {
          if (seg.startsWith(':')) {
            keys.push(seg.slice(1));
            return '([^/]+)';
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('/') +
      '\\/?$',
  );
  return { method, pattern: re, keys, handler };
}

function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.pattern.exec(pathname);
    if (!m) continue;
    const params: Record<string, string> = {};
    r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
    return { route: r, params };
  }
  return null;
}

// ----------------------------------------------------------------------------
// JSON helpers
// ----------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(data),
  });
  res.end(data);
}

function err(res: ServerResponse, status: number, code: string, message: string): void {
  json(res, status, { error: { code, message } });
}

async function readJson(req: IncomingMessage, max = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (c: Buffer) => {
      total += c.length;
      if (total > max) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(new Error('BAD_JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ----------------------------------------------------------------------------
// Skills (static list for M2)
// ----------------------------------------------------------------------------

const SKILLS = [
  { name: 'browser-webbridge-testing', description: 'Inspect/drive a Kimi WebBridge browser session for E2E testing.' },
  { name: 'playwright-test-skill',     description: 'Write, update, and run Playwright tests.' },
  { name: 'code-review-skill',         description: 'Structured PR/diff review with risk flags.' },
  { name: 'trace-analysis-skill',      description: 'Read runner JSONL trace and summarize events.' },
] as const;

// ----------------------------------------------------------------------------
// Routes
// ----------------------------------------------------------------------------

const routes: Route[] = [
  // ---- liveness ----
  compileRoute('GET', '/health', () => ({}) as never),

  // ---- auth ----
  compileRoute('POST', '/api/auth/test', async (ctx) => {
    const body = (ctx.body ?? {}) as { token?: string };
    const ok = isValidAdminToken(body.token ?? null, ADMIN_TOKEN);
    if (!ok) return err(ctx.res, 401, 'UNAUTHORIZED', 'token invalid');
    return json(ctx.res, 200, { ok: true });
  }),

  // ---- devices ----
  compileRoute('GET', '/api/devices', (ctx) => {
    return json(ctx.res, 200, { devices: store.listDevices() });
  }),

  // ---- sessions ----
  compileRoute('GET', '/api/sessions', (ctx) => {
    const status = ctx.url.searchParams.get('status') ?? undefined;
    const items = store.listSessions(status ? { status: status as Session['status'] } : undefined);
    const page = Math.max(1, Number(ctx.url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(ctx.url.searchParams.get('page_size') ?? '20')));
    const total = items.length;
    const start = (page - 1) * pageSize;
    return json(ctx.res, 200, { items: items.slice(start, start + pageSize), total, page, page_size: pageSize });
  }),

  compileRoute('POST', '/api/sessions', async (ctx) => {
    const body = (ctx.body ?? {}) as { repo_path?: string; title?: string; claude_session_id?: string };
    if (!body.repo_path) return err(ctx.res, 400, 'BAD_REQUEST', 'repo_path required');

    // Pick first online runner if any (M2 fake always picks fake-runner).
    const runnerId: string | null = store.listDevices().find((d) => d.status === 'online')?.id ?? 'fake-runner';

    const session = store.createSession({
      repo_path: body.repo_path,
      title: body.title,
      claude_session_id: body.claude_session_id,
      runner_id: runnerId,
    });
    dispatcher.dispatch({ type: 'session.created', ts: nowIso(), session });
    fakeRunner.onSessionCreated(session);
    return json(ctx.res, 201, session);
  }),

  compileRoute('GET', '/api/sessions/:id', (ctx) => {
    const s = store.getSession(ctx.params.id!);
    if (!s) return err(ctx.res, 404, 'NOT_FOUND', 'session not found');
    return json(ctx.res, 200, s);
  }),

  compileRoute('POST', '/api/sessions/:id/messages', async (ctx) => {
    const session = store.getSession(ctx.params.id!);
    if (!session) return err(ctx.res, 404, 'NOT_FOUND', 'session not found');
    const body = (ctx.body ?? {}) as { content?: string; attachments?: string[] };
    if (!body.content) return err(ctx.res, 400, 'BAD_REQUEST', 'content required');
    if (body.content.length > 100_000) return err(ctx.res, 400, 'BAD_REQUEST', 'content too large');

    const userMsg = store.appendMessage({
      session_id: session.id,
      role: 'user',
      content: body.content,
      attachments: body.attachments,
    });
    dispatcher.dispatch({
      type: 'session.message',
      ts: nowIso(),
      session_id: session.id,
      message: userMsg,
    });
    // Kick fake stream
    void fakeRunner.onClientMessage(session, body.content);
    return json(ctx.res, 201, userMsg);
  }),

  compileRoute('POST', '/api/sessions/:id/commands', async (ctx) => {
    const session = store.getSession(ctx.params.id!);
    if (!session) return err(ctx.res, 404, 'NOT_FOUND', 'session not found');
    const body = ctx.body;
    // Validate via zod
    const { Command } = await import('@e2e-bridge/shared');
    const parsed = Command.safeParse(body);
    if (!parsed.success) return err(ctx.res, 400, 'BAD_REQUEST', parsed.error.issues[0]?.message ?? 'invalid command');

    fakeRunner.onClientCommand(session, parsed.data, ctx.userId ?? 'admin');
    return json(ctx.res, 202, { accepted: true, command: parsed.data });
  }),

  compileRoute('POST', '/api/sessions/:id/stop', (ctx) => {
    const session = store.getSession(ctx.params.id!);
    if (!session) return err(ctx.res, 404, 'NOT_FOUND', 'session not found');
    fakeRunner.onStop(session.id, 'user');
    return json(ctx.res, 200, { ok: true });
  }),

  compileRoute('POST', '/api/sessions/:id/kill', (ctx) => {
    const session = store.getSession(ctx.params.id!);
    if (!session) return err(ctx.res, 404, 'NOT_FOUND', 'session not found');
    fakeRunner.onStop(session.id, 'system');
    return json(ctx.res, 200, { ok: true });
  }),

  compileRoute('GET', '/api/sessions/:id/history', (ctx) => {
    const session = store.getSession(ctx.params.id!);
    if (!session) return err(ctx.res, 404, 'NOT_FOUND', 'session not found');
    return json(ctx.res, 200, {
      session,
      messages: store.listMessages(session.id),
    });
  }),

  // ---- skills ----
  compileRoute('GET', '/api/skills', (ctx) => {
    return json(ctx.res, 200, { skills: SKILLS });
  }),

  // ---- uploads (basic M2 implementation) ----
  compileRoute('POST', '/api/uploads', async (ctx) => {
    if (!ctx.req.headers['content-type']?.toString().startsWith('multipart/form-data')) {
      return err(ctx.res, 400, 'BAD_REQUEST', 'multipart/form-data required');
    }
    try {
      const attachment = await handleUpload(ctx.req);
      if ('error' in attachment) return err(ctx.res, attachment.status, attachment.code, attachment.message);
      return json(ctx.res, 201, attachment.attachment);
    } catch (e) {
      logger.error('upload failed', { err: String(e) });
      return err(ctx.res, 500, 'INTERNAL', 'upload failed');
    }
  }),

  // ---- hitl ----
  compileRoute('POST', '/api/hitl/:id/decision', async (ctx) => {
    const hitl = store.getHitl(ctx.params.id!);
    if (!hitl) return err(ctx.res, 404, 'NOT_FOUND', 'hitl not found');
    if (hitl.status !== 'pending') return err(ctx.res, 409, 'HITL_NOT_PENDING', `status=${hitl.status}`);
    const body = (ctx.body ?? {}) as { decision?: string; note?: string };
    const parsed = HitlDecision.safeParse(body.decision);
    if (!parsed.success) return err(ctx.res, 400, 'BAD_REQUEST', 'decision must be approve|reject|modify|abort');

    const status: HitlRequestT['status'] =
      parsed.data === 'approve' ? 'approved' :
      parsed.data === 'reject'  ? 'rejected' :
      parsed.data === 'modify'  ? 'modified' : 'aborted';

    const updated: HitlRequest = {
      ...hitl,
      status,
      decision: parsed.data,
      decision_note: body.note,
      decided_at: nowIso(),
      decided_by: ctx.userId ?? 'admin',
    };
    store.putHitl(updated);
    dispatcher.dispatch({
      type: 'hitl.decided',
      ts: nowIso(),
      hitl_id: hitl.id,
      decision: parsed.data,
      decided_by: updated.decided_by!,
      note: updated.decision_note,
    });
    return json(ctx.res, 200, updated);
  }),

  // ---- dev-only: trigger a fake HITL (for testing the UI in M5) ----
  compileRoute('POST', '/api/sessions/:id/test-hitl', (ctx) => {
    if (process.env.NODE_ENV === 'production') {
      return err(ctx.res, 404, 'NOT_FOUND', 'disabled');
    }
    const session = store.getSession(ctx.params.id!);
    if (!session) return err(ctx.res, 404, 'NOT_FOUND', 'session not found');
    const id = newId('h');
    const req: HitlRequest = {
      id,
      session_id: session.id,
      risk_level: 'high',
      action: 'git push origin main',
      reason: 'Test fixture; dangerous action requires approval before execution.',
      evidence: ['branch=main', 'no PR opened', 'remote=origin'],
      status: 'pending',
      created_at: nowIso(),
    };
    store.putHitl(req);
    dispatcher.dispatch({ type: 'hitl.requested', ts: nowIso(), request: req });
    return json(ctx.res, 201, req);
  }),
];

// ----------------------------------------------------------------------------
// Upload handler (busboy)
// ----------------------------------------------------------------------------

async function handleUpload(
  req: IncomingMessage,
): Promise<{ attachment: Attachment } | { error: true; status: number; code: string; message: string }> {
  await mkdir(UPLOAD_DIR, { recursive: true });

  return new Promise((resolve) => {
    let resolved = false;
    const safeResolve = (v: Parameters<typeof resolve>[0]) => {
      if (resolved) return;
      resolved = true;
      resolve(v);
    };

    let bb: ReturnType<typeof Busboy>;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { files: 1, fileSize: MAX_UPLOAD_BYTES },
      });
    } catch (e) {
      safeResolve({ error: true, status: 400, code: 'BAD_REQUEST', message: 'bad multipart: ' + String(e) });
      return;
    }

    let fileSeen = false;
    let savedPath: string | null = null;
    let originalName = 'upload';
    let detectedMime = 'application/octet-stream';
    let savedSize = 0;
    let truncated = false;

    bb.on('file', (_field, fileStream, info) => {
      fileSeen = true;
      originalName = info.filename || 'upload';
      detectedMime = info.mimeType || 'application/octet-stream';
      const ext = extname(originalName) || '';
      const id = newId('u');
      const filename = `${id}${ext}`;
      savedPath = join(UPLOAD_DIR, filename);
      const chunks: Buffer[] = [];
      fileStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        savedSize += chunk.length;
      });
      fileStream.on('limit', () => {
        truncated = true;
      });
      fileStream.on('end', async () => {
        if (truncated) {
          safeResolve({ error: true, status: 413, code: 'UPLOAD_TOO_LARGE', message: `> ${MAX_UPLOAD_BYTES} bytes` });
          return;
        }
        const buf = Buffer.concat(chunks);
        try {
          await writeFile(savedPath!, buf);
        } catch (e) {
          safeResolve({ error: true, status: 500, code: 'INTERNAL', message: 'write failed: ' + String(e) });
          return;
        }
        // Validate mime
        const allowed = ['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'application/pdf'];
        if (!allowed.includes(detectedMime)) {
          safeResolve({ error: true, status: 415, code: 'UPLOAD_BAD_MIME', message: detectedMime });
          return;
        }
        const att: Attachment = {
          id,
          filename: originalName,
          mime: detectedMime as Attachment['mime'],
          size: savedSize,
          url: `/api/uploads/${id}/raw`,
          created_at: nowIso(),
        };
        // Validate via zod for symmetry
        const parsed = Attachment.safeParse(att);
        if (!parsed.success) {
          safeResolve({ error: true, status: 400, code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'invalid attachment' });
          return;
        }
        store.putAttachment(parsed.data);
        dispatcher.dispatch({
          type: 'upload.created',
          ts: nowIso(),
          upload_id: parsed.data.id,
          filename: parsed.data.filename,
          mime: parsed.data.mime,
          size: parsed.data.size,
        });
        safeResolve({ attachment: parsed.data });
      });
    });

    bb.on('error', (e: Error) => {
      safeResolve({ error: true, status: 400, code: 'BAD_REQUEST', message: 'multipart error: ' + e.message });
    });

    bb.on('close', () => {
      if (!fileSeen) {
        safeResolve({ error: true, status: 400, code: 'BAD_REQUEST', message: 'no file field' });
      }
    });

    req.pipe(bb);
  });
}

// ----------------------------------------------------------------------------
// HTTP entry
// ----------------------------------------------------------------------------

export async function httpHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS — minimal, for dev only
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization, content-type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // Public routes
  if (req.method === 'GET' && pathname === '/health') {
    return json(res, 200, {
      ok: true,
      version: '0.0.1',
      ts: nowIso(),
      subs: dispatcher.size(),
      sessions: store.listSessions().length,
      devices: store.listDevices().length,
    });
  }

  // Auth (skip for /health and OPTIONS)
  const presented = bearerToken(req.headers);
  const authed = isValidAdminToken(presented, ADMIN_TOKEN);
  if (!authed) {
    return err(res, 401, 'UNAUTHORIZED', 'missing or invalid bearer token');
  }

  // Static-serve uploaded files (read-only)
  const m = /^\/api\/uploads\/([^/]+)\/raw$/.exec(pathname);
  if (req.method === 'GET' && m) {
    const att = store.getAttachment(m[1]!);
    if (!att) return err(res, 404, 'NOT_FOUND', 'attachment not found');
    try {
      const fs = await import('node:fs/promises');
      const buf = await fs.readFile(join(UPLOAD_DIR, att.id + extname(att.filename)));
      res.writeHead(200, {
        'content-type': att.mime,
        'content-length': buf.length,
        'cache-control': 'private, max-age=60',
      });
      res.end(buf);
    } catch {
      return err(res, 410, 'NOT_FOUND', 'attachment data missing');
    }
    return;
  }

  const found = matchRoute(routes, req.method ?? 'GET', pathname);
  if (!found) {
    return err(res, 404, 'NOT_FOUND', `no route for ${req.method} ${pathname}`);
  }

  let body: unknown = undefined;
  // Read JSON body for non-multipart POST/PUT
  const ct = (req.headers['content-type'] ?? '').toString();
  if ((req.method === 'POST' || req.method === 'PUT') && !ct.startsWith('multipart/')) {
    try {
      body = await readJson(req);
    } catch (e) {
      return err(res, 400, 'BAD_REQUEST', String((e as Error).message).toLowerCase());
    }
  }

  const ctx: HttpCtx = { req, res, url, method: req.method ?? 'GET', params: found.params, body, userId: 'admin' };
  try {
    await found.route.handler(ctx);
  } catch (e) {
    logger.error('http handler threw', { err: String(e), path: pathname });
    if (!res.headersSent) return err(res, 500, 'INTERNAL', 'internal error');
  }
}
