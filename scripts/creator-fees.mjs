// VALO — creator-fee handler. 25% creator / 25% buyback-and-burn / 50% epoch.
//
//   node scripts/creator-fees.mjs               # DRY RUN
//   node scripts/creator-fees.mjs --execute     # buys, burns, and pays out
//
// pump.fun creator rewards are claimed on pump.fun and land in the creator
// wallet as plain SOL. This script then does what the whitepaper promises:
//
//   25%  stays in the creator wallet
//   25%  BUYS $VALO on the open market, then BURNS every token bought
//   50%  goes to the hourly epoch vault
//
// The buyback is a real market purchase — it adds buy pressure before the
// burn, which is the point. The burn is an SPL burn instruction, so supply
// actually falls and the treasury's supply-delta burn tracker will show it.
//
//   export CREATOR_SECRET='...'     # the creator wallet holding claimed rewards
//
// Run it AFTER claiming on pump.fun. Nothing here claims for you — claiming is
// a pump.fun action and this script never touches their contracts.

import {
  Connection, Keypair, PublicKey, VersionedTransaction, Transaction,
  SystemProgram, sendAndConfirmTransaction,
} from "@solana/web3.js";

// which token program owns this mint? Token-2022 and legacy SPL derive
// DIFFERENT associated accounts, so guessing puts the burn at an address that
// does not exist. Read it from the chain.
async function tokenProgramFor(conn, mint) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error("mint not found on chain");
  return info.owner;
}

import {
  getAssociatedTokenAddressSync, getAccount, createBurnInstruction, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const EXECUTE = process.argv.includes("--execute");
const SOL_MINT = "So11111111111111111111111111111111111111112";
const VALO_MINT = (process.env.VALO_MINT || "8sGztc2R1sMY4WiXSU1vuJqZGtzHXaA832AcifF9pump").trim();
const EPOCH = new PublicKey(process.env.VALO_EPOCH || "HGb8XYx639njxn4vEyvzXyKmPyUET4BgoxyMUxyn1nCj");
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag/swap/v1";

// keep enough back for network fees and the token account's rent
const RESERVE = Math.round(parseFloat(process.env.VALO_CREATOR_RESERVE || "0.01") * 1e9);
const MIN_SOL = parseFloat(process.env.VALO_MIN_CREATOR || "0.02");
const SLIPPAGE_BPS = parseInt(process.env.VALO_CREATOR_SLIPPAGE || "500", 10);

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

const sol = (l) => (l / 1e9).toFixed(6);
const creator = loadKey(process.env.CREATOR_SECRET, "CREATOR_SECRET");

console.log(EXECUTE ? "\nMODE     EXECUTE — this will buy, burn and pay out\n" : "\nMODE     DRY RUN — nothing will be sent\n");
console.log("creator ", creator.publicKey.toBase58());
console.log("$VALO   ", VALO_MINT);

const bal = await conn.getBalance(creator.publicKey);
const avail = bal - RESERVE;
console.log("balance ", sol(bal), "SOL · distributable", sol(Math.max(0, avail)), "SOL");

if (avail / 1e9 < MIN_SOL) {
  console.log(`\nbelow the ${MIN_SOL} SOL threshold — claim more on pump.fun first, or lower VALO_MIN_CREATOR.\n`);
  process.exit(0);
}

// 25 / 25 / 50 — creator keeps the exact remainder so nothing is lost
const buyback = Math.floor(avail * 0.25);
const epochLam = Math.floor(avail * 0.5);
const keep = avail - buyback - epochLam;

console.log("\nsplit");
console.log("  buyback+burn", sol(buyback), "SOL  → buys $VALO, burns every token");
console.log("  epoch vault ", sol(epochLam), "SOL  →", EPOCH.toBase58());
const PAYOUT = (process.env.VALO_CREATOR_PAYOUT || "").trim();
console.log("  creator     ", sol(keep), "SOL  →", PAYOUT ? PAYOUT : "stays put (set VALO_CREATOR_PAYOUT to sweep it)");
if (!PAYOUT) {
  console.log("\n  ! your 25% stays in this wallet, so the NEXT run will count it as new");
  console.log("    rewards and split it again. Set VALO_CREATOR_PAYOUT to a personal");
  console.log("    wallet so each run only ever processes freshly claimed rewards.");
}

if (!EXECUTE) { console.log("\nDRY RUN — nothing sent. Re-run with --execute.\n"); process.exit(0); }

// ── 1. buy $VALO on the open market ─────────────────────────────────────────
console.log("\nbuying $VALO…");
const qRes = await fetch(`${JUP}/quote?inputMint=${SOL_MINT}&outputMint=${VALO_MINT}`
  + `&amount=${buyback}&slippageBps=${SLIPPAGE_BPS}`);
if (!qRes.ok) { console.error("  quote failed:", await qRes.text()); process.exit(1); }
const quote = await qRes.json();
if (!quote || !quote.outAmount) { console.error("  no route for this size"); process.exit(1); }
console.log("  route:", (quote.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean).join(" -> ") || "direct");

const sRes = await fetch(`${JUP}/swap`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote, userPublicKey: creator.publicKey.toBase58(),
    wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500000, priorityLevel: "high" } },
  }),
});
if (!sRes.ok) { console.error("  swap build failed:", await sRes.text()); process.exit(1); }
const { swapTransaction } = await sRes.json();

const vtx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
vtx.sign([creator]);
const buySig = await conn.sendRawTransaction(vtx.serialize(), { maxRetries: 3 });
await conn.confirmTransaction(buySig, "confirmed");
console.log("  bought:  https://solscan.io/tx/" + buySig);

// ── 2. burn every token the buyback produced ────────────────────────────────
const mint = new PublicKey(VALO_MINT);
const TOKEN_PROG = await tokenProgramFor(conn, mint);
const ata = getAssociatedTokenAddressSync(mint, creator.publicKey, true, TOKEN_PROG);
// a token account created by the swap can lag the confirmation that made it
let acct = null;
for (let i = 0; i < 8; i++) {
  try { acct = await getAccount(conn, ata, undefined, TOKEN_PROG); break; }
  catch (e) {
    if (i === 7) { console.error("  token account not visible yet — run scripts/finish-burn.mjs in a minute to complete the burn"); process.exit(1); }
    await new Promise((r) => setTimeout(r, 1500));
  }
}
const qty = acct.amount;
if (qty <= 0n) { console.error("  nothing to burn — the buy produced no tokens"); process.exit(1); }
console.log(`\nburning ${qty.toString()} $VALO base units…`);

const burnTx = new Transaction().add(
  createBurnInstruction(ata, mint, creator.publicKey, qty, [], TOKEN_PROG)
);
const burnSig = await sendAndConfirmTransaction(conn, burnTx, [creator], { commitment: "confirmed" });
console.log("  burned:  https://solscan.io/tx/" + burnSig);

// ── 3. the epoch vault's half ───────────────────────────────────────────────
console.log("\npaying the epoch vault…");
const payTx = new Transaction().add(
  SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: EPOCH, lamports: epochLam })
);
// sweep the creator share out in the SAME transaction, so the wallet is left
// holding only its reserve and the next run starts from a clean slate
if (PAYOUT && keep > 0) {
  payTx.add(SystemProgram.transfer({ fromPubkey: creator.publicKey, toPubkey: new PublicKey(PAYOUT), lamports: keep }));
}
const paySig = await sendAndConfirmTransaction(conn, payTx, [creator], { commitment: "confirmed" });
console.log("  paid:    https://solscan.io/tx/" + paySig);

console.log("\ndone — bought, burned, and funded the vault. Supply is permanently lower.\n");
