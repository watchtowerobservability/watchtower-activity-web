import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  logOrigin, parseNote, parseVkey, verdict, verifyCompleteness, verifyCosignature, verifyDigests, verifyDisclosure, verifyNote,
  verifyTombstone, type Digest, type Head, type NetPage, type Tombstone,
} from './verify_net';

// testdata/activity_verify_vectors.json: the conformance vectors every verifier (Rust, Go, TS, SDKs) runs.
type V = {
  project: string; account: string; keys: { keys: { kid: string; x: string }[] };
  witness_key: { vkey: string }; rekor_log: { origin: string; x: string };
  note: { origin: string; text: string; vkey: string; body: string; cosignature_line: string };
  origin_escaping: { account: string; origin: string }[];
  chain: { id: string; seq: number; prev_hash: string; hash: string; body: string }[];
  disclosure: { fields: { field: string; value: unknown; salt: string; commitment: string }[]; inclusion: { index: number; size: number; leaf: string; path: string[] }; seq: number };
  sth: Head; digests: Digest[]; completeness: { message: string; kid: string; signature: string }; tombstone: Tombstone;
  verdicts: { name: string; expect: string; first_bad_seq?: number; page: NetPage; head: Head | null }[];
};
const v = JSON.parse(readFileSync(join(process.cwd(), 'testdata/activity_verify_vectors.json'), 'utf8')) as V;
const keys = v.keys.keys;
const b64std = (s: string) => btoa(String.fromCharCode(...Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))));
const rekorVkey = async () => {
  const pk = Uint8Array.from(atob(b64std(v.rekor_log.x)), (c) => c.charCodeAt(0));
  const kh = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode(v.rekor_log.origin), 0x0a, 0x01, ...pk]))).slice(0, 4);
  return `${v.rekor_log.origin}+${[...kh].map((x) => x.toString(16).padStart(2, '0')).join('')}+${btoa(String.fromCharCode(1, ...pk))}`;
};

describe('integrity network vectors', () => {
  it('origins, notes and cosignatures', async () => {
    for (const o of v.origin_escaping) expect(logOrigin(v.project, o.account)).toBe(o.origin);
    const k = await parseVkey(v.note.vkey, 0x01);
    expect(k?.name).toBe(v.note.origin);
    expect(await verifyNote(v.note.text, v.note.origin, k!.key)).toBe(true);
    expect(await verifyNote(v.note.text.replace('\n3\n', '\n4\n'), v.note.origin, k!.key)).toBe(false);
    const w = await parseVkey(v.witness_key.vkey, 0x04);
    const n = parseNote(`${v.note.text}${v.note.cosignature_line}\n`)!;
    expect(await verifyCosignature(n.body, n.sigs, w!.name, w!.key)).toBe(1700003700);
  });

  it('digests, completeness and tombstones', async () => {
    expect(await verifyDigests(v.digests, keys, v.project, v.account)).toEqual([]);
    expect((await verifyDigests([v.digests[1]!, v.digests[0]!], keys, v.project, v.account)).length).toBeGreaterThan(0);
    const c = await verifyCompleteness({ ...v.completeness, records: v.digests }, keys, v.project, v.account);
    expect(c).toEqual({ ok: true, complete: true, problems: [] });
    expect(await verifyTombstone(v.tombstone, keys, v.project, v.account)).toBe(true);
    expect(await verifyTombstone({ ...v.tombstone, policy: 'retention:1d' }, keys, v.project, v.account)).toBe(false);
  });

  it('selective disclosure', async () => {
    const row = v.chain[v.disclosure.seq - 1]!;
    const d = { row, fields: v.disclosure.fields, inclusion: v.disclosure.inclusion, sth: v.sth };
    expect(await verifyDisclosure(d, keys)).toEqual({ ok: true, included: true, problems: [] });
    const lie = { ...d, fields: [{ ...d.fields[0]!, value: 'user_3' }] };
    expect((await verifyDisclosure(lie, keys)).ok).toBe(false);
  });

  it('verdicts', async () => {
    const trust = { keys, project: v.project, witnesses: [v.witness_key.vkey], quorum: 1, rekorLogs: [await rekorVkey()] };
    for (const c of v.verdicts) {
      const r = await verdict([c.page], c.head, trust);
      expect(r.verdict, `${c.name}: ${r.problems.join('; ')} ${r.notes.join('; ')}`).toBe(c.expect);
      if (c.first_bad_seq) expect(r.firstBadSeq).toBe(c.first_bad_seq);
    }
    const anchored = v.verdicts.find((c) => c.expect === 'VALID')!;
    expect((await verdict([anchored.page], anchored.head, { ...trust, rekorLogs: [] })).verdict).toBe('VALID_UNANCHORED');
    expect((await verdict([anchored.page], anchored.head, { ...trust, quorum: 2 })).verdict).toBe('VALID_UNANCHORED');
  });
});
