// Lazy-loaded extras of <wt-activity> (outside the 12 KB core): verify and per-event proofs, column
// chooser, saved views, async exports and the daily-volume sparkline. Built as dist/extras.js next to the main bundle; the element imports it
// on first use, so a page that never opens them never downloads them.
import type { Column, Strings } from './types';

// Verification lives here too, so its hashing and Ed25519 code stays out of the core bundle.
import { runConsistency } from './verify';
import { verdict, type Head as NetHead, type NetPage, type NetVerdict } from './verify_net';
export { runConsistency, runProof, runVerify } from './verify';
export * from './verify_net';

/**
 * The four-state verdict (VALID / VALID_UNANCHORED / VALID_PRUNED / INVALID) over every verify page, the
 * project's keys and the signed head (`/feed/head`, absent until the first hourly head).
 */
export async function runVerdict(base: string, init: RequestInit): Promise<NetVerdict & { checked: number }> {
  const get = async <T>(p: string): Promise<T> => { const r = await fetch(base + p, init); if (!r.ok) throw new Error(String(r.status)); return r.json() as Promise<T>; };
  const pages: (NetPage & { next_cursor: string | null; project: string })[] = [await get('/v1/activity/feed/verify?limit=2000')];
  // shortcut: at most 50 pages (100k rows) per click, like runVerify
  for (let n = 0, c = pages[0]!.next_cursor; c && n < 50; n++, c = pages[pages.length - 1]!.next_cursor) pages.push(await get(`/v1/activity/feed/verify?limit=2000&from_seq=${encodeURIComponent(c)}`));
  const project = pages[0]!.project;
  const keys = (await get<{ keys?: { kid: string; x: string }[] }>(`/v1/activity/keys?project=${encodeURIComponent(project)}`).catch(() => ({ keys: [] }))).keys ?? [];
  const head = await get<{ sth: NetHead }>('/v1/activity/feed/head').then((h) => h.sth, () => null);
  const v = await verdict(pages, head, { keys, project });
  return { ...v, checked: pages.reduce((n, p) => n + p.data.length, 0) };
}

export interface SavedView { name: string; q: string; filters: Record<string, string>; order: string }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  return e;
};

/** Checkboxes over the theme's `columns`; `set` gets the hidden fields. */
export function columns(s: Strings, cols: Column[], hidden: string[], set: (hidden: string[]) => void): HTMLElement {
  const f = el('fieldset');
  f.append(el('legend', s.columns ?? 'Columns'));
  for (const c of cols) {
    const l = el('label');
    const cb = Object.assign(el('input'), { type: 'checkbox', checked: !hidden.includes(c.field) });
    cb.onchange = () => set(cb.checked ? hidden.filter((h) => h !== c.field) : [...hidden, c.field]);
    l.append(cb, ` ${c.label}`);
    f.append(l);
  }
  return f;
}

export function loadViews(key: string): SavedView[] {
  try { const v = JSON.parse(localStorage.getItem(key) ?? '[]') as SavedView[]; return Array.isArray(v) ? v.slice(0, 50) : []; } catch { return []; }
}
const store = (key: string, v: SavedView[]) => { try { localStorage.setItem(key, JSON.stringify(v.slice(0, 50))); } catch { /* blocked */ } };

interface ServerView { id: string; name: string; q: string; params: Record<string, string> }
type Remote = { base: string; init: RequestInit };
const tokenCred = new Map<string, Promise<boolean>>();
const call = (r: Remote, path: string, more: RequestInit = {}) =>
  fetch(r.base + path, { ...r.init, ...more, headers: { ...(r.init.headers as Record<string, string>), ...(more.headers as Record<string, string>) } })
    .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res; });
/** Whether the credential is an account token (`/v1/activity/session`), which keeps its views on the server. Cached per credential. */
const isToken = (r: Remote) => {
  const k = `${r.base} ${(r.init.headers as Record<string, string> | undefined)?.authorization ?? ''}`;
  if (!tokenCred.has(k)) tokenCred.set(k, call(r, '/v1/activity/session').then((x) => x.json()).then((x: { credential?: string }) => x.credential === 'account_token').catch(() => false));
  return tokenCred.get(k)!;
};
const fromServer = (v: ServerView): SavedView & { id: string } => {
  const { order = 'desc', ...filters } = v.params;
  return { id: v.id, name: v.name, q: v.q, filters: { ...filters, ...(v.q ? { q: v.q } : {}) }, order };
};

/** Saved views: apply, delete, save the current one. In localStorage, or on the server for an account token (`remote`). */
export function views(s: Strings, key: string, current: () => Omit<SavedView, 'name'>, apply: (v: SavedView) => void, rerender: () => void, remote?: Remote): HTMLElement {
  const box = el('div');
  let list: (SavedView & { id?: string })[] = loadViews(key);
  let srv = false;
  const ul = el('ul');
  ul.setAttribute('aria-label', s.views ?? 'Saved views');
  const status = el('p');
  status.setAttribute('role', 'status');
  const fail = (e: Error) => { status.textContent = `${s.error} (${e.message})`; };
  const load = () => call(remote!, '/v1/activity/views').then((r) => r.json()).then((p: { data: ServerView[] }) => { list = p.data.map(fromServer); draw(); }).catch(fail);
  const draw = () => ul.replaceChildren(...list.map((v) => {
    const li = el('li');
    const a = Object.assign(el('button', v.name), { type: 'button', onclick: () => apply(v) });
    const del = Object.assign(el('button', '×'), { type: 'button', onclick: () => {
      if (srv && v.id) void call(remote!, `/v1/activity/views/${encodeURIComponent(v.id)}`, { method: 'DELETE' }).then(load).catch(fail);
      else { store(key, list.filter((x) => x.name !== v.name)); rerender(); }
    } });
    del.setAttribute('aria-label', (s.deleteView ?? 'Delete view {name}').replace('{name}', v.name));
    li.append(a, del);
    return li;
  }));
  const form = el('form');
  const name = Object.assign(el('input'), { maxLength: 60, placeholder: s.viewName ?? 'View name' });
  name.setAttribute('aria-label', s.viewName ?? 'View name');
  form.append(name, Object.assign(el('button', s.saveView ?? 'Save view'), { type: 'submit' }));
  form.onsubmit = (e) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) return;
    const c = current();
    if (!srv) { store(key, [...list.filter((x) => x.name !== n), { name: n, ...c }]); rerender(); return; }
    // the server keeps names unique: replace a view of the same name
    const old = list.find((x) => x.name === n)?.id;
    const params: Record<string, string> = { order: c.order };
    for (const [k, v] of Object.entries(c.filters)) if (v && k !== 'q') params[k] = v;
    void (old ? call(remote!, `/v1/activity/views/${encodeURIComponent(old)}`, { method: 'DELETE' }) : Promise.resolve())
      .then(() => call(remote!, '/v1/activity/views', { method: 'POST', body: JSON.stringify({ name: n, q: c.q, params }), headers: { 'content-type': 'application/json' } }))
      .then(() => { name.value = ''; return load(); }).catch(fail);
  };
  box.append(ul, form, status);
  draw();
  if (remote) void isToken(remote).then((yes) => { if (yes) { srv = true; void load(); } });
  return box;
}

/** Inline SVG of daily counts over the last `days` UTC days (text alternative in aria-label). */
export function sparkline(s: Strings, buckets: { at: string; count: number }[], days: number, now = Date.now()): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const end = Math.floor(now / 864e5);
  const counts = Array.from({ length: days }, () => 0);
  for (const b of buckets) { const i = days - 1 - (end - Math.floor(Date.parse(b.at) / 864e5)); if (i >= 0 && i < days) counts[i] = b.count; }
  const max = Math.max(1, ...counts);
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of [['width', '120'], ['height', '24'], ['viewBox', '0 0 120 24'], ['role', 'img']]) svg.setAttribute(k!, v!);
  const label = `${(s.volume ?? 'Events per day, last {n} days').replace('{n}', String(days))}: ${counts.reduce((a, b) => a + b, 0)}`;
  svg.setAttribute('aria-label', label);
  const t = document.createElementNS(ns, 'title');
  t.textContent = label;
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', counts.map((c, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, days - 1)) * 120).toFixed(1)},${(23 - (c / max) * 22).toFixed(1)}`).join(''));
  for (const [k, v] of [['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '1.5']]) p.setAttribute(k!, v!);
  svg.append(t, p);
  return svg;
}

interface ExportRow { id: string; format: string; state: string; rows?: number | null; created_at: string; expires_at?: string | null }
const EXPORT_FILTERS = ['actor_id', 'action', 'target_type', 'outcome', 'severity', 'from', 'to'];

/**
 * Async exports of the session's account (cap `export`): queue one over the current filters (optionally emailing the
 * link), list them, download a finished file. Fetch + Blob, so the token stays in the header.
 */
export function exportsPanel(s: Strings, base: string, init: RequestInit, q: URLSearchParams): HTMLElement {
  const box = el('div');
  const status = el('p');
  status.setAttribute('role', 'status');
  const ul = el('ul');
  ul.setAttribute('aria-label', s.exports ?? 'Exports');
  const call = async (path: string, more: RequestInit = {}) => {
    const res = await fetch(base + path, { ...init, ...more, headers: { ...(init.headers as Record<string, string>), ...(more.headers as Record<string, string>) } });
    if (!res.ok) throw new Error(String(res.status));
    return res;
  };
  const list = () => call('/v1/activity/exports?limit=20').then((r) => r.json()).then((p: { data: ExportRow[] }) => {
    ul.replaceChildren(...p.data.map((x) => {
      const li = el('li');
      li.append(`${x.created_at.slice(0, 16).replace('T', ' ')} · ${x.format} · ${x.state}${x.rows != null ? ` · ${x.rows}` : ''}`);
      if (x.state === 'done') {
        li.append(Object.assign(el('button', s.download ?? 'Download'), { type: 'button', onclick: () => void call(`/v1/activity/exports/${encodeURIComponent(x.id)}/download`)
          .then(async (r) => { const u = URL.createObjectURL(await r.blob()); Object.assign(el('a'), { href: u, download: `activity.${x.format === 'csv' ? 'csv' : 'ndjson'}` }).click(); setTimeout(() => URL.revokeObjectURL(u), 1e4); })
          .catch((e: Error) => { status.textContent = `${s.error} (${e.message})`; }) }));
      }
      return li;
    }));
  }).catch((e: Error) => { status.textContent = `${s.error} (${e.message})`; });
  const form = el('form');
  const fmtSel = el('select');
  fmtSel.setAttribute('aria-label', s.format ?? 'Format');
  for (const f of ['csv', 'ndjson']) fmtSel.append(Object.assign(el('option', f.toUpperCase()), { value: f }));
  const email = Object.assign(el('input'), { type: 'email', placeholder: s.emailLink ?? 'Email the link to (optional)' });
  email.setAttribute('aria-label', s.emailLink ?? 'Email the link to (optional)');
  form.append(fmtSel, email, Object.assign(el('button', s.queueExport ?? 'Queue export'), { type: 'submit' }));
  form.onsubmit = (e) => {
    e.preventDefault();
    const filters = Object.fromEntries(EXPORT_FILTERS.filter((k) => q.get(k)).map((k) => [k, q.get(k)!]));
    const body = { format: fmtSel.value, filters, ...(email.value.trim() ? { notify_email: email.value.trim() } : {}) };
    void call('/v1/activity/exports', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
      .then(() => { status.textContent = s.exportQueued ?? 'Export queued. It appears below when ready.'; return list(); })
      .catch((e: Error) => { status.textContent = `${s.error} (${e.message})`; });
  };
  const refresh = Object.assign(el('button', s.refresh ?? 'Refresh'), { type: 'button', onclick: () => void list() });
  box.append(form, refresh, status, ul);
  void list();
  return box;
}

interface Head { sth: { size: number; root: string; created_at: string; message: string; anchor?: { receipts?: Receipt[] } | null }; project: string }
interface Receipt { kind?: string; url?: string; id?: string; commit?: string; entries?: { log_index?: number | null }[] }
type Pin = { size: number; root: string; since: string };
const head = (base: string, init: RequestInit) => call({ base, init }, '/v1/activity/feed/head').then((r) => r.json() as Promise<Head>);
const web = (u?: string) => (u?.startsWith('https://') ? u : null);

/** Links to an anchor's public receipts: Rekor log entries, the Arweave transaction, the git commit (https only). */
export function receiptLinks(r: Receipt): [string, string][] {
  const out: [string, string][] = [];
  const u = web(r.url);
  if (r.kind === 'rekor' && u) for (const e of r.entries ?? []) {
    if (e.log_index == null) continue;
    out.push([`Rekor #${e.log_index}`, /rekor\.sigstore\.dev/.test(u) ? `https://search.sigstore.dev/?logIndex=${e.log_index}` : `${u}/api/v1/log/entries?logIndex=${e.log_index}`]);
  }
  if (r.kind === 'arweave' && u) out.push([`Arweave ${r.id ?? ''}`.trim(), u]);
  if (r.kind === 'git' && u) out.push([`git ${(r.commit ?? '').slice(0, 12)}`.trim(), u]);
  return out;
}

/** The published receipts of the account's latest signed head (which covers a proven event), or null. */
export async function receipts(s: Strings, base: string, init: RequestInit): Promise<HTMLElement | null> {
  const links = ((await head(base, init)).sth.anchor?.receipts ?? []).flatMap(receiptLinks);
  if (!links.length) return null;
  const box = el('div');
  const ul = el('ul');
  for (const [t, href] of links) {
    const li = el('li');
    li.append(Object.assign(el('a', t), { href, target: '_blank', rel: 'noopener noreferrer' }));
    ul.append(li);
  }
  box.append(el('h3', s.receipts ?? 'Published receipts'), ul);
  return box;
}

/**
 * Pin `{size, root}` of a signed head per account; on later visits the newer head must be consistent with the pin.
 * `consistent` checks pin -> head. Returns `pinned` (first visit), `ok` (pin advanced) or `tampered` (pin kept).
 */
export async function checkPin(key: string, sth: Head['sth'], consistent: (pin: Pin) => Promise<boolean>): Promise<{ state: 'pinned' | 'ok' | 'tampered'; since: string }> {
  let pin: Pin | null = null;
  try { pin = JSON.parse(localStorage.getItem(key) ?? 'null') as Pin | null; } catch { /* storage blocked */ }
  const save = (since: string) => { try { localStorage.setItem(key, JSON.stringify({ size: sth.size, root: sth.root, since })); } catch { /* blocked */ } };
  if (!pin || typeof pin.size !== 'number') { save(sth.created_at); return { state: 'pinned', since: sth.created_at }; }
  const same = pin.size === sth.size;
  const ok = same ? pin.root === sth.root : pin.size < sth.size && (await consistent(pin));
  if (!ok) return { state: 'tampered', since: pin.since };
  if (!same) save(pin.since);
  return { state: 'ok', since: pin.since };
}

/** The element's log check: the note to show, or null when there is no signed head yet or the check could not run. */
export async function checkLog(s: Strings, base: string, init: RequestInit, date: (iso: string) => string): Promise<{ text: string; alert: boolean } | null> {
  try {
    const h = await head(base, init);
    const account = (JSON.parse(h.sth.message) as unknown[])[2];
    const r = await checkPin(`wta-pin:${base}:${h.project}:${String(account)}`, h.sth,
      (pin) => runConsistency(base, init, pin, h.sth.size).then((v) => v.ok && v.signature !== false));
    const t = { pinned: s.logPinned ?? 'Log head pinned on {date}; later visits check that nothing signed before has changed.', ok: s.logConsistent ?? 'Log consistent since {date}.',
      tampered: s.logTampered ?? 'Warning: the log changed since {date}. Events signed earlier were altered or removed.' }[r.state];
    return { text: t.replace('{date}', date(r.since)), alert: r.state === 'tampered' };
  } catch { return null; } // shortcut: a 404/409/network failure shows nothing rather than a false alarm
}

const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Opens the `$wt_cse` envelopes under `v` (at dotted `path` from the event root) with the viewer-held base64 AES-256 key; an envelope it cannot open stays as is. */
export async function openSealed(v: unknown, key: string, path: string): Promise<unknown> {
  if (!v || typeof v !== 'object') return v;
  if (Array.isArray(v)) return Promise.all(v.map((x, i) => openSealed(x, key, `${path}.${i}`)));
  const o = v as Record<string, unknown>;
  if (typeof o.$wt_cse === 'string') {
    try {
      const k = await crypto.subtle.importKey('raw', unb64(key), 'AES-GCM', false, ['decrypt']);
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(String(o.iv)), additionalData: new TextEncoder().encode(path) }, k, unb64(String(o.ct)));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch { return v; }
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(o)) out[k] = await openSealed(x, key, `${path}.${k}`);
  return out;
}

/** The value behind a tokenised IP or email (capability `reveal`; every reveal is an audited access event). */
export async function reveal(base: string, init: RequestInit, token: string): Promise<string> {
  const res = await fetch(`${base}/v1/activity/reveal`, { ...init, method: 'POST', headers: { ...init.headers, 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  if (!res.ok) throw new Error(String(res.status));
  return ((await res.json()) as { value: string }).value;
}
