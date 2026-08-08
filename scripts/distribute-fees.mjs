// VALO — distribute accrued platform fees, 40% burn / 40% epoch / 20% treasury.
//
//   node scripts/distribute-fees.mjs            # DRY RUN — shows the split, sends nothing
//   node scripts/distribute-fees.mjs --execute  # signs and sends
//
// Fees arrive by two routes and this handles both:
//
//   POOL   — buys pay a single SOL transfer into the fee pool wallet.
//            Needs POOL_SECRET.
//   WSOL   — sells pay inside the swap, landing as wrapped SOL in the
//            treasury's token account. Needs TREASURY_SECRET.
//
// Each route is its own atomic transaction, so one can run without the other
// and a failure in one never leaves the other half-done. Set whichever secrets
// you have; missing ones are skipped with a note.
//
//   export POOL_SECRET='...'        # fee pool wallet
//   export TREASURY_SECRET='...'    # treasury wallet
//
// Keep both out of the repo. ` unset` them when finished.

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
const TREASURY = new PublicKey(process.env.VALO_TREASURY || "AYRV8D28EkvNBV178fBMF61G1i3uLGLp1De1MzuLUb3E");

// leave enough behind for the pool wallet to pay its own network fees
const POOL_RESERVE = Math.round(parseFloat(process.env.VALO_POOL_RESERVE || "0.005") * 1e9);
const MIN_SOL = parseFloat(process.env.VALO_MIN_DISTRIBUTE || "0.01");

const rpc = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");

function loadKey(raw, label) {
  if (!raw || !raw.trim()) return null;
  raw = raw.trim();
  if (raw.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = 0n;
  for (const c of raw) {
    const i = A.indexOf(c);
    if (i < 0) throw new Error(`${label} is not valid base58`);
    n = n * 58n + BigInt(i);
  }
  const b = [];
  while (n > 0n) { b.unshift(Number(n & 255n)); n >>= 8n; }
  for (const c of raw) { if (c === "1") b.unshift(0); else break; }
  return Keypair.fromSecretKey(Uint8Array.from(b));
}

// 40 / 40 / 20 — treasury takes the exact remainder so no lamport is lost
const split = (lam) => {
  const burn = Math.floor(lam * 0.4);
  const epoch = Math.floor(lam * 0.4);
  return { burn, epoch, treasury: lam - burn - epoch };
};
const sol = (l) => (l / 1e9).toFixed(6);

async function send(tx, signers, label) {
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  const sim = await conn.simulateTransaction(tx);
  if (sim.value.err) {
    console.error(`  x ${label}: simulation failed, nothing sent —`, JSON.stringify(sim.value.err));
    if (sim.value.logs) console.error("   ", sim.value.logs.slice(-6).join("\n    "));
    return null;
  }
  const sig = await sendAndConfirmTransaction(conn, tx, signers, { commitment: "confirmed" });
  console.log(`  ok ${label}: https://solscan.io/tx/${sig}`);
  return sig;
}

console.log(EXECUTE ? "\nMODE  EXECUTE — this will move real funds\n" : "\nMODE  DRY RUN — nothing will be sent\n");

// ── route 1: the fee pool (buys) ────────────────────────────────────────────
const pool = loadKey(process.env.POOL_SECRET, "POOL_SECRET");
if (!pool) {
  console.log("POOL   skipped — POOL_SECRET not set");
} else {
  const bal = await conn.getBalance(pool.publicKey);
  const avail = bal - POOL_RESERVE;
  console.log("POOL  ", pool.publicKey.toBase58());
  console.log("       balance", sol(bal), "SOL · distributable", sol(Math.max(0, avail)), "SOL");
  if (avail / 1e9 < MIN_SOL) {
    console.log(`       below the ${MIN_SOL} SOL threshold — leaving it to accumulate`);
  } else {
    const s = split(avail);
    console.log("       burn", sol(s.burn), "· epoch", sol(s.epoch), "· treasury", sol(s.treasury));
    if (EXECUTE) {
      const tx = new Transaction()
        .add(SystemProgram.transfer({ fromPubkey: pool.publicKey, toPubkey: BURN, lamports: s.burn }))
        .add(SystemProgram.transfer({ fromPubkey: pool.publicKey, toPubkey: EPOCH, lamports: s.epoch }))
        .add(SystemProgram.transfer({ fromPubkey: pool.publicKey, toPubkey: TREASURY, lamports: s.treasury }));
      await send(tx, [pool], "pool distributed");
    }
  }
}

// ── route 2: the in-swap wrapped SOL (sells) ────────────────────────────────
const treasury = loadKey(process.env.TREASURY_SECRET, "TREASURY_SECRET");
if (!treasury) {
  console.log("\nWSOL   skipped — TREASURY_SECRET not set");
} else {
  const ata = getAssociatedTokenAddressSync(WSOL, treasury.publicKey, true, TOKEN_PROGRAM_ID);
  console.log("\nWSOL  ", ata.toBase58());
  let acct = null;
  try { acct = await getAccount(conn, ata); } catch (e) { console.log("       no fee account yet — nothing collected in-swap"); }
  if (acct) {
    if (acct.owner.toBase58() !== treasury.publicKey.toBase58()) {
      console.error("       owner mismatch — TREASURY_SECRET is not the treasury wallet. Skipping.");
    } else {
      const lam = Number(acct.amount);
      console.log("       accrued", sol(lam), "wSOL");
      if (lam / 1e9 < MIN_SOL) {
        console.log(`       below the ${MIN_SOL} SOL threshold — leaving it to accumulate`);
      } else {
        const s = split(lam);
        console.log("       burn", sol(s.burn), "· epoch", sol(s.epoch), "· treasury", sol(s.treasury), "(stays)");
        if (EXECUTE) {
          // closing is the only way to unwrap; recreate so fees keep landing
          const tx = new Transaction()
            .add(createCloseAccountInstruction(ata, treasury.publicKey, treasury.publicKey, [], TOKEN_PROGRAM_ID))
            .add(createAssociatedTokenAccountIdempotentInstruction(treasury.publicKey, ata, treasury.publicKey, WSOL, TOKEN_PROGRAM_ID))
            .add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: BURN, lamports: s.burn }))
            .add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: EPOCH, lamports: s.epoch }));
          await send(tx, [treasury], "wSOL unwrapped and distributed");
        }
      }
    }
  }
}

if (!EXECUTE) console.log("\nDRY RUN — nothing sent. Re-run with --execute.\n");
