import { describe, expect, it } from 'vitest';
import { dirFor, fmt, groupRuns, localeFiles, markKind, relatedQueries, toggleTerm, viaText } from './viewlogic';

const ev = (id: string, actor: string, action: string, at: string) => ({ id, action, occurred_at: at, actor: { id: actor } });

describe('viewlogic', () => {
  it('ICU plurals pick the locale category and exact matches', () => {
    const s = '{n, plural, =0 {none} one {# event} other {# events}}';
    expect(fmt(s, { n: 0 }, 'en')).toBe('none');
    expect(fmt(s, { n: 1 }, 'en')).toBe('1 event');
    expect(fmt(s, { n: 1200 }, 'en')).toBe('1,200 events');
    const ru = '{n, plural, one {# событие} few {# события} many {# событий} other {# события}}';
    expect([1, 3, 5, 21].map((n) => fmt(ru, { n }, 'ru'))).toEqual(['1 событие', '3 события', '5 событий', '21 событие']);
    expect(fmt('Delete view {name}', { name: 'Mine' })).toBe('Delete view Mine');
    expect(fmt('{missing}', {})).toBe('{missing}');
  });

  it('locale files: base first, variants and aliases', () => {
    expect(localeFiles('en-US')).toEqual([]);
    expect(localeFiles('de-AT')).toEqual(['de']);
    expect(localeFiles('es-MX')).toEqual(['es', 'es-419']);
    expect(localeFiles('es-ES')).toEqual(['es']);
    expect(localeFiles('pt')).toEqual(['pt-BR']);
    expect(localeFiles('pt_PT')).toEqual(['pt-BR', 'pt-PT']);
    expect(localeFiles('zh-Hant-HK')).toEqual(['zh-TW']);
    expect(localeFiles('zh')).toEqual(['zh-CN']);
    expect(localeFiles('nn-NO')).toEqual(['nb']);
    expect(localeFiles('fr-CA')).toEqual(['fr', 'fr-CA']);
    expect(dirFor('ar-EG')).toBe('rtl');
    expect(dirFor('fa')).toBe('rtl');
  });

  it('groups runs of the same actor and action within 5 minutes', () => {
    const runs = groupRuns([
      ev('1', 'ann', 'setting.changed', '2026-10-30T10:10:00Z'),
      ev('2', 'ann', 'setting.changed', '2026-10-30T10:08:00Z'),
      ev('3', 'ann', 'setting.changed', '2026-10-30T09:00:00Z'),
      ev('4', 'bob', 'setting.changed', '2026-10-30T08:59:00Z'),
    ]);
    expect(runs.map((r) => r.map((e) => e.id))).toEqual([['1', '2'], ['3'], ['4']]);
  });

  it('delegation chain text', () => {
    const s = { viaFor: 'for', approvedBy: 'approved by {name}', usingTool: 'using {tool}' };
    const t = viaText({ id: 'agent', name: 'Agent X' }, [
      { actor: { id: 'agent' }, model: 'claude-opus' },
      { actor: { id: 'ann', name: 'Ann' }, approved_by: { id: 'bob', name: 'Bob' } },
    ], s);
    expect(t).toBe('Agent X (claude-opus) for Ann, approved by Bob');
    expect(viaText({ id: 'a' }, [], s)).toBe('');
  });

  it('related queries, marks and terms', () => {
    const r = relatedQueries({ actor: { id: 'u 1' }, targets: [{ id: 't1' }], context: { session_id: 's1' }, trace_id: 'abc' });
    expect(r).toEqual([['sameSession', 'session:s1'], ['sameActor', 'actor:"u 1"'], ['sameTarget', 'target:t1'], ['sameTrace', 'trace:abc']]);
    expect(markKind('[REDACTED]')).toBe('redacted');
    expect(markKind('x7f@token.invalid')).toBe('tokenized');
    expect(markKind('ann@acme.test')).toBeNull();
    expect(toggleTerm('actor:ann', 'is:notable')).toBe('actor:ann is:notable');
    expect(toggleTerm('actor:ann is:notable', 'is:notable')).toBe('actor:ann');
  });
});

describe('ux deep links', () => {
  it('reads #wta-q/from/to/view and drops bad dates', async () => {
    const { linkFilters } = await import('./ux');
    expect(linkFilters('#wta-q=actor%3Aann&wta-from=2026-10-01T00:00:00Z&wta-to=nope&wta-view=ops')).toEqual({
      f: { q: 'actor:ann', from: '2026-10-01T00:00:00Z', range: 'custom' }, view: 'ops',
    });
    expect(linkFilters('')).toEqual({ f: {}, view: undefined });
  });
});

describe('gap markers', () => {
  it('places each incident before the first older row', async () => {
    const { placeGaps } = await import('./viewlogic');
    const times = ['2026-10-30T10:00:00Z', '2026-10-30T08:00:00Z', '2026-10-29T08:00:00Z'];
    const g1 = { kind: 'silent_source', started_at: '2026-10-30T08:30:00Z', ended_at: '2026-10-30T09:00:00Z' };
    const open = { kind: 'chain_break', started_at: '2026-10-30T11:00:00Z' };
    const old = { kind: 'manual', started_at: '2026-10-01T00:00:00Z', ended_at: '2026-10-02T00:00:00Z' };
    const out = placeGaps(times, [g1, open, old], Date.parse('2026-10-30T12:00:00Z'));
    expect(out.map((x) => x.map((g) => g.kind))).toEqual([['chain_break'], ['silent_source'], [], ['manual']]);
    const asc = placeGaps([...times].reverse(), [g1, open, old], Date.parse('2026-10-30T12:00:00Z'), true);
    expect(asc.map((x) => x.map((g) => g.kind))).toEqual([['manual'], [], ['silent_source'], ['chain_break']]);
  });
});
