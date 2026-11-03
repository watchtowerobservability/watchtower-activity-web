import { EN, applyTheme, claims, fmtDate, interpolate, isAccessEvent, isDark, pickStrings, regionBase, relTime, text, toQuery } from './lib';
import { fmt } from './viewlogic';
import { LOCALES } from './locales';
import { chipText, loadPrefs, removeTerm, savePrefs, tokenize, type Prefs } from './query';
import type { Event, Feed, Filters, MountOptions, Strings, Theme } from './types';

export type { Event, Feed, Filters, MountOptions, Theme, Palette, ActionStyle, Column, Strings, Target } from './types';
export { LOCALES } from './locales';
export { interpolate, applyTheme, pickStrings, toQuery, field, text, claims, fmtDate } from './lib';

const CSS = `:host{display:block;position:relative;font:14px/1.45 var(--wta-font,system-ui,sans-serif);color:var(--wta-fg,#1a1a1a);background:var(--wta-bg,#fff)}
*{box-sizing:border-box}.w{padding:16px}h2{font-size:18px;margin:0 0 12px}h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--wta-muted,#666);margin:16px 0 4px}
ul{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--wta-border,#e3e3e3);cursor:pointer}
.d li{padding:4px 0}time,.m{color:var(--wta-muted,#666);white-space:nowrap;font-size:12px}b{font-weight:600}
li[data-tone=danger] b.a{color:var(--wta-danger,#c0392b)}.m{display:block;white-space:normal}
button,select,input{font:inherit;color:inherit;background:transparent;border:1px solid var(--wta-border,#ccc);border-radius:var(--wta-radius,6px);padding:6px 10px}
button{cursor:pointer}:focus-visible{outline:2px solid var(--wta-accent,#2563eb);outline-offset:2px}
button.p{background:var(--wta-accent,#2563eb);color:#fff;border-color:transparent}.bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:8px}
.s{color:var(--wta-muted,#666);padding:24px 0;text-align:center}.e{color:var(--wta-danger,#c0392b)}
.g{display:inline-block;font-size:11px;border:1px solid var(--wta-border,#ccc);border-radius:9px;padding:0 6px;margin-left:6px}.g.x{color:var(--wta-danger,#c0392b)}
.dr{position:absolute;inset:0 0 0 auto;width:min(28rem,100%);overflow:auto;background:var(--wta-bg,#fff);border-left:1px solid var(--wta-border,#ccc);padding:16px;z-index:2}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0}dt{color:var(--wta-muted,#666)}dd{margin:0;word-break:break-all}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid var(--wta-border,#e3e3e3);padding:4px}pre{white-space:pre-wrap;word-break:break-all;margin:0}
.v{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}.c{display:inline-flex;gap:4px;align-items:center;border:1px solid var(--wta-border,#ccc);border-radius:12px;padding:0 0 0 8px;font-size:12px}.c button{border:0;padding:2px 8px}
.env{background:#fef3c7;color:#78350f;font-weight:600;text-align:center;padding:4px;border-radius:var(--wta-radius,6px);margin-bottom:8px}fieldset,form{border:0;padding:0;margin:0}`;
// The extras chunk sits next to this file (ESM: import.meta.url; IIFE: the <script> src).
const SELF = typeof document !== 'undefined' ? (document.currentScript as HTMLScriptElement | null)?.src : undefined;
type Extras = typeof import('./extras');
type Ux = import('./ux').Ux;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const opt = (text: string, value: string) => Object.assign(h('option', text), { value });
const label = <E extends HTMLElement>(e: E, l: string) => (e.setAttribute('aria-label', l), e);
const btn = (t: string, on: () => void, cls?: string) => Object.assign(h('button', t, cls), { type: 'button', onclick: on });
const show = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const copy = (s: Strings, value: string) => btn(s.copy!, () => void navigator.clipboard?.writeText(value));

export class WtActivity extends HTMLElement {
  static observedAttributes = ['session', 'base-url', 'theme', 'accent', 'density', 'locale', 'live', 'verify', 'page-size', 'seal-key', 'extras-url'];
  #prefs!: Prefs;
  #x: Extras | null = null;
  #u: Ux | null = null;
  #feed?: Feed;
  #panel = '';
  #xp: HTMLElement | null = null; // the open exports panel, kept across renders
  #hist: { at: string; count: number }[] | null = null;
  #events: Event[] = [];
  #cursor: string | null = null;
  #theme: Theme | undefined;
  #f: Filters = {};
  #opts: Record<string, Set<string>> = { action: new Set(), actor_id: new Set(), target_type: new Set() };
  #names = new Map<string, string>();
  #root: ShadowRoot;
  #gen = 0;
  #err = '';
  #note = '';
  #loading = false;
  #ready = false;
  #open: Event | null = null;
  #fresh = 0;
  #sse: (() => void) | null = null;
  #facets = false;
  #log: { text: string; alert: boolean } | null = null; // pinned-head consistency note (extras checkLog)
  #rc: Node | null = null; // anchor receipts of a proven event

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }
  get session() { return this.getAttribute('session') ?? ''; }
  set session(v: string) { this.setAttribute('session', v); }
  #rb = ''; // the API of the session's region (`rgn`), resolved on reload
  get #own() { return (this.getAttribute('base-url') || location.origin).replace(/\/+$/, ''); }
  get #base() { return this.#rb || this.#own; }
  // Token only in the Authorization header, never in the URL.
  get #init(): RequestInit { return { headers: { authorization: `Bearer ${this.session}` } }; }
  get #claims() { return claims(this.session); }
  get #locale() { return this.getAttribute('locale') || this.#claims.locale || navigator.language; }
  get #s() { return pickStrings(this.#theme?.strings, this.#locale, LOCALES); }

  get #key() { return `wta-el:${this.#base}`; }
  #setPrefs(p: Prefs, refetch = false) { this.#prefs = p; savePrefs(this.#key, p); if (refetch) void this.reload(); else this.#render(); }
  connectedCallback() {
    this.#ready = true;
    this.#prefs = loadPrefs(this.#key, Number(this.getAttribute('page-size')) || 25);
    void this.#boot();
  }
  // The UX chunk (ux.js next to this file): locale, shared or linked view, grouping, bookmarks, live; the core works without it.
  async #boot() {
    try {
      const x = (await import(/* @vite-ignore */ this.getAttribute('ux-url') || new URL('./ux.js', SELF || import.meta.url).href)) as typeof import('./ux');
      const u = (this.#u ??= x.create(() => this.#ctx())), r = await u.ready();
      LOCALES[this.#locale.split('-')[0]!] = { ...x.UX_EN, ...r.strings };
      if (r.filters) this.#f = r.filters;
    } catch { /* core only */ }
    void this.reload();
    void this.#permalink();
  }
  #ctx() {
    return { host: this, s: this.#s, base: this.#base, init: this.#init, key: this.#key, locale: this.#locale, tz: this.#claims.tz, theme: this.#theme, feed: this.#feed, f: this.#f, more: !!this.#cursor, asc: this.#prefs.order === 'asc',
      setF: (f: Filters) => { this.#f = f; this.#open = null; void this.reload(); }, render: () => this.#render(), open: (id: string, at: string) => void this.#permalink(id, at), date: (d: string) => fmtDate(d, this.#locale, this.#claims.tz) };
  }
  disconnectedCallback() { this.#ready = false; this.#gen++; this.#sse?.(); }
  attributeChangedCallback(name: string, old: string | null, val: string | null) {
    if (old === val || !this.#ready) return;
    if (name === 'session' || name === 'base-url') void this.reload(); else if (name === 'live') this.#live(); else this.#render();
  }

  async reload() {
    this.#events = []; this.#cursor = null; this.#err = ''; this.#fresh = 0; this.#facets = false;
    const own = this.#own, rb = await regionBase(own, this.#claims.rgn);
    this.#rb = rb === own ? '' : rb;
    await this.#fetch();
    this.#live();
    if (this.#claims.cap.includes('verify')) void this.#extras().then((x) => x?.checkLog(this.#s, this.#base, this.#init, (d) => fmtDate(d, this.#locale, this.#claims.tz)))
      .then((l) => { this.#log = l ?? null; this.#render(); }, () => {});
  }

  async #get<T>(path: string): Promise<T> {
    const res = await fetch(this.#base + path, this.#init);
    if (!res.ok) throw new Error(String(res.status));
    return res.json() as Promise<T>;
  }

  async #fetch() {
    if (!this.session) { this.#err = 'Missing session'; return this.#render(); }
    const gen = ++this.#gen;
    this.#loading = true; this.#render();
    if (!this.#facets) { this.#facets = true; void this.#loadFacets(); if (this.#x) this.#loadHist(); }
    try {
      const q = toQuery(this.#f);
      q.set('limit', String(this.#prefs.limit));
      if (this.#prefs.order === 'asc') q.set('order', 'asc');
      if (this.#cursor) q.set('cursor', this.#cursor);
      const f = await this.#get<Feed>(`/v1/activity/feed?${q}`);
      if (gen !== this.#gen) return;
      this.#u?.cache(`${q}`, (this.#feed = f));
      this.#events.push(...f.data);
      for (const e of f.data) this.#seen(e);
      this.#cursor = f.next_cursor ?? null;
      if (f.theme) this.#theme = f.theme;
      this.#err = '';
      this.#emit('load', f);
    } catch (e) {
      if (gen !== this.#gen) return;
      const c = this.#u?.offline(`${toQuery(this.#f)}`);
      if (c) this.#events = c.data; else this.#err = (e as Error).message;
      this.#emit('error', { title: (e as Error).message, offline: !!c });
    }
    this.#loading = false;
    this.#render();
  }

  // wt-activity-open / -load / -error for the framework wrappers (Vue, Angular, Svelte).
  #emit(n: string, detail: unknown) { this.dispatchEvent(new CustomEvent(`wt-activity-${n}`, { detail, bubbles: true, composed: true })); }

  #seen(e: Event) {
    this.#opts.action!.add(e.action);
    this.#opts.actor_id!.add(e.actor.id);
    if (e.actor.name) this.#names.set(e.actor.id, e.actor.name);
    if (e.target) this.#opts.target_type!.add(e.target.type);
  }

  // Every action of the catalog and every facet value under the current filters, not just the rows on this page.
  async #loadFacets() {
    for (const o of Object.values(this.#opts)) o.clear();
    const add = (k: string, vals: { value?: string; action?: string; label?: string }[]) => {
      for (const v of vals) {
        const x = v.value ?? v.action;
        if (!x) continue;
        this.#opts[k]!.add(x);
        if (v.label) this.#names.set(x, v.label);
      }
    };
    type P = { data?: { value?: string; action?: string; label?: string }[] };
    await Promise.all([
      this.#get<P>('/v1/activity/actions').then((r) => add('action', r.data ?? [])),
      ...(['action', 'actor', 'target_type'] as const).map((f) =>
        this.#get<P>(`/v1/activity/feed/facets?field=${f}&${toQuery(this.#f)}`).then((r) => add(f === 'actor' ? 'actor_id' : f, r.data ?? []))),
    ].map((p) => p.catch(() => {})));
    this.#render();
  }

  // While `live` is set: SSE (one tab per session, shared with the others) bumps the "N new events" pill.
  #live() {
    this.#sse?.();
    this.#sse = this.hasAttribute('live') && this.session && this.#u ? this.#u.live((n) => { this.#fresh += n; this.#render(); }) : null;
  }

  #set(k: keyof Filters, v: string) { this.#f = { ...this.#f, [k]: v }; void this.reload(); }

  // The sparkline over the current filters and `q` (30 days unless `from` is set).
  #loadHist() {
    const q = toQuery(this.#f);
    q.set('bucket', 'day');
    if (!q.has('from')) q.set('from', new Date(Date.now() - 30 * 864e5).toISOString());
    void this.#get<{ data: { at: string; count: number }[] }>(`/v1/activity/feed/histogram?${q}`)
      .then((r) => { this.#hist = r.data; this.#render(); }).catch(() => {});
  }

  // Lazy chunk: column chooser, saved views, sparkline. A failed load just leaves them out.
  async #extras(): Promise<Extras | null> {
    if (this.#x) return this.#x;
    try {
      const url = this.getAttribute('extras-url') || new URL('./extras.js', SELF || import.meta.url).href;
      this.#x = (await import(/* @vite-ignore */ url)) as Extras;
      if (!this.#hist) this.#loadHist();
    } catch { /* extras unavailable */ }
    return this.#x;
  }

  // #wta-event=<id>&wta-at=<occurred_at> on the host page opens that event (read at that instant).
  async #permalink(id?: string | null, t?: string) {
    const q = new URLSearchParams(location.hash.slice(1));
    id ??= q.get('wta-event');
    const at = Date.parse(t ?? q.get('wta-at') ?? '');
    if (!id || !at || !this.session) return;
    try {
      const f = await this.#get<Feed>(`/v1/activity/feed?from=${new Date(at).toISOString()}&to=${new Date(at + 1).toISOString()}&limit=100`);
      const ev = f.data.find((e) => e.id === id);
      if (ev) { this.#open = ev; this.#emit('open', ev); } else this.#note = this.#s.linkMissing ?? 'That event is not available.';
    } catch { /* the feed error shows already */ }
    this.#render();
  }

  #search(s: Strings) {
    const box = h('div');
    const i = this.#input('q', s.search!);
    i.id = 'q';
    box.append(i);
    const terms = tokenize(this.#f.q ?? '');
    if (terms.length) {
      const ul = label(h('ul', undefined, 'bar'), s.search!);
      terms.forEach((t, n) => {
        const li = h('li', undefined, 'c');
        const x = btn('×', () => this.#set('q', removeTerm(this.#f.q ?? '', n)));
        x.setAttribute('aria-label', fmt(s.removeFilter ?? 'Remove filter {f}', { f: chipText(t, s.not) }));
        li.append(chipText(t, s.not), x);
        ul.append(li);
      });
      box.append(ul);
    }
    return box;
  }

  #select(k: keyof Filters, l: string, all: string, values: Iterable<string>, named = false) {
    const sel = label(h('select'), l);
    sel.append(opt(all, ''));
    const cur = this.#f[k] ?? '';
    for (const v of new Set([...values, ...(cur ? [cur] : [])])) sel.append(opt(named ? this.#names.get(v) ?? v : v, v));
    sel.value = cur;
    sel.onchange = () => this.#set(k, sel.value);
    return sel;
  }

  #input(k: keyof Filters, l: string, type = 'search') {
    const i = label(Object.assign(h('input'), { type, value: this.#f[k] ?? '', placeholder: l }), l);
    i.onchange = () => this.#set(k, type === 'datetime-local' && i.value ? new Date(i.value).toISOString() : i.value);
    return i;
  }

  #bar(s: Strings) {
    const bar = h('div', undefined, 'bar');
    const caps = this.#claims.cap;
    const range = this.#select('range', s.range!, s.allTime!, []);
    range.replaceChildren(opt(s.allTime!, ''), opt(s.last24h!, '24h'), opt(s.last7d!, '7d'), opt(s.last30d!, '30d'), opt(s.custom!, 'custom'));
    range.value = this.#f.range ?? '';
    const p = this.#prefs;
    const sort = label(h('select'), s.sort ?? 'Sort');
    sort.append(opt(s.newest ?? 'Newest first', 'desc'), opt(s.oldest ?? 'Oldest first', 'asc'));
    sort.value = p.order;
    sort.onchange = () => this.#setPrefs({ ...this.#prefs, order: sort.value === 'asc' ? 'asc' : 'desc' }, true);
    const size = label(h('select'), s.pageSize ?? 'Per page');
    for (const n of ['25', '50', '100']) size.append(opt(n, n));
    size.value = String(p.limit);
    size.onchange = () => this.#setPrefs({ ...this.#prefs, limit: Number(size.value) }, true);
    const rel = p.time === 'relative';
    const time = btn(rel ? s.timeAbsolute ?? 'Exact times' : s.timeRelative ?? 'Relative times', () => this.#setPrefs({ ...this.#prefs, time: rel ? 'absolute' : 'relative' }));
    const panel = (id: string, l: string) => {
      const b = btn(l, () => void this.#extras().then(() => { this.#panel = this.#panel === id ? '' : id; this.#xp = null; this.#render(); }));
      b.setAttribute('aria-expanded', String(this.#panel === id));
      return b;
    };
    bar.append(
      this.#search(s),
      this.#select('action', s.allActions!, s.allActions!, [...Object.keys(this.#theme?.actions ?? {}), ...this.#opts.action!]),
      this.#select('actor_id', s.actor!, s.allActors!, this.#opts.actor_id!, true),
      this.#select('target_type', s.targetType!, s.allTargets!, this.#opts.target_type!),
      this.#input('target_id', s.targetId!),
      this.#select('outcome', s.outcome!, `${s.outcome}: ${s.any}`, ['success', 'failure', 'denied']),
      this.#select('severity', s.severity!, `${s.severity}: ${s.any}`, ['info', 'notice', 'warning', 'critical']),
      range,
    );
    if (this.#f.range === 'custom') bar.append(this.#input('from', s.from!, 'datetime-local'), this.#input('to', s.to!, 'datetime-local'));
    bar.append(sort, size, time, panel('v', s.views ?? 'Saved views'));
    if (this.#theme?.columns?.length) bar.append(panel('c', s.columns ?? 'Columns'));
    if (this.#x && this.#hist) bar.append(this.#x.sparkline(s, this.#hist, 30));
    if (caps.includes('export')) bar.append(btn(s.export!, () => void this.#export()), panel('x', s.exports ?? 'Exports'));
    if (caps.includes('verify') || this.hasAttribute('verify')) bar.append(btn(s.verify!, () => void this.#verify(s)));
    bar.append(...(this.#u?.bar() ?? []));
    if (this.#fresh) bar.append(btn(fmt(s.newEvents!, { n: this.#fresh }, this.#locale), () => void this.reload(), 'p'));
    return bar;
  }

  // fetch + Blob so the token stays in the header; never a link with the token in it.
  async #export() {
    try {
      const q = toQuery(this.#f);
      q.set('format', 'csv');
      const res = await fetch(`${this.#base}/v1/activity/feed/export?${q}`, this.#init);
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      Object.assign(h('a'), { href: url, download: 'activity.csv' }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1e4);
    } catch (e) {
      this.#note = `${this.#s.error} (${(e as Error).message})`;
      this.#render();
    }
  }

  async #verify(s: Strings) {
    this.#note = s.loading!; this.#render();
    try {
      const x = await this.#extras();
      if (!x) throw new Error('extras.js');
      // VALID / VALID_UNANCHORED / VALID_PRUNED / INVALID over rows, tombstones, checkpoint and signed head
      const v = await x.runVerdict(this.#base, this.#init);
      this.#note = `${v.verdict}: ${v.verdict === 'INVALID' ? fmt(s.tampered!, { n: v.firstBadSeq ?? '?' }) : fmt(s.verified!, { n: v.checked })}${[...v.problems, ...v.notes].length ? ` (${[...v.problems, ...v.notes].join('; ')})` : ''}`;
    } catch (e) {
      this.#note = `${s.error} (${(e as Error).message})`;
    }
    this.#render();
  }

  // Merkle inclusion proof of one event; 409 = its hour is not signed yet.
  async #prove(id: string, s: Strings) {
    this.#note = s.loading!; this.#render();
    try {
      const x = await this.#extras();
      if (!x) throw new Error('extras.js');
      const { runProof } = x;
      const v = await runProof(this.#base, this.#init, id);
      if (v.ok) this.#rc = await x.receipts(s, this.#base, this.#init).catch(() => null);
      this.#note = v.ok && v.signature ? s.proved ?? 'Proven: the event is in a signed batch.' : v.ok ? s.provedUnsigned ?? 'In its batch; signature not checkable here.' : s.proofFailed ?? 'The proof did not verify.';
    } catch (e) {
      const m = (e as Error).message;
      this.#note = m === '409' ? s.notSealed ?? 'Not sealed yet: events are signed hourly.' : `${s.proofFailed ?? 'The proof did not verify.'} (${m})`;
    }
    this.#render();
  }

  #render() {
    const t = this.#theme, s = this.#s;
    // shortcut: "system" scheme is read at render time, not live; re-render on attribute change or reload.
    applyTheme(this, t, isDark(this.getAttribute('theme'), t), this.getAttribute('accent') ?? undefined);
    const wrap = h('div', undefined, 'w' + ((this.getAttribute('density') || t?.density) === 'compact' ? ' d' : ''));
    const u = this.#u, style = h('style', CSS + (u?.css ?? '') + (t?.customCss ?? ''));
    // The theme's own title wins, then the brand name, then the built-in (translated) title.
    const own = pickStrings(t?.strings, this.#locale).title;
    wrap.dir = /^(ar|he|fa|ur|ps|sd|yi|dv|ckb|ug)\b/i.test(this.#locale) ? 'rtl' : 'ltr';
    if (t?.environmentLabel) { const e = h('p', t.environmentLabel, 'env'); e.setAttribute('role', 'note'); wrap.append(e); }
    wrap.append(h('h2', own !== EN.title ? own : t?.brandName ?? s.title), this.#bar(s));
    if (this.#panel && this.#x) {
      const x = this.#x;
      wrap.append(this.#panel === 'x' ? (this.#xp ??= x.exportsPanel(s, this.#base, this.#init, toQuery(this.#f)))
        : this.#panel === 'c'
        ? x.columns(s, t?.columns ?? [], this.#prefs.hidden, (hidden) => this.#setPrefs({ ...this.#prefs, hidden }))
        : x.views(s, `${this.#key}:views`, () => ({ q: this.#f.q ?? '', filters: { ...this.#f } as Record<string, string>, order: this.#prefs.order }),
          (v) => { this.#f = v.filters; this.#panel = ''; this.#setPrefs({ ...this.#prefs, order: v.order === 'asc' ? 'asc' : 'desc' }, true); }, () => this.#render(),
          { base: this.#base, init: this.#init }));
    }

    const live = h('div', this.#note, 'v');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    if (this.#note) wrap.append(h('p', this.#note, 'm'));
    if (this.#log) { const l = h('p', this.#log.text, this.#log.alert ? 'm e' : 'm'); l.setAttribute('role', this.#log.alert ? 'alert' : 'note'); wrap.append(l); }
    wrap.append(...(u?.notes() ?? []), live);

    const events = t?.hideAccessEvents ? this.#events.filter((e) => !isAccessEvent(e)) : this.#events;
    if (this.#err) {
      const e = h('div', undefined, 's e');
      e.setAttribute('role', 'alert');
      e.append(h('p', s.error), btn(s.retry!, () => void (this.#events.length ? this.#fetch() : this.reload())));
      wrap.append(e);
    } else if (!events.length) {
      const filtered = Object.values(this.#f).some(Boolean);
      const m = this.#loading ? s.loading! : filtered ? s.noMatch ?? 'No events match these filters.' : s.emptyState!;
      live.textContent = m;
      const e = h('div', undefined, 's');
      e.append(h('p', m));
      if (filtered && !this.#loading) e.append(btn(s.clearFilters ?? 'Clear filters', () => { this.#f = {}; void this.reload(); }));
      wrap.append(e);
    }

    const days = new Map<string, Event[]>();
    for (const ev of events) {
      const k = fmtDate(ev.occurred_at, this.#locale, this.#claims.tz, { dateStyle: 'full' });
      (days.get(k) ?? days.set(k, []).get(k)!).push(ev);
    }
    for (const [day, evs] of days) {
      const ul = u ? u.list(evs, (e) => this.#row(e, s, t)) : h('ul');
      if (!u) for (const ev of evs) ul.append(this.#row(ev, s, t));
      wrap.append(h('h3', day), ul);
    }

    if (this.#cursor && !this.#err) {
      const b = btn(this.#loading ? s.loading! : s.loadMore!, () => void this.#fetch(), 'p');
      b.disabled = this.#loading;
      b.dataset.more = '';
      wrap.append(b);
    }
    this.#root.replaceChildren(style, wrap, ...(this.#open ? [this.#drawer(this.#open, s, t)] : []));
    u?.after(this.#root);
  }

  #row(ev: Event, s: Strings, t?: Theme) {
    const li = h('li');
    li.tabIndex = 0;
    li.dataset.id = ev.id;
    const open = () => { this.#open = ev; this.#rc = null; this.#render(); this.#emit('open', ev); };
    li.onclick = open;
    // Enter opens; arrows / j k move between rows across day groups; Home/End jump
    li.onkeydown = (k) => {
      if (k.key === 'Enter' || k.key === ' ') { k.preventDefault(); return open(); }
      const all = [...this.#root.querySelectorAll<HTMLElement>('li[data-id]:not([hidden])')], i = all.indexOf(li);
      const to = ({ ArrowDown: i + 1, j: i + 1, ArrowUp: i - 1, k: i - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[k.key];
      if (to !== undefined && all[to]) { k.preventDefault(); all[to].focus(); }
    };
    const st = t?.actions?.[ev.action];
    const tone = st?.tone ?? (ev.severity === 'critical' || ev.outcome === 'denied' || ev.outcome === 'failure' ? 'danger' : ev.severity === 'warning' ? 'warning' : '');
    if (tone) li.dataset.tone = tone;
    const body = h('div');
    const tpl = st?.label ?? '{actor.name} ' + ev.action + (ev.target || ev.targets?.length ? ' {target.name}' : '');
    const target = ev.target ?? ev.targets?.[0];
    const line = h('span');
    const e2 = { ...ev, actor: { ...ev.actor, name: ev.actor.name || (ev.actor.type === 'anonymous' ? s.anonymous ?? 'Anonymous' : ev.actor.id) }, target: target && { ...target, name: target.name || target.id } };
    for (const p of interpolate(tpl, e2)) line.append(p.field ? h('b', p.text, 'a') : document.createTextNode(p.text));
    if (ev.on_behalf_of && t?.showImpersonation !== false) line.append(h('span', s.viaSupport, 'g'));
    if (ev.outcome && ev.outcome !== 'success') line.append(h('span', ev.outcome, 'g x'));
    if (ev.severity === 'warning' || ev.severity === 'critical') line.append(h('span', ev.severity, 'g x'));
    body.append(line);
    for (const c of (t?.columns ?? []).filter((c) => !this.#prefs.hidden.includes(c.field))) {
      const v = text(ev, c.field);
      if (v) body.append(h('span', `${c.label}: ${c.kind === 'time' ? fmtDate(v, this.#locale, this.#claims.tz) : v}`, c.kind === 'badge' ? 'g' : 'm'));
    }
    const ip = ev.context?.ip ?? ev.ip;
    if (t?.showIp && ip) body.append(h('span', ip, 'm'));
    if (t?.showLocation && ev.context?.country) body.append(h('span', ev.context.country, 'm'));
    if (t?.showMetadata && ev.metadata) body.append(h('span', JSON.stringify(ev.metadata), 'm'));
    const r = relTime(ev.occurred_at, Date.now(), this.#locale), a = fmtDate(ev.occurred_at, this.#locale, this.#claims.tz);
    const time = h('time', this.#prefs.time === 'relative' ? r : a);
    time.dateTime = ev.occurred_at;
    time.title = this.#prefs.time === 'relative' ? a : r;
    li.append(body, time);
    return li;
  }

  // Detail view: every value via textContent; copy buttons copy the plain value.
  #drawer(ev: Event, s: Strings, t?: Theme) {
    const d = label(h('div', undefined, 'dr'), s.details!);
    d.setAttribute('role', 'dialog');
    const shut = () => { this.#open = null; this.#render(); [...this.#root.querySelectorAll<HTMLElement>('li[data-id]')].find((l) => l.dataset.id === ev.id)?.focus(); };
    d.onkeydown = (k) => { if (k.key === 'Escape') shut(); };
    const dl = (rows: [string, unknown][]) => {
      const l = h('dl');
      for (const [k, v] of rows) if (v != null && v !== '') l.append(h('dt', k), h('dd', show(v)), copy(s, show(v)));
      l.style.gridTemplateColumns = 'auto 1fr auto';
      return l;
    };
    const close = btn(s.close!, shut);
    const link = btn(s.copyLink ?? 'Copy link', () => void navigator.clipboard?.writeText(`${location.href.split('#')[0]}#wta-event=${encodeURIComponent(ev.id)}&wta-at=${encodeURIComponent(ev.occurred_at)}`));
    d.append(close, link);
    if (this.#claims.cap.includes('verify') || this.hasAttribute('verify')) d.append(btn(s.prove ?? 'Prove', () => void this.#prove(ev.id, s)));
    d.append(h('h2', ev.action));
    const extra = (t?.detailFields ?? []).map((p) => [p, text(ev, p)] as [string, unknown]);
    d.append(dl([...extra, ['id', ev.id], [s.actor!, ev.actor.email ? `${ev.actor.name ?? ev.actor.id} <${ev.actor.email}>` : ev.actor.name ?? ev.actor.id],
      [s.onBehalfOf!, t?.showImpersonation === false ? null : ev.on_behalf_of && (ev.on_behalf_of.name ?? ev.on_behalf_of.id)],
      [s.outcome!, ev.outcome], [s.severity!, ev.severity], ['occurred_at', fmtDate(ev.occurred_at, this.#locale, this.#claims.tz)], ['signed_by', ev.signed_by]]));
    const c = ev.context ?? {};
    const ctx = dl([['ip', t?.showIp ? c.ip ?? ev.ip : null], ['user_agent', t?.showIp ? c.user_agent : null], ['request_id', c.request_id],
      ['session_id', c.session_id], ['country', t?.showLocation ? c.country : null], ['trace_id', ev.trace_id]]);
    if (ctx.childElementCount) d.append(h('h3', s.context), ctx);
    // tokenised IP / email (2001:db8::/32, @token.invalid): the audited reveal call, capability `reveal`
    const toks = [c.ip ?? ev.ip, ev.actor.email].filter((v): v is string => !!v && /^2001:db8:|@token\.invalid$/.test(v));
    if (toks.length && this.#claims.cap.includes('reveal')) d.append(btn(s.reveal ?? 'Reveal', () => void this.#extras()
      .then((x) => Promise.all(toks.map((t) => x!.reveal(this.#base, this.#init, t))))
      .then((v) => { this.#note = `${s.revealed ?? 'Revealed'}: ${v.join(', ')}`; }, (e) => { this.#note = `${s.revealFailed ?? s.error} (${(e as Error).message})`; }).then(() => this.#render())));
    if (ev.changes?.length) {
      const tb = h('table');
      const hr = h('tr');
      hr.append(h('th', s.field), h('th', s.before), h('th', s.after));
      tb.append(hr);
      const cells: [HTMLElement, HTMLElement][] = [];
      for (const ch of ev.changes) {
        const r = h('tr'), o = h('td', show(ch.old)), n = h('td', show(ch.new));
        r.append(h('td', ch.field), o, n);
        tb.append(r);
        cells.push([o, n]);
      }
      // sealed old/new values open with the same `seal-key` (AAD changes.<i>.old / .new)
      const ck = this.getAttribute('seal-key');
      if (ck && JSON.stringify(ev.changes).includes('$wt_cse')) void this.#extras().then((x) => x?.openSealed(ev.changes, ck, 'changes'))
        .then((o) => (o as typeof ev.changes)?.forEach((c, i) => { cells[i]![0].textContent = show(c.old); cells[i]![1].textContent = show(c.new); }));
      d.append(h('h3', s.changes), tb);
    }
    const targets = ev.targets?.length ? ev.targets : ev.target ? [ev.target] : [];
    if (targets.length) d.append(h('h3', s.targets), dl(targets.map((x) => [x.type, x.name ? `${x.name} (${x.id})` : x.id])));
    if (ev.credential) d.append(h('h3', s.credential), dl([['type', ev.credential.type], ['id', ev.credential.id], ['fingerprint', ev.credential.fingerprint]]));
    if (ev.metadata && Object.keys(ev.metadata).length) {
      const j = JSON.stringify(ev.metadata, null, 2);
      const pre = h('pre', j);
      d.append(h('h3', s.metadata), pre, copy(s, j));
      // client-sealed values ($wt_cse) open only with the key the page holds (`seal-key`); it never reaches Watchtower
      const key = this.getAttribute('seal-key');
      if (key && j.includes('$wt_cse')) void this.#extras().then((x) => x?.openSealed(ev.metadata, key, 'metadata')).then((m) => { if (m) pre.textContent = JSON.stringify(m, null, 2); });
    }
    d.append(...(this.#u?.detail(ev) ?? []));
    if (this.#rc) d.append(this.#rc);
    queueMicrotask(() => close.focus());
    return d;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('wt-activity')) customElements.define('wt-activity', WtActivity);

/** Create a <wt-activity> inside `el`. Returns a handle to refresh or remove it. */
export function mountActivity(el: Element, opts: MountOptions) {
  const node = document.createElement('wt-activity') as WtActivity;
  node.setAttribute('session', opts.session);
  for (const k of ['baseUrl', 'theme', 'accent', 'density', 'locale'] as const) if (opts[k]) node.setAttribute(k === 'baseUrl' ? 'base-url' : k, opts[k]!);
  if (opts.live) node.setAttribute('live', '');
  if (opts.pageSize) node.setAttribute('page-size', String(opts.pageSize));
  if (opts.extrasUrl) node.setAttribute('extras-url', opts.extrasUrl);
  if (opts.uxUrl) node.setAttribute('ux-url', opts.uxUrl);
  if (opts.infinite) node.setAttribute('infinite', '');
  if (opts.verify) node.setAttribute('verify', '');
  el.append(node);
  return { element: node, reload: () => node.reload(), destroy: () => node.remove() };
}
