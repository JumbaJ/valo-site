// VALO — buy $VALO with the pooled burn share and burn every token.
//
//   node scripts/burn-valo.mjs              # DRY RUN
//   node scripts/burn-valo.mjs --execute    # buys and burns
//
// The burn share of every trading fee pools in the burn wallet as SOL. This
// spends ALL of it on the open market and burns the $VALO it receives.
//
// Why not send SOL to the incinerator instead: SOL burned there does nothing
// to $VALO supply, and the incinerator is a shared address, so no figure there
// can be attributed to VALO. A dedicated wallet is auditable, and buying
// before burning adds real buy pressure on the way through.
//
//   export BURN_SECRET='...'    # the burn wallet
//
// The burn is an SPL burn instruction, so total supply actually falls and the
// site's supply-delta tracker reflects it without any bookkeeping.

import {
  Connection, Keypair, PublicKey, VersionedTransaction, Transaction, sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync, getAccount, createBurnInstruction, TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const EXECUTE = process.argv.includes("--execute");
const SOL_MINT = "So11111111111111111111111111111111111111112";
const VALO_MINT = (process.env.VALO_MINT || "8sGztc2R1sMY4WiXSU1vuJqZGtzHXaA832AcifF9pump").trim();
const JUP = process.env.JUPITER_API || "https://lite-api.jup.ag/swap/v1";

// leave enough for network fees and the token account's rent
const RESERVE = Math.round(parseFloat(process.env.VALO_BURN_RESERVE || "0.01") * 1e9);
const MIN_SOL = parseFloat(process.env.VALO_MIN_BURN || "0.02");
const SLIPPAGE_BPS = parseInt(process.env.VALO_BURN_SLIPPAGE || "500", 10);
const MAX_IMPACT = parseFloat(process.env.VALO_BURN_MAX_IMPACT || "10");   // percent

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
const burner = loadKey(process.env.BURN_SECRET, "BURN_SECRET");

console.log(EXECUTE ? "\nMODE     EXECUTE — this will buy and burn\n" : "\nMODE     DRY RUN — nothing will be sent\n");
console.log("burn wallet", burner.publicKey.toBase58());
console.log("$VALO      ", VALO_MINT);

const bal = await conn.getBalance(burner.publicKey);
const spend = bal - RESERVE;
console.log("balance    ", sol(bal), "SOL · spendable", sol(Math.max(0, spend)), "SOL");

if (spend / 1e9 < MIN_SOL) {
  console.log(`\nbelow the ${MIN_SOL} SOL threshold — letting it pool. Lower VALO_MIN_BURN to force it.\n`);
  process.exit(0);
}

const qRes = await fetch(`${JUP}/quote?inputMint=${SOL_MINT}&outputMint=${VALO_MINT}`
  + `&amount=${spend}&slippageBps=${SLIPPAGE_BPS}`);
if (!qRes.ok) { console.error("quote failed:", await qRes.text()); process.exit(1); }
const quote = await qRes.json();
if (!quote || !quote.outAmount) { console.error("no route for this size"); process.exit(1); }

const impact = Math.abs(+quote.priceImpactPct * 100);
const tokens = +quote.outAmount / 1e6;   // $VALO uses 6 decimals
console.log("\nbuyback");
console.log("  spending  ", sol(spend), "SOL");
console.log("  receives  ~", tokens.toLocaleString(), "$VALO");
console.log("  impact    ", impact.toFixed(3) + "%");
console.log("  route     ", (quote.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean).join(" -> ") || "direct");

// a thin pool can turn a buyback into a donation to arbitrageurs
if (impact > MAX_IMPACT) {
  console.error(`\nprice impact ${impact.toFixed(2)}% exceeds the ${MAX_IMPACT}% ceiling — refusing.`);
  console.error("Let the pool deepen, split this across smaller runs, or raise VALO_BURN_MAX_IMPACT.\n");
  process.exit(1);
}

if (!EXECUTE) { console.log("\nDRY RUN — nothing sent. Re-run with --execute.\n"); process.exit(0); }

console.log("\nbuying…");
const sRes = await fetch(`${JUP}/swap`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({
    quoteResponse: quote, userPublicKey: burner.publicKey.toBase58(),
    wrapAndUnwrapSol: true, dynamicComputeUnitLimit: true,
    prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500000, priorityLevel: "high" } },
  }),
});
if (!sRes.ok) { console.error("  swap build failed:", await sRes.text()); process.exit(1); }
const { swapTransaction } = await sRes.json();

const vtx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
vtx.sign([burner]);
const buySig = await conn.sendRawTransaction(vtx.serialize(), { maxRetries: 3 });
await conn.confirmTransaction(buySig, "confirmed");
console.log("  bought: https://solscan.io/tx/" + buySig);

const mint = new PublicKey(VALO_MINT);
const ata = getAssociatedTokenAddressSync(mint, burner.publicKey, true, TOKEN_PROGRAM_ID);
const acct = await getAccount(conn, ata);
const qty = acct.amount;
if (qty <= 0n) { console.error("  nothing to burn — the buy produced no tokens"); process.exit(1); }

console.log(`\nburning ${(Number(qty) / 1e6).toLocaleString()} $VALO…`);
const burnTx = new Transaction().add(
  createBurnInstruction(ata, mint, burner.publicKey, qty, [], TOKEN_PROGRAM_ID)
);
const burnSig = await sendAndConfirmTransaction(conn, burnTx, [burner], { commitment: "confirmed" });
console.log("  burned: https://solscan.io/tx/" + burnSig);
console.log("\nSupply is permanently lower. The burn tracker will show it within a minute.\n");
