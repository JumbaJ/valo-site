// VALO — primitives the creator/burn cycle needs that _solana-lite.js lacks.
//
// Kept in a separate file on purpose: _solana-lite.js is imported by live
// payout code, and this adds a versioned-transaction path that nothing else
// uses yet. A bug in here can only break the cycle route.

import { createPublicKey, verify as edVerify } from "node:crypto";
import { b58decode, b58encode } from "./_solana-lite.js";

export const SYSTEM_PROGRAM = "11111111111111111111111111111111";

// ── system transfer ───────────────────────────────────────────────
export const ixTransferSol = ({ from, to, lamports }) => {
  const data = Buffer.alloc(12);
  data.writeUInt32LE(2, 0);                       // SystemInstruction::Transfer
  data.writeBigUInt64LE(BigInt(lamports), 4);
  return {
    programId: SYSTEM_PROGRAM,
    keys: [
      { pubkey: from, isSigner: true, isWritable: true },
      { pubkey: to, isSigner: false, isWritable: true },
    ],
    data,
  };
};

// ── SPL BurnChecked (index 15) — same layout on Token-2022 ────────
// Checked rather than plain Burn so the decimals are verified on-chain: a
// wrong-decimals burn would silently destroy the wrong magnitude.
export const ixBurnChecked = ({ account, mint, owner, amount, decimals, tokenProgram }) => {
  const data = Buffer.alloc(10);
  data.writeUInt8(15, 0);
  data.writeBigUInt64LE(BigInt(amount), 1);
  data.writeUInt8(decimals, 9);
  return {
    programId: tokenProgram,
    keys: [
      { pubkey: account, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data,
  };
};

// ── sign a transaction we did not build ───────────────────────────
// Jupiter returns a v0 transaction with address-lookup tables, which the
// legacy builder in _solana-lite.js cannot construct or parse. It does not
// need to: the wire format is
//     [compact-u16 numSignatures][64-byte signature × n][message …]
// and the message is opaque bytes to be signed. With a single signer, the
// first byte is 1, bytes 1..65 are an empty slot, and everything after is the
// message. Sign it and write the signature into the slot.
export const signSerialized = (b64, signer) => {
  const buf = Buffer.from(b64, "base64");
  const numSigs = buf[0];
  if (numSigs !== 1) {
    throw new Error(`expected 1 signature slot, got ${numSigs} — refusing to sign a multi-party transaction`);
  }
  const message = buf.subarray(1 + 64);
  const sig = Buffer.from(signer.sign(message));
  if (sig.length !== 64) throw new Error(`signature was ${sig.length} bytes, expected 64`);
  sig.copy(buf, 1);
  return buf.toString("base64");
};

// ── which token program owns a mint ───────────────────────────────
// Token-2022 mints derive a different ATA than classic ones, so guessing
// wrong means looking for tokens at an address that does not exist.
export const tokenProgramOf = async (rpc, mint) => {
  const info = await rpc("getAccountInfo", [mint, { encoding: "base64" }]);
  const owner = info && info.value && info.value.owner;
  if (!owner) throw new Error(`mint ${mint} not found on chain`);
  return owner;
};

// ── poll until a signature confirms, or give up ───────────────────
export const confirm = async (rpc, sig, { tries = 20, waitMs = 1500 } = {}) => {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, waitMs));
    const st = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: false }]);
    const v = st && st.value && st.value[0];
    if (!v) continue;
    if (v.err) throw new Error(`transaction failed on-chain: ${JSON.stringify(v.err)}`);
    if (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized") return true;
  }
  throw new Error(`signature ${sig} did not confirm in time — check Solscan before re-running`);
};

// ── verify a message signed by a wallet ───────────────────────────
// Lets the creator authorize a run by signing a string in Phantom, with no
// secret in the browser. The mirror of keypairFrom's PKCS#8 trick: wrap the
// raw 32-byte public key as SPKI so node's crypto will verify with it.
export const verifyEd25519 = (pubkeyB58, message, signature) => {
  const pub = Buffer.from(b58decode(pubkeyB58));
  if (pub.length !== 32) throw new Error("public key must be 32 bytes");
  const der = Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    pub,
  ]);
  const key = createPublicKey({ key: der, format: "der", type: "spki" });
  return edVerify(null, Buffer.from(message), key, Buffer.from(signature));
};

export { b58decode, b58encode };
