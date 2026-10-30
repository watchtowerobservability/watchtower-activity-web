import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, interpolate, mountActivity } from './index';
import type { Event, Feed } from './index';

const ev = (o: Partial<Event> = {}): Event => ({
  id: '1', account_id: 'a', actor: { id: 'u1', name: 'Ann' }, action: 'invoice.paid',
  target: { type: 'invoice', id: 'i1', name: 'INV-7' },
  occurred_at: new Date().toISOString(), received_at: new Date().toISOString(), ...o,
});

describe('interpolate', () => {
  it('fills fields and keeps data as plain text', () => {
    const parts = interpolate('{actor.name} paid invoice {target.name}', ev({ actor: { id: 'u', name: '<img src=x onerror=alert(1)>' } }));
    expect(parts.map((p) => p.text).join('')).toBe('<img src=x onerror=alert(1)> paid invoice INV-7');
    expect(parts.filter((p) => p.field)).toHaveLength(2);
  });
  it('missing and object paths render empty', () => {
    expect(interpolate('{nope.x}{metadata}', ev({ metadata: { a: 1 } })).map((p) => p.text)).toEqual(['', '']);
  });
});

describe('applyTheme', () => {
  it('sets only provided keys, layering host vars; dark palette and accent attr win', () => {
    const el = document.createElement('div');
    applyTheme(el, { palette: { bg: '#fff', accent: '#00f' }, paletteDark: { bg: '#000' }, radius: 8 }, true, '#f0f');
    expect(el.style.getPropertyValue('--wta-bg')).toBe('var(--wt-activity-bg, #000)');
    expect(el.style.getPropertyValue('--wta-radius')).toBe('var(--wt-activity-radius, 8px)');
    expect(el.style.getPropertyValue('--wta-accent')).toBe('#f0f');
    expect(el.style.getPropertyValue('--wta-fg')).toBe('');
  });
  it('rejects values that could break out of the declaration', () => {
    const el = document.createElement('div');
    applyTheme(el, { palette: { bg: 'red; background:url(//evil)' } }, false);
    expect(el.style.getPropertyValue('--wta-bg')).toBe('');
  });
});

describe('<wt-activity>', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const feed = (f: Feed) => vi.fn(async () => new Response(JSON.stringify(f), { status: 200 }));

  it('sends the session as Bearer only, renders escaped text, applies the theme', async () => {
    const f = feed({
      data: [ev({ actor: { id: 'u', name: '<b>x</b>' } })], next_cursor: 'c2',
      theme: { palette: { accent: '#123456' }, actions: { 'invoice.paid': { label: '{actor.name} paid invoice {target.name}' } } },
    });
    vi.stubGlobal('fetch', f);
    const { element } = mountActivity(document.body, { session: 'tok123', baseUrl: 'https://api.test' });
    await vi.waitFor(() => expect(element.shadowRoot!.querySelector('li')).toBeTruthy());
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/api\.test\/v1\/activity\/feed\?/);
    expect(url).not.toContain('tok123');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok123');
    const li = element.shadowRoot!.querySelector('li')!;
    expect(li.textContent).toContain('<b>x</b> paid invoice INV-7');
    expect(li.querySelector('b b')).toBeNull();
    expect(element.style.getPropertyValue('--wta-accent')).toContain('#123456');
    expect(element.shadowRoot!.textContent).toContain('Load more');
  });

  it('shows empty and error states', async () => {
    vi.stubGlobal('fetch', feed({ data: [] }));
    const a = mountActivity(document.body, { session: 's' }).element;
    await vi.waitFor(() => expect(a.shadowRoot!.textContent).toContain('No activity yet.'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const b = mountActivity(document.body, { session: 's' }).element;
    await vi.waitFor(() => expect(b.shadowRoot!.querySelector('[role=alert]')).toBeTruthy());
  });
});
