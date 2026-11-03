import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bytes, consistencyVerify, merkleVerify, verifyConsistency, type Consistency, type Sth } from './verify';

// RFC 6962 vectors computed by an independent Python script, shared with the Rust (wt-store-pg merkle_log) and Go
// (wtctl) tests: leaf i = SHA-256(0x00 || data[i]).
type Vectors = {
  data: string[]; roots: Record<string, string>;
  inclusion: { index: number; size: number; path: string[] }[];
  consistency: { from: number; to: number; proof: string[] }[];
};
const v = JSON.parse(readFileSync(join(process.cwd(), 'testdata/activity_merkle_vectors.json'), 'utf8')) as Vectors;
const leaf = async (hex: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([0, ...bytes(hex)])));
const root = (n: number) => v.roots[String(n)]!;

const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('merkle log vectors', () => {
  it('inclusion proofs verify', async () => {
    for (const c of v.inclusion) {
      expect(await merkleVerify(await leaf(v.data[c.index]!), c.index, c.size, c.path, root(c.size)), `${c.index}/${c.size}`).toBe(true);
    }
  });
  it('consistency proofs verify and tampering fails', async () => {
    for (const c of v.consistency) {
      const what = `${c.from}->${c.to}`;
      expect(await consistencyVerify(c.from, c.to, root(c.from), root(c.to), c.proof), what).toBe(true);
      if (c.from === c.to) continue;
      expect(await consistencyVerify(c.from, c.to, root(c.to), root(c.from), c.proof), what).toBe(false);
      if (c.proof.length) expect(await consistencyVerify(c.from, c.to, root(c.from), root(c.to), [root(1), ...c.proof.slice(1)]), what).toBe(false);
      expect(await consistencyVerify(c.from, c.to, root(c.from), root(c.to), [...c.proof, root(1)]), what).toBe(false);
    }
    expect(await consistencyVerify(0, 3, root(0), root(3), [])).toBe(false);
  });
  it('checks both signed tree heads and the pinned head', async () => {
    const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
    const keys = [{ kid: 'k1', x: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) }];
    const sth = async (size: number): Promise<Sth> => {
      const message = `["wt.activity.merkle.v1","prj_1","a",5,${4 + size},"${root(size)}"]`;
      const sig = b64u(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(message)));
      return { size, from_seq: 5, to_seq: 4 + size, root: root(size), kid: 'k1', message, signature: sig, created_at: '', anchor: null };
    };
    const vec = v.consistency.find((x) => x.from === 7 && x.to === 13)!;
    const c: Consistency = { from_size: 7, to_size: 13, proof: vec.proof, from_root: root(7), to_root: root(13), sth: await sth(13), from_sth: await sth(7), project: 'acme' };
    expect(await verifyConsistency(c, keys, { size: 7, root: root(7) })).toMatchObject({ ok: true, checked: 6, signature: true });
    expect(await verifyConsistency(c, [])).toMatchObject({ ok: true, signature: null });
    expect(await verifyConsistency(c, keys, { size: 7, root: root(6) })).toMatchObject({ ok: false });
    expect(await verifyConsistency({ ...c, to_root: root(12) }, keys)).toMatchObject({ ok: false });
    expect(await verifyConsistency({ ...c, sth: { ...c.sth, signature: c.from_sth.signature } }, keys)).toMatchObject({ ok: true, signature: false });
  });
});
