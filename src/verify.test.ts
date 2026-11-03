import { describe, expect, it } from 'vitest';
import { bytes, canonical, chainBody, merkleVerify, micros, verifyProof, verifyResponse, verifyRows, type ChainRow, type Proof } from './verify';

// Vectors computed independently (Python hashlib + json.dumps(sort_keys)): SHA-256(prev || canonical_json(body)),
// RFC 6962 leaf SHA-256(0x00 || h) and node SHA-256(0x01 || l || r).
const B1 = { seq: 1, id: 'e1', action: 'invoice.paid', metadata: { z: 1, a: 'Ä"x' }, ip: null, actor_name: 'Ada' };
const H1 = '489b43fc4010dd53a8bcb9e5063cf6af74c77527f3e0d1e8fca85f8d6539a288';
const B2 = { seq: 2, id: 'e2', action: 'user.role_changed', metadata: {}, ip: '1.2.3.4' };
const H2 = '44772a3e82363dfe3981b0b69a324906d978349d978a8256316e90b1d877ad46';
const rows: ChainRow[] = [{ seq: 1, prev_hash: '', hash: H1, body: B1 }, { seq: 2, prev_hash: H1, hash: H2, body: B2 }];
// the wire form: body as the canonical string
const wire: ChainRow[] = rows.map((r, i) => ({ ...r, id: `e${i + 1}`, body: canonical(r.body) }));

const b64u = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function signer() {
  const kp = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const keys = [{ kid: 'k1', x: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)) }];
  const sign = async (m: string) => b64u(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(m)));
  return { keys, sign };
}

describe('verify', () => {
  it('canonical json matches serde ordering', () => {
    expect(canonical(B1)).toBe('{"action":"invoice.paid","actor_name":"Ada","id":"e1","ip":null,"metadata":{"a":"Ä\\"x","z":1},"seq":1}');
  });
  it('recomputes the known vector and finds tampering', async () => {
    expect(await verifyRows(rows)).toEqual({ ok: true, checked: 2, firstBadSeq: null });
    expect(await verifyRows(wire)).toEqual({ ok: true, checked: 2, firstBadSeq: null });
    const bad = [rows[0]!, { ...rows[1]!, body: { ...B2, ip: '9.9.9.9' } }];
    expect(await verifyRows(bad)).toMatchObject({ ok: false, firstBadSeq: 2 });
    expect(await verifyRows([rows[1]!], { seq: 1, hash: H1 })).toMatchObject({ ok: true, checked: 1 });
  });
  it('hashes a string body as sent, so 100.0 stays 100.0', async () => {
    const body = '{"metadata":{"amount":100.0},"seq":1}';
    const h = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))), (x) => x.toString(16).padStart(2, '0')).join('');
    expect(await verifyRows([{ seq: 1, prev_hash: '', hash: h, body }])).toMatchObject({ ok: true });
  });
  it('checks rows, contiguity and the Ed25519 checkpoint signature', async () => {
    const { keys, sign } = await signer();
    const message = `["wt.activity.checkpoint.v1","prj_1","a",2,"${H2}",1761818400]`;
    const cp = { seq: 2, hash: H2, at: '2026-10-30T11:00:00Z', kid: 'k1', kind: 'periodic', message, signature: await sign(message) };
    const page = { data: wire, head_seq: 2, anchor_seq: null, checkpoint: cp, erased: [], project: 'acme' };
    expect(await verifyResponse(page, keys)).toMatchObject({ ok: true, checked: 2, signature: true });
    expect(await verifyResponse({ ...page, checkpoint: { ...cp, message: message.replace('1761818400', '1761818401') } }, keys)).toMatchObject({ signature: false });
    expect(await verifyResponse({ ...page, checkpoint: { ...cp, hash: H1 } }, keys)).toMatchObject({ ok: false, firstBadSeq: 2 });
    expect(await verifyResponse({ ...page, data: [wire[1]!] }, keys)).toMatchObject({ ok: false, firstBadSeq: 2 });
    expect(await verifyResponse({ ...page, data: [wire[1]!], anchor_seq: 1 }, keys)).toMatchObject({ ok: true, checked: 1 });
    expect(await verifyResponse({ ...page, data: [wire[0]!, { ...wire[1]!, body: (wire[1]!.body as string).replace('1.2.3.4', '1.2.3.5') }] }, keys)).toMatchObject({ ok: false, firstBadSeq: 2 });
    expect(await verifyResponse({ ...page, head_seq: 3 }, keys)).toMatchObject({ ok: false, firstBadSeq: 3 });
    expect(await verifyResponse(page, [])).toMatchObject({ ok: true, signature: null });
  });
  it('RFC 6962 inclusion: 3-leaf vector', async () => {
    const leaf1 = bytes('dcffe786ded16d283c663846ad0c4ff26558fccde36ca9d30b2ea19eade9fc0e');
    const path = ['7f9c9e31ac8256ca2f258583df262dbc7d6f68f2a03043d5c99a4ae5a7396ce9', 'cba8c596120bdb69debbd923d92cba948bde7c7d06a465a1bb7d98d3116038fa'];
    const root = 'ba8d94b7fbcecae7b81c4c80574fe24734a6917bf9c1ecd66ff3e0c34ead4620';
    expect(await merkleVerify(leaf1, 1, 3, path, root)).toBe(true);
    expect(await merkleVerify(leaf1, 0, 3, path, root)).toBe(false);
    expect(await merkleVerify(leaf1, 1, 3, [...path].reverse(), root)).toBe(false);
  });
  it('verifies one event from its proof and signed root', async () => {
    const { keys, sign } = await signer();
    const root = '6ec13cbba25bcd15910dcaad5a3d5a3d397c3e9b377c5b814c9353c94a87385b';
    const message = `["wt.activity.merkle.v1","prj_1","a",1,2,"${root}"]`;
    const p: Proof = {
      row: wire[1]!, leaf: '30ed78493c820ace8168a5a25453db5ea1feecee47ccea932176e12c020db74c', index: 1, size: 2,
      path: ['e972c4de3aa0cf010f00d93a11d14cbc8fe6b3388e3cffdee2ad5b568f22e577'], root, from_seq: 1, to_seq: 2,
      kid: 'k1', message, signature: await sign(message), checkpoint: null, anchor: null, project: 'acme',
    };
    expect(await verifyProof(p, keys, 'e2')).toMatchObject({ ok: true, signature: true });
    expect(await verifyProof(p, keys, 'e1')).toMatchObject({ ok: false });
    expect(await verifyProof({ ...p, row: { ...p.row, body: (p.row.body as string).replace('1.2.3.4', '1.2.3.5') } }, keys)).toMatchObject({ ok: false });
    expect(await verifyProof({ ...p, path: [H1] }, keys)).toMatchObject({ ok: false, signature: false });
    expect(await verifyProof({ ...p, signature: await sign('x') }, keys)).toMatchObject({ ok: true, signature: false });
  });
});

describe('chainBody', () => {
  it("rebuilds body v2 like the server's chain body (same vector as wtctl)", () => {
    const doc = JSON.parse('{"id":"e1","account_id":"a","action":"x","occurred_at":"2023-11-14T22:13:20Z","actor":{"id":"erased","name":null,"type":"user"},"target":{"type":"user","id":"erased"},"context":{"ip":null},"metadata":{"ssn":"1","k":2},"commitments":{"actor_id":"aa","actor_name":"bb","targets[0].id":"cc","metadata.ssn":"dd"}}');
    expect(canonical(chainBody(doc, 'prj_1', 1))).toBe('{"account_id":"a","action":"x","actor_type":"user","commit":{"actor_id":"aa","actor_name":"bb","metadata.ssn":"dd","targets[0].id":"cc"},"id":"e1","ip":null,"metadata":{"k":2},"occurred_at_micros":1700000000000000,"project_id":"prj_1","seq":1,"target_name":null,"target_type":"user","v":2}');
    expect(doc.metadata.ssn).toBe('1');
    expect(micros('2023-11-14T22:13:20.000005Z')).toBe(1700000000000005);
  });
});
