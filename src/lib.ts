import type { Event, Filters, Strings, Theme } from './types';

export interface Part { text: string; field: boolean }

/** Dotted path into an event; `changes.count` / `targets.count` are lengths, `target` falls back to `targets[0]`. */
export function field(ev: unknown, path: string): unknown {
  let v: any = ev;
  for (const k of path.split('.')) {
    if (k === 'count' && Array.isArray(v)) return v.length;
    const next = v != null && typeof v === 'object' ? v[k] : undefined;
    v = next === undefined && k === 'target' ? v?.targets?.[0] : next;
  }
  return v;
}

/** `field` as display text: objects render as "" (use the detail view for those). */
export function text(ev: unknown, path: string): string {
  const v = field(ev, path);
  return v == null || typeof v === 'object' ? '' : String(v);
}

/** Split a template into text and field parts. The caller renders every part via textContent, so data is never parsed as HTML. */
export function interpolate(tpl: string, ev: Event): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of tpl.matchAll(/\{([\w.]+)\}/g)) {
    if (m.index! > last) out.push({ text: tpl.slice(last, m.index), field: false });
    out.push({ text: text(ev, m[1]!), field: true });
    last = m.index! + m[0].length;
  }
  if (last < tpl.length) out.push({ text: tpl.slice(last), field: false });
  return out;
}

/** Built-in copy (en); the theme's per-locale strings override it. */
export const EN: Strings = {
  title: 'Activity', emptyState: 'No activity yet.', loadMore: 'Load more', allActions: 'All actions', error: 'Could not load activity.',
  retry: 'Retry', search: 'Search', actor: 'Actor', allActors: 'All actors', targetType: 'Target type', allTargets: 'All target types',
  targetId: 'Target id', outcome: 'Outcome', severity: 'Severity', any: 'Any', range: 'Time range', last24h: 'Last 24 hours',
  last7d: 'Last 7 days', last30d: 'Last 30 days', allTime: 'All time', custom: 'Custom', from: 'From', to: 'To', export: 'Export',
  verify: 'Verify', newEvents: '{n} new events', viaSupport: 'via support', close: 'Close', copy: 'Copy', details: 'Details',
  changes: 'Changes', field: 'Field', before: 'Before', after: 'After', targets: 'Targets', context: 'Context',
  credential: 'Credential', onBehalfOf: 'On behalf of', metadata: 'Metadata', verified: 'Verified: {n} events, signature valid.',
  verifiedServer: 'Verified by server: {n} events.', tampered: 'Verification failed at event {n}.', loading: 'Loading…',
};

/**
 * Theme strings for a locale: built-ins < theme "default" < base language ("pt") < exact locale ("pt-BR").
 * A flat map (every value a string) is the legacy form and counts as "default".
 */
export function pickStrings(strings: Theme['strings'], locale: string | undefined, builtins: Record<string, Strings> = {}): Strings {
  const s = strings ?? {};
  const flat = Object.values(s).some((v) => typeof v === 'string');
  const map = (flat ? { default: s } : s) as Record<string, Strings | undefined>;
  const chain = ['default', ...(locale ? [locale.split('-')[0]!, locale] : [])];
  const out: Strings = { ...EN };
  for (const l of chain.slice(1)) Object.assign(out, builtins[l]);
  for (const l of chain) Object.assign(out, map[l]);
  return out;
}

/** Fill `{n}` style placeholders of a UI string. */
export const fmt = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));

/** Claims of a viewer JWS (unverified, display only: the server enforces caps). */
export function claims(token: string): { cap: string[]; locale?: string; tz?: string; rgn?: string } {
  try {
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    const cap = p.cap ?? p.caps ?? ['read'];
    // claim names as minted by the server: cap, loc, tz, rgn
    return { cap: Array.isArray(cap) ? cap : [cap], locale: p.loc ?? p.locale, tz: p.tz ?? p.time_zone, rgn: p.rgn };
  } catch {
    return { cap: ['read'] };
  }
}

export const RANGES: Record<string, number> = { '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };

/** Filters -> feed query; a quick range resolves to `from` at call time. Empty values are dropped. */
export function toQuery(f: Filters, now = Date.now()): URLSearchParams {
  const q = new URLSearchParams();
  const quick = f.range ? RANGES[f.range] : undefined;
  for (const [k, v] of Object.entries(f)) if (v && k !== 'range' && !(quick && (k === 'from' || k === 'to'))) q.set(k, v.trim());
  if (quick) q.set('from', new Date(now - quick).toISOString());
  return q;
}

const KEYS = ['bg', 'fg', 'muted', 'accent', 'border', 'danger'] as const;
// CSS custom property values come from a trusted-but-editable theme: refuse anything that could close the declaration.
const safe = (v: unknown): v is string | number => (typeof v === 'string' || typeof v === 'number') && !/[;{}<>]|url\(|expression\(/i.test(String(v));

/**
 * Precedence, highest first: attribute (`accent`) > host page `--wt-activity-*` > theme. Host vars are applied with
 * var() fallbacks so a page can set them in plain CSS at any time.
 */
export function applyTheme(host: HTMLElement, theme: Theme | undefined, dark: boolean, accent?: string): void {
  const t = theme ?? {};
  const set = (name: string, val: unknown) => {
    if (val !== undefined && safe(val)) host.style.setProperty(`--wta-${name}`, `var(--wt-activity-${name}, ${val})`);
    else host.style.removeProperty(`--wta-${name}`);
  };
  const pal = { ...t.palette, ...(dark ? t.paletteDark : {}) };
  for (const k of KEYS) set(k, pal[k]);
  set('font', t.font?.family);
  set('radius', typeof t.radius === 'number' ? `${t.radius}px` : t.radius);
  if (accent && safe(accent)) host.style.setProperty('--wta-accent', accent);
}

export function isDark(scheme: string | null | undefined, theme: Theme | undefined): boolean {
  const s = scheme || theme?.colorScheme || 'system';
  return s === 'dark' || (s === 'system' && typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
}

export function relTime(iso: string, now = Date.now(), locale?: string): string {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12]];
  let v = s;
  for (const [u, n] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), u);
    v /= n;
  }
  return rtf.format(Math.round(v), 'year');
}

/** Intl date in the session's locale and time zone; an unknown zone falls back to the browser's. */
export function fmtDate(iso: string, locale?: string, timeZone?: string, o: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'medium' }): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...o, timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(locale, o).format(new Date(iso));
  }
}

/** Reads a text/event-stream body and calls `on(data, event)` per event; stops after an `end` event. */
export async function readSse(body: ReadableStream<Uint8Array>, on: (data: string, event: string) => void): Promise<void> {
  const r = body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await r.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const lines = buf.slice(0, i).split('\n');
      buf = buf.slice(i + 2);
      const ev = lines.find((l) => l.startsWith('event:'))?.slice(6).trim() ?? 'message';
      const data = lines.filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n');
      if (data) on(data, ev);
      if (ev === 'end') return void r.cancel();
    }
  }
}

/** New events in one `/feed/stream` message: `new` carries `{count, latest_received_at}`. */
export const sseCount = (data: string, ev: string): number => {
  try { return ev === 'new' ? Number(JSON.parse(data).count) || 0 : 0; } catch { return 0; }
};

/** Self-audit events written by Watchtower itself (`wt.activity.viewed`, `.exported`, ...). */
export const isAccessEvent = (e: Event) => e.action.startsWith('wt.activity.');

/** The API base of the token's region (`rgn`) from `GET /v1/regions`; `base` when that is already it, or on any failure. */
export async function regionBase(base: string, rgn: string | undefined): Promise<string> {
  if (!rgn) return base;
  try {
    const d = await (await fetch(`${base}/v1/regions`)).json() as { current?: string; data?: { region: string; api_base_url: string }[] };
    const x = d.current === rgn ? undefined : d.data?.find((r) => r.region === rgn);
    return x ? x.api_base_url.replace(/\/+$/, '') : base;
  } catch {
    return base;
  }
}
