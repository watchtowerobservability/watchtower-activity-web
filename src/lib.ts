import type { Event, Theme } from './types';

export interface Part { text: string; field: boolean }

function lookup(ev: unknown, path: string): string {
  let v: any = ev;
  for (const k of path.split('.')) v = v != null && typeof v === 'object' ? v[k] : undefined;
  return v == null || typeof v === 'object' ? '' : String(v);
}

/** Split a template into text and field parts. The caller renders every part via textContent, so data is never parsed as HTML. */
export function interpolate(tpl: string, ev: Event): Part[] {
  const out: Part[] = [];
  let last = 0;
  for (const m of tpl.matchAll(/\{([\w.]+)\}/g)) {
    if (m.index! > last) out.push({ text: tpl.slice(last, m.index), field: false });
    out.push({ text: lookup(ev, m[1]!), field: true });
    last = m.index! + m[0].length;
  }
  if (last < tpl.length) out.push({ text: tpl.slice(last), field: false });
  return out;
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

export function relTime(iso: string, now = Date.now()): string {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [['second', 60], ['minute', 60], ['hour', 24], ['day', 30], ['month', 12]];
  let v = s;
  for (const [u, n] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), u);
    v /= n;
  }
  return rtf.format(Math.round(v), 'year');
}
