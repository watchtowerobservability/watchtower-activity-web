// Pure viewer logic shared by <wt-activity> (lazy ux.js) and the hosted page (apps/web imports this
// file by path): ICU plurals, locale files, event grouping, delegation chains, related-event
// queries and redaction markers. No DOM, no imports, so both builds can take it as is.

/** `{n}` placeholders plus ICU plurals: `{n, plural, =0 {none} one {# event} other {# events}}`. */
export function fmt(s: string, vars: Record<string, string | number>, locale?: string): string {
  const out = s.replace(/\{(\w+),\s*plural,((?:\s*(?:=\d+|zero|one|two|few|many|other)\s*\{[^{}]*\})+)\s*\}/g, (m, k: string, body: string) => {
    const n = Number(vars[k]);
    if (!(k in vars) || Number.isNaN(n)) return m;
    const forms: Record<string, string> = {};
    for (const f of body.matchAll(/(=\d+|zero|one|two|few|many|other)\s*\{([^{}]*)\}/g)) forms[f[1]!] = f[2]!;
    let cat = 'other';
    try { cat = new Intl.PluralRules(locale).select(n); } catch { /* unknown locale: other */ }
    const pick = forms[`=${n}`] ?? forms[cat] ?? forms.other ?? m;
    return pick.replace(/#/g, (() => { try { return new Intl.NumberFormat(locale).format(n); } catch { return String(n); } })());
  });
  return out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Built-in locales (besides en). Regional variants load their base file first. */
export const LOCALE_TAGS = [
  'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'es', 'es-419', 'et', 'fa', 'fi', 'fil', 'fr', 'fr-CA', 'he', 'hi', 'hr', 'hu',
  'id', 'it', 'ja', 'ko', 'lt', 'lv', 'ms', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl', 'sr', 'sv', 'sw', 'th',
  'tr', 'uk', 'ur', 'vi', 'zh-CN', 'zh-TW',
] as const;
const PARENT: Record<string, string> = { 'es-419': 'es', 'fr-CA': 'fr', 'pt-PT': 'pt-BR' };
const ALIAS: Record<string, string> = { pt: 'pt-BR', zh: 'zh-CN', 'zh-Hant': 'zh-TW', 'zh-HK': 'zh-TW', 'zh-MO': 'zh-TW', no: 'nb', nn: 'nb', iw: 'he', tl: 'fil', in: 'id' };

/** The locale files to load for `locale`, base first ([] for English or an unknown language). */
export function localeFiles(locale: string | undefined): string[] {
  if (!locale) return [];
  const tags = LOCALE_TAGS as readonly string[];
  const region = locale.replace(/_/g, '-');
  const lang = region.split('-')[0]!.toLowerCase();
  const variant = /^zh-(Hant|TW|HK|MO)\b/i.test(region) ? 'zh-TW' : /^es-(?!ES\b)/i.test(region) ? 'es-419'
    : /^pt-(PT|AO|MZ)\b/i.test(region) ? 'pt-PT' : undefined;
  const exact = tags.find((t) => t.toLowerCase() === region.toLowerCase()) ?? ALIAS[region] ?? variant ?? ALIAS[lang]
    ?? tags.find((t) => t === lang);
  if (!exact) return [];
  return PARENT[exact] ? [PARENT[exact]!, exact] : [exact];
}

const RTL = /^(ar|he|iw|fa|ur|ps|sd|yi|dv|ckb|ug)\b/i;
export const dirFor = (locale?: string) => (RTL.test(locale ?? '') ? 'rtl' : 'ltr');

interface Ev { id: string; action: string; occurred_at: string; actor: { id: string; name?: string; type?: string } }

/**
 * Runs of adjacent events by the same actor with the same action, each within `gapMs` of the previous
 * (default 5 minutes), e.g. "Ann changed 4 settings". Order is kept; a run of one is a plain row.
 */
export function groupRuns<T extends Ev>(evs: T[], gapMs = 3e5): T[][] {
  const out: T[][] = [];
  for (const e of evs) {
    const run = out[out.length - 1], last = run?.[run.length - 1];
    if (last && last.actor.id === e.actor.id && last.action === e.action && Math.abs(Date.parse(last.occurred_at) - Date.parse(e.occurred_at)) <= gapMs) run!.push(e);
    else out.push([e]);
  }
  return out;
}

/** One hop of a delegation chain (`via[]`): who acted for whom, with what model or tool, approved by whom. */
export interface Hop { actor: { id: string; name?: string; type?: string }; credential?: { type?: string; id?: string }; model?: string; tool?: string; approved_by?: { id: string; name?: string }; sig?: string }

/**
 * "Agent X (claude-opus) for Ann, approved by Bob": the event's actor, then each hop it acted for, nearest
 * first. A hop that repeats the event's actor only adds its model, tool and approval.
 */
export function viaText(actor: { id: string; name?: string }, via: Hop[] | undefined, s: Record<string, string>): string {
  if (!via?.length) return '';
  const name = (a: { id: string; name?: string }) => a.name || a.id;
  const parts: string[] = [];
  const hops = via.slice(0, 5);
  const self = hops[0]?.actor.id === actor.id ? hops.shift() : undefined;
  const label = (a: { id: string; name?: string }, h?: Hop) => {
    let t = name(a);
    if (h?.model) t += ` (${h.model})`;
    if (h?.tool) t += ` ${fmt(s.usingTool ?? 'using {tool}', { tool: h.tool })}`;
    return t;
  };
  parts.push(label(actor, self));
  for (const h of hops) parts.push(`${s.viaFor ?? 'for'} ${label(h.actor, h)}`);
  const approvals = [self, ...hops].filter((h) => h?.approved_by).map((h) => fmt(s.approvedBy ?? 'approved by {name}', { name: name(h!.approved_by!) }));
  return parts.join(' ') + (approvals.length ? `, ${approvals.join(', ')}` : '');
}

const q = (v: string) => (/[\s"]/.test(v) ? `"${v.replace(/"/g, '')}"` : v);

/** Pivots of one event into the feed's search: `[string key, q]` for each id it carries. */
export function relatedQueries(e: { actor: { id: string }; target?: { id: string }; targets?: { id: string }[]; context?: { session_id?: string; request_id?: string }; credential?: { id?: string; fingerprint?: string }; trace_id?: string }): [string, string][] {
  const t = e.target ?? e.targets?.[0];
  const c = e.credential?.id ?? e.credential?.fingerprint;
  const out: [string, string | undefined][] = [
    ['sameSession', e.context?.session_id && `session:${q(e.context.session_id)}`],
    ['sameRequest', e.context?.request_id && `request:${q(e.context.request_id)}`],
    ['sameActor', `actor:${q(e.actor.id)}`],
    ['sameTarget', t && `target:${q(t.id)}`],
    ['sameCredential', c && `credential:${q(c)}`],
    ['sameTrace', e.trace_id && `trace:${q(e.trace_id)}`],
  ];
  return out.filter((x): x is [string, string] => !!x[1]);
}

/** `[REDACTED]` (server redaction) or a tokenised IP / email (`2001:db8::/32`, `@token.invalid`). */
export const markKind = (v: string): 'redacted' | 'tokenized' | null =>
  v.includes('[REDACTED]') ? 'redacted' : /^2001:db8:|@token\.invalid$/i.test(v.trim()) ? 'tokenized' : null;

/** Whether `term` (e.g. `is:notable`) is in `q`; `toggleTerm` adds or removes it. */
export const hasTerm = (qs: string, term: string) => qs.split(/\s+/).includes(term);
export const toggleTerm = (qs: string, term: string) =>
  (hasTerm(qs, term) ? qs.split(/\s+/).filter((t) => t && t !== term) : [...qs.split(/\s+/).filter(Boolean), term]).join(' ');

/** A logging incident (WP5): a span where events may be missing or late. */
export interface Gap { kind: string; started_at: string; ended_at?: string | null }

/**
 * Where each gap goes in a list of event times: `out[i]` holds the gaps drawn just before row `i`,
 * `out[n]` those after every row. Newest first (default): before the first row older than the
 * gap's end (now while open). Oldest first (`asc`): before the first row newer than its start.
 */
export function placeGaps(times: string[], gaps: Gap[], now = Date.now(), asc = false): Gap[][] {
  const out: Gap[][] = Array.from({ length: times.length + 1 }, () => []);
  for (const g of gaps) {
    const at = asc ? Date.parse(g.started_at) : g.ended_at ? Date.parse(g.ended_at) : now;
    const i = times.findIndex((t) => (asc ? Date.parse(t) > at : Date.parse(t) < at));
    out[i < 0 ? times.length : i]!.push(g);
  }
  return out;
}
