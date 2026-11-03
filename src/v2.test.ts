import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claims, interpolate, pickStrings, toQuery } from './lib';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mountActivity, type Event } from './index';

const ev = (o: Partial<Event> = {}): Event => ({
  id: '1', account_id: 'a', actor: { id: 'u1', name: 'Ann', email: 'ann@acme.test' }, action: 'user.role_changed',
  occurred_at: '2026-10-30T10:00:00Z', received_at: '2026-10-30T10:00:01Z', ...o,
});
const join = (tpl: string, e: Event) => interpolate(tpl, e).map((p) => p.text).join('');

describe('template fields', () => {
  it('actor.email, on_behalf_of.name, changes.count, target from targets[0]', () => {
    const e = ev({ on_behalf_of: { id: 's', name: 'Support Sam' }, changes: [{ field: 'role', old: 'member', new: 'admin' }, { field: 'x' }], targets: [{ type: 'user', id: 'u9', name: 'Bob' }] });
    expect(join('{actor.email} via {on_behalf_of.name}: {changes.count} changes to {target.name}', e)).toBe('ann@acme.test via Support Sam: 2 changes to Bob');
    expect(join('{changes.count}', ev())).toBe('');
  });
});

const DIR = resolve('src/locales') + '/'; // vitest runs in the package root
const LOCALES: Record<string, Record<string, string>> = Object.fromEntries(
  readdirSync(DIR).filter((f) => f.endsWith('.json') && f !== 'en.json').map((f) => [f.slice(0, -5), JSON.parse(readFileSync(DIR + f, 'utf8'))]),
);

describe('locale fallback', () => {
  it('builtins < default < base language < exact locale; flat map is default', () => {
    const strings = { default: { title: 'Log', emptyState: 'Empty' }, pt: { title: 'Registro' }, 'pt-BR': { emptyState: 'Vazio' } };
    expect(pickStrings(strings, 'pt-BR', LOCALES)).toMatchObject({ title: 'Registro', emptyState: 'Vazio', loadMore: 'Carregar mais' });
    expect(pickStrings(strings, 'de', LOCALES)).toMatchObject({ title: 'Log', loadMore: 'Mehr laden' });
    expect(pickStrings({ title: 'Flat' }, 'fr', LOCALES)).toMatchObject({ title: 'Flat', loadMore: 'Charger plus' });
    expect(pickStrings(undefined, undefined).loadMore).toBe('Load more');
  });
  it('every built-in locale file has every en.json key (regional overrides only a subset)', () => {
    const en = Object.keys(JSON.parse(readFileSync(DIR + 'en.json', 'utf8'))).sort();
    expect(Object.keys(LOCALES).length).toBeGreaterThanOrEqual(40);
    for (const [l, s] of Object.entries(LOCALES)) {
      if (['es-419', 'fr-CA', 'pt-PT'].includes(l)) expect(Object.keys(s).every((k) => en.includes(k)), l).toBe(true);
      else expect(Object.keys(s).sort(), l).toEqual(en);
    }
  });
});

describe('filters and claims', () => {
  it('quick range becomes from; custom keeps from/to; empty values dropped', () => {
    const now = Date.parse('2026-10-30T00:00:00Z');
    expect(toQuery({ q: ' inv ', action: '', range: '24h', from: 'x' }, now).toString()).toBe('q=inv&from=2026-10-29T00%3A00%3A00.000Z');
    expect(toQuery({ range: 'custom', from: 'a', to: 'b' }, now).toString()).toBe('from=a&to=b');
  });
  it('reads cap, locale and time zone from the token payload', () => {
    const p = btoa(JSON.stringify({ cap: ['read', 'export'], loc: 'de', tz: 'Europe/Berlin' })).replace(/=+$/, '');
    expect(claims(`h.${p}.s`)).toEqual({ cap: ['read', 'export'], locale: 'de', tz: 'Europe/Berlin' });
    expect(claims('garbage').cap).toEqual(['read']);
  });
});

describe('<wt-activity> v2', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const tok = `h.${btoa(JSON.stringify({ cap: ['read', 'export'] })).replace(/=+$/, '')}.s`;

  it('detail drawer renders changes as text, hides access events, filters re-query', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string) => {
      calls.push(u);
      if (u.includes('/feed/facets')) return new Response(JSON.stringify({ data: [{ value: 'u7', label: 'Zed', count: 3 }] }));
      if (u.includes('/actions')) return new Response(JSON.stringify({ data: [{ action: 'team.deleted' }] }));
      return new Response(JSON.stringify({
        data: [ev({ changes: [{ field: 'role', old: '<i>m</i>', new: 'admin' }], on_behalf_of: { id: 's' } }), ev({ id: '2', action: 'wt.activity.viewed' })],
        theme: { hideAccessEvents: true },
      }));
    }));
    const { element } = mountActivity(document.body, { session: tok, baseUrl: 'https://api.test' });
    const root = element.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelectorAll('li')).toHaveLength(1));
    await vi.waitFor(() => expect(root.textContent).toContain('Zed'));
    expect(root.textContent).toContain('via support');
    expect([...root.querySelectorAll('option')].map((o) => o.value)).toContain('team.deleted');
    expect(root.textContent).toContain('Export');
    expect(root.textContent).not.toContain('Verify');
    root.querySelector('li')!.click();
    const dr = root.querySelector('[role=dialog]')!;
    expect(dr.querySelector('td:nth-child(2)')!.textContent).toBe('<i>m</i>');
    expect(dr.querySelector('i')).toBeNull();
    const sel = root.querySelector<HTMLSelectElement>('select[aria-label="Outcome"]')!;
    sel.value = 'denied';
    sel.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(calls.some((c) => c.includes('outcome=denied'))).toBe(true));
    expect(calls.every((c) => !c.includes(tok))).toBe(true);
  });
});
