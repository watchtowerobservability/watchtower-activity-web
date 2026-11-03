// Lazy UX chunk of <wt-activity> (dist/ux.js, outside the 12 KB core): built-in locales (about 45, RTL
// included, loaded per language from dist/locales/), grouping of repeated events, the new-since-last-visit
// marker, bookmarks with notes, related-event pivots, the notable filter, delegation chains, "Removed"
// actors, redaction markers, the archive (hot-window) warning with a restore request, shared views with a
// default and `#wta-view=` short links, deep links, cross-tab live updates with idle disconnect, an offline
// cache and the live integrity badge. The core loads it on connect; if it cannot load, the core still works.
import { readSse, relTime, sseCount } from './lib';
import type { Event, Feed, Filters, Strings, Theme } from './types';
import { fmt, groupRuns, localeFiles, markKind, placeGaps, type Gap, relatedQueries, toggleTerm, hasTerm, viaText, type Hop } from './viewlogic';

export { LOCALE_TAGS, fmt } from './viewlogic';

/** What the core hands the chunk on every call. */
export interface Ctx {
  host: HTMLElement;
  s: Strings;
  base: string;
  init: RequestInit;
  key: string;
  locale?: string;
  tz?: string;
  theme?: Theme;
  feed?: Feed;
  f: Filters;
  more: boolean;
  /** Oldest first. */
  asc?: boolean;
  setF(f: Filters): void;
  render(): void;
  open(id: string, at: string): void;
  date(iso: string): string;
}

type Ev = Event & { via?: Hop[] };
interface Bookmark { event_id: string; occurred_at: string; note: string }

/** English copy of the chunk's own strings (locale files and the theme override them). */
export const UX_EN: Strings = {
  notable: 'Notable only', markRead: 'Mark all as read', lastVisit: 'Your last visit', loggingGap: 'Logging gap {from} – {to}: events in this span may be missing or late.', newBadge: 'New',
  groupMore: '+{n, plural, one {# similar event} other {# similar events}}', groupHide: 'Hide similar events',
  related: 'Related events', sameSession: 'Same session', sameRequest: 'Same request', sameActor: 'Same actor', sameTarget: 'Same target',
  sameCredential: 'Same credential', sameTrace: 'Same trace', bookmark: 'Bookmark', unbookmark: 'Remove bookmark', bookmarks: 'Bookmarks',
  bookmarked: 'Bookmarked', note: 'Note', saveNote: 'Save note', noBookmarks: 'No bookmarks yet.', open: 'Open', removed: 'Removed',
  redacted: 'Redacted value', tokenized: 'Tokenised value', hotWindow: 'Events before {date} are archived and not shown here.',
  requestRestore: 'Request a restore', restoreRequested: 'Restore requested. Your provider has been notified.',
  offline: 'Offline: showing the events loaded at {time}.', livePaused: 'Live updates paused while this tab is hidden.',
  sharedViews: 'Shared views', delegation: 'Delegation', viaFor: 'for', approvedBy: 'approved by {name}', usingTool: 'using {tool}',
  signedHop: 'signed', badgeVerified: 'Log verified {time}', witnesses: '{n, plural, one {# witness} other {# witnesses}}',
  anchoredIn: 'Anchored in {list}', accessibility: 'Accessibility',
  newEvents: '{n, plural, one {# new event} other {# new events}}', shown: '{n, plural, one {# event shown} other {# events shown}}',
};

export const CSS = `li{content-visibility:auto;contain-intrinsic-size:auto 44px}li[hidden]{display:none}
li.gap{cursor:default;font-size:12px;border-left:3px dashed var(--wta-muted,#888);padding:4px 8px;color:var(--wta-muted,#666)}
li.sep{cursor:default;justify-content:center;color:var(--wta-accent,#2563eb);font-size:12px;border-bottom:2px solid var(--wta-accent,#2563eb);padding:2px 0}
li.nu b.a::before{content:"";display:inline-block;width:6px;height:6px;border-radius:3px;background:var(--wta-accent,#2563eb);margin-inline-end:6px;vertical-align:middle}
mark{background:transparent;color:inherit;border-bottom:1px dashed var(--wta-danger,#c0392b)}mark.tk{border-bottom-color:var(--wta-accent,#2563eb)}
.bm{color:var(--wta-accent,#2563eb)}.bdg{font-size:12px;color:var(--wta-muted,#666)}.gx{border:0;padding:0 4px;font-size:12px;color:var(--wta-accent,#2563eb)}
textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--wta-border,#ccc);border-radius:var(--wta-radius,6px);width:100%}
[dir=rtl] .dr{inset:0 auto 0 0;border-left:0;border-right:1px solid var(--wta-border,#ccc)}`;

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};
const btn = (t: string, on: (e: MouseEvent) => void, cls?: string) => Object.assign(h('button', t, cls), { type: 'button', onclick: on });
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* blocked */ } },
};
const call = (c: Ctx, path: string, more: RequestInit = {}) =>
  fetch(c.base + path, { ...c.init, ...more, headers: { ...(c.init.headers as Record<string, string>), ...(more.headers as Record<string, string>) } })
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r; });
const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
const tokenClaims = (init: RequestInit): { jti?: string; prj?: string; acc?: string } => {
  try {
    const t = ((init.headers as Record<string, string>).authorization ?? '').replace(/^Bearer /, '');
    return JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
  } catch { return {}; }
};

/** Built-in strings of `locale`: its base file, then its regional file (files next to this chunk). */
export async function loadLocale(locale: string | undefined, url = import.meta.url): Promise<Strings> {
  const out: Strings = {};
  for (const f of localeFiles(locale)) {
    try { Object.assign(out, await (await fetch(new URL(`./locales/${f}.json`, url))).json()); } catch { /* falls back to en */ }
  }
  return out;
}

/** Filters a host-page link asks for: `#wta-q=&wta-from=&wta-to=&wta-view=` (deep links, V12). */
export function linkFilters(hash: string): { f: Filters; view?: string } {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const f: Filters = {};
  for (const k of ['q', 'from', 'to', 'action', 'actor_id', 'outcome', 'severity'] as const) { const v = q.get(`wta-${k}`); if (v) f[k] = v; }
  if (f.from && !Date.parse(f.from)) delete f.from;
  if (f.to && !Date.parse(f.to)) delete f.to;
  if (f.from || f.to) f.range = 'custom';
  return { f, view: q.get('wta-view') ?? undefined };
}

interface SharedView { slug: string; name: string; q: string; params: Record<string, string>; is_default: boolean }
const viewFilters = (v: SharedView): Filters => {
  const { order: _o, limit: _l, ...rest } = v.params;
  return { ...rest, ...(v.q ? { q: v.q } : {}) } as Filters;
};

export function create(ctx: () => Ctx) {
  let seen = '';           // the marker shown this visit (events received after it are new)
  let shared: SharedView[] = [];
  let marks = new Map<string, Bookmark>();
  let badge: { status?: string; checked_at?: string | null; cosignatures?: number; anchors?: string[] } | null = null;
  let note = '';
  let showMarks = false;
  const open = new Set<string>();
  const gone = new Set<string>(); // removed actors seen on any page
  let gaps: Gap[] = [];            // WP5 logging incidents of the account
  const drawn = new Set<Gap>();     // gaps already drawn in this render (bar() starts a render)
  const tc = tokenClaims(ctx().init);
  const seenKey = () => `wta-seen:${ctx().base}:${tc.acc ?? ''}`;
  let server = false;

  const saveSeen = (at: string) => {
    if (server) void call(ctx(), '/v1/activity/seen', { method: 'PUT', ...json({ at }) }).catch(() => {});
    else store.set(seenKey(), at);
  };

  /** Strings, then the filters to start with (deep link > `wta-view` > the default shared view). */
  async function ready(): Promise<{ strings: Strings; filters?: Filters }> {
    const c = ctx();
    const [strings] = await Promise.all([
      loadLocale(c.locale),
      call(c, '/v1/activity/shared-views').then((r) => r.json()).then((p: { data: SharedView[] }) => { shared = p.data ?? []; }).catch(() => {}),
      call(c, '/v1/activity/seen').then((r) => r.json()).then((p: { last_seen_at?: string | null; stored?: string }) => {
        server = p.stored === 'server';
        seen = (server ? p.last_seen_at : store.get(seenKey())) ?? '';
      }).catch(() => { seen = store.get(seenKey()) ?? ''; }),
      call(c, '/v1/activity/incidents').then((r) => r.json()).then((p: { data?: Gap[] }) => { gaps = (p.data ?? []).filter((g) => typeof g.kind === 'string' && !Number.isNaN(Date.parse(g.started_at))); }).catch(() => {}),
      call(c, '/v1/activity/bookmarks').then((r) => r.json()).then((p: { data: Bookmark[] }) => { marks = new Map(p.data.map((b) => [b.event_id, b])); }).catch(() => {}),
      // WP1 live badge: public, by project slug (the `project` attribute); one account's log when the token names it
      c.host.getAttribute('project') ? fetch(`${c.base}/v1/activity/badge/${encodeURIComponent(c.host.getAttribute('project')!)}?format=json${tc.acc ? `&account=${encodeURIComponent(tc.acc)}` : ''}`)
        .then((r) => (r.ok ? r.json() : null)).then((b) => { badge = b; }).catch(() => {}) : undefined,
    ]);
    // the next visit counts from now; this visit keeps the old marker for its divider
    saveSeen(new Date().toISOString());
    const link = linkFilters(location.hash);
    const pick = link.view ? shared.find((v) => v.slug === link.view) : Object.keys(link.f).length ? undefined : shared.find((v) => v.is_default);
    return { strings, filters: Object.keys(link.f).length ? link.f : pick ? viewFilters(pick) : undefined };
  }

  function bar(): Node[] {
    drawn.clear();
    const c = ctx(), s = c.s, out: Node[] = [];
    const q = c.f.q ?? '';
    const nb = btn(s.notable!, () => c.setF({ ...c.f, q: toggleTerm(q, 'is:notable') }));
    nb.setAttribute('aria-pressed', String(hasTerm(q, 'is:notable')));
    out.push(nb);
    if (seen) out.push(btn(s.markRead!, () => { seen = new Date().toISOString(); saveSeen(seen); c.render(); }));
    const bm = btn(`${s.bookmarks} (${marks.size})`, () => { showMarks = !showMarks; c.render(); });
    bm.setAttribute('aria-expanded', String(showMarks));
    out.push(bm);
    if (shared.length) {
      const sel = h('select');
      sel.setAttribute('aria-label', s.sharedViews!);
      sel.append(Object.assign(h('option', s.sharedViews), { value: '' }), ...shared.map((v) => Object.assign(h('option', v.name), { value: v.slug })));
      sel.onchange = () => { const v = shared.find((x) => x.slug === sel.value); if (v) c.setF(viewFilters(v)); };
      out.push(sel);
    }
    if (badge?.status === 'verified' && badge.checked_at) {
      const t = h('span', `✓ ${fmt(s.badgeVerified!, { time: relTime(badge.checked_at, Date.now(), c.locale) })}`, 'bdg');
      if (badge.cosignatures) t.textContent += ` · ${fmt(s.witnesses!, { n: badge.cosignatures }, c.locale)}`;
      if (badge.anchors?.length) t.title = fmt(s.anchoredIn!, { list: badge.anchors.join(', ') });
      t.setAttribute('role', 'note');
      out.push(t);
    }
    return out;
  }

  function notes(): Node[] {
    const c = ctx(), s = c.s, out: Node[] = [];
    if (note) { const p = h('p', note, 'm'); p.setAttribute('role', 'status'); out.push(p); }
    const hot = c.feed?.hot_from;
    const from = c.f.from && c.f.range === 'custom' ? c.f.from : undefined;
    if (hot && ((from && from < hot) || (!c.f.from && !c.f.range && !c.more && (c.feed?.data.length ?? 0) > 0))) {
      const p = h('p', fmt(s.hotWindow!, { date: c.date(hot) }), 'm');
      p.setAttribute('role', 'note');
      p.append(' ', btn(s.requestRestore!, () => {
        const start = from ?? new Date(Date.parse(hot) - 365 * 864e5).toISOString();
        void call(c, '/v1/activity/restore-requests', { method: 'POST', ...json({ from: start, to: hot }) })
          .then(() => { note = s.restoreRequested!; }, (e: Error) => { note = `${s.error} (${e.message})`; }).then(() => c.render());
      }));
      out.push(p);
    }
    if (showMarks) {
      const ul = h('ul');
      ul.setAttribute('aria-label', s.bookmarks!);
      if (!marks.size) ul.append(h('li', s.noBookmarks, 'sep'));
      for (const b of marks.values()) {
        const li = h('li');
        li.append(h('span', `${c.date(b.occurred_at)}${b.note ? ` · ${b.note}` : ''}`), btn(s.open!, () => c.open(b.event_id, b.occurred_at)));
        ul.append(li);
      }
      out.push(ul);
    }
    return out;
  }

  /** One day's rows: grouped runs, the last-visit divider, bookmark, removed and delegation marks. */
  function list(evs: Event[], row: (e: Event) => HTMLLIElement): HTMLUListElement {
    const c = ctx(), s = c.s, ul = h('ul');
    const removed = gone;
    let divided = false, hadNew = false;
    const since = Date.parse(seen);
    const desc = evs.length < 2 || evs[0]!.occurred_at >= evs[evs.length - 1]!.occurred_at;
    // gap markers in either order, once per render; gaps past this day's last row wait for a later day
    const at = placeGaps(evs.map((e) => e.occurred_at), gaps.filter((g) => !drawn.has(g)), Date.now(), !!c.asc);
    const gapAt = (i: number) => { for (const g of at[i] ?? []) { drawn.add(g); ul.append(h('li', fmt(s.loggingGap!, { from: c.date(g.started_at), to: g.ended_at ? c.date(g.ended_at) : '…' }), 'gap')); } };
    let idx = 0;
    for (const run of groupRuns(evs as Ev[])) {
      run.forEach((e, i) => {
        const isNew = since > 0 && Date.parse(e.received_at) > since;
        hadNew ||= isNew;
        if (hadNew && desc && !isNew && !divided) {
          divided = true;
          ul.append(h('li', s.lastVisit, 'sep'));
        }
        gapAt(idx++);
        const li = row(e);
        const line = li.firstElementChild?.firstElementChild as HTMLElement | null;
        if (isNew) li.classList.add('nu');
        if (removed.has(e.actor.id)) line?.append(h('span', s.removed, 'g'));
        if (marks.has(e.id)) { const m = h('span', ' ★', 'bm'); m.setAttribute('aria-label', s.bookmarked!); m.title = marks.get(e.id)!.note || s.bookmarked!; line?.append(m); }
        const via = viaText(e.actor, e.via, s);
        if (via) li.firstElementChild?.append(h('span', via, 'm'));
        if (i === 0 && run.length > 1) {
          const k = e.id, on = open.has(k);
          const g = btn(on ? s.groupHide! : fmt(s.groupMore!, { n: run.length - 1 }, c.locale), (ev) => { ev.stopPropagation(); if (on) open.delete(k); else open.add(k); c.render(); }, 'gx');
          g.setAttribute('aria-expanded', String(on));
          line?.append(g);
        }
        if (i > 0 && !open.has(run[0]!.id)) li.hidden = true;
        ul.append(li);
      });
    }
    return ul;
  }

  /** Extra sections of the detail view: delegation chain, related pivots, bookmark with note. */
  function detail(ev: Event): Node[] {
    const c = ctx(), s = c.s, e = ev as Ev, out: Node[] = [];
    if (gone.has(e.actor.id)) out.push(h('p', `${s.actor}: ${s.removed}`, 'm'));
    if (e.via?.length) {
      const ol = h('ol');
      for (const hop of e.via.slice(0, 5)) {
        const bits = [hop.actor.name || hop.actor.id, hop.actor.type, hop.model, hop.tool && fmt(s.usingTool!, { tool: hop.tool }),
          hop.credential?.type, hop.approved_by && fmt(s.approvedBy!, { name: hop.approved_by.name || hop.approved_by.id }), hop.sig && s.signedHop];
        ol.append(h('li', bits.filter(Boolean).join(' · ')));
      }
      out.push(h('h3', s.delegation), h('p', viaText(e.actor, e.via, s)), ol);
    }
    const rel = relatedQueries(e);
    if (rel.length) {
      const div = h('div', undefined, 'bar');
      for (const [k, q] of rel) div.append(btn(s[k] ?? k, () => c.setF({ q })));
      out.push(h('h3', s.related), div);
    }
    const b = marks.get(e.id);
    const form = h('form');
    const ta = Object.assign(h('textarea'), { maxLength: 500, rows: 2, value: b?.note ?? '' });
    ta.setAttribute('aria-label', s.note!);
    form.append(ta, Object.assign(h('button', b ? s.saveNote : s.bookmark), { type: 'submit' }));
    form.onsubmit = (x) => {
      x.preventDefault();
      void call(c, `/v1/activity/bookmarks/${encodeURIComponent(e.id)}`, { method: 'PUT', ...json({ occurred_at: e.occurred_at, note: ta.value }) })
        .then((r) => r.json()).then((nb: Bookmark) => { marks.set(e.id, nb); note = s.bookmarked!; }, (err: Error) => { note = `${s.error} (${err.message})`; }).then(() => c.render());
    };
    out.push(h('h3', s.bookmarks), form);
    if (b) out.push(btn(s.unbookmark!, () => void call(c, `/v1/activity/bookmarks/${encodeURIComponent(e.id)}`, { method: 'DELETE' })
      .then(() => { marks.delete(e.id); }, () => {}).then(() => c.render())));
    return out;
  }

  /** After each render: mark redacted and tokenised values; infinite scroll on `infinite`. */
  function after(root: ShadowRoot) {
    const s = ctx().s;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    for (let n = w.nextNode(); n; n = w.nextNode()) if (/\[REDACTED\]|2001:db8:|@token\.invalid/i.test(n.nodeValue ?? '') && !/^(STYLE|OPTION|TEXTAREA|SELECT)$/.test(n.parentElement?.tagName ?? '')) nodes.push(n as Text);
    for (const t of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0;
      const v = t.nodeValue!;
      for (const m of v.matchAll(/\[REDACTED\]|2001:db8:[0-9a-f:]+|[\w.+-]+@token\.invalid/gi)) {
        frag.append(v.slice(last, m.index));
        const k = markKind(m[0])!;
        const mk = h('mark', m[0], k === 'tokenized' ? 'tk' : 'rd');
        mk.title = k === 'tokenized' ? s.tokenized! : s.redacted!;
        frag.append(mk);
        last = m.index! + m[0].length;
      }
      frag.append(v.slice(last));
      t.replaceWith(frag);
    }
    const more = root.querySelector<HTMLButtonElement>('button[data-more]');
    if (more && ctx().host.hasAttribute('infinite') && typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((x) => { if (x.some((i) => i.isIntersecting)) { io.disconnect(); if (!more.disabled) more.click(); } });
      io.observe(more);
    }
  }

  /**
   * Live counts: one tab per session holds the SSE stream (Web Locks) and shares counts with the others
   * (BroadcastChannel); a tab hidden for 2 minutes lets go, and takes over again when shown.
   */
  function live(on: (n: number) => void): () => void {
    const c = ctx();
    const name = `wta-live:${c.base}:${tc.jti ?? ''}`;
    const bc = typeof BroadcastChannel === 'function' ? new BroadcastChannel(name) : null;
    if (bc) bc.onmessage = (m) => on(Number(m.data) || 0);
    let stop = false, ac: AbortController | null = null, wait: AbortController | null = null, idle: ReturnType<typeof setTimeout> | undefined;
    const hold = () => new Promise<void>((done) => {
      ac = new AbortController();
      void fetch(`${c.base}/v1/activity/feed/stream`, { ...c.init, signal: ac.signal })
        .then((r) => (r.ok && r.body ? readSse(r.body, (d, e) => { const n = sseCount(d, e); if (n) { on(n); bc?.postMessage(n); } }) : undefined))
        .catch(() => {}).finally(() => { ac = null; done(); });
    });
    const run = () => {
      if (stop || ac || wait || document.hidden) return;
      const locks = (navigator as Navigator & { locks?: { request(n: string, o: { signal: AbortSignal }, f: () => Promise<void>): Promise<void> } }).locks;
      if (!locks) { void hold(); return; }
      wait = new AbortController();
      void locks.request(name, { signal: wait.signal }, hold).catch(() => {}).finally(() => { wait = null; });
    };
    const vis = () => {
      clearTimeout(idle);
      if (document.hidden) {
        idle = setTimeout(() => { ac?.abort(); wait?.abort(); note = c.s.livePaused ?? ''; ctx().render(); }, 12e4);
        return;
      }
      if (note && note === c.s.livePaused) { note = ''; ctx().render(); }
      run();
    };
    document.addEventListener('visibilitychange', vis);
    run();
    return () => { stop = true; clearTimeout(idle); ac?.abort(); wait?.abort(); bc?.close(); document.removeEventListener('visibilitychange', vis); };
  }

  /** Offline cache: the last answer per query, per tab (sessionStorage); `offline` shows it when the network fails. */
  const ck = (q: string) => `wta-cache:${ctx().key}:${q}`;
  function cache(q: string, f: Feed) {
    for (const a of f.removed_actors ?? []) gone.add(a);
    try { sessionStorage.setItem(ck(q), JSON.stringify({ at: new Date().toISOString(), f })); } catch { /* full or blocked */ } }
  function offline(q: string): Feed | null {
    try {
      const v = JSON.parse(sessionStorage.getItem(ck(q)) ?? 'null') as { at: string; f: Feed } | null;
      if (!v) return null;
      note = fmt(ctx().s.offline!, { time: ctx().date(v.at) });
      addEventListener('online', () => { note = ''; ctx().setF(ctx().f); }, { once: true });
      return v.f;
    } catch { return null; }
  }
  const clearNote = () => { if (note && note !== ctx().s.livePaused) note = ''; };

  return { css: CSS, ready, bar, notes, list, detail, after, live, cache, offline, clearNote };
}
export type Ux = ReturnType<typeof create>;
