// Integrity-network checks (WP1) for browsers and Node, against testdata/activity_verify_vectors.json:
// C2SP signed notes and witness cosignatures, prune tombstones (VALID_PRUNED), hourly digests and completeness
// certificates, selective-disclosure proofs, Rekor v2 anchor receipts, and the three-state verdict
// (INVALID > VALID_PRUNED > VALID / VALID_UNANCHORED). Spec: docs/superpowers/specs/2026-10-31-activity-verification-spec.md.
// WebCrypto has Ed25519 but neither Ed25519ph nor ML-DSA: a Rekor v2 entry's own signature and the ML-DSA-44
// twin signatures are not checked here (wtctl and the Rust verifier check them); everything else is.
import { bytes, canonical, hex, merkleVerify, verifyRows, verifySignature, type ChainRow, type Checkpoint, type Sth } from './verify';

type Keys = { kid: string; x: string }[];
type Bytes = Uint8Array<ArrayBuffer>;

export const VALID = 'VALID', VALID_UNANCHORED = 'VALID_UNANCHORED', VALID_PRUNED = 'VALID_PRUNED', INVALID = 'INVALID';
export type VerdictName = typeof VALID | typeof VALID_UNANCHORED | typeof VALID_PRUNED | typeof INVALID;

export interface Tombstone { from_seq: number; to_seq: number; last_hash: string; policy: string; pruned_at_unix: number; kid: string; message: string; signature: string }
export interface NetPage {
  data: ChainRow[]; head_seq: number; anchor_seq: number | null; checkpoint: Checkpoint | null;
  erased?: { from_seq: number; to_seq: number }[]; pruned?: Tombstone[];
}
export interface Cosignature { witness: string; time: number; line: string }
export interface Head extends Sth { note?: string | null; cosignatures?: Cosignature[] }
export interface Trust {
  keys: Keys; project: string;
  /** Witness C2SP vkeys (cosignature/v1) and how many must cosign. */
  witnesses?: string[]; quorum?: number;
  /** Rekor v2 log checkpoint keys as C2SP Ed25519 vkeys. */
  rekorLogs?: string[];
}
export interface NetVerdict { verdict: VerdictName; firstBadSeq: number | null; problems: string[]; notes: string[] }

const enc = (s: string): Bytes => new TextEncoder().encode(s);
const b64 = (s: string): Bytes => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64enc = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const cat = (...p: Uint8Array[]): Bytes => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  p.reduce((o, x) => (out.set(x, o), o + x.length), 0);
  return out;
};
const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const digest = async (alg: string, b: Bytes): Promise<Bytes> => new Uint8Array(await crypto.subtle.digest(alg, b));
const sha = (b: Bytes) => digest('SHA-256', b);
const leafHash = (b: Bytes) => sha(cat(new Uint8Array([0]), b));

async function ed25519(pk: Bytes, msg: Bytes, sig: Bytes): Promise<boolean | null> {
  try {
    const key = await crypto.subtle.importKey('raw', pk, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sig, msg);
  } catch {
    return null;
  }
}

/** `watchtower.dev/activity/<project id>/<account>`, every account byte outside A-Z a-z 0-9 - . _ ~ as %XX. */
export function logOrigin(project: string, account: string): string {
  const a = [...enc(account)].map((c) => (/[A-Za-z0-9\-._~]/.test(String.fromCharCode(c)) ? String.fromCharCode(c) : `%${c.toString(16).toUpperCase().padStart(2, '0')}`)).join('');
  return `watchtower.dev/activity/${project}/${a}`;
}

/** C2SP key hash: SHA-256(name || 0x0A || type || key)[:4]. */
export async function noteKeyHash(name: string, type: number, pk: Uint8Array): Promise<Bytes> {
  return (await sha(cat(enc(name), new Uint8Array([0x0a, type]), pk))).slice(0, 4);
}

/** A signed note's body (with its final newline) and signature lines. */
export function parseNote(text: string): { body: string; sigs: { name: string; sig: Bytes }[] } | null {
  const i = text.indexOf('\n\n');
  if (i < 0) return null;
  const sigs = [];
  for (const l of text.slice(i + 2).replace(/\n$/, '').split('\n')) {
    const m = /^— (\S+) ([A-Za-z0-9+/=]+)$/.exec(l);
    if (!m) return null;
    sigs.push({ name: m[1]!, sig: b64(m[2]!) });
  }
  return { body: text.slice(0, i + 1), sigs };
}

export function parseCheckpoint(body: string): { origin: string; size: number; root: Bytes } | null {
  const l = body.split('\n');
  if (l.length < 4 || !l[0] || !/^\d+$/.test(l[1]!)) return null;
  try {
    const root = b64(l[2]!);
    return root.length === 32 ? { origin: l[0], size: Number(l[1]), root } : null;
  } catch {
    return null;
  }
}

/** `<name>+<hex key hash>+<base64(type || key)>` -> name and key, when the hash and type match. */
export async function parseVkey(v: string, type: number): Promise<{ name: string; key: Bytes } | null> {
  const i = v.indexOf('+'), j = v.indexOf('+', i + 1);
  const [name, kh, k] = [v.slice(0, i), v.slice(i + 1, j), v.slice(j + 1)];
  try {
    const raw = b64(k ?? '');
    if (i < 1 || j < 0 || raw.length !== 33 || raw[0] !== type) return null;
    const key = raw.slice(1);
    return hex(await noteKeyHash(name, type, key)) === kh ? { name, key } : null;
  } catch {
    return null;
  }
}

/** Is `text` signed (Ed25519 note signature) by key name `name`? null when this runtime lacks Ed25519. */
export async function verifyNote(text: string, name: string, pk: Bytes): Promise<boolean | null> {
  const n = parseNote(text);
  if (!n) return false;
  const kh = await noteKeyHash(name, 0x01, pk);
  let result: boolean | null = false;
  for (const s of n.sigs.filter((x) => x.name === name && x.sig.length === 68 && eq(x.sig.slice(0, 4), kh))) {
    const r = await ed25519(pk, enc(n.body), s.sig.slice(4));
    if (r) return true;
    if (r === null) result = null;
  }
  return result;
}

export const cosignatureMessage = (t: number, body: string) => `cosignature/v1\ntime ${t}\n${body}`;

/** The time witness `name` cosigned `body` at, among the note's lines; null when none verifies. */
export async function verifyCosignature(body: string, sigs: { name: string; sig: Bytes }[], name: string, pk: Bytes): Promise<number | null> {
  const kh = await noteKeyHash(name, 0x04, pk);
  for (const s of sigs) {
    if (s.name !== name || s.sig.length !== 76 || !eq(s.sig.slice(0, 4), kh)) continue;
    const t = Number(new DataView(s.sig.buffer, s.sig.byteOffset + 4, 8).getBigUint64(0));
    if (await ed25519(pk, enc(cosignatureMessage(t, body)), s.sig.slice(12))) return t;
  }
  return null;
}

/** A prune tombstone's message is its fields and its signature verifies. */
export async function verifyTombstone(t: Tombstone, keys: Keys, project: string, account: string): Promise<boolean | null> {
  const want = JSON.stringify(['wt.activity.pruned.v1', project, account, t.from_seq, t.to_seq, t.last_hash, t.policy, t.pruned_at_unix]);
  if (t.message !== want || t.from_seq < 1 || t.to_seq < t.from_seq) return false;
  return verifySignature(t, keys);
}

export interface Digest { message: string; digest: string; kid: string; signature: string }

/** Hourly digests, oldest first: each SHA-256 recomputes, links to the one before and is signed. */
export async function verifyDigests(ds: Digest[], keys: Keys, project: string, account: string): Promise<string[]> {
  const p: string[] = [];
  let prev = '';
  for (const [i, d] of ds.entries()) {
    const a = JSON.parse(d.message) as unknown[];
    if (a[0] !== 'wt.activity.digest.v1' || a[1] !== project || a[2] !== account) p.push(`digest ${i}: not this log's`);
    else if (hex(await sha(enc(d.message))) !== d.digest) p.push(`digest ${i}: digest is not SHA-256(message)`);
    else if (i > 0 && a[8] !== prev) p.push(`digest ${i}: does not link to the one before`);
    if ((await verifySignature(d, keys)) === false) p.push(`digest ${i}: signature invalid`);
    prev = d.digest;
  }
  return p;
}

export interface Completeness { message: string; kid: string; signature: string; records?: Digest[]; complete?: boolean }

/** A completeness certificate (B3): its signature, and its records chained and ending at its last digest. */
export async function verifyCompleteness(c: Completeness, keys: Keys, project: string, account: string): Promise<{ ok: boolean; complete: boolean; problems: string[] }> {
  const m = JSON.parse(c.message) as unknown[];
  const problems = m[0] === 'wt.activity.completeness.v1' && m[1] === project && m[2] === account ? [] : ['not a completeness certificate of this log'];
  if ((await verifySignature(c, keys)) === false) problems.push('certificate signature invalid');
  const recs = c.records ?? [];
  problems.push(...(await verifyDigests(recs, keys, project, account)));
  if (recs.length && (recs.length !== m[6] || recs[recs.length - 1]!.digest !== m[7])) problems.push('records differ from the certificate');
  return { ok: problems.length === 0, complete: problems.length === 0 && m[5] === m[6] && m[11] === true, problems };
}

export interface Disclosure {
  row: ChainRow; fields: { field: string; value: unknown; salt: string; commitment: string }[];
  inclusion: { index: number; size: number; leaf: string; path: string[] } | null; sth: Sth | null;
}

/** Selective disclosure (B8): each value opens its commitment, the commitment is in the hashed body, the row is in
 *  the signed tree head. `included` is null while no published head covers the row. */
export async function verifyDisclosure(d: Disclosure, keys: Keys): Promise<{ ok: boolean; included: boolean | null; problems: string[] }> {
  const problems: string[] = [];
  const body = typeof d.row.body === 'string' ? d.row.body : canonical(d.row.body);
  const commits = ((JSON.parse(body) as { commit?: Record<string, string> }).commit) ?? {};
  if (hex(await sha(cat(bytes(d.row.prev_hash), enc(body)))) !== d.row.hash) problems.push('row hash does not recompute');
  for (const f of d.fields) {
    const c = hex(await sha(cat(bytes(f.salt), enc(canonical(f.value)))));
    if (c !== f.commitment || commits[f.field] !== c) problems.push(`${f.field}: value does not open the committed hash`);
  }
  let included: boolean | null = null;
  if (d.inclusion && d.sth) {
    const leaf = await leafHash(bytes(d.row.hash));
    included = hex(leaf) === d.inclusion.leaf && d.inclusion.size === d.sth.size && (await merkleVerify(leaf, d.inclusion.index, d.inclusion.size, d.inclusion.path, d.sth.root));
    if (!included) problems.push('row is not in the tree head');
    if ((await verifySignature(d.sth, keys)) === false) problems.push('tree head signature invalid');
  }
  return { ok: problems.length === 0, included, problems };
}

const rekorStatement = (top: string) => JSON.stringify(['wt.activity.rekor.v1', top]);

/** A Rekor v2 entry for anchored hash `top`: the body names SHA-512(statement), the entry is in the log at the
 *  stated tree, and the log's checkpoint is signed by a trusted Rekor log key. */
export async function verifyRekorV2(e: Record<string, unknown>, top: string, logs: { name: string; key: Bytes }[]): Promise<string | null> {
  if (e.statement !== rekorStatement(top)) return 'entry is not for this anchor';
  const body = b64(String(e.canonicalized_body ?? ''));
  const spec = (JSON.parse(new TextDecoder().decode(body)) as { spec?: { hashedRekordV002?: { data?: { digest?: string } } } }).spec;
  if (spec?.hashedRekordV002?.data?.digest !== b64enc(await digest('SHA-512', enc(String(e.statement))))) return 'body does not name the statement';
  const p = e.inclusion_proof as { log_index: number; tree_size: number; root_hash: string; hashes: string[]; checkpoint: { envelope: string } };
  const root = b64(p.root_hash);
  if (!(await merkleVerify(await leafHash(body), p.log_index, p.tree_size, p.hashes.map((h) => hex(b64(h))), hex(root)))) return 'inclusion proof does not verify';
  const n = parseNote(p.checkpoint.envelope);
  const cp = n && parseCheckpoint(n.body);
  if (!cp || cp.size !== p.tree_size || !eq(cp.root, root)) return 'checkpoint does not state the proven tree';
  const log = logs.find((l) => l.name === cp.origin);
  if (!log) return `log ${cp.origin} is not trusted`;
  return (await verifyNote(p.checkpoint.envelope, cp.origin, log.key)) ? null : 'log checkpoint signature invalid';
}

async function anchored(h: Head, t: Trust, notes: string[]): Promise<boolean> {
  const a = h.anchor as { top: string; index: number; size: number; path: string[]; receipts?: { kind: string; version?: number; entries?: Record<string, unknown>[] }[] } | null;
  if (!a) return notes.push('head is not anchored yet'), false;
  if (!(await merkleVerify(await leafHash(bytes(h.root)), a.index, a.size, a.path, a.top))) throw new Error('anchor: the head is not in the anchored hash');
  const logs = (await Promise.all((t.rekorLogs ?? []).map((v) => parseVkey(v, 0x01)))).filter((x) => x !== null);
  let ok = false;
  for (const r of a.receipts ?? []) {
    if (r.kind !== 'rekor' || r.version !== 2) { notes.push(`anchor: ${r.kind} receipt not checked in the browser`); continue; }
    for (const e of r.entries ?? []) {
      const err = await verifyRekorV2(e, a.top, logs);
      if (err) notes.push(`anchor: rekor: ${err}`); else ok = true;
    }
  }
  return ok;
}

async function checkHead(h: Head, rows: ChainRow[], account: string, t: Trust, v: NetVerdict): Promise<boolean> {
  if ((await verifySignature(h, t.keys)) === false) v.problems.push('head: signature invalid');
  const leaves: Bytes[] = [];
  for (let s = h.from_seq; s <= h.to_seq; s++) {
    const r = rows.find((x) => x.seq === s);
    if (!r) return v.notes.push(`head covers seq ${s}, not among the rows`), false;
    leaves.push(await leafHash(bytes(r.hash)));
  }
  const mth = async (l: Bytes[]): Promise<Bytes> => {
    if (l.length === 1) return l[0]!;
    let k = 1;
    while (k * 2 < l.length) k *= 2;
    return sha(cat(new Uint8Array([1]), await mth(l.slice(0, k)), await mth(l.slice(k))));
  };
  if (!leaves.length || hex(await mth(leaves)) !== h.root) return v.problems.push('head: root is not the Merkle root of the rows'), false;
  const key = t.keys.find((k) => k.kid === h.kid);
  if (h.note && key && (await verifyNote(h.note, logOrigin(t.project, account), bytes(key.x))) === false) v.problems.push('head: checkpoint note signature invalid');
  let text = h.note ?? '';
  for (const c of h.cosignatures ?? []) if (!text.includes(c.line)) text += `${c.line}\n`;
  const n = parseNote(text);
  let cosigned = 0;
  for (const w of t.witnesses ?? []) {
    const k = await parseVkey(w, 0x04);
    if (k && n && (await verifyCosignature(n.body, n.sigs, k.name, k.key)) !== null) cosigned++;
  }
  if (cosigned < (t.quorum ?? 0)) v.notes.push(`head: ${cosigned} of ${t.quorum} witness cosignatures`);
  try {
    return (await anchored(h, t, v.notes)) && cosigned >= (t.quorum ?? 0);
  } catch (e) {
    v.problems.push((e as Error).message);
    return false;
  }
}

/** The verdict over verify pages (oldest first) and the optional tree head (GET /v1/activity/feed/head `sth`). */
export async function verdict(pages: NetPage[], head: Head | null, t: Trust): Promise<NetVerdict> {
  const v: NetVerdict = { verdict: VALID_UNANCHORED, firstBadSeq: null, problems: [], notes: [] };
  const rows = pages.flatMap((p) => p.data);
  const first = rows[0];
  if (!first) return v.notes.push('no rows'), v;
  const account = String((JSON.parse(typeof first.body === 'string' ? first.body : canonical(first.body)) as { account_id?: string }).account_id ?? '');
  const r = await verifyRows(rows, first.seq > 1 ? { seq: first.seq - 1, hash: first.prev_hash } : null);
  if (!r.ok) return { ...v, verdict: INVALID, firstBadSeq: r.firstBadSeq, problems: [`seq ${r.firstBadSeq}: hash or link broken`] };
  let pruned = '';
  if (first.seq > 1) {
    const ts = pages.flatMap((p) => p.pruned ?? []).sort((a, b) => a.from_seq - b.from_seq);
    let next = 1;
    for (const x of ts) {
      if ((await verifyTombstone(x, t.keys, t.project, account)) === false) v.problems.push(`tombstone ${x.from_seq}..${x.to_seq} invalid`);
      if (x.from_seq > next) break;
      next = Math.max(next, x.to_seq + 1);
      if (x.to_seq === first.seq - 1 && x.last_hash !== first.prev_hash) v.problems.push(`tombstone ..${x.to_seq} does not link to seq ${first.seq}`);
    }
    const erased = pages.some((p) => (p.erased ?? []).some((e) => e.from_seq <= next && e.to_seq >= first.seq - 1));
    if (next >= first.seq) pruned = `seqs 1..${first.seq - 1} pruned under signed tombstones`;
    else if (erased) pruned = `seqs ${next}..${first.seq - 1} re-anchored by an erasure (unsigned)`;
    else v.problems.push(`seqs ${next}..${first.seq - 1} are missing and no tombstone explains them`);
  }
  for (const p of pages) {
    const cp = p.checkpoint;
    if (!cp) continue;
    const m = JSON.parse(cp.message) as unknown[];
    const at = rows.find((x) => x.seq === cp.seq);
    if (m[0] !== 'wt.activity.checkpoint.v1' || m[1] !== t.project || m[3] !== cp.seq || m[4] !== cp.hash || (at && at.hash !== cp.hash)) v.problems.push('checkpoint differs from the rows');
    else if ((await verifySignature(cp, t.keys)) === false) v.problems.push('checkpoint signature invalid');
  }
  const isAnchored = head ? await checkHead(head, rows, account, t, v) : false;
  if (pruned) v.notes.push(pruned);
  v.verdict = v.problems.length ? INVALID : pruned ? VALID_PRUNED : isAnchored ? VALID : VALID_UNANCHORED;
  return v;
}
