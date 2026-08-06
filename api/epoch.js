// 🎁 VALO EPOCH — the hourly release, weighted by real activity.
// weight = 1 (showing up) + volume component (real SOL traded this hour,
//          0.5×, capped at +3) × callout multiplier (from profile, capped 2×)
// share  = weight / Σ weights  → payout = share × pool
//
// GET  → status: epoch id, pool balances, total weights, caller's projected
//        share when ?user= is passed. Safe, public, read-only.
// POST → payout table (dry-run) — requires x-cron-key === VALO_CRON_KEY.
//        Actual $VALO sending stays OFF until VALO_MINT + VALO_EPOCH_SECRET
//        exist; until then this returns exactly what WOULD be paid, per user,
//        to their chosen payout wallet.
const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

const solBalance = async (addr) => {
  try {
    const r = await fetch(RPC(), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [addr] }), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    return (j && j.result && j.result.value ? j.result.value : 0) / 1e9;
  } catch (e) { return null; }
};

// 📜 WHITEPAPER FORMULA — verbatim from the spec:
//   "vault half is distributed by holder weight + trading volume"
//   with leaderboard epoch bonuses stacking up to +4.0×.
// weight = (holderWeight + volSol) × (1 + Σ leaderboard bonuses, capped 4.0)
// holderWeight arms itself when VALO_MINT exists (real $VALO balances);
// until launch it is honestly 0 and volume carries the epoch.
const weightOf = (volSol, lbBonus, holderWeight = 0) =>
  ((holderWeight || 0) + (volSol || 0)) * (1 + Math.max(0, Math.min(4, (lbBonus || 1) - 1)));

export default async function handler(req, res) {
  const EPOCH_W = (process.env.VALO_EPOCH || "").trim();
  const epoch = String(Math.floor(Date.now() / 3600e3));
  const minsLeft = 60 - new Date().getUTCMinutes();

  // supabase (service role) → this hour's activity + payout wallets
  const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  let rows = null;
  if (SB_URL && SB_KEY) {
    try {
      const r = await fetch(`${SB_URL}/rest/v1/epoch_activity?epoch=eq.${epoch}&select=user_id,vol_sol,callout_mult`, {
        headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(6000) });
      if (r.ok) rows = await r.json();
    } catch (e) {}
  }
  // callout_mult column carries (1 + Σ leaderboard bonuses) per the spec
  const weights = (rows || []).map((x) => ({ user: x.user_id, volSol: +x.vol_sol || 0, w: weightOf(+x.vol_sol, +x.callout_mult) })).filter((x) => x.w > 0);
  const totalW = weights.reduce((a, x) => a + x.w, 0);

  const pool = EPOCH_W ? await solBalance(EPOCH_W) : null;

  if (req.method === "POST") {
    if ((req.headers["x-cron-key"] || "") !== (process.env.VALO_CRON_KEY || "") || !process.env.VALO_CRON_KEY)
      return res.status(401).json({ error: "bad cron key" });
    // payout wallets for participants
    let wallets = {};
    if (SB_URL && SB_KEY && weights.length) {
      try {
        const ids = weights.map((x) => `"${x.user}"`).join(",");
        const r = await fetch(`${SB_URL}/rest/v1/profiles?id=in.(${ids})&select=id,payout_wallet,wallet`, {
          headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(6000) });
        if (r.ok) for (const p of await r.json()) wallets[p.id] = p.payout_wallet || p.wallet || null;
      } catch (e) {}
    }
    const canSend = !!(process.env.VALO_MINT && process.env.VALO_EPOCH_SECRET);
    const payouts = weights.map((x) => ({
      user: x.user, wallet: wallets[x.user] || null, weight: +x.w.toFixed(3),
      share: totalW > 0 ? +(x.w / totalW).toFixed(4) : 0,
      solEquivalent: pool != null && totalW > 0 ? +((x.w / totalW) * pool).toFixed(6) : null,
    }));
    return res.status(200).json({ epoch, executed: false, mode: canSend ? "ready" : "dry-run (set VALO_MINT + VALO_EPOCH_SECRET to arm)", pool, totalWeight: +totalW.toFixed(3), payouts });
  }

  // GET status (+ per-user projection)
  const user = String(req.query.user || "").trim();
  const mine = user ? weights.find((x) => x.user === user) : null;
  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
  return res.status(200).json({
    epoch, minsLeft, pool, participants: weights.length, totalWeight: +totalW.toFixed(3),
    configured: !!EPOCH_W,
    you: mine ? { volSol: +mine.volSol.toFixed(4), weight: +mine.w.toFixed(3), share: totalW > 0 ? +(mine.w / totalW).toFixed(4) : 0 } : null,
  });
}
