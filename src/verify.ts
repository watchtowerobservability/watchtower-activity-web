// Client-side chain check against what the server emits (the viewer feed):
//   GET /v1/activity/feed/verify?from_seq=&limit=
//     {data: [{id, seq, prev_hash(hex), hash(hex), body(canonical JSON string)}], next_cursor, head_seq, anchor_seq,
//      project(slug), checkpoint: {seq, hash(hex), at, kid, kind, message, signature(base64url)} | null,
//      erased: [{from_seq, to_seq, rows}]}
//   GET /v1/activity/feed/proof?event_id=   one event's RFC 9162 inclusion proof against the account's latest signed
//     tree head (the account's Merkle log is append-only: tree size = leaves so far, heads signed hourly)
//   GET /v1/activity/feed/consistency?from_size=&to_size=   {proof[], from_root, to_root, sth, from_sth}: the older
//     tree head is a prefix of the newer one (RFC 9162 2.1.4); shared vectors: testdata/activity_merkle_vectors.json
//   GET /v1/activity/keys?project=<slug>  {keys: [{kid, kty, crv, x(base64url raw Ed25519 key)}]}
// Every hash is recomputed here: SHA-256(prev_hash || body bytes), links and seqs contiguous from the anchor to the
// head, the signed checkpoint's message names a seq and hash that a row carries, and Ed25519 over `message`.
// `body` is the exact canonical JSON the server hashed, sent as a string so number formatting survives.

export interface ChainRow { id?: string; seq: number; prev_hash: string; hash: string; body: unknown }
export interface Checkpoint { seq: number; hash: string; at: string; kid: string; kind: string; message: string; signature: string }
export interface VerifyPage {
  data: ChainRow[]; next_cursor: string | null; head_seq: number; anchor_seq: number | null;
  checkpoint: Checkpoint | null; erased: { from_seq: number; to_seq: number; rows: number }[]; project: string;
}
export interface Proof {
  row: ChainRow; leaf: string; index: number; size: number; path: string[]; root: string; from_seq: number; to_seq: number;
  kid: string; message: string; signature: string; checkpoint: Checkpoint | null; anchor: unknown; project: string;
}
export interface Sth {
  size: number; from_seq: number; to_seq: number; root: string; kid: string; message: string; signature: string;
  created_at: string; anchor: unknown;
}
export interface Consistency { from_size: number; to_size: number; proof: string[]; from_root: string; to_root: string; sth: Sth; from_sth: Sth; project: string }
/** `signature`: true valid, false invalid, null not checkable here (no Ed25519 in this browser, no checkpoint or key). */
export interface Verdict { ok: boolean; checked: number; firstBadSeq: number | null; signature: boolean | null }
type Keys = { kid: string; x: string }[];

/**
 * The server's canonical JSON: keys sorted at every level, no whitespace, serde_json string escaping
 * (JSON.stringify escapes the same characters, with the same lowercase \u00xx).
 * shortcut: floats serde_json prints differently (1.0 is "1.0" there, "1" here; 1e21) and keys outside the BMP
 * (UTF-16 vs byte order) can differ; only for parsed bodies: the server sends `body` as the canonical string.
 */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return v === undefined ? 'null' : JSON.stringify(v);
}

type Bytes = Uint8Array<ArrayBuffer>;

export function bytes(s: string): Bytes {
  if (/^([0-9a-f]{2})*$/i.test(s)) return new Uint8Array((s.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const eq = (a: Bytes, b: Bytes) => a.length === b.length && a.every((x, i) => x === b[i]);
const cat = (...p: Uint8Array[]): Bytes => {
  const out = new Uint8Array(p.reduce((n, x) => n + x.length, 0));
  p.reduce((o, x) => (out.set(x, o), o + x.length), 0);
  return out;
};
const sha = async (b: Bytes): Promise<Bytes> => new Uint8Array(await crypto.subtle.digest('SHA-256', b));
const text = (body: unknown) => (typeof body === 'string' ? body : canonical(body));
const parsed = (body: unknown): { seq?: number; id?: string } => {
  try { return (typeof body === 'string' ? JSON.parse(body) : body) as { seq?: number; id?: string }; } catch { return {}; }
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});

/** Unix microseconds of an RFC 3339 time (sub-millisecond digits kept). */
export function micros(t: string): number {
  const m = /^(.*?)(?:\.(\d+))?(Z|[+-]\d\d:\d\d)$/i.exec(t);
  if (!m) return NaN;
  return Date.parse(m[1]! + m[3]!) * 1000 + Number((m[2] ?? '').padEnd(6, '0').slice(0, 6));
}

/** Leave a committed field out, as the server's field removal. */
function removeField(b: Obj, f: string) {
  const t = /^targets\[(\d+)\]\.(id|name)$/.exec(f);
  if (f.startsWith('metadata.')) {
    const keys = f.slice(9).split('.'), last = keys.pop()!;
    let m: Obj | undefined = obj(b.metadata);
    for (const k of keys) { const x: unknown = m?.[k]; m = x && typeof x === 'object' ? (x as Obj) : undefined; }
    if (m) delete m[last];
  } else if (t) {
    const ts = Array.isArray(b.targets) ? (b.targets as unknown[]) : [];
    const x = ts[Number(t[1])];
    if (x && typeof x === 'object') delete (x as Obj)[t[2]!];
    if (t[1] === '0') delete b[`target_${t[2]}`];
  } else delete b[f];
}

/**
 * The server's chain body rebuilt from an exported Event v2 object (for callers holding
 * events, not the verify route's bodies). Body v2 (`commitments` on the event) leaves committed fields out and adds
 * `v: 2` and `commit`, so erased values do not matter. Same algorithm as `wtctl activity verify`.
 */
export function chainBody(event: Obj, project: string, seq: number): Obj {
  const e = structuredClone(event), a = obj(e.actor), t = obj(e.target), c = obj(e.context), o = obj(e.on_behalf_of), cr = obj(e.credential);
  const v = (x: unknown) => (x === undefined ? null : x);
  const b: Obj = {
    id: e.id, project_id: project, account_id: e.account_id, actor_id: v(a.id), actor_name: v(a.name), actor_type: v(a.type),
    action: e.action, target_type: v(t.type), target_id: v(t.id), target_name: v(t.name), metadata: e.metadata ?? {}, ip: v(c.ip),
    occurred_at_micros: micros(String(e.occurred_at)), seq,
  };
  const opt: Obj = {
    user_agent: c.user_agent, request_id: c.request_id, session_id: c.session_id, country: c.country, actor_email: a.email,
    actor_url: a.url, on_behalf_of_id: o.id, on_behalf_of_name: o.name, credential_type: cr.type, credential_id: cr.id,
    credential_fingerprint: cr.fingerprint, outcome: e.outcome, severity: e.severity, trace_id: e.trace_id, span_id: e.span_id,
    operation: e.operation, device_id: c.device_id, region: c.region, targets: e.targets, changes: e.changes,
    actor_metadata: a.metadata, schema_version: e.schema_version, asn: c.asn,
  };
  for (const [k, x] of Object.entries(opt)) if (x !== undefined && x !== null) b[k] = x;
  const commit = e.commitments;
  if (commit && typeof commit === 'object') {
    for (const f of Object.keys(commit)) removeField(b, f);
    Object.assign(b, { v: 2, commit });
  }
  return b;
}

/** SHA-256(prev_hash bytes || body): a string body is hashed as is, an object as its canonical JSON. */
export async function rowHash(prev: Bytes, body: unknown): Promise<Bytes> {
  return sha(cat(prev, new TextEncoder().encode(text(body))));
}

/** Recompute rows; ascending and contiguous from `anchor` (or seq 1 with an empty link). */
export async function verifyRows(rows: ChainRow[], anchor?: { seq: number; hash: string } | null): Promise<Omit<Verdict, 'signature'>> {
  let seq = anchor?.seq ?? 0;
  let prev: Bytes = anchor ? bytes(anchor.hash) : new Uint8Array();
  for (const [i, r] of rows.entries()) {
    const link = bytes(r.prev_hash), h = bytes(r.hash);
    const good = r.seq === seq + 1 && eq(link, prev) && parsed(r.body).seq === r.seq && eq(await rowHash(link, r.body), h);
    if (!good) return { ok: false, checked: i, firstBadSeq: r.seq };
    seq = r.seq;
    prev = h;
  }
  return { ok: true, checked: rows.length, firstBadSeq: null };
}

/** Ed25519 over the UTF-8 `message`; null when this browser has no Ed25519 in WebCrypto or the key is unknown. */
export async function verifySignature(s: { kid: string; message: string; signature: string }, keys: Keys): Promise<boolean | null> {
  const k = keys.find((x) => x.kid === s.kid);
  if (!k) return null;
  try {
    const key = await crypto.subtle.importKey('raw', bytes(k.x), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, bytes(s.signature), new TextEncoder().encode(s.message));
  } catch {
    return null;
  }
}
export const verifyCheckpoint = verifySignature;

const msg = (m: string): unknown[] => { try { return JSON.parse(m) as unknown[]; } catch { return []; } };

/** Check the merged pages of one account: every row from the anchor to the head, then the signed checkpoint. */
export async function verifyResponse(r: Omit<VerifyPage, 'next_cursor'>, keys: Keys): Promise<Verdict> {
  const first = r.data[0];
  // the server starts rows after the anchor; the first row's link is the anchor hash it states
  const anchor = r.anchor_seq ? { seq: r.anchor_seq, hash: first?.prev_hash ?? '' } : null;
  const v = await verifyRows(r.data, anchor);
  if (!v.ok) return { ...v, signature: null };
  const last = r.data[r.data.length - 1]?.seq ?? r.anchor_seq ?? 0;
  if (last !== r.head_seq) return { ok: false, checked: v.checked, firstBadSeq: last + 1, signature: null };
  const cp = r.checkpoint;
  if (!cp) return { ...v, signature: null };
  const m = msg(cp.message);
  const at = r.data.find((x) => x.seq === cp.seq);
  if (m[0] !== 'wt.activity.checkpoint.v1' || m[3] !== cp.seq || m[4] !== cp.hash || (at && at.hash !== cp.hash)) {
    return { ok: false, checked: v.checked, firstBadSeq: cp.seq, signature: false };
  }
  return { ...v, signature: await verifySignature(cp, keys) };
}

const node = (l: Bytes, x: Bytes) => sha(cat(new Uint8Array([1]), l, x));
const half = (x: number) => Math.floor(x / 2);

/** RFC 9162 2.1.3.2 inclusion check of an already leaf-hashed `leaf` (`SHA-256(0x00 || hash)`). */
export async function merkleVerify(leaf: Bytes, index: number, size: number, path: string[], root: string): Promise<boolean> {
  if (index >= size) return false;
  let f = index, s = size - 1, r = leaf;
  for (const p of path.map(bytes)) {
    if (s === 0) return false;
    if (f % 2 === 1 || f === s) {
      r = await node(p, r);
      while (f % 2 === 0 && f !== 0) { f = half(f); s = half(s); }
    } else r = await node(r, p);
    f = half(f); s = half(s);
  }
  return s === 0 && eq(r, bytes(root));
}

/** RFC 9162 2.1.4.2: does `proof` show the tree `(m, oldRoot)` is a prefix of `(n, newRoot)`? Roots are hex. */
export async function consistencyVerify(m: number, n: number, oldRoot: string, newRoot: string, proof: string[]): Promise<boolean> {
  if (!(m >= 1 && m <= n)) return false;
  if (m === n) return proof.length === 0 && oldRoot === newRoot;
  const p = proof.map(bytes);
  let x = m;
  while (x % 2 === 0) x /= 2;
  if (x === 1) p.unshift(bytes(oldRoot)); // m is a power of two: the old root is the first node
  let fn = m - 1, sn = n - 1;
  while (fn % 2 === 1) { fn = half(fn); sn = half(sn); }
  let fr = p[0], sr = p[0];
  if (!fr || !sr) return false;
  for (const c of p.slice(1)) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      fr = await node(c, fr); sr = await node(c, sr);
      while (fn % 2 === 0 && fn !== 0) { fn = half(fn); sn = half(sn); }
    } else sr = await node(sr, c);
    fn = half(fn); sn = half(sn);
  }
  return sn === 0 && eq(fr, bytes(oldRoot)) && eq(sr, bytes(newRoot));
}

const sthShape = (s: Sth) => {
  const m = msg(s.message);
  return m[0] === 'wt.activity.merkle.v1' && m[3] === s.from_seq && m[4] === s.to_seq && m[5] === s.root && s.size === s.to_seq - s.from_seq + 1;
};

/**
 * Two signed tree heads of one account and the proof between them: both heads well formed and signed, the same log
 * (`from_seq`), the roots the response states, the proof, and (when given) the head you pinned earlier.
 */
export async function verifyConsistency(c: Consistency, keys: Keys, pinned?: { size: number; root: string }): Promise<Verdict> {
  const bad = { ok: false, checked: 0, firstBadSeq: c.sth.from_seq + c.from_size, signature: null };
  const heads = sthShape(c.sth) && sthShape(c.from_sth) && c.sth.from_seq === c.from_sth.from_seq
    && c.sth.size === c.to_size && c.from_sth.size === c.from_size && c.sth.root === c.to_root && c.from_sth.root === c.from_root;
  if (!heads || (pinned && (pinned.size !== c.from_size || pinned.root !== c.from_root))) return bad;
  if (!(await consistencyVerify(c.from_size, c.to_size, c.from_root, c.to_root, c.proof))) return { ...bad, signature: false };
  const sigs = [await verifySignature(c.sth, keys), await verifySignature(c.from_sth, keys)];
  const signature = sigs.includes(false) ? false : sigs.every((x) => x === true) ? true : null;
  return { ok: true, checked: c.to_size - c.from_size, firstBadSeq: null, signature };
}

/** One event without the chain: its row hash, its leaf in the account's log, and the signed tree head. */
export async function verifyProof(p: Proof, keys: Keys, eventId?: string): Promise<Verdict> {
  const bad = { ok: false, checked: 0, firstBadSeq: p.row.seq, signature: null };
  const b = parsed(p.row.body);
  if (b.seq !== p.row.seq || (eventId && b.id !== eventId) || !eq(await rowHash(bytes(p.row.prev_hash), p.row.body), bytes(p.row.hash))) return bad;
  const leaf = await sha(cat(new Uint8Array([0]), bytes(p.row.hash)));
  const m = msg(p.message);
  const shape = m[0] === 'wt.activity.merkle.v1' && m[3] === p.from_seq && m[4] === p.to_seq && m[5] === p.root
    && p.index === p.row.seq - p.from_seq && p.size === p.to_seq - p.from_seq + 1 && hex(leaf) === p.leaf;
  if (!shape || !(await merkleVerify(leaf, p.index, p.size, p.path, p.root))) return { ...bad, signature: false };
  return { ok: true, checked: 1, firstBadSeq: null, signature: await verifySignature(p, keys) };
}

async function getter(base: string, init: RequestInit) {
  return async <T>(p: string): Promise<T> => {
    const res = await fetch(base + p, init);
    if (!res.ok) throw new Error(String(res.status));
    return res.json() as Promise<T>;
  };
}
const keysOf = async (get: <T>(p: string) => Promise<T>, slug: string): Promise<Keys> =>
  (await get<{ keys?: Keys }>(`/v1/activity/keys?project=${encodeURIComponent(slug)}`).catch(() => ({ keys: [] }))).keys ?? [];

/** Fetch every verify page and the project's keys with the caller's auth, then check them. No server verdict exists. */
export async function runVerify(base: string, init: RequestInit): Promise<Verdict & { server: null }> {
  const get = await getter(base, init);
  let page = await get<VerifyPage>('/v1/activity/feed/verify?limit=2000');
  const all = { ...page, data: [...page.data] };
  // shortcut: at most 50 pages (100k rows) per click; beyond that the head check reports a gap.
  for (let n = 0; page.next_cursor && n < 50; n++) {
    page = await get<VerifyPage>(`/v1/activity/feed/verify?limit=2000&from_seq=${encodeURIComponent(page.next_cursor)}`);
    all.data.push(...page.data);
  }
  return { ...(await verifyResponse(all, await keysOf(get, all.project))), server: null };
}

/** Fetch and check the consistency of the head you pinned (`from`) with a newer one (default: the latest). */
export async function runConsistency(base: string, init: RequestInit, from: { size: number; root: string }, toSize?: number): Promise<Verdict & { server: null }> {
  const get = await getter(base, init);
  const q = `from_size=${from.size}${toSize ? `&to_size=${toSize}` : ''}`;
  const c = await get<Consistency>(`/v1/activity/feed/consistency?${q}`);
  return { ...(await verifyConsistency(c, await keysOf(get, c.project), from)), server: null };
}

/** Fetch and check one event's Merkle proof (409 until a signed tree head covers the event; heads are hourly). */
export async function runProof(base: string, init: RequestInit, eventId: string): Promise<Verdict & { server: null }> {
  const get = await getter(base, init);
  const p = await get<Proof>(`/v1/activity/feed/proof?event_id=${encodeURIComponent(eventId)}`);
  return { ...(await verifyProof(p, await keysOf(get, p.project), eventId)), server: null };
}
