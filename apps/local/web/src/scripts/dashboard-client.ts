// ══════════════════════════════════════════════════════════════════════════════
// dashboard-client — vanilla-TS helpers for the admin UI pages.
// ══════════════════════════════════════════════════════════════════════════════
//
// Astro output is static; every page renders skeletons at build time and hits
// the same-origin /v1/admin/* endpoints on DOMContentLoaded to populate them.
// The loopback middleware on the API side means no bearer token is needed
// from the browser (see apps/local/src/middleware/loopback.ts).
//
// Kept dependency-free on purpose — no framework, no fetcher lib. `<script>`
// blocks in .astro pages import from this module.
//
// ══════════════════════════════════════════════════════════════════════════════

export type CheckStatus = 'ok' | 'degraded' | 'error' | 'unknown';

export interface HealthPayload {
  status: 'ok' | 'degraded';
  schemaVersion: { current: number; required: number };
  checks: {
    db: { status: 'ok' | 'degraded'; message?: string };
    embedder: { status: 'ok' | 'degraded'; identity?: string; message?: string };
    mothership: {
      status: 'ok' | 'degraded' | 'unknown';
      mode: 'configured' | 'air_gapped';
      circuitState?: string;
    };
    migrations: {
      status: 'ok' | 'degraded';
      current: number;
      required: number;
      message?: string;
    };
  };
}

export interface BudgetSnapshot {
  tenantId: string;
  plan: string;
  tokensTotal: number;
  tokensRemaining: number;
  tokensResetAt: string;
  lowBalance: boolean;
  cachedAt: string;
}

export interface BudgetPayload {
  budget: BudgetSnapshot | null;
  mode: 'configured' | 'air_gapped';
}

const STATUS_CONFIG: Record<CheckStatus, { fg: string; bg: string; border: string }> = {
  ok:       { fg: '#6ee7b7', bg: 'rgba(110, 231, 183, 0.12)', border: '#34d399' },
  degraded: { fg: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)',  border: '#f59e0b' },
  error:    { fg: '#f87171', bg: 'rgba(248, 113, 113, 0.12)', border: '#ef4444' },
  unknown:  { fg: '#8b8b93', bg: 'rgba(139, 139, 147, 0.12)', border: '#3f3f46' },
};

/**
 * Fetch same-origin JSON. Throws on network error; on non-2xx returns the
 * body payload (so the caller can render error messages from /v1/admin/*
 * error envelopes).
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

/** Render a rounded pill inline. */
export function pillMarkup(status: CheckStatus, label?: string): string {
  const c = STATUS_CONFIG[status];
  const text = label ?? status;
  return (
    `<span class="inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-full border" ` +
    `style="background-color:${c.bg};color:${c.fg};border-color:${c.border};" data-status="${status}">` +
    `<span class="inline-block h-1.5 w-1.5 rounded-full" style="background-color:${c.fg};"></span>` +
    `${escapeHtml(text)}` +
    `</span>`
  );
}

/** Populate a `[data-budget-gauge]` element from a budget payload. */
export function renderBudgetGauge(root: HTMLElement, payload: BudgetPayload): void {
  const slots = (name: string) =>
    root.querySelector<HTMLElement>(`[data-slot="${name}"]`);

  const remaining = slots('remaining');
  const total = slots('total');
  const bar = slots('bar');
  const plan = slots('plan');
  const reset = slots('reset');
  const cached = slots('cached');
  const empty = slots('empty');

  if (payload.budget === null) {
    if (empty) {
      empty.textContent =
        payload.mode === 'air_gapped'
          ? 'Air-gap mode — no mothership budget to display.'
          : 'No budget snapshot cached yet. Try refreshing from mothership.';
      empty.classList.remove('hidden');
    }
    if (bar) bar.style.width = '0%';
    return;
  }

  if (empty) empty.classList.add('hidden');

  const b = payload.budget;
  const pct = b.tokensTotal > 0 ? (b.tokensRemaining / b.tokensTotal) * 100 : 0;

  if (remaining) remaining.textContent = formatNumber(b.tokensRemaining);
  if (total) total.textContent = formatNumber(b.tokensTotal);
  if (plan) plan.textContent = b.plan ?? '—';
  if (reset) reset.textContent = formatDate(b.tokensResetAt);
  if (cached) cached.textContent = formatDate(b.cachedAt);
  if (bar) {
    bar.style.width = `${Math.max(0, Math.min(100, pct)).toFixed(1)}%`;
    bar.style.backgroundColor = colourForPct(pct, b.lowBalance);
  }
}

function colourForPct(pct: number, lowBalance: boolean): string {
  if (lowBalance || pct < 10) return '#f87171';
  if (pct < 25) return '#fbbf24';
  return '#6ee7b7';
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n);
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert a health-check status to a StatusPill status. */
export function toPillStatus(s: 'ok' | 'degraded' | 'unknown' | undefined): CheckStatus {
  if (s === 'ok') return 'ok';
  if (s === 'degraded') return 'degraded';
  return 'unknown';
}
