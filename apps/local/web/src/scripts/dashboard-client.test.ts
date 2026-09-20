import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAdminToken,
  escapeHtml,
  fetchJson,
  getAdminToken,
  healthCheckRowMarkup,
  setAdminToken,
  formatDate,
  formatNumber,
  pillMarkup,
  publishStatusToPill,
  renderBudgetGauge,
  safeHttpUrl,
  toPublishStatus,
  toPillStatus,
  type BudgetPayload,
} from './dashboard-client.js';

describe('toPublishStatus', () => {
  it('maps null/empty to unpublished', () => {
    expect(toPublishStatus(null)).toBe('unpublished');
    expect(toPublishStatus(undefined)).toBe('unpublished');
    expect(toPublishStatus('')).toBe('unpublished');
  });

  it('passes through known statuses', () => {
    expect(toPublishStatus('published')).toBe('published');
    expect(toPublishStatus('pending')).toBe('pending');
    expect(toPublishStatus('failed')).toBe('failed');
  });

  it('returns unknown for unexpected values', () => {
    expect(toPublishStatus('weird')).toBe('unknown');
  });
});

describe('publishStatusToPill', () => {
  it('maps publish statuses to pill colours', () => {
    expect(publishStatusToPill('published')).toBe('ok');
    expect(publishStatusToPill('failed')).toBe('error');
    expect(publishStatusToPill('pending')).toBe('degraded');
    expect(publishStatusToPill('unpublished')).toBe('unknown');
  });
});

describe('toPillStatus', () => {
  it('maps health check statuses', () => {
    expect(toPillStatus('ok')).toBe('ok');
    expect(toPillStatus('degraded')).toBe('degraded');
    expect(toPillStatus('unknown')).toBe('unknown');
    expect(toPillStatus(undefined)).toBe('unknown');
  });
});

describe('formatNumber', () => {
  it('formats with grouping separators', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
});

describe('formatDate', () => {
  it('returns the raw string when parsing fails', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('formats valid ISO timestamps', () => {
    const out = formatDate('2026-01-15T12:00:00.000Z');
    expect(out).toContain('2026');
  });
});

describe('escapeHtml', () => {
  it('escapes HTML metacharacters', () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
    );
  });
});

describe('safeHttpUrl', () => {
  it('allows http and https after trim, returning the normalised href', () => {
    expect(safeHttpUrl('https://api.skillsregistry.net/skills/x')).toBe(
      'https://api.skillsregistry.net/skills/x',
    );
    expect(safeHttpUrl('http://localhost:3000/v1/health')).toBe(
      'http://localhost:3000/v1/health',
    );
    expect(safeHttpUrl('  https://example.com/path  ')).toBe('https://example.com/path');
  });

  it('rejects javascript, data, and other schemes', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('vbscript:msgbox(1)')).toBeNull();
    expect(safeHttpUrl('ftp://files.example/x')).toBeNull();
  });

  it('rejects protocol-relative, relative, and empty values', () => {
    expect(safeHttpUrl('//evil.example/path')).toBeNull();
    expect(safeHttpUrl('/admin/skills')).toBeNull();
    expect(safeHttpUrl('example.com')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
  });
});

describe('healthCheckRowMarkup', () => {
  it('escapes embedder identity and other dynamic substrings', () => {
    const html = healthCheckRowMarkup(
      'embedder',
      'ok',
      'ok',
      `<img src=x onerror=alert(1)>`,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('embedder');
    expect(html).toContain('data-status="ok"');
  });

  it('omits the sub span when identity is absent', () => {
    const html = healthCheckRowMarkup('database', 'ok', 'ok');
    expect(html).not.toContain('color: var(--color-text-muted)');
    expect(html).toContain('>database</span>');
  });
});

describe('pillMarkup', () => {
  it('includes status and escaped label', () => {
    const html = pillMarkup('ok', '<safe>');
    expect(html).toContain('data-status="ok"');
    expect(html).toContain('&lt;safe&gt;');
  });
});

describe('admin token helpers', () => {
  afterEach(() => clearAdminToken());

  it('round-trips a token through sessionStorage', () => {
    expect(getAdminToken()).toBeNull();
    setAdminToken('secret-token');
    expect(getAdminToken()).toBe('secret-token');
    clearAdminToken();
    expect(getAdminToken()).toBeNull();
  });
});

describe('fetchJson', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearAdminToken();
  });

  it('omits Authorization when no token is stored', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);

    await fetchJson('/v1/admin/health');
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it('attaches the stored token as a bearer', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    vi.stubGlobal('fetch', fetchMock);
    setAdminToken('t0ken');

    await fetchJson('/v1/admin/health');
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer t0ken');
  });

  it('on 401 clears the token and dispatches admin-auth-required', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'unauthenticated' } }),
      }),
    );
    setAdminToken('stale');
    const onAuth = vi.fn();
    window.addEventListener('admin-auth-required', onAuth);

    const result = await fetchJson('/v1/admin/health');
    expect(result.status).toBe(401);
    expect(getAdminToken()).toBeNull();
    expect(onAuth).toHaveBeenCalledTimes(1);
    window.removeEventListener('admin-auth-required', onAuth);
  });

  it('returns parsed JSON with ok flag', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      }),
    );

    const result = await fetchJson<{ status: string }>('/v1/admin/health');
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body.status).toBe('ok');
  });

  it('returns empty object when body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new SyntaxError('bad json');
        },
      }),
    );

    const result = await fetchJson<Record<string, never>>('/v1/admin/budget');
    expect(result.ok).toBe(false);
    expect(result.body).toEqual({});
  });
});

describe('renderBudgetGauge', () => {
  it('shows air-gap empty state when budget is null', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div data-slot="empty" class="hidden"></div>
      <div data-slot="bar" style="width:50%"></div>
    `;

    const payload: BudgetPayload = { budget: null, mode: 'air_gapped' };
    renderBudgetGauge(root, payload);

    const empty = root.querySelector('[data-slot="empty"]');
    expect(empty?.textContent).toContain('Air-gap mode');
    expect(empty?.classList.contains('hidden')).toBe(false);
    expect(root.querySelector<HTMLElement>('[data-slot="bar"]')?.style.width).toBe('0%');
  });

  it('renders remaining/total and bar width from snapshot', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <span data-slot="remaining"></span>
      <span data-slot="total"></span>
      <span data-slot="plan"></span>
      <span data-slot="reset"></span>
      <span data-slot="cached"></span>
      <div data-slot="bar" style="width:0%"></div>
      <div data-slot="empty" class="hidden"></div>
    `;

    const payload: BudgetPayload = {
      mode: 'configured',
      budget: {
        tenantId: 'local',
        plan: 'starter',
        tokensTotal: 1000,
        tokensRemaining: 250,
        tokensResetAt: '2026-02-01T00:00:00.000Z',
        lowBalance: false,
        cachedAt: '2026-01-01T00:00:00.000Z',
      },
    };

    renderBudgetGauge(root, payload);

    expect(root.querySelector('[data-slot="remaining"]')?.textContent).toBe('250');
    expect(root.querySelector('[data-slot="total"]')?.textContent).toBe('1,000');
    expect(root.querySelector('[data-slot="plan"]')?.textContent).toBe('starter');
    expect(root.querySelector<HTMLElement>('[data-slot="bar"]')?.style.width).toBe('25%');
  });
});
