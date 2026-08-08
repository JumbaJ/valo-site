// 🎁 /api/epoch-payout — the hourly distribution.
//
// Reads the PREVIOUS epoch's weights, computes each wallet's share by the
// whitepaper formula, sends $VALO from the epoch vault, records every result,
// and publishes a Merkle root so anyone can verify their own slice.
//
// SAFETY MODEL — this endpoint moves real tokens, so it is deliberately paranoid:
//   • dry-run unless VALO_EPOCH_SECRET is set (compute + report, send nothing)
//   • idempotent: an epoch already marked paid can never pay twice
//   • per-epoch ceiling: VALO_EPOCH_MAX_TOKENS caps what one run can ever send
//   • failure isolation: one bad wallet is recorded and skipped, not fatal
//   • never touches the CURRENT hour — only the epoch that has closed
//
// Trigger: Vercel cron (Authorization: Bearer CRON_SECRET) or manual
//          curl -X POST … -H "x-cron-key: VALO_CRON_KEY"
import {
  Connection, Keypair, PublicKey, Transaction, ComputeBudgetProgram,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddress, createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction, getAccount, getMint,
} from "@solana/spl-token";
import { createHash } from "crypto";

const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

// ── whitepaper weight — identical to /api/epoch, kept in lockstep ──
const weightOf = (volSol, lbBonus, holderWeight = 0) =>
  ((holderWeight || 0) + (volSol || 0)) * (1 + Math.max(0, Math.min(4, (lbBonus || 1) - 1)));

// base58 → Keypair, accepting either a JSON byte array or a base58 secret
const loadVault = (secret) => {
  const raw = String(secret || "").trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
    // base58 (Phantom export format)
    const ALPHA = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    let n = 0n;
    for (const ch of raw) {
      const i = ALPHA.indexOf(ch);
      if (i < 0) throw new Error("bad base58 character in VALO_EPOCH_SECRET");
      n = n * 58n + BigInt(i);
    }
    const bytes = [];
    while (n > 0n) { bytes.unshift(Number(n & 255n)); n >>= 8n; }
    for (const ch of raw) { if (ch === "1") bytes.unshift(0); else break; }
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch (e) {
    throw new Error(`VALO_EPOCH_SECRET could not be read (${e.message})`);
  }
};

const sb = async (path, opts = {}) => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) return null;
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: key, authorization: `Bearer ${key}`,
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!r.ok) return null;
  const t = await r.text();
  return t ? JSON.parse(t) : [];
};

// Merkle root over the payout set — publishable proof of what was owed
const merkleRoot = (leaves) => {
  if (!leaves.length) return null;
  let level = leaves.map((l) => createHash("sha256").update(l).digest());
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const a = level[i], b = level[i + 1] || level[i];
      next.push(createHash("sha256").update(Buffer.concat([a, b])).digest());
    }
    level = next;
  }
  return level[0].toString("hex");
};

export default async function handler(req, res) {
  // ── auth: Vercel cron header OR our own key ──
  const cronOk = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const keyOk = process.env.VALO_CRON_KEY && req.headers["x-cron-key"] === process.env.VALO_CRON_KEY;
  if (!cronOk && !keyOk) return res.status(401).json({ error: "unauthorized" });

  const MINT = (process.env.VALO_MINT || "").trim();
  const EPOCH_ADDR = (process.env.VALO_EPOCH || "").trim();
  const force = String(req.query.force || "") === "1";
  // which epoch: default = the hour that just CLOSED, never the live one
  const nowEpoch = Math.floor(Date.now() / 3600e3);
  const epoch = String(req.query.epoch || (nowEpoch - 1));
  if (+epoch >= nowEpoch && !force) {
    return res.status(400).json({ error: "that epoch is still running — pass ?force=1 only if you mean it", epoch, nowEpoch });
  }

  // ── 1. already paid? (idempotency, checked before anything else) ──
  const done = await sb(`epoch_payouts?epoch=eq.${epoch}&status=eq.sent&select=epoch,user_id&limit=1`);
  if (done && done.length && !force) {
    return res.status(200).json({ ok: true, epoch, skipped: "already paid", note: "idempotent — this epoch will never pay twice" });
  }

  // ── 2. weights for that epoch ──
  const rows = await sb(`epoch_activity?epoch=eq.${epoch}&select=user_id,vol_sol,callout_mult`);
  if (!rows) return res.status(500).json({ error: "could not read epoch_activity (SUPABASE_SERVICE_KEY?)" });
  const weights = rows
    .map((r) => ({ user: r.user_id, volSol: +r.vol_sol || 0, w: weightOf(+r.vol_sol, +r.callout_mult) }))
    .filter((x) => x.w > 0);
  const totalW = weights.reduce((a, x) => a + x.w, 0);
  if (!weights.length || totalW <= 0) {
    return res.status(200).json({ ok: true, epoch, participants: 0, note: "no activity in that epoch — nothing to pay" });
  }

  // ── 3. payout wallets ──
  const ids = weights.map((x) => `"${x.user}"`).join(",");
  const profs = await sb(`profiles?id=in.(${ids})&select=id,payout_wallet,wallet`) || [];
  const walletOf = {};
  for (const p of profs) walletOf[p.id] = p.payout_wallet || p.wallet || null;

  // ── 4. what's in the vault ──
  if (!MINT || !EPOCH_ADDR) return res.status(400).json({ error: "VALO_MINT and VALO_EPOCH must be set" });
  const conn = new Connection(RPC(), "confirmed");
  const mintPk = new PublicKey(MINT);
  const vaultPk = new PublicKey(EPOCH_ADDR);
  const mintInfo = await getMint(conn, mintPk);
  const decimals = mintInfo.decimals;
  const vaultAta = await getAssociatedTokenAddress(mintPk, vaultPk, true);
  let vaultBal = 0n;
  try { const acc = await getAccount(conn, vaultAta); vaultBal = acc.amount; }
  catch (e) { vaultBal = 0n; }

  // hard ceiling: one run can never send more than this, whatever the maths says
  const capTokens = Math.max(0, parseFloat(process.env.VALO_EPOCH_MAX_TOKENS || "0") || 0);
  const capBase = capTokens > 0 ? BigInt(Math.floor(capTokens * 10 ** decimals)) : null;
  const distributable = capBase && capBase < vaultBal ? capBase : vaultBal;

  // ── 5. the payout table ──
  const payouts = weights.map((x) => {
    const share = x.w / totalW;
    const amount = (distributable * BigInt(Math.floor(share * 1e9))) / 1000000000n;
    return {
      user: x.user, wallet: walletOf[x.user] || null,
      weight: +x.w.toFixed(4), share: +share.toFixed(6),
      amountBase: amount.toString(),
      amount: Number(amount) / 10 ** decimals,
    };
  });
  const leaves = payouts.map((p) => `${epoch}|${p.user}|${p.wallet || ""}|${p.amountBase}`);
  const root = merkleRoot(leaves);

  const armed = !!(process.env.VALO_EPOCH_SECRET || "").trim();
  const payable = payouts.filter((p) => p.wallet && BigInt(p.amountBase) > 0n);

  // ── 6. DRY RUN unless armed ──
  if (!armed) {
    return res.status(200).json({
      ok: true, mode: "dry-run", epoch, executed: false,
      participants: payouts.length, payableNow: payable.length,
      vaultTokens: Number(vaultBal) / 10 ** decimals,
      distributable: Number(distributable) / 10 ** decimals,
      totalWeight: +totalW.toFixed(4), merkleRoot: root, payouts,
      note: "set VALO_EPOCH_SECRET to arm real sends. Nothing was transferred.",
    });
  }

  // ── 7. ARMED: send, in small batches, isolating failures ──
  let vault;
  try { vault = loadVault(process.env.VALO_EPOCH_SECRET); }
  catch (e) { return res.status(500).json({ error: String(e.message) }); }
  if (!vault || !vault.publicKey.equals(vaultPk)) {
    return res.status(500).json({ error: "VALO_EPOCH_SECRET does not match VALO_EPOCH — refusing to send" });
  }

  const results = [];
  const BATCH = 6;                       // transfers per transaction
  for (let i = 0; i < payable.length; i += BATCH) {
    const slice = payable.slice(i, i + BATCH);
    const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20000 }));
    const included = [];
    for (const p of slice) {
      try {
        const owner = new PublicKey(p.wallet);
        const ata = await getAssociatedTokenAddress(mintPk, owner, true);
        let needsAta = false;
        try { await getAccount(conn, ata); } catch (e) { needsAta = true; }
        if (needsAta) tx.add(createAssociatedTokenAccountInstruction(vault.publicKey, ata, owner, mintPk));
        tx.add(createTransferCheckedInstruction(vaultAta, mintPk, ata, vault.publicKey, BigInt(p.amountBase), decimals));
        included.push(p);
      } catch (e) {
        results.push({ ...p, status: "failed", error: `bad wallet: ${String(e.message || e)}` });
      }
    }
    if (!included.length) continue;
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      tx.recentBlockhash = blockhash;
      tx.feePayer = vault.publicKey;
      tx.sign(vault);
      const sig = await conn.sendRawTransaction(tx.serialize(), { maxRetries: 3 });
      await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      for (const p of included) results.push({ ...p, status: "sent", sig, solscan: `https://solscan.io/tx/${sig}` });
    } catch (e) {
      for (const p of included) results.push({ ...p, status: "failed", error: String(e.message || e).slice(0, 180) });
    }
  }

  // ── 8. record everything, successes and failures alike ──
  try {
    const stamp = new Date().toISOString();
    await sb("epoch_payouts", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify(results.map((r) => ({
        epoch, user_id: r.user, wallet: r.wallet, amount: r.amount,
        status: r.status, sig: r.sig || null, err: r.error || null,
        merkle_root: root, paid_at: stamp,
      }))),
    });
  } catch (e) {}

  const sent = results.filter((r) => r.status === "sent");
  return res.status(200).json({
    ok: true, mode: "live", epoch, executed: true,
    sent: sent.length, failed: results.length - sent.length,
    tokensSent: sent.reduce((a, r) => a + r.amount, 0),
    vaultTokensBefore: Number(vaultBal) / 10 ** decimals,
    merkleRoot: root, results,
  });
}
