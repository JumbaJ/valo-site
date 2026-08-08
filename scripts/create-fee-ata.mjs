// VALO — create the treasury's fee token account for a mint.
//
//   node scripts/create-fee-ata.mjs                 # wSOL (covers every trade, if Jupiter allows it)
//   node scripts/create-fee-ata.mjs <MINT>          # a specific token
//
// Jupiter routes its platform fee into a token account owned by the treasury.
// That account must already exist on chain or the fee is uncollectable.
//
// The OWNER does not sign — anyone may create an associated token account for
// anyone else; the payer just funds the ~0.00204 SOL of rent. So this runs
// with a throwaway payer and never touches the treasury key.
//
// PAYER_SECRET: base58 secret key, or a JSON array of bytes. Keep it in a
// local .env or shell var — never in the repo, never pasted into a chat.

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Transaction, sendAndConfirmTransaction } from "@solana/web3.js";

const WSOL = "So11111111111111111111111111111111111111112";
const mint = new PublicKey(process.argv[2] || WSOL);

const owner = new PublicKey(
  process.env.VALO_TREASURY || "AYRV8D28EkvNBV178fBMF61G1i3uLGLp1De1MzuLUb3E"
);

const rpc = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com";

function loadPayer() {
  const raw = (process.env.PAYER_SECRET || "").trim();
  if (!raw) {
    console.error("PAYER_SECRET is not set. Export it first:\n" +
      "  export PAYER_SECRET='<base58 secret key>'");
    process.exit(1);
  }
  if (raw.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  // base58 without pulling in another dependency
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of raw) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error("PAYER_SECRET is not valid base58");
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of raw) { if (c === "1") bytes.unshift(0); else break; }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

const conn = new Connection(rpc, "confirmed");
const payer = loadPayer();
const ata = getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);

console.log("mint    ", mint.toBase58());
console.log("owner   ", owner.toBase58(), "(treasury)");
console.log("fee ATA ", ata.toBase58());
console.log("payer   ", payer.publicKey.toBase58());

const existing = await conn.getAccountInfo(ata);
if (existing) {
  console.log("\nAlready exists — nothing to do. Jupiter can collect into this today.");
  process.exit(0);
}

const bal = await conn.getBalance(payer.publicKey);
console.log("payer balance", (bal / 1e9).toFixed(6), "SOL");
if (bal < 3_000_000) {
  console.error("payer needs at least ~0.003 SOL to cover rent plus the network fee");
  process.exit(1);
}

const tx = new Transaction().add(
  createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint, TOKEN_PROGRAM_ID)
);
const sig = await sendAndConfirmTransaction(conn, tx, [payer], { commitment: "confirmed" });

console.log("\ncreated ✓");
console.log("signature", sig);
console.log("solscan  ", `https://solscan.io/tx/${sig}`);
console.log("\nThe treasury now owns this account. Fees for this mint are collectable.");
