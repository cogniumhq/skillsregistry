import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { getTenantId, tenantContext } from './tenant.js';

function buildApp(): Hono {
  const app = new Hono();
  app.use('*', tenantContext);
  app.get('/probe', (c) => c.json({ tenantId: getTenantId(c) }));
  return app;
}

describe('tenantContext', () => {
  it('resolves the tenant id when the header is present', async () => {
    const res = await buildApp().request('/probe', {
      headers: { 'X-Tenant-Id': 'tenant-abc123' },
    });
    expect(await res.json()).toEqual({ tenantId: 'tenant-abc123' });
  });

  it('resolves the tenant id from a lower-case header', async () => {
    const res = await buildApp().request('/probe', {
      headers: { 'x-tenant-id': 'tenant-abc123' },
    });
    expect(await res.json()).toEqual({ tenantId: 'tenant-abc123' });
  });

  it('returns null when the header is missing', async () => {
    const res = await buildApp().request('/probe');
    expect(await res.json()).toEqual({ tenantId: null });
  });

  it('drops empty / whitespace-only tenant ids as null', async () => {
    const res = await buildApp().request('/probe', {
      headers: { 'X-Tenant-Id': '  ' },
    });
    expect(await res.json()).toEqual({ tenantId: null });
  });

  it('drops values that fail the shape guard (e.g. contain spaces)', async () => {
    const res = await buildApp().request('/probe', {
      headers: { 'X-Tenant-Id': 'bad value with spaces' },
    });
    expect(await res.json()).toEqual({ tenantId: null });
  });

  it('accepts the documented ASCII shape (letters, digits, . _ : -)', async () => {
    const res = await buildApp().request('/probe', {
      headers: { 'X-Tenant-Id': 'tenant.example_1:v-2' },
    });
    expect(await res.json()).toEqual({ tenantId: 'tenant.example_1:v-2' });
  });

  it('drops values over 128 chars', async () => {
    const tooLong = 'a'.repeat(129);
    const res = await buildApp().request('/probe', {
      headers: { 'X-Tenant-Id': tooLong },
    });
    expect(await res.json()).toEqual({ tenantId: null });
  });
});
