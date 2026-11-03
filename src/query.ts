// Search chips: a small tokenizer over the qualifier syntax the feed's `q` accepts (the server parses
// it; this only drives the chips). Copy of apps/web/src/features/activity/hostedViews.ts tokenize().
const KEYS = 'action actor actor_email target target_type outcome severity country operation ip created occurred'.split(' ');

export interface Term { raw: string; key?: string; value: string; neg: boolean }

/** Whitespace-separated terms; double quotes group (`actor:"Ada L"`); `-key:value` negates. */
export function tokenize(q: string): Term[] {
  const out: Term[] = [];
  for (const [raw, neg, k, v, quoted] of q.matchAll(/(-?)([a-z_]+:)?("([^"]*)"?|\S+)/g)) {
    const key = k?.slice(0, -1);
    out.push(key && KEYS.includes(key) ? { raw: raw!, key, value: quoted ?? v!, neg: neg === '-' } : { raw: raw!, value: raw!, neg: false });
  }
  return out;
}

export const removeTerm = (q: string, i: number) => tokenize(q).filter((_, j) => j !== i).map((t) => t.raw).join(' ');
export const chipText = (t: Term, not = 'not') => (t.key ? `${t.neg ? not + ' ' : ''}${t.key}: ${t.value}` : t.value);
export const dirFor = (locale?: string) => (/^(ar|he|fa|ur|ps|sd|yi|dv|ckb)\b/i.test(locale ?? '') ? 'rtl' : 'ltr');

/** Per-element preferences in localStorage (blocked storage = defaults, session-only). */
export interface Prefs { limit: number; order: 'desc' | 'asc'; hidden: string[]; time: 'relative' | 'absolute' }
export function loadPrefs(key: string, limit: number): Prefs {
  const d: Prefs = { limit, order: 'desc', hidden: [], time: 'relative' };
  try {
    const p = { ...d, ...(JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Prefs>) };
    return { ...p, limit: [25, 50, 100].includes(p.limit) ? p.limit : limit, hidden: Array.isArray(p.hidden) ? p.hidden.map(String) : [] };
  } catch { return d; }
}
export const savePrefs = (key: string, p: Prefs) => { try { localStorage.setItem(key, JSON.stringify(p)); } catch { /* blocked */ } };
