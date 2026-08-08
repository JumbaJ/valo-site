// ⛓ solana-lite — everything the payout executor needs, with zero npm
// dependencies. @solana/web3.js drags in rpc-websockets, which breaks on
// Vercel's runtime (ERR_REQUIRE_ESM), so we build and sign transactions here
// using Node's native ed25519.
import { createHash, createPrivateKey, sign as edSign } from "crypto";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export const b58decode = (str) => {
  let n = 0n;
  for (const ch of String(str)) {
    const i = B58.indexOf(ch);
    if (i < 0) throw new Error(`invalid base58 character: ${ch}`);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const ch of String(str)) { if (ch === "1") bytes.unshift(0); else break; }
  return Uint8Array.from(bytes);
};

export const b58encode = (buf) => {
  const bytes = Uint8Array.from(buf);
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b === 0) out = "1" + out; else break; }
  return out || "1";
};

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const ATA_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

// ── program-derived address (the "find PDA" loop) ──────────────────
const pdaFrom = (seeds, programId) => {
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const s of seeds) h.update(Buffer.from(s));
    h.update(Buffer.from([bump]));
    h.update(Buffer.from(b58decode(programId)));
    h.update(Buffer.from("ProgramDerivedAddress"));
    const d = h.digest();
    if (!isOnCurve(d)) return { address: b58encode(d), bump };
  }
  throw new Error("no PDA bump found");
};

// a point is "on curve" if it decodes as a valid ed25519 point — the standard
// check keeps PDAs off the curve so nobody can hold their private key
const isOnCurve = (bytes) => {
  try {
    const P = (1n << 255n) - 19n;
    const y = bytesToLe(bytes) & ((1n << 255n) - 1n);
    if (y >= P) return false;
    const y2 = (y * y) % P;
    const d = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
    const u = (y2 - 1n + P) % P;
    const v = (d * y2 + 1n) % P;
    const uv3 = (u * modpow(v, 3n, P)) % P;
    const uv7 = (u * modpow(v, 7n, P)) % P;
    let x = (uv3 * modpow(uv7, (P - 5n) / 8n, P)) % P;
    const vx2 = (v * x % P) * x % P;
    if (vx2 === u % P) return true;
    if (vx2 === (P - u % P) % P) return true;
    return false;
  } catch (e) { return false; }
};
const bytesToLe = (b) => { let n = 0n; for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]); return n; };
const modpow = (b, e, m) => { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; };

// the associated token account for (owner, mint)
export const findAta = (owner, mint, tokenProgram = TOKEN_PROGRAM) =>
  pdaFrom([b58decode(owner), b58decode(tokenProgram), b58decode(mint)], ATA_PROGRAM).address;

// ── keypair from a Phantom base58 secret or a JSON byte array ──────
export const keypairFrom = (secret) => {
  const raw = String(secret || "").trim();
  if (!raw) throw new Error("empty secret");
  const bytes = raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : b58decode(raw);
  if (bytes.length !== 64) throw new Error(`expected a 64-byte secret key, got ${bytes.length}`);
  const seed = bytes.slice(0, 32);
  const pub = bytes.slice(32);
  // wrap the raw seed as a PKCS#8 ed25519 key so node's crypto can sign with it
  const der = Buffer.concat([
    Buffer.from("302e020100300506032b657004220420", "hex"),
    Buffer.from(seed),
  ]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return { publicKey: b58encode(pub), sign: (msg) => edSign(null, Buffer.from(msg), key) };
};

// ── compact-u16, Solana's length prefix ───────────────────────────
const shortVec = (n) => {
  const out = [];
  let v = n;
  for (;;) { const b = v & 0x7f; v >>= 7; if (v === 0) { out.push(b); break; } out.push(b | 0x80); }
  return Buffer.from(out);
};

// ── build + sign a legacy transaction ─────────────────────────────
// instructions: [{ programId, keys: [{pubkey, isSigner, isWritable}], data: Buffer }]
export const buildTx = ({ payer, instructions, recentBlockhash, signer }) => {
  // collect accounts: payer first, then by (signer, writable) precedence
  const meta = new Map();
  const touch = (pk, isSigner, isWritable) => {
    const cur = meta.get(pk) || { pubkey: pk, isSigner: false, isWritable: false };
    cur.isSigner = cur.isSigner || isSigner;
    cur.isWritable = cur.isWritable || isWritable;
    meta.set(pk, cur);
  };
  touch(payer, true, true);
  for (const ix of instructions) {
    for (const k of ix.keys) touch(k.pubkey, !!k.isSigner, !!k.isWritable);
    touch(ix.programId, false, false);
  }
  const all = [...meta.values()];
  const rank = (a) => (a.isSigner ? 0 : 2) + (a.isWritable ? 0 : 1);
  all.sort((a, b) => (a.pubkey === payer ? -1 : b.pubkey === payer ? 1 : rank(a) - rank(b)));

  const numSigners = all.filter((a) => a.isSigner).length;
  const numReadonlySigned = all.filter((a) => a.isSigner && !a.isWritable).length;
  const numReadonlyUnsigned = all.filter((a) => !a.isSigner && !a.isWritable).length;
  const index = new Map(all.map((a, i) => [a.pubkey, i]));

  const parts = [];
  parts.push(Buffer.from([numSigners, numReadonlySigned, numReadonlyUnsigned]));
  parts.push(shortVec(all.length));
  for (const a of all) parts.push(Buffer.from(b58decode(a.pubkey)));
  parts.push(Buffer.from(b58decode(recentBlockhash)));
  parts.push(shortVec(instructions.length));
  for (const ix of instructions) {
    parts.push(Buffer.from([index.get(ix.programId)]));
    parts.push(shortVec(ix.keys.length));
    parts.push(Buffer.from(ix.keys.map((k) => index.get(k.pubkey))));
    parts.push(shortVec(ix.data.length));
    parts.push(Buffer.from(ix.data));
  }
  const message = Buffer.concat(parts);
  const sig = signer.sign(message);
  return Buffer.concat([shortVec(1), sig, message]).toString("base64");
};

// ── instruction builders ──────────────────────────────────────────
export const ixCreateAta = ({ payer, ata, owner, mint, tokenProgram = TOKEN_PROGRAM }) => ({
  programId: ATA_PROGRAM,
  keys: [
    { pubkey: payer, isSigner: true, isWritable: true },
    { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: owner, isSigner: false, isWritable: false },
    { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: SYSTEM_PROGRAM, isSigner: false, isWritable: false },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ],
  data: Buffer.from([]),           // idempotent-create = discriminator 1; 0/empty = create
});

// TransferChecked = instruction 12
export const ixTransferChecked = ({ source, mint, dest, owner, amount, decimals, tokenProgram = TOKEN_PROGRAM }) => {
  const data = Buffer.alloc(10);
  data.writeUInt8(12, 0);
  data.writeBigUInt64LE(BigInt(amount), 1);
  data.writeUInt8(decimals, 9);
  return {
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: dest, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  };
};
