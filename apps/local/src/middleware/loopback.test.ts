import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  isLoopbackAddress,
  isLoopbackRequest,
  loopbackOnly,
  readRemoteAddress,
} from './loopback.js';

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', loopbackOnly());
  app.get('/probe', (c) => c.json({ ok: true }));
  return app;
}

function env(remoteAddress: string | null | undefined): Record<string, unknown> {
  return { incoming: { socket: { remoteAddress } } };
}

describe('isLoopbackAddress', () => {
  it.each([
    '127.0.0.1',
    '127.0.0.42',
    '127.1.2.3',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:127.0.0.42',
    '::ffff:7f00:1',
    '::ffff:7f01:0202',
  ])('accepts %s', (addr) => {
    expect(isLoopbackAddress(addr)).toBe(true);
  });

  it.each([
    '10.0.0.1',
    '192.168.1.42',
    '172.20.0.5',
    '8.8.8.8',
    '::ffff:8.8.8.8',
    '::ffff:c0a8:0101',
    '2001:db8::1',
    'fe80::1',
    'not-an-ip',
    '',
  ])('rejects %s', (addr) => {
    expect(isLoopbackAddress(addr)).toBe(false);
  });

  it.each([null, undefined])('rejects nullish (%p)', (addr) => {
    expect(isLoopbackAddress(addr)).toBe(false);
  });
});

describe('readRemoteAddress', () => {
  it('extracts a string address from env.incoming.socket.remoteAddress', () => {
    expect(readRemoteAddress(env('127.0.0.1'))).toBe('127.0.0.1');
  });

  it.each([null, undefined, {}, { incoming: null }, { incoming: {} }, { incoming: { socket: null } }])(
    'returns null when the shape is broken (%p)',
    (broken) => {
      expect(readRemoteAddress(broken)).toBeNull();
    },
  );

  it('returns null when remoteAddress is empty', () => {
    expect(readRemoteAddress(env(''))).toBeNull();
  });
});

describe('isLoopbackRequest', () => {
  it('is true for loopback env', () => {
    expect(isLoopbackRequest(env('127.0.0.1'))).toBe(true);
  });
  it('is false for LAN env', () => {
    expect(isLoopbackRequest(env('192.168.1.42'))).toBe(false);
  });
  it('is false when env has no incoming socket (defensive default)', () => {
    expect(isLoopbackRequest({})).toBe(false);
  });
});

describe('loopbackOnly middleware', () => {
  it('lets 127.0.0.1 through', async () => {
    const res = await buildApp().request('/probe', {}, env('127.0.0.1'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('lets ::1 through', async () => {
    const res = await buildApp().request('/probe', {}, env('::1'));
    expect(res.status).toBe(200);
  });

  it('lets ::ffff:127.0.0.1 through', async () => {
    const res = await buildApp().request('/probe', {}, env('::ffff:127.0.0.1'));
    expect(res.status).toBe(200);
  });

  it('rejects a LAN IP with 403 + forbidden envelope', async () => {
    const res = await buildApp().request('/probe', {}, env('192.168.1.42'));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('forbidden');
    expect(body.error.message).toMatch(/loopback-only/);
  });

  it('rejects an unroutable / missing address (fail-closed)', async () => {
    const res = await buildApp().request('/probe', {}, env(undefined));
    expect(res.status).toBe(403);
  });

  it('rejects when the env has no incoming socket at all', async () => {
    const res = await buildApp().request('/probe');
    expect(res.status).toBe(403);
  });
});
