import { describe, expect, it } from 'vitest';
import { openSealed } from './extras';
import { readFileSync } from 'node:fs';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=';
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function envelope(value: unknown, path: string) {
  const k = await crypto.subtle.importKey('raw', Uint8Array.from(atob(KEY), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(path) }, k, new TextEncoder().encode(JSON.stringify(value)));
  return { $wt_cse: 's1', alg: 'A256GCM', iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}

describe('client-sealed values', () => {
  it('open with the viewer key at their path only', async () => {
    const m = { plan: 'pro', ssn: await envelope('123-45', 'metadata.ssn'), moved: await envelope('x', 'metadata.other') };
    const out = (await openSealed(m, KEY, 'metadata')) as Record<string, unknown>;
    expect(out.plan).toBe('pro');
    expect(out.ssn).toBe('123-45');
    expect(out.moved).toEqual(m.moved);
  });
});

describe('sealed changes and reveal strings', () => {
  it('opens changes[].old/new at changes.<i>.<side> only', async () => {
    const ch = [{ field: 'a', old: await envelope('x', 'changes.0.old'), new: 'plain' }, { field: 'b', old: 1, new: await envelope('y', 'changes.0.new') }];
    const out = (await openSealed(ch, KEY, 'changes')) as typeof ch;
    expect(out[0]).toMatchObject({ old: 'x', new: 'plain' });
    expect(out[1]!.new).toEqual(ch[1]!.new); // wrong index: AAD mismatch keeps the envelope
  });
  it('every locale has the reveal strings', () => {
    for (const l of ['de', 'fr', 'es', 'ja', 'pt-BR']) for (const k of ['reveal', 'revealed', 'revealFailed']) expect(JSON.parse(readFileSync(`src/locales/${l}.json`, 'utf8'))[k]).toBeTruthy();
  });
});
