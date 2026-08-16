// VALO — /api/creator-cycle
//
// Runs daily. Two legs, either of which can be skipped without breaking the
// other:
//
//   1. SPLIT   Only what has newly arrived in the creator wallet since the last
//              run is split 25 burn / 50 epoch / 25 keep. The kept share is
//              never touched again — that is the whole point of the baseline.
//   2. BURN    Whatever SOL sits on the burn wallet is swapped to $VALO through
//              Jupiter and burned.
//
// WHY A BASELINE
//   The site's doCreatorSplit takes the entire wallet balance minus rent. That
//   re-splits the creator's kept share on every run, so the keep erodes by 75%
//   each time. Here the untouchable floor is stored in Supabase and re-anchored
//   to the real on-chain balance after every successful split, which also
//   absorbs whatever the transaction fees cost.
//
// WHY THE BURN LEG IS SELF-HEALING
//   It swaps whatever is on the burn wallet above the reserve, rather than an
//   amount carried over from the split. If the split lands and the burn fails,
//   tomorrow's run finds the SOL still sitting there and burns it. Nothing has
//   to be reconciled by hand.
//
// ENV
//   VALO_CREATOR_SECRET   base58 or JSON secret key for VALO_CREATOR
//   VALO_BURN_SECRET      base58 or JSON secret key for VALO_BURN
//   VALO_SPLIT_MIN_SOL    hold below this much newly claimed SOL (default 0.05)
//   VALO_BURN_MIN_SOL     hold below this much on the burn wallet (default 0.02)
//   CRON_SECRET           Vercel cron bearer, or VALO_CRON_KEY via x-cron-key
//
// Requires a Supabase table:
//   create table creator_split_state (
//     id text primary key,
//     baseline_lamports int8 not null,
//     updated_at timestamptz not null default now()
//   );

import { keypairFrom, buildTx, findAta } from "./_solana-lite.js";
import {
  ixTransferSol, ixBurnChecked, signSerialized, tokenProgramOf, confirm, verifyEd25519,
} from "./_burn-lite.js";

const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

const rpc = async (method, params) => {
  const r = await fetch(RPC(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  if (j && j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j && j.result;
};

const sb = async (path, opts = {}) => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(opts.headers || {}) },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch (e) { return null; }
};

const JUP = (process.env.JUPITER_API || "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");
const SOL_MINT = "So11111111111111111111111111111111111111112";
const LAMPORTS = 1e9;

// Helius load-balances, so a blockhash fetched at "confirmed" can be simulated
// on a node a slot or two behind that has never seen it — which surfaces as
// "Blockhash not found" and looks exactly like an exhausted RPC key.
// "finalized" is old enough that every node knows it, and a retry covers the
// rest. web3.js does this internally, which is why the local script never hit it.
const sendSigned = async ({ payer, instructions, signer, label }) => {
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    const bh = await rpc("getLatestBlockhash", [{ commitment: "finalized" }]);
    const blockhash = bh && bh.value && bh.value.blockhash;
    if (!blockhash) throw new Error(`no blockhash for ${label}`);
    try {
      const raw = buildTx({ payer, instructions, recentBlockhash: blockhash, signer });
      return await rpc("sendTransaction", [raw, { encoding: "base64", maxRetries: 3, skipPreflight: false }]);
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || e);
      // Only a stale blockhash is worth retrying. Anything else — a bad
      // account, no fees owed — will fail identically every time, and retrying
      // just burns the function's timeout.
      if (!/[Bb]lockhash not found|block height exceeded/.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw lastErr;
};

const readBaseline = async () => {
  const rows = await sb("creator_split_state?id=eq.creator&select=baseline_lamports");
  if (!rows || !rows.length) return null;
  return Number(rows[0].baseline_lamports);
};

const writeBaseline = async (lamports) => sb("creator_split_state", {
  method: "POST",
  headers: { prefer: "resolution=merge-duplicates" },
  body: JSON.stringify([{ id: "creator", baseline_lamports: Math.floor(lamports), updated_at: new Date().toISOString() }]),
});

// ── leg 0: claim creator fees from pump.fun ───────────────────────
// Copied verbatim from a real CollectCreatorFeeV2 the creator wallet signed
// (3n7itspwkuAh4Z…), rather than derived from pump.fun's seeds. The accounts
// at indexes 1-3 are PDAs of this creator and this mint; both are fixed, so
// hardcoding is safe and avoids guessing at a layout that has changed before.
//
// If VALO is ever not the only token this wallet created, these addresses stop
// being right — override them with VALO_PUMP_ACCOUNTS rather than editing here.
const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
const PUMP_CLAIM_DISC = Buffer.from("cf118af204221338", "hex");
const PUMP_DEFAULT_ACCOUNTS = [
  "EiWQwQiqPyNymfgwFppkVEC33qRvKtq7zfBLEVkkKE93",
  "EAEYpcFUwJv9Cq4nDs7dfiFXk2kiTVAxEYz5ZszSSwXB",
  "RiTL56fCWsgQDufT1qFnNYp8m1RyD2fMiWoVRUmtKVy",
];

async function claimLeg(out) {
  const CREATOR = (process.env.VALO_CREATOR || "").trim();
  if (!CREATOR) { out.claim = { skipped: "VALO_CREATOR not set" }; return; }
  if (String(process.env.VALO_PUMP_CLAIM || "on").toLowerCase() === "off") {
    out.claim = { skipped: "VALO_PUMP_CLAIM=off" }; return;
  }

  let signer;
  try { signer = keypairFrom(process.env.VALO_CREATOR_SECRET); }
  catch (e) { out.claim = { skipped: `VALO_CREATOR_SECRET unreadable: ${String(e.message || e)}` }; return; }
  if (signer.publicKey !== CREATOR) {
    out.claim = { error: "VALO_CREATOR_SECRET does not match VALO_CREATOR — refusing to sign" };
    return;
  }

  const pdas = (process.env.VALO_PUMP_ACCOUNTS || "").trim()
    ? process.env.VALO_PUMP_ACCOUNTS.split(",").map((x) => x.trim()).filter(Boolean)
    : PUMP_DEFAULT_ACCOUNTS;
  if (pdas.length !== 3) { out.claim = { error: "VALO_PUMP_ACCOUNTS must be exactly 3 addresses" }; return; }

  const before = await rpc("getBalance", [CREATOR, { commitment: "confirmed" }]);
  const beforeLam = (before && before.value) || 0;

  const ix = {
    programId: PUMP_PROGRAM,
    keys: [
      { pubkey: CREATOR, isSigner: true, isWritable: true },
      { pubkey: pdas[0], isSigner: false, isWritable: true },
      { pubkey: pdas[1], isSigner: false, isWritable: true },
      { pubkey: pdas[2], isSigner: false, isWritable: true },
      { pubkey: SOL_MINT, isSigner: false, isWritable: false },
      { pubkey: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", isSigner: false, isWritable: false },
      { pubkey: "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", isSigner: false, isWritable: false },
      { pubkey: "11111111111111111111111111111111", isSigner: false, isWritable: false },
      { pubkey: "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1", isSigner: false, isWritable: false },
      { pubkey: PUMP_PROGRAM, isSigner: false, isWritable: false },
    ],
    data: PUMP_CLAIM_DISC,
  };

  const sig = await sendSigned({ payer: CREATOR, instructions: [ix], signer, label: "claim" });
  await confirm(rpc, sig);

  const after = await rpc("getBalance", [CREATOR, { commitment: "confirmed" }]);
  const claimed = ((after && after.value) || 0) - beforeLam;
  out.claim = {
    executed: true, claimedSol: claimed / LAMPORTS,
    sig, solscan: `https://solscan.io/tx/${sig}`,
  };
}

// ── leg 1: split only what newly arrived ──────────────────────────
async function splitLeg(out) {
  const CREATOR = (process.env.VALO_CREATOR || "").trim();
  const BURN = (process.env.VALO_BURN || "").trim();
  const EPOCH = (process.env.VALO_EPOCH || "").trim();
  const MIN = Math.max(0.001, parseFloat(process.env.VALO_SPLIT_MIN_SOL || "0.05"));

  if (!CREATOR || !BURN || !EPOCH) { out.split = { skipped: "VALO_CREATOR / VALO_BURN / VALO_EPOCH not all set" }; return; }

  let signer;
  try { signer = keypairFrom(process.env.VALO_CREATOR_SECRET); }
  catch (e) { out.split = { skipped: `VALO_CREATOR_SECRET unreadable: ${String(e.message || e)}` }; return; }
  if (signer.publicKey !== CREATOR) {
    out.split = { error: "VALO_CREATOR_SECRET does not match VALO_CREATOR — refusing to sign", secretPubkey: signer.publicKey };
    return;
  }

  const balance = await rpc("getBalance", [CREATOR, { commitment: "confirmed" }]);
  const bal = (balance && balance.value) || 0;

  let baseline = await readBaseline();
  if (baseline === null) {
    // First run: everything currently in the wallet is the creator's, by
    // definition. Anchor and split nothing — better to skip one cycle than to
    // split a balance we cannot account for.
    await writeBaseline(bal);
    out.split = { anchored: true, baselineSol: bal / LAMPORTS, note: "first run — baseline set, nothing split" };
    return;
  }

  // Fees paid by past runs can push the balance under the baseline. That is
  // not a claim; re-anchor down so it does not read as one later.
  if (bal < baseline) {
    await writeBaseline(bal);
    out.split = { claimedSol: 0, note: "balance below baseline (fees) — re-anchored", baselineSol: bal / LAMPORTS };
    return;
  }

  const claimed = bal - baseline;
  if (claimed < MIN * LAMPORTS) {
    out.split = { executed: false, claimedSol: claimed / LAMPORTS, thresholdSol: MIN, note: "below threshold — holding" };
    return;
  }

  const burnLam = Math.floor(claimed * 0.25);
  const epochLam = Math.floor(claimed * 0.5);

  const sig = await sendSigned({
    payer: CREATOR,
    instructions: [
      ixTransferSol({ from: CREATOR, to: BURN, lamports: burnLam }),
      ixTransferSol({ from: CREATOR, to: EPOCH, lamports: epochLam }),
    ],
    signer, label: "split",
  });
  await confirm(rpc, sig);

  // Re-anchor to the real post-split balance: it absorbs the fee automatically,
  // so the kept share never drifts.
  const after = await rpc("getBalance", [CREATOR, { commitment: "confirmed" }]);
  await writeBaseline((after && after.value) || 0);

  out.split = {
    executed: true, claimedSol: claimed / LAMPORTS,
    burnedToWalletSol: burnLam / LAMPORTS, epochSol: epochLam / LAMPORTS,
    keptSol: (claimed - burnLam - epochLam) / LAMPORTS,
    newBaselineSol: ((after && after.value) || 0) / LAMPORTS,
    sig, solscan: `https://solscan.io/tx/${sig}`,
  };
}

// ── leg 2: swap the burn wallet's SOL to $VALO and burn it ────────
async function burnLeg(out) {
  const BURN = (process.env.VALO_BURN || "").trim();
  const MINT = (process.env.VALO_MINT || "").trim();
  const MIN = Math.max(0.002, parseFloat(process.env.VALO_BURN_MIN_SOL || "0.02"));
  // The route creates a wrapped-SOL account and a token account mid-swap, each
  // needing rent. 0.006 was not enough in testing — pump.fun ran out of
  // lamports at instruction 6.
  const RESERVE = 0.01;

  if (!BURN || !MINT) { out.burn = { skipped: "VALO_BURN / VALO_MINT not set" }; return; }

  let signer;
  try { signer = keypairFrom(process.env.VALO_BURN_SECRET); }
  catch (e) { out.burn = { skipped: `VALO_BURN_SECRET unreadable: ${String(e.message || e)}` }; return; }
  if (signer.publicKey !== BURN) {
    out.burn = { error: "VALO_BURN_SECRET does not match VALO_BURN — refusing to sign", secretPubkey: signer.publicKey };
    return;
  }

  const balR = await rpc("getBalance", [BURN, { commitment: "confirmed" }]);
  const bal = (balR && balR.value) || 0;
  const swapLam = Math.floor(bal - RESERVE * LAMPORTS);
  if (swapLam < MIN * LAMPORTS) {
    out.burn = { executed: false, availableSol: Math.max(0, swapLam) / LAMPORTS, thresholdSol: MIN, note: "below threshold — holding" };
    return;
  }

  const tokenProgram = await tokenProgramOf(rpc, MINT);

  const qr = await fetch(`${JUP}/quote?inputMint=${SOL_MINT}&outputMint=${MINT}&amount=${swapLam}&slippageBps=${process.env.VALO_SLIPPAGE_BPS || 300}`,
    { signal: AbortSignal.timeout(12000) });
  if (!qr.ok) throw new Error(`Jupiter quote ${qr.status}`);
  const quote = await qr.json();

  const sr = await fetch(`${JUP}/swap`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quote, userPublicKey: BURN, wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 500000, priorityLevel: "high" } },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!sr.ok) throw new Error(`Jupiter swap ${sr.status}: ${(await sr.text()).slice(0, 200)}`);
  const { swapTransaction } = await sr.json();

  const swapSig = await rpc("sendTransaction", [signSerialized(swapTransaction, signer), { encoding: "base64", maxRetries: 3, skipPreflight: false }]);
  await confirm(rpc, swapSig);

  // Burn what actually landed, not what was quoted — slippage means those
  // differ, and burning the quote would either fail or strand dust forever.
  const ata = findAta(BURN, MINT, tokenProgram);
  let held = null, decimals = 0;
  for (let i = 0; i < 6; i++) {
    try {
      const b = await rpc("getTokenAccountBalance", [ata, { commitment: "confirmed" }]);
      if (b && b.value && BigInt(b.value.amount) > 0n) { held = BigInt(b.value.amount); decimals = b.value.decimals; break; }
    } catch (e) { /* the account may lag the swap */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (held === null) {
    out.burn = { executed: false, swapSig, error: "swap confirmed but no $VALO balance found — tokens are safe, next run will burn them" };
    return;
  }

  const burnSig = await sendSigned({
    payer: BURN,
    instructions: [ixBurnChecked({ account: ata, mint: MINT, owner: BURN, amount: held, decimals, tokenProgram })],
    signer, label: "burn",
  });
  await confirm(rpc, burnSig);

  const supply = await rpc("getTokenSupply", [MINT]);
  out.burn = {
    executed: true, swappedSol: swapLam / LAMPORTS,
    burnedTokens: Number(held) / 10 ** decimals,
    swapSig, burnSig,
    solscan: `https://solscan.io/tx/${burnSig}`,
    supplyNow: supply && supply.value && supply.value.uiAmount,
  };
}


// discordAnnounce-v1 - fire-and-forget receipt into a channel webhook.
// Never throws, never blocks money: a dead webhook costs 4s max and nothing else.
const discordAnnounce = async (envKey, content) => {
  const hook = (process.env[envKey] || "").trim();
  if (!hook) return;
  try {
    await fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(4000),
    });
  } catch (e) {}
};

export default async function handler(req, res) {
  const cronOk = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const keyOk = process.env.VALO_CRON_KEY && req.headers["x-cron-key"] === process.env.VALO_CRON_KEY;

  // The creator can also authorize a run by signing a message in Phantom.
  // Nothing secret reaches the browser: the signature proves control of
  // VALO_CREATOR, and the server holds the key that actually spends.
  let walletOk = false;
  const sigHdr = req.headers["x-valo-sig"];
  const msgHdr = req.headers["x-valo-msg"];
  if (!cronOk && !keyOk && sigHdr && msgHdr) {
    try {
      const CREATOR = (process.env.VALO_CREATOR || "").trim();
      const m = String(msgHdr);
      const [tag, ts] = m.split(":");
      // A signature is replayable forever unless it is bound to a moment.
      const age = Math.abs(Date.now() - Number(ts));
      if (tag === "valo-creator-cycle" && Number.isFinite(age) && age < 300000) {
        walletOk = verifyEd25519(CREATOR, new TextEncoder().encode(m), Buffer.from(String(sigHdr), "base64"));
      }
    } catch (e) { walletOk = false; }
  }

  if (!cronOk && !keyOk && !walletOk) return res.status(401).json({ ok: false, error: "unauthorized" });

  const out = { ok: true, at: new Date().toISOString() };

  // Dry run reports what it would do and signs nothing.
  if (String(req.query.mode || "") === "status") {
    const CREATOR = (process.env.VALO_CREATOR || "").trim();
    const BURN = (process.env.VALO_BURN || "").trim();
    const baseline = await readBaseline();
    const cb = CREATOR ? await rpc("getBalance", [CREATOR, { commitment: "confirmed" }]) : null;
    const bb = BURN ? await rpc("getBalance", [BURN, { commitment: "confirmed" }]) : null;
    const bal = (cb && cb.value) || 0;
    return res.status(200).json({
      ...out, mode: "status",
      creatorBalanceSol: bal / LAMPORTS,
      baselineSol: baseline === null ? null : baseline / LAMPORTS,
      claimedSol: baseline === null ? null : Math.max(0, bal - baseline) / LAMPORTS,
      splitThresholdSol: parseFloat(process.env.VALO_SPLIT_MIN_SOL || "0.05"),
      burnWalletSol: ((bb && bb.value) || 0) / LAMPORTS,
      keysPresent: { creator: !!process.env.VALO_CREATOR_SECRET, burn: !!process.env.VALO_BURN_SECRET },
    });
  }

  // Manually re-anchor the untouchable floor to the current balance.
  if (String(req.query.mode || "") === "anchor") {
    const CREATOR = (process.env.VALO_CREATOR || "").trim();
    const b = await rpc("getBalance", [CREATOR, { commitment: "confirmed" }]);
    await writeBaseline((b && b.value) || 0);
    return res.status(200).json({ ...out, anchoredSol: ((b && b.value) || 0) / LAMPORTS });
  }

  // Claim first, so anything pump.fun owes lands before the split measures the
  // balance. A failed claim must not stop the split: fees claimed on an earlier
  // run may still be sitting unsplit.
  try { await claimLeg(out); }
  catch (e) { out.claim = { executed: false, error: String(e.message || e).slice(0, 300) }; }

  // Each leg is reported independently: a failed split must not stop the burn
  // of SOL already sitting on the burn wallet from a previous cycle.
  try { await splitLeg(out); }
  catch (e) { out.ok = false; out.split = { error: String(e.message || e).slice(0, 300) }; }

  try { await burnLeg(out); }
  catch (e) { out.ok = false; out.burn = { error: String(e.message || e).slice(0, 300) }; }

  // discordAnnounce-v1 - receipts only: legs that executed. Held legs are
  // the machine being careful, not news.
  if (out.split && out.split.executed) {
    await discordAnnounce("DISCORD_WEBHOOK_BURN",
      `\u2699 **Creator fees split** \u00b7 ${(out.split.claimedSol || 0).toFixed(4)} SOL \u2192 ` +
      `\ud83d\udd25 ${(out.split.burnedToWalletSol || 0).toFixed(4)} burn \u00b7 ` +
      `\ud83c\udf81 ${(out.split.epochSol || 0).toFixed(4)} rewards \u00b7 ` +
      `[tx](<${out.split.solscan || "https://solscan.io"}>)`);
  }
  if (out.burn && out.burn.executed) {
    const n = Math.round(out.burn.burnedTokens || 0).toLocaleString("en-US");
    const sup = out.burn.supplyNow ? Math.round(out.burn.supplyNow).toLocaleString("en-US") : "?";
    await discordAnnounce("DISCORD_WEBHOOK_BURN",
      `\ud83d\udd25 **${n} $VALO burned** \u2014 bought off the market and destroyed.\n` +
      `Supply now **${sup}** \u00b7 it only goes one way \u00b7 [verify on Solscan](<${out.burn.solscan}>)`);
  }

  return res.status(200).json(out);
}

export const config = { maxDuration: 120 };
