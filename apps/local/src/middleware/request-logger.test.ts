import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import pino from 'pino';
import { Writable } from 'node:stream';

import { requestLogger } from './request-logger.js';
import { tenantContext } from './tenant.js';

function captureStream(): { stream: Writable; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      const text = chunk.toString('utf8').trim();
      for (const line of text.split('\n')) {
        if (line.length === 0) continue;
        try {
          lines.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          // ignore non-JSON output
        }
      }
      cb();
    },
  });
  return { stream, lines };
}

function buildApp(headerName = 'X-Request-Id'): {
  app: Hono;
  lines: Record<string, unknown>[];
} {
  const { stream, lines } = captureStream();
  const logger = pino({ level: 'info' }, stream);
  const app = new Hono();
  app.use('*', tenantContext);
  app.use('*', requestLogger({ logger, requestIdHeader: headerName }));
  app.get('/hello', (c) => c.text('hi'));
  app.get('/echo-id', (c) => c.json({ requestId: c.get('requestId') }));
  app.get('/boom', () => {
    throw new Error('kaboom');
  });
  return { app, lines };
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('requestLogger (T-2.15)', () => {
  it('generates a UUID v4 request id when the header is absent', async () => {
    const { app, lines } = buildApp();
    const res = await app.request('http://localhost/hello');

    expect(res.status).toBe(200);
    const echoed = res.headers.get('X-Request-Id');
    expect(echoed).toMatch(UUID_V4);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      msg: 'request',
      method: 'GET',
      path: '/hello',
      status: 200,
      tenant_id: null,
    });
    expect(lines[0].req_id).toBe(echoed);
    expect(typeof lines[0].duration_ms).toBe('number');
  });

  it('honors an inbound request id when it matches the shape guard', async () => {
    const { app, lines } = buildApp();
    const inbound = 'req-abc.123_TEST-42';
    const res = await app.request('http://localhost/echo-id', {
      headers: { 'X-Request-Id': inbound },
    });

    expect(res.headers.get('X-Request-Id')).toBe(inbound);
    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(inbound);

    expect(lines[0].req_id).toBe(inbound);
  });

  it('rejects malformed inbound ids (too long / illegal chars) and mints a fresh one', async () => {
    const { app, lines } = buildApp();
    // 129 chars — exceeds the 128-char guard
    const overlong = 'a'.repeat(129);
    const res = await app.request('http://localhost/hello', {
      headers: { 'X-Request-Id': overlong },
    });

    const echoed = res.headers.get('X-Request-Id');
    expect(echoed).not.toBe(overlong);
    expect(echoed).toMatch(UUID_V4);
    expect(lines[0].req_id).toBe(echoed);
  });

  it('honors a custom header name (LOG_REQUEST_ID_HEADER override)', async () => {
    const { app, lines } = buildApp('X-Trace-Id');
    const res = await app.request('http://localhost/hello', {
      headers: { 'X-Trace-Id': 'trace-42' },
    });

    expect(res.headers.get('X-Trace-Id')).toBe('trace-42');
    // Default header not touched.
    expect(res.headers.get('X-Request-Id')).toBeNull();
    expect(lines[0].req_id).toBe('trace-42');
  });

  it('propagates tenant_id from the tenant middleware into the log line', async () => {
    const { app, lines } = buildApp();
    await app.request('http://localhost/hello', {
      headers: { 'X-Tenant-Id': 'acme' },
    });

    expect(lines[0].tenant_id).toBe('acme');
  });

  it('logs an error line + re-throws on handler failure so Hono can 500', async () => {
    const { app, lines } = buildApp();
    const res = await app.request('http://localhost/boom');

    // Hono's default error handler → 500.
    expect(res.status).toBe(500);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      msg: 'request failed',
      method: 'GET',
      path: '/boom',
      err: 'kaboom',
    });
    // ERROR level = 50 in pino numeric codes.
    expect(lines[0].level).toBe(50);
  });

  it('stashes a pino child logger on context bound to req_id + method + path', async () => {
    const { stream, lines } = captureStream();
    const logger = pino({ level: 'info' }, stream);
    const app = new Hono();
    app.use('*', requestLogger({ logger, requestIdHeader: 'X-Request-Id' }));
    app.get('/x', (c) => {
      const l = c.get('logger');
      l.info({ extra: 'hi' }, 'handler-event');
      return c.text('ok');
    });

    await app.request('http://localhost/x');

    // First line = handler-event, second line = request summary.
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      msg: 'handler-event',
      extra: 'hi',
      method: 'GET',
      path: '/x',
    });
    expect(lines[1]).toMatchObject({ msg: 'request' });
    // Same req_id on both.
    expect(lines[0].req_id).toBe(lines[1].req_id);
  });

  it('emits a numeric duration_ms field on every log line', async () => {
    const { app, lines } = buildApp();
    await app.request('http://localhost/hello');
    expect(typeof lines[0].duration_ms).toBe('number');
    expect((lines[0].duration_ms as number) >= 0).toBe(true);
  });
});
