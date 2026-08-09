// VALO — finish a creator-fee run that stopped after the buy.
//
//   node scripts/finish-burn.mjs             # DRY RUN
//   node scripts/finish-burn.mjs --execute   # burns and pays the vault
//
// This does NOT buy anything. It burns whatever $VALO the wallet is already
// holding and sends the epoch vault its share, so a run interrupted between
// the buy and the burn can be completed without buying twice.
//
// The original failure was a race: at "confirmed" commitment the freshly
// created token account is not always readable by the very next RPC call.
// This retries instead of assuming.
//
//   export CREATOR_SECRET='...'
//   export EPOCH_LAMPORTS=103672000     # optional — skip the vault payment if unset

import { Connection, Keypair, PublicKey, Transaction, SystemProgram, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, createBurnInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// which token program owns this mint? Token-2022 and legacy SPL derive
// DIFFERENT associated accounts, so guessing puts the burn at an address that
// does not exist. Read it from the chain.
async function tokenProgramFor(conn, mint) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error("mint not found on chain");
  return info.owner;
}


const EXECUTE = process.argv.includes("--execute");
const VALO_MINT = (process.env.VALO_MINT || "8sGztc2R1sMY4WiXSU1vuJqZGtzHXaA832AcifF9pump").trim();
const EPOCH = new PublicKey(process.env.VALO_EPOCH || "HGb8XYx639njxn4vEyvzXyKmPyUET4BgoxyMUxyn1nCj");
const EPOCH_LAM = parseInt(process.env.EPOCH_LAMPORTS || "0", 10);

const rpc = process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com";
const conn = new Connection(rpc, "confirmed");

function loadKey(raw, label) {
  if (!raw || !raw.trim()) { console.error(`${label} is not set.`); process.exit(1); }
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

const owner = loadKey(process.env.CREATOR_SECRET, "CREATOR_SECRET");
const mint = new PublicKey(VALO_MINT);
const TOKEN_PROG = await tokenProgramFor(conn, mint);
const ata = getAssociatedTokenAddressSync(mint, owner.publicKey, true, TOKEN_PROG);

console.log(EXECUTE ? "\nMODE   EXECUTE\n" : "\nMODE   DRY RUN — nothing will be sent\n");
console.log("wallet", owner.publicKey.toBase58());
console.log("token ", ata.toBase58());

// retry — a new account can lag the confirmation that created it
let acct = null;
for (let i = 0; i < 8; i++) {
  try { acct = await getAccount(conn, ata, undefined, TOKEN_PROG); break; }
  catch (e) {
    if (i === 7) { console.error("\ntoken account still not visible after 8 tries — wait a minute and re-run.\n"); process.exit(1); }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const held = acct.amount;
console.log("holding", (Number(held) / 1e6).toLocaleString(), "$VALO");
if (held <= 0n) { console.log("\nnothing to burn.\n"); process.exit(0); }

// BURN_UI_AMOUNT limits the burn to a specific quantity. Without it the whole
// balance goes — correct for a dedicated burn wallet, wrong for one that also
// holds a dev allocation.
const wantUi = (process.env.BURN_UI_AMOUNT || "").trim();
let qty = held;
if (wantUi) {
  if (!/^\d+(\.\d+)?$/.test(wantUi)) { console.error("BURN_UI_AMOUNT is not a number"); process.exit(1); }
  const [w, f = ""] = wantUi.split(".");
  qty = BigInt(w + (f + "000000").slice(0, 6));
  if (qty > held) { console.error(`BURN_UI_AMOUNT exceeds the balance (${(Number(held)/1e6).toLocaleString()} held)`); process.exit(1); }
  console.log("burning", (Number(qty) / 1e6).toLocaleString(), "$VALO · keeping", (Number(held - qty) / 1e6).toLocaleString());
} else {
  console.log("burning the FULL balance — set BURN_UI_AMOUNT to burn only part of it");
}
if (qty <= 0n) { console.log("\nnothing to burn.\n"); process.exit(0); }
if (EPOCH_LAM > 0) console.log("epoch  ", (EPOCH_LAM / 1e9).toFixed(6), "SOL ->", EPOCH.toBase58());

if (!EXECUTE) { console.log("\nDRY RUN — re-run with --execute.\n"); process.exit(0); }

console.log("\nburning…");
const burnTx = new Transaction().add(createBurnInstruction(ata, mint, owner.publicKey, qty, [], TOKEN_PROG));
const burnSig = await sendAndConfirmTransaction(conn, burnTx, [owner], { commitment: "confirmed" });
console.log("  burned: https://solscan.io/tx/" + burnSig);

if (EPOCH_LAM > 0) {
  console.log("\npaying the epoch vault…");
  const payTx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: owner.publicKey, toPubkey: EPOCH, lamports: EPOCH_LAM })
  );
  const paySig = await sendAndConfirmTransaction(conn, payTx, [owner], { commitment: "confirmed" });
  console.log("  paid:   https://solscan.io/tx/" + paySig);
}

console.log("\ndone — supply is permanently lower.\n");
