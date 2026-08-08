// VALO — distribute accrued platform fees.
//
//   node scripts/distribute-fees.mjs            # DRY RUN — shows the split, sends nothing
//   node scripts/distribute-fees.mjs --execute  # signs and sends
//
// Jupiter pays the in-swap platform fee into the treasury's WRAPPED SOL
// account. Wrapped SOL cannot be transferred out as SOL — the only way to
// unwrap is to CLOSE the token account, which sends its whole balance to the
// owner. So one atomic transaction does all of it:
//
//   1. close the fee account          → treasury receives wrapped SOL + rent
//   2. recreate it (idempotent)       → future fees keep landing
//   3. transfer 40% to the burn address
//   4. transfer 40% to the epoch vault
//   5. the remaining 20% simply stays in the treasury
//
// Atomic matters: a partial run could unwrap without paying out, or pay out
// twice. Either all five happen or none do.
//
// TREASURY_SECRET: the treasury wallet's secret key, base58 or JSON array.
// Keep it in your shell, never in the repo. ` unset TREASURY_SECRET` after.

import {
  Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getAccount, createCloseAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const WSOL = new PublicKey("So11111111111111111111111111111111111111112");
const EXECUTE = process.argv.includes("--execute");

const BURN = new PublicKey(process.env.VALO_BURN || "1nc1nerator11111111111111111111111111111111");
const EPOCH = new PublicKey(process.env.VALO_EPOCH || "HGb8XYx639njxn4vEyvzXyKmPyUET4BgoxyMUxyn1nCj");

// don't burn a network fee to move dust
const MIN_SOL = parseFloat(process.env.VALO_MIN_DISTRIBUTE || "0.01");

const rpc = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com";

function loadKey(raw, label) {
  if (!raw) {
    console.error(`${label} is not set. Export it first:\n  export ${label}='<base58 secret key>'`);
    process.exit(1);
  }
  if (raw.trim().startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of raw.trim()) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error(`${label} is not valid base58`);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of raw.trim()) { if (c === "1") bytes.unshift(0); else break; }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

const conn = new Connection(rpc, "confirmed");
const treasury = loadKey(process.env.TREASURY_SECRET, "TREASURY_SECRET");
const owner = treasury.publicKey;
const feeAta = getAssociatedTokenAddressSync(WSOL, owner, true, TOKEN_PROGRAM_ID);

console.log(EXECUTE ? "MODE     EXECUTE — this will move real funds" : "MODE     DRY RUN — nothing will be sent");
console.log("treasury", owner.toBase58());
console.log("fee ATA ", feeAta.toBase58());

// the treasury key must actually own the fee account, or we'd be signing for
// an account we cannot close — fail loudly rather than send a doomed tx
let acct;
try {
  acct = await getAccount(conn, feeAta);
} catch (e) {
  console.error("\nno fee account found at that address — nothing has been collected yet.");
  process.exit(1);
}
if (acct.owner.toBase58() !== owner.toBase58()) {
  console.error(`\nowner mismatch: the fee account belongs to ${acct.owner.toBase58()}`);
  console.error("TREASURY_SECRET is not the treasury wallet. Refusing to continue.");
  process.exit(1);
}

const lam = Number(acct.amount);              // wrapped SOL, in lamports
console.log("accrued ", (lam / 1e9).toFixed(6), "SOL");

if (lam / 1e9 < MIN_SOL) {
  console.log(`\nbelow the ${MIN_SOL} SOL threshold — not worth a network fee yet. Nothing to do.`);
  process.exit(0);
}

// 40 / 40 / 20, treasury takes the exact remainder so nothing is lost
const burnLam = Math.floor(lam * 0.4);
const epochLam = Math.floor(lam * 0.4);
const treasLam = lam - burnLam - epochLam;
if (burnLam + epochLam + treasLam !== lam) { console.error("split does not sum — aborting"); process.exit(1); }

console.log("\nsplit");
console.log("  🔥 burn    ", (burnLam / 1e9).toFixed(6), "SOL →", BURN.toBase58());
console.log("  🎁 epoch   ", (epochLam / 1e9).toFixed(6), "SOL →", EPOCH.toBase58());
console.log("  🏦 treasury", (treasLam / 1e9).toFixed(6), "SOL → stays in", owner.toBase58());

if (!EXECUTE) {
  console.log("\nDRY RUN — nothing sent. Re-run with --execute to send.");
  process.exit(0);
}

const balBefore = await conn.getBalance(owner);
if (balBefore < 5_000_000) {
  console.error("\ntreasury needs a little SOL to cover rent + network fees (~0.005). Top it up first.");
  process.exit(1);
}

const tx = new Transaction();
// 1. unwrap: closing sends the wrapped balance AND the rent to the owner
tx.add(createCloseAccountInstruction(feeAta, owner, owner, [], TOKEN_PROGRAM_ID));
// 2. immediately recreate it so the next trade's fee still has somewhere to land
tx.add(createAssociatedTokenAccountIdempotentInstruction(owner, feeAta, owner, WSOL, TOKEN_PROGRAM_ID));
// 3 + 4. pay the community legs; the 20% remainder needs no instruction
tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: BURN, lamports: burnLam }));
tx.add(SystemProgram.transfer({ fromPubkey: owner, toPubkey: EPOCH, lamports: epochLam }));

// simulate before signing — a build that assembles is not a build that lands
const sim = await conn.simulateTransaction(
  await (async () => {
    tx.feePayer = owner;
    tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
    return tx;
  })()
);
if (sim.value.err) {
  console.error("\nsimulation failed — nothing was sent:", JSON.stringify(sim.value.err));
  if (sim.value.logs) console.error(sim.value.logs.slice(-8).join("\n"));
  process.exit(1);
}
console.log("\nsimulation passed — sending…");

const sig = await sendAndConfirmTransaction(conn, tx, [treasury], { commitment: "confirmed" });
console.log("\ndistributed ✓");
console.log("signature", sig);
console.log("solscan  ", `https://solscan.io/tx/${sig}`);
console.log("\nThe fee account has been recreated — new fees keep accruing to the same address.");
