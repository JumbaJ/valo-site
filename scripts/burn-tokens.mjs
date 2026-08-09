// VALO — burn tokens directly from a wallet.
//
//   BURN_UI_AMOUNT=8000000 node scripts/burn-tokens.mjs             # DRY RUN
//   BURN_UI_AMOUNT=8000000 node scripts/burn-tokens.mjs --execute   # burns
//
// This is for burning $VALO you ALREADY HOLD — a team allocation, a community
// gesture, tokens bought on the open market. It is not the fee buyback; that
// is burn-valo.mjs, which buys first.
//
// There is no "burn address" for this. An SPL burn is an instruction executed
// against your own token account: the tokens cease to exist and total supply
// drops. Sending tokens to an incinerator address does NOT reduce supply —
// they simply sit somewhere unspendable, and the supply-delta burn tracker
// would show nothing.
//
// Key handling — do NOT paste a key into a terminal you might screenshot:
//   echo -n 'YOUR_KEY' > ~/.valo-burn.key && chmod 600 ~/.valo-burn.key
//   export HOLDER_SECRET=$(cat ~/.valo-burn.key)

import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount, createBurnInstruction } from "@solana/spl-token";

const EXECUTE = process.argv.includes("--execute");
const VALO_MINT = (process.env.VALO_MINT || "8sGztc2R1sMY4WiXSU1vuJqZGtzHXaA832AcifF9pump").trim();
const WANT = (process.env.BURN_UI_AMOUNT || "").trim();

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

// Token-2022 and legacy SPL derive different accounts and take different
// program IDs — read it off the mint rather than assuming
async function tokenProgramFor(mint) {
  const info = await conn.getAccountInfo(mint);
  if (!info) throw new Error("mint not found on chain");
  return info.owner;
}

const holder = loadKey(process.env.HOLDER_SECRET, "HOLDER_SECRET");
const mint = new PublicKey(VALO_MINT);
const PROG = await tokenProgramFor(mint);
const ata = getAssociatedTokenAddressSync(mint, holder.publicKey, true, PROG);

console.log(EXECUTE ? "\nMODE    EXECUTE — tokens will be destroyed\n" : "\nMODE    DRY RUN — nothing will be sent\n");
console.log("wallet ", holder.publicKey.toBase58());
console.log("mint   ", VALO_MINT);
console.log("program", PROG.toBase58());
console.log("account", ata.toBase58());

let acct = null;
for (let i = 0; i < 8; i++) {
  try { acct = await getAccount(conn, ata, undefined, PROG); break; }
  catch (e) {
    if (i === 7) { console.error("\nno $VALO account on this wallet — check HOLDER_SECRET.\n"); process.exit(1); }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

const held = acct.amount;
const supplyRes = await conn.getTokenSupply(mint);
const decimals = supplyRes.value.decimals;
const supply = Number(supplyRes.value.amount);
console.log("holding", (Number(held) / 10 ** decimals).toLocaleString(), "$VALO");

if (!WANT) { console.error("\nset BURN_UI_AMOUNT to the quantity to burn (this script never burns everything by default).\n"); process.exit(1); }
if (!/^\d+(\.\d+)?$/.test(WANT)) { console.error("BURN_UI_AMOUNT is not a number"); process.exit(1); }
const [w, f = ""] = WANT.split(".");
const qty = BigInt(w + (f + "0".repeat(decimals)).slice(0, decimals));
if (qty <= 0n) { console.error("nothing to burn"); process.exit(1); }
if (qty > held) {
  console.error(`\nBURN_UI_AMOUNT exceeds the balance — holding ${(Number(held) / 10 ** decimals).toLocaleString()}.\n`);
  process.exit(1);
}

const pct = (Number(qty) / supply) * 100;
console.log("\nburning", (Number(qty) / 10 ** decimals).toLocaleString(), "$VALO");
console.log("keeping", (Number(held - qty) / 10 ** decimals).toLocaleString(), "$VALO");
console.log("that is", pct.toFixed(4) + "% of the", (supply / 10 ** decimals).toLocaleString(), "current supply");
console.log("\nThis is irreversible. Burned tokens cannot be recovered by anyone, including you.");

if (!EXECUTE) { console.log("\nDRY RUN — nothing sent. Re-run with --execute.\n"); process.exit(0); }

const tx = new Transaction().add(createBurnInstruction(ata, mint, holder.publicKey, qty, [], PROG));
const sig = await sendAndConfirmTransaction(conn, tx, [holder], { commitment: "confirmed" });
console.log("\nburned ok");
console.log("signature", sig);
console.log("solscan  ", `https://solscan.io/tx/${sig}`);
console.log("\nSupply is permanently lower. The burn tracker updates within a minute.\n");
