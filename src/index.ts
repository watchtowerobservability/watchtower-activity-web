import { applyTheme, interpolate, isDark, relTime } from './lib';
import type { Event, Feed, MountOptions, Theme } from './types';

export type { Event, Feed, MountOptions, Theme, Palette, ActionStyle } from './types';
export { interpolate, applyTheme } from './lib';

const CSS = `:host{display:block;font:14px/1.45 var(--wta-font,system-ui,sans-serif);color:var(--wta-fg,#1a1a1a);background:var(--wta-bg,#fff)}
*{box-sizing:border-box}.w{padding:16px}h2{font-size:18px;margin:0 0 12px}h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--wta-muted,#666);margin:16px 0 4px}
ul{list-style:none;margin:0;padding:0}li{display:flex;gap:12px;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--wta-border,#e3e3e3)}
.d li{padding:4px 0}time,.m{color:var(--wta-muted,#666);white-space:nowrap;font-size:12px}b{font-weight:600}
li[data-tone=danger] b.a{color:var(--wta-danger,#c0392b)}.m{display:block;white-space:normal}
button,select{font:inherit;color:inherit;background:transparent;border:1px solid var(--wta-border,#ccc);border-radius:var(--wta-radius,6px);padding:6px 12px;cursor:pointer}
button:focus-visible,select:focus-visible{outline:2px solid var(--wta-accent,#2563eb);outline-offset:2px}
button.p{background:var(--wta-accent,#2563eb);color:#fff;border-color:transparent}.bar{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.s{color:var(--wta-muted,#666);padding:24px 0;text-align:center}.e{color:var(--wta-danger,#c0392b)}
.v{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}`;

const opt = (text: string, value: string): HTMLOptionElement => {
  const o = h('option', text);
  o.value = value;
  return o;
};
const h = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
};

export class WtActivity extends HTMLElement {
  static observedAttributes = ['session', 'base-url', 'theme', 'accent', 'density'];
  #events: Event[] = [];
  #cursor: string | null = null;
  #theme: Theme | undefined;
  #action = '';
  #seen = new Set<string>();
  #root: ShadowRoot;
  #gen = 0;
  #err = '';
  #loading = false;
  #ready = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }
  get session() { return this.getAttribute('session') ?? ''; }
  set session(v: string) { this.setAttribute('session', v); }

  connectedCallback() { this.#ready = true; void this.reload(); }
  disconnectedCallback() { this.#ready = false; this.#gen++; }
  attributeChangedCallback(name: string, old: string | null, val: string | null) {
    if (old === val || !this.#ready) return;
    if (name === 'session' || name === 'base-url') void this.reload();
    else this.#render();
  }

  async reload() {
    this.#events = []; this.#cursor = null; this.#err = '';
    await this.#fetch();
  }

  async #fetch() {
    if (!this.session) { this.#err = 'Missing session'; return this.#render(); }
    const gen = ++this.#gen;
    this.#loading = true; this.#render();
    try {
      const q = new URLSearchParams({ limit: '25' });
      if (this.#cursor) q.set('cursor', this.#cursor);
      if (this.#action) q.set('action', this.#action);
      const base = (this.getAttribute('base-url') || location.origin).replace(/\/+$/, '');
      // Token only in the Authorization header, never in the URL.
      const res = await fetch(`${base}/v1/activity/feed?${q}`, { headers: { authorization: `Bearer ${this.session}` } });
      if (!res.ok) throw new Error(String(res.status));
      const f = (await res.json()) as Feed;
      if (gen !== this.#gen) return;
      this.#events.push(...f.data);
      for (const e of f.data) this.#seen.add(e.action);
      this.#cursor = f.next_cursor ?? null;
      if (f.theme) this.#theme = f.theme;
      this.#err = '';
    } catch (e) {
      if (gen !== this.#gen) return;
      this.#err = (e as Error).message;
    }
    this.#loading = false;
    this.#render();
  }

  #render() {
    const t = this.#theme, str = t?.strings ?? {};
    // shortcut: "system" scheme is read at render time, not live; re-render on attribute change or reload.
    applyTheme(this, t, isDark(this.getAttribute('theme'), t), this.getAttribute('accent') ?? undefined);
    const wrap = h('div', undefined, 'w' + ((this.getAttribute('density') || t?.density) === 'compact' ? ' d' : ''));
    const style = h('style', CSS + (t?.customCss ?? ''));
    wrap.append(h('h2', str.title ?? t?.brandName ?? 'Activity'));

    const bar = h('div', undefined, 'bar');
    const sel = h('select');
    sel.setAttribute('aria-label', 'Filter by action');
    sel.append(opt(str.allActions ?? 'All actions', ''));
    for (const a of new Set([...Object.keys(t?.actions ?? {}), ...this.#seen, ...(this.#action ? [this.#action] : [])])) {
      sel.append(opt(a, a));
    }
    sel.value = this.#action;
    sel.onchange = () => { this.#action = sel.value; void this.reload(); };
    bar.append(sel);
    wrap.append(bar);

    const live = h('div', undefined, 'v');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    wrap.append(live);

    if (this.#err) {
      const e = h('div', undefined, 's e');
      e.setAttribute('role', 'alert');
      e.append(h('p', str.error ?? 'Could not load activity.'));
      const r = h('button', str.retry ?? 'Retry');
      r.onclick = () => void (this.#events.length ? this.#fetch() : this.reload());
      e.append(r);
      wrap.append(e);
    } else if (!this.#events.length) {
      const m = this.#loading ? 'Loading…' : (str.emptyState ?? 'No activity yet.');
      live.textContent = m;
      wrap.append(h('p', m, 's'));
    }

    const days = new Map<string, Event[]>();
    for (const ev of this.#events) {
      const k = new Date(ev.occurred_at).toLocaleDateString(undefined, { dateStyle: 'full' });
      (days.get(k) ?? days.set(k, []).get(k)!).push(ev);
    }
    for (const [day, evs] of days) {
      const sec = h('section');
      sec.append(h('h3', day));
      const ul = h('ul');
      for (const ev of evs) ul.append(this.#row(ev, t));
      sec.append(ul);
      wrap.append(sec);
    }

    if (this.#cursor && !this.#err) {
      const b = h('button', this.#loading ? 'Loading…' : (str.loadMore ?? 'Load more'), 'p');
      b.disabled = this.#loading;
      b.onclick = () => void this.#fetch();
      wrap.append(b);
    }
    this.#root.replaceChildren(style, wrap);
  }

  #row(ev: Event, t?: Theme) {
    const li = h('li');
    const st = t?.actions?.[ev.action];
    if (st?.tone) li.dataset.tone = st.tone;
    const body = h('div');
    const tpl = st?.label ?? '{actor.name} ' + ev.action + (ev.target ? ' {target.name}' : '');
    const line = h('span');
    for (const p of interpolate(tpl, { ...ev, actor: { ...ev.actor, name: ev.actor.name || ev.actor.id } })) {
      line.append(p.field ? h('b', p.text, 'a') : document.createTextNode(p.text));
    }
    body.append(line);
    if (t?.showIp && ev.ip) body.append(h('span', ev.ip, 'm'));
    if (t?.showMetadata && ev.metadata) body.append(h('span', JSON.stringify(ev.metadata), 'm'));
    const time = h('time', relTime(ev.occurred_at));
    time.dateTime = ev.occurred_at;
    time.title = new Date(ev.occurred_at).toLocaleString();
    li.append(body, time);
    return li;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('wt-activity')) customElements.define('wt-activity', WtActivity);

/** Create a <wt-activity> inside `el`. Returns a handle to refresh or remove it. */
export function mountActivity(el: Element, opts: MountOptions) {
  const node = document.createElement('wt-activity') as WtActivity;
  node.setAttribute('session', opts.session);
  if (opts.baseUrl) node.setAttribute('base-url', opts.baseUrl);
  if (opts.theme) node.setAttribute('theme', opts.theme);
  if (opts.accent) node.setAttribute('accent', opts.accent);
  if (opts.density) node.setAttribute('density', opts.density);
  el.append(node);
  return { element: node, reload: () => node.reload(), destroy: () => node.remove() };
}
