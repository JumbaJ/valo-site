// 🎁 VALO EPOCH — the hourly release, weighted by real activity.
// weight = (holderWeight + volSol) × (1 + Σ leaderboard bonuses, capped +4.0)
// — see weightOf below; this comment previously described an older formula
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

// The vault pays $VALO, so the pool the panel advertises must be $VALO. It was
// reporting the vault's SOL balance — a different asset entirely, which also
// made every projected share wrong.
const tokenBalance = async (owner, mint) => {
  if (!owner || !mint) return null;
  try {
    const r = await fetch(RPC(), { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }] }), signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    const hit = j && j.result && Array.isArray(j.result.value) && j.result.value[0];
    if (!hit) return 0;
    return +hit.account.data.parsed.info.tokenAmount.uiAmount || 0;
  } catch (e) { return null; }
};

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

  const MINT = (process.env.VALO_MINT || "").trim();
  const poolSol = EPOCH_W ? await solBalance(EPOCH_W) : null;      // gas, not the prize
  const vaultTokens = EPOCH_W && MINT ? await tokenBalance(EPOCH_W, MINT) : null;
  // epoch-payout sends min(cap, balance) — advertise the same number, or the
  // panel promises more than a run can pay
  const capTokens = Math.max(0, parseFloat(process.env.VALO_EPOCH_MAX_TOKENS || "0") || 0);
  const pool = vaultTokens == null ? null
    : (capTokens > 0 ? Math.min(capTokens, vaultTokens) : vaultTokens);

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
      amount: pool != null && totalW > 0 ? +((x.w / totalW) * pool).toFixed(6) : null,
    }));
    return res.status(200).json({ epoch, executed: false, mode: canSend ? "ready" : "dry-run (set VALO_MINT + VALO_EPOCH_SECRET to arm)",
      pool, poolUnit: "VALO", vaultTokens, capTokens: capTokens || null, poolSol, totalWeight: +totalW.toFixed(3), payouts });
  }

  // GET status (+ per-user projection)
  // req.query is not always populated here — fall back to the raw URL so the
  // per-user projection never silently returns null.
  let user = String((req.query && req.query.user) || "").trim();
  if (!user) {
    try { user = (new URL(req.url, "http://x").searchParams.get("user") || "").trim(); }
    catch (e) { user = ""; }
  }
  const mine = user ? weights.find((x) => x.user === user) : null;
  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
  return res.status(200).json({
    epoch, minsLeft, pool, poolUnit: "VALO", vaultTokens, capTokens: capTokens || null,
    poolSol, participants: weights.length, totalWeight: +totalW.toFixed(3),
    configured: !!EPOCH_W,
    // a null balance means the RPC read FAILED — it does not mean the vault is
    // empty. Without this the two are indistinguishable, which is exactly how
    // an expired Helius key went unnoticed while payouts quietly failed.
    rpcOk: !(EPOCH_W && (vaultTokens === null || poolSol === null)),
    alert: (EPOCH_W && (vaultTokens === null || poolSol === null))
      ? "chain read failed — balances unknown, not zero. Check the RPC provider."
      : null,
    // the vault pays rent for recipients who don't hold $VALO yet (~0.002 each)
    gasOk: poolSol == null ? null : poolSol >= 0.01,
    you: mine ? { volSol: +mine.volSol.toFixed(4), weight: +mine.w.toFixed(3),
      share: totalW > 0 ? +(mine.w / totalW).toFixed(4) : 0,
      amount: pool != null && totalW > 0 ? +((mine.w / totalW) * pool).toFixed(4) : null } : null,
  });
}
