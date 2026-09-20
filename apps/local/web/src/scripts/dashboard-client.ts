// ══════════════════════════════════════════════════════════════════════════════
// dashboard-client — vanilla-TS helpers for the admin UI pages.
// ══════════════════════════════════════════════════════════════════════════════
//
// Astro output is static; every page renders skeletons at build time and hits
// the same-origin /v1/admin/* endpoints on DOMContentLoaded to populate them.
// A loopback caller (local dev) is bypassed by admin-auth so no token is
// needed; an over-network caller (Docker bridge, LAN) must present the admin
// token. `fetchJson` attaches it as a bearer from sessionStorage, and on a 401
// dispatches `admin-auth-required` so the Base layout can prompt for it (#44).
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

export interface AdminSkillItem {
  id: string;
  slug: string;
  name: string;
  source: string;
  version: string;
  mothershipPublishStatus: string | null;
  mothershipUrl: string | null;
  mothershipPublishedAt: string | null;
  createdAt: string | null;
}

export interface AdminSkillsListPayload {
  skills: AdminSkillItem[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * `GET /v1/skills/:id` payload as the admin detail drawer consumes it (#83).
 * Deliberately loose — the drawer renders whatever the API returns, grouped by
 * section, so a new manifest field shows up without a UI change. Only the
 * fields the drawer references by name are typed.
 */
export interface SkillDetailPayload {
  id: string;
  slug: string;
  name: string;
  version: string;
  status?: string | null;
  [key: string]: unknown;
}

/** Statuses an operator may set from the UI — mirrors AdminSkillStatusSchema. */
export const EDITABLE_STATUSES = ['draft', 'published', 'deprecated', 'archived'] as const;

export type PublishStatus = 'unpublished' | 'pending' | 'published' | 'failed' | 'unknown';

/**
 * Normalise DB-shaped mothership_publish_status to the tags the UI knows
 * how to render. NULL / unset counts as "unpublished" — the skill was
 * ingested locally and never promoted to the mothership.
 */
export function toPublishStatus(s: string | null | undefined): PublishStatus {
  if (s === null || s === undefined || s === '') return 'unpublished';
  if (s === 'pending' || s === 'published' || s === 'failed' || s === 'unpublished') {
    return s;
  }
  return 'unknown';
}

const PUBLISH_STATUS_TO_PILL: Record<PublishStatus, CheckStatus> = {
  unpublished: 'unknown',
  pending: 'degraded',
  published: 'ok',
  failed: 'error',
  unknown: 'unknown',
};

export function publishStatusToPill(s: PublishStatus): CheckStatus {
  return PUBLISH_STATUS_TO_PILL[s];
}

const STATUS_CONFIG: Record<CheckStatus, { fg: string; bg: string; border: string }> = {
  ok:       { fg: '#6ee7b7', bg: 'rgba(110, 231, 183, 0.12)', border: '#34d399' },
  degraded: { fg: '#fbbf24', bg: 'rgba(251, 191, 36, 0.12)',  border: '#f59e0b' },
  error:    { fg: '#f87171', bg: 'rgba(248, 113, 113, 0.12)', border: '#ef4444' },
  unknown:  { fg: '#8b8b93', bg: 'rgba(139, 139, 147, 0.12)', border: '#3f3f46' },
};

// ── Admin token (session-scoped) ────────────────────────────────────────────
// Stored in sessionStorage (cleared when the tab closes). Loopback callers
// never need it (admin-auth bypasses the bearer for local sockets); over the
// network the operator supplies ADMIN_TOKEN via the login prompt.
const ADMIN_TOKEN_KEY = 'sr_admin_token';

export function getAdminToken(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAdminToken(token: string): void {
  try {
    sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
  } catch {
    /* sessionStorage unavailable — no-op */
  }
}

export function clearAdminToken(): void {
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  } catch {
    /* no-op */
  }
}

/**
 * Fetch same-origin JSON, attaching the admin bearer token when one is stored.
 * Throws on network error; on non-2xx returns the body payload (so the caller
 * can render error messages from /v1/admin/* error envelopes). On a 401 it
 * clears the stored token and dispatches `admin-auth-required` on `window` so
 * the Base layout can surface the login prompt.
 */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: T }> {
  const token = getAdminToken();
  const auth = token ? { authorization: `Bearer ${token}` } : {};
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', ...auth, ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    clearAdminToken();
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent('admin-auth-required'));
    }
  }
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

/**
 * Allow only absolute http(s) URLs from API data. `escapeHtml` alone does
 * not make `javascript:` / `data:` / protocol-relative values safe as hrefs.
 * Returns the WHATWG-normalised href, or null when the string is not an
 * http(s) URL after trim.
 */
export function safeHttpUrl(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === '') return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    /* not an absolute URL */
  }
  return null;
}

/** One dashboard health-list row. Every dynamic substring is escaped. */
export function healthCheckRowMarkup(
  key: string,
  status: CheckStatus,
  label: string,
  sub?: string,
): string {
  const subHtml =
    sub !== undefined && sub !== ''
      ? ` <span class="text-xs" style="color: var(--color-text-muted);">${escapeHtml(sub)}</span>`
      : '';
  return (
    `<li class="flex items-center justify-between">` +
    `<span>${escapeHtml(key)}${subHtml}</span>` +
    pillMarkup(status, label) +
    `</li>`
  );
}

/** Convert a health-check status to a StatusPill status. */
export function toPillStatus(s: 'ok' | 'degraded' | 'unknown' | undefined): CheckStatus {
  if (s === 'ok') return 'ok';
  if (s === 'degraded') return 'degraded';
  return 'unknown';
}
