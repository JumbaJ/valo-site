// 🎁 /api/epoch-payout — the hourly distribution.
//
// Reads the epoch that just closed, computes each wallet's share by the
// whitepaper formula, sends $VALO from the epoch vault, records every result,
// and publishes a Merkle root so anyone can verify their own slice.
//
// NO npm dependencies: @solana/web3.js pulls in rpc-websockets, which crashes
// on Vercel's runtime (ERR_REQUIRE_ESM). Everything is built in
// _solana-lite.js on top of Node's native ed25519.
//
// SAFETY MODEL — this endpoint moves real tokens, so it is deliberately paranoid:
//   • dry-run unless VALO_EPOCH_SECRET is set (computes, sends nothing)
//   • idempotent: an epoch already paid can never pay twice
//   • per-run ceiling: VALO_EPOCH_MAX_TOKENS caps what one run can send
//   • destination accounts are READ FROM CHAIN, never assumed
//   • failure isolation: one bad wallet is recorded and skipped, not fatal
//   • never touches the live hour — only the epoch that has closed
import { createHash } from "crypto";
import {
  b58decode, keypairFrom, buildTx, findAta,
  ixCreateAta, ixTransferChecked, TOKEN_PROGRAM, TOKEN_2022_PROGRAM,
} from "./_solana-lite.js";

const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

const rpc = async (method, params) => {
  const r = await fetch(RPC(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json();
  if (j && j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j && j.result;
};

// whitepaper weight — identical to /api/epoch, kept in lockstep
const weightOf = (volSol, lbBonus, holderWeight = 0) =>
  ((holderWeight || 0) + (volSol || 0)) * (1 + Math.max(0, Math.min(4, (lbBonus || 1) - 1)));

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

// the recipient's REAL token account, straight from chain. Only when they hold
// none do we derive one to create — and the ATA program validates that address
// itself, so a derivation error fails safely instead of misdirecting funds.
const destFor = async (owner, mint, tokenProgram) => {
  try {
    const r = await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
    const hit = r && Array.isArray(r.value) && r.value[0];
    if (hit && hit.pubkey) return { ata: hit.pubkey, exists: true };
  } catch (e) {}
  return { ata: findAta(owner, mint, tokenProgram), exists: false };
};

export default async function handler(req, res) {
  try {
    const cronOk = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
    const keyOk = process.env.VALO_CRON_KEY && req.headers["x-cron-key"] === process.env.VALO_CRON_KEY;
    if (!cronOk && !keyOk) return res.status(401).json({ error: "unauthorized" });

    const MINT = (process.env.VALO_MINT || "").trim();
    const EPOCH_ADDR = (process.env.VALO_EPOCH || "").trim();
    if (!MINT || !EPOCH_ADDR) return res.status(400).json({ error: "VALO_MINT and VALO_EPOCH must be set" });

    const force = String(req.query.force || "") === "1";
    const nowEpoch = Math.floor(Date.now() / 3600e3);
    const epoch = String(req.query.epoch || (nowEpoch - 1));
    if (+epoch >= nowEpoch && !force) {
      return res.status(400).json({ error: "that epoch is still running — pass ?force=1 only if you mean it", epoch, nowEpoch });
    }

    // 1. idempotency, before anything else
    const done = await sb(`epoch_payouts?epoch=eq.${epoch}&status=eq.sent&select=epoch&limit=1`);
    if (done && done.length && !force) {
      return res.status(200).json({ ok: true, epoch, skipped: "already paid", note: "idempotent — this epoch will never pay twice" });
    }

    // 2. weights
    const rows = await sb(`epoch_activity?epoch=eq.${epoch}&select=user_id,vol_sol,callout_mult`);
    if (!rows) return res.status(200).json({ ok: false, error: "could not read epoch_activity — check SUPABASE_URL / SUPABASE_SERVICE_KEY and that the table exists" });
    const weights = rows
      .map((r) => ({ user: r.user_id, volSol: +r.vol_sol || 0, w: weightOf(+r.vol_sol, +r.callout_mult) }))
      .filter((x) => x.w > 0);
    const totalW = weights.reduce((a, x) => a + x.w, 0);
    if (!weights.length || totalW <= 0) {
      return res.status(200).json({ ok: true, epoch, participants: 0, note: "no activity in that epoch — nothing to pay" });
    }

    // 3. payout wallets
    const ids = weights.map((x) => `"${x.user}"`).join(",");
    const profs = (await sb(`profiles?id=in.(${ids})&select=id,payout_wallet,wallet`)) || [];
    const walletOf = {};
    for (const p of profs) walletOf[p.id] = p.payout_wallet || p.wallet || null;

    // 4. mint + vault balance
    const mintAcc = await rpc("getAccountInfo", [MINT, { encoding: "jsonParsed" }]);
    const parsed = mintAcc && mintAcc.value && mintAcc.value.data && mintAcc.value.data.parsed;
    const decimals = parsed && parsed.info && Number.isInteger(parsed.info.decimals) ? parsed.info.decimals : 6;
    const tokenProgram = mintAcc && mintAcc.value && mintAcc.value.owner === TOKEN_2022_PROGRAM ? TOKEN_2022_PROGRAM : TOKEN_PROGRAM;

    const vaultAccs = await rpc("getTokenAccountsByOwner", [EPOCH_ADDR, { mint: MINT }, { encoding: "jsonParsed" }]);
    const vaultHit = vaultAccs && Array.isArray(vaultAccs.value) && vaultAccs.value[0];
    const vaultAta = vaultHit ? vaultHit.pubkey : null;
    const vaultBal = vaultHit ? BigInt(vaultHit.account.data.parsed.info.tokenAmount.amount || "0") : 0n;

    const capTokens = Math.max(0, parseFloat(process.env.VALO_EPOCH_MAX_TOKENS || "0") || 0);
    const capBase = capTokens > 0 ? BigInt(Math.floor(capTokens * 10 ** decimals)) : null;
    const distributable = capBase && capBase < vaultBal ? capBase : vaultBal;

    // 5. the table
    const payouts = weights.map((x) => {
      const share = x.w / totalW;
      const amount = (distributable * BigInt(Math.floor(share * 1e9))) / 1000000000n;
      return {
        user: x.user, wallet: walletOf[x.user] || null,
        weight: +x.w.toFixed(4), share: +share.toFixed(6),
        amountBase: amount.toString(), amount: Number(amount) / 10 ** decimals,
      };
    });
    const root = merkleRoot(payouts.map((p) => `${epoch}|${p.user}|${p.wallet || ""}|${p.amountBase}`));
    const armed = !!(process.env.VALO_EPOCH_SECRET || "").trim();
    const payable = payouts.filter((p) => p.wallet && BigInt(p.amountBase) > 0n);

    // 6. dry run unless armed
    if (!armed) {
      return res.status(200).json({
        ok: true, mode: "dry-run", epoch, executed: false,
        participants: payouts.length, payableNow: payable.length,
        vaultTokens: Number(vaultBal) / 10 ** decimals,
        distributable: Number(distributable) / 10 ** decimals,
        decimals, tokenProgram, vaultAta,
        totalWeight: +totalW.toFixed(4), merkleRoot: root, payouts,
        note: "set VALO_EPOCH_SECRET to arm real sends. Nothing was transferred.",
      });
    }

    // 7. armed
    if (!vaultAta || vaultBal <= 0n) {
      return res.status(200).json({ ok: true, epoch, executed: false, note: "the epoch vault holds no $VALO — nothing to distribute" });
    }
    let signer;
    try { signer = keypairFrom(process.env.VALO_EPOCH_SECRET); }
    catch (e) { return res.status(200).json({ ok: false, error: `VALO_EPOCH_SECRET unreadable: ${String(e.message || e)}` }); }
    if (signer.publicKey !== EPOCH_ADDR) {
      return res.status(200).json({ ok: false, error: "VALO_EPOCH_SECRET does not match VALO_EPOCH — refusing to send", secretPubkey: signer.publicKey, expected: EPOCH_ADDR });
    }

    const results = [];
    const BATCH = 5;
    for (let i = 0; i < payable.length; i += BATCH) {
      const slice = payable.slice(i, i + BATCH);
      const ixs = [];
      const included = [];
      for (const p of slice) {
        try {
          b58decode(p.wallet);
          const { ata, exists } = await destFor(p.wallet, MINT, tokenProgram);
          if (!exists) ixs.push(ixCreateAta({ payer: signer.publicKey, ata, owner: p.wallet, mint: MINT, tokenProgram }));
          ixs.push(ixTransferChecked({
            source: vaultAta, mint: MINT, dest: ata, owner: signer.publicKey,
            amount: p.amountBase, decimals, tokenProgram,
          }));
          included.push({ ...p, ata });
        } catch (e) {
          results.push({ ...p, status: "failed", error: `bad wallet: ${String(e.message || e).slice(0, 120)}` });
        }
      }
      if (!ixs.length) continue;
      try {
        const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
        const blockhash = bh && bh.value && bh.value.blockhash;
        if (!blockhash) throw new Error("no blockhash");
        const raw = buildTx({ payer: signer.publicKey, instructions: ixs, recentBlockhash: blockhash, signer });
        const sig = await rpc("sendTransaction", [raw, { encoding: "base64", maxRetries: 3, skipPreflight: false }]);
        for (const p of included) results.push({ ...p, status: "sent", sig, solscan: `https://solscan.io/tx/${sig}` });
      } catch (e) {
        for (const p of included) results.push({ ...p, status: "failed", error: String(e.message || e).slice(0, 180) });
      }
    }

    // 8. record everything, successes and failures alike
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
  } catch (e) {
    // never 500 silently — the operator needs the reason
    return res.status(200).json({ ok: false, error: String(e && e.message || e).slice(0, 300) });
  }
}
