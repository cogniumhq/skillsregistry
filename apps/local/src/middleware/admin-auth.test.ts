import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { adminAuth } from './admin-auth.js';

const TOKEN = 'my-super-secret-admin-token';

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', adminAuth({ token: TOKEN }));
  app.get('/probe', (c) => c.json({ ok: true }));
  return app;
}

describe('adminAuth', () => {
  it('rejects construction with an empty token', () => {
    expect(() => adminAuth({ token: '' })).toThrow();
  });

  it('rejects requests missing the Authorization header', async () => {
    const res = await buildApp().request('/probe');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('unauthenticated');
  });

  it('rejects a non-Bearer scheme', async () => {
    const res = await buildApp().request('/probe', {
      headers: { Authorization: `Basic ${TOKEN}` },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/Bearer/);
  });

  it('rejects a mismatched token', async () => {
    const res = await buildApp().request('/probe', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Invalid admin token');
  });

  it('accepts the correct token and calls next()', async () => {
    const res = await buildApp().request('/probe', {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('accepts a lower-case `bearer` scheme (case-insensitive)', async () => {
    const res = await buildApp().request('/probe', {
      headers: { Authorization: `bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  it('accepts the header name in lower-case', async () => {
    const res = await buildApp().request('/probe', {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
  });

  describe('loopback exception', () => {
    const loopbackEnv = (
      remoteAddress: string,
    ): Record<string, unknown> => ({
      incoming: { socket: { remoteAddress } },
    });

    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1'])(
      'bypasses the bearer check for %s',
      async (addr) => {
        // No Authorization header — would normally be 401.
        const res = await buildApp().request('/probe', {}, loopbackEnv(addr));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      },
    );

    it('bypasses even when a wrong bearer is presented from loopback', async () => {
      const res = await buildApp().request(
        '/probe',
        { headers: { Authorization: 'Bearer this-is-wrong' } },
        loopbackEnv('127.0.0.1'),
      );
      expect(res.status).toBe(200);
    });

    it('still requires bearer from a LAN caller', async () => {
      const res = await buildApp().request(
        '/probe',
        {},
        loopbackEnv('192.168.1.42'),
      );
      expect(res.status).toBe(401);
    });

    it('LAN caller with correct bearer is accepted (over-network contract preserved)', async () => {
      const res = await buildApp().request(
        '/probe',
        { headers: { Authorization: `Bearer ${TOKEN}` } },
        loopbackEnv('192.168.1.42'),
      );
      expect(res.status).toBe(200);
    });
  });
});
