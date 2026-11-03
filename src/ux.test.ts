import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkPin, columns, receiptLinks, sparkline, views } from './extras';
import { mountActivity } from './index';
import type { Event } from './index';
import { chipText, dirFor, loadPrefs, removeTerm, tokenize } from './query';

const ev = (o: Partial<Event> = {}): Event => ({
  id: 'e1', account_id: 'a', actor: { id: 'anon', type: 'anonymous' }, action: 'page.viewed', metadata: { plan: 'pro' },
  occurred_at: '2026-10-30T10:00:00Z', received_at: '2026-10-30T10:00:00Z', ...o,
});

describe('query helpers', () => {
  it('tokenizes qualifiers, negation, quotes and free text', () => {
    const t = tokenize('actor:ada -outcome:denied actor:"Ada L" hello foo:bar');
    expect(t.map((x) => [x.key, x.value, x.neg])).toEqual([['actor', 'ada', false], ['outcome', 'denied', true], ['actor', 'Ada L', false], [undefined, 'hello', false], [undefined, 'foo:bar', false]]);
    expect(chipText(t[1]!)).toBe('not outcome: denied');
    expect(removeTerm('actor:ada -outcome:denied', 0)).toBe('-outcome:denied');
    expect(dirFor('he')).toBe('rtl');
    expect(dirFor('en-US')).toBe('ltr');
    localStorage.setItem('k', JSON.stringify({ limit: 7, order: 'asc' }));
    expect(loadPrefs('k', 25)).toMatchObject({ limit: 25, order: 'asc' });
  });

  it('extras render accessible controls', () => {
    const set = vi.fn();
    const f = columns({}, [{ label: 'Plan', field: 'metadata.plan' }], [], set);
    const cb = f.querySelector('input')!;
    cb.checked = false; cb.dispatchEvent(new Event('change'));
    expect(set).toHaveBeenCalledWith(['metadata.plan']);
    localStorage.clear();
    const re = vi.fn();
    const v = views({}, 'vk', () => ({ q: 'actor:ada', filters: { q: 'actor:ada' }, order: 'asc' }), vi.fn(), re);
    v.querySelector('input')!.value = 'Mine';
    v.querySelector('form')!.dispatchEvent(new Event('submit'));
    expect(JSON.parse(localStorage.getItem('vk')!)).toEqual([{ name: 'Mine', q: 'actor:ada', filters: { q: 'actor:ada' }, order: 'asc' }]);
    expect(re).toHaveBeenCalled();
    const svg = sparkline({}, [{ at: '2026-10-30T00:00:00Z', count: 3 }], 2, Date.parse('2026-10-30T12:00:00Z'));
    expect(svg.getAttribute('aria-label')).toBe('Events per day, last 2 days: 3');
    expect(svg.querySelector('path')!.getAttribute('d')).toBe('M0.0,23.0L120.0,1.0');
  });
});

describe('<wt-activity> viewer UX', () => {
  beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

  it('chips, sort, page size, banner, anonymous label, keyboard and a 409 proof', async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes('/feed/proof')) return new Response('{}', { status: 409 });
      if (url.includes('/feed/histogram')) return new Response(JSON.stringify({ data: [] }), { status: 200 });
      return new Response(JSON.stringify({ data: [ev(), ev({ id: 'e2', actor: { id: 'u2', name: 'Bo' } })], theme: { environmentLabel: 'Sandbox' } }), { status: 200 });
    });
    vi.stubGlobal('fetch', f);
    const tok = `h.${btoa(JSON.stringify({ cap: ['read', 'verify'] })).replace(/=+$/, '')}.s`;
    const { element } = mountActivity(document.body, { session: tok, baseUrl: 'https://api.test' });
    element.setAttribute('extras-url', '/src/extras.ts');
    const root = element.shadowRoot!;
    await vi.waitFor(() => expect(root.querySelectorAll('li[data-id]')).toHaveLength(2));
    expect(root.querySelector('.env')!.textContent).toBe('Sandbox');
    expect(root.querySelector('li[data-id]')!.textContent).toContain('Anonymous');
    const q = root.querySelector<HTMLInputElement>('#q')!;
    q.value = 'actor:ada -outcome:denied'; q.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(root.querySelectorAll('.c')).toHaveLength(2));
    (root.querySelector('.c button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(root.querySelectorAll('.c')).toHaveLength(1));
    const sels = [...root.querySelectorAll('select')];
    const sort = sels.find((s) => [...s.options].some((o) => o.value === 'asc'))!;
    sort.value = 'asc'; sort.dispatchEvent(new Event('change'));
    const size = sels.find((s) => [...s.options].some((o) => o.value === '100'))!;
    size.value = '100'; size.dispatchEvent(new Event('change'));
    await vi.waitFor(() => {
      const last = (f.mock.calls as unknown as [string][]).map((c) => c[0]).filter((u) => u.includes('/feed?')).at(-1)!;
      expect(last).toContain('order=asc');
      expect(last).toContain('limit=100');
    });
    const rows = () => [...root.querySelectorAll<HTMLElement>('li[data-id]')];
    await vi.waitFor(() => expect(rows()).toHaveLength(2));
    rows()[0]!.focus();
    rows()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(root.activeElement).toBe(rows()[1]);
    rows()[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const prove = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Prove')!;
    prove.click();
    await vi.waitFor(() => expect(root.textContent).toContain('Not sealed yet'));
  });
});

describe('regions and async exports', () => {
  it('moves to the region of the token, stays put otherwise', async () => {
    const { regionBase } = await import('./lib');
    const dir = { current: 'us', data: [{ region: 'us', api_base_url: 'https://us.x' }, { region: 'eu', api_base_url: 'https://eu.x/' }] };
    const f = vi.fn(async () => new Response(JSON.stringify(dir)));
    vi.stubGlobal('fetch', f);
    expect(await regionBase('https://us.x', 'eu')).toBe('https://eu.x');
    expect(await regionBase('https://us.x', 'us')).toBe('https://us.x');
    expect(await regionBase('https://us.x', undefined)).toBe('https://us.x');
    expect(f).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('queues an export with only the filters the API takes', async () => {
    const { exportsPanel } = await import('./extras');
    const calls: [string, RequestInit | undefined][] = [];
    vi.stubGlobal('fetch', vi.fn(async (u: string, i?: RequestInit) => { calls.push([u, i]); return new Response(JSON.stringify({ data: [] })); }));
    const p = exportsPanel({}, 'https://api.x', { headers: { authorization: 'Bearer t' } }, new URLSearchParams({ action: 'a.b', q: 'x', target_id: 't1' }));
    p.querySelector('form')!.dispatchEvent(new Event('submit'));
    await new Promise((r) => setTimeout(r, 0));
    const post = calls.find(([, i]) => i?.method === 'POST')!;
    expect(post[0]).toBe('https://api.x/v1/activity/exports');
    expect(JSON.parse(String(post[1]!.body))).toEqual({ format: 'csv', filters: { action: 'a.b' } });
    expect((post[1]!.headers as Record<string, string>).authorization).toBe('Bearer t');
    vi.unstubAllGlobals();
  });
});

describe('pinned log head and receipts', () => {
  it('pins, advances on a consistent head, flags a rewrite', async () => {
    localStorage.clear();
    const h = (size: number, root: string) => ({ size, root, created_at: '2026-10-01T00:00:00Z', message: '[]' });
    expect((await checkPin('p', h(2, 'a'), async () => true)).state).toBe('pinned');
    expect((await checkPin('p', h(5, 'b'), async (pin) => pin.size === 2)).state).toBe('ok');
    expect((await checkPin('p', h(5, 'x'), async () => true)).state).toBe('tampered');
    expect(receiptLinks({ kind: 'git', url: 'http://plain', commit: 'c' })).toEqual([]);
    expect(receiptLinks({ kind: 'git', url: 'https://github.com/o/r/commit/abc', commit: 'abcdef0123456789' })).toEqual([['git abcdef012345', 'https://github.com/o/r/commit/abc']]);
  });
});
