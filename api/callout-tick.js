// VALO — always-on callout scoring.
// Runs on a schedule (Vercel cron or any external pinger). For every open
// callout it reads the pool's CURRENT market cap and raises peak_mult whenever
// the market made a new high — so a 3am run is captured even with nobody online.
//
// Required env vars (set in Vercel → Settings → Environment Variables):
//   SUPABASE_URL           https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE  the service_role key  ← SECRET. Never commit or share it.
//   CRON_SECRET            any long random string you invent (protects this route)
const GT = "https://api.geckoterminal.com/api/v2";
const WINDOW_DAYS = 400;   // callouts older than this stop being scored
const MAX_ROWS = 600;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.authorization || "";
  const given = req.query.key || auth.replace(/^Bearer\s+/i, "");
  if (secret && given !== secret) return res.status(401).json({ error: "unauthorized" });

  const SB = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE;
  if (!SB || !KEY) return res.status(500).json({ error: "supabase env vars missing" });
  const sbHeaders = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

  try {
    // 1. open callouts worth scoring
    const since = new Date(Date.now() - WINDOW_DAYS * 86400e3).toISOString();
    const r = await fetch(
      `${SB}/rest/v1/callouts?select=id,token_key,mc_at,peak_mult&ts=gte.${since}&order=ts.desc&limit=${MAX_ROWS}`,
      { headers: sbHeaders }
    );
    if (!r.ok) throw new Error(`supabase read ${r.status}`);
    const rows = await r.json();
    if (!rows.length) return res.status(200).json({ scanned: 0, updated: 0 });

    // 2. current market cap per pool — batched 25 at a time
    const pools = [...new Set(rows.map((x) => String(x.token_key)).filter((p) => /^[A-Za-z0-9]{20,60}$/.test(p)))];
    const mcByPool = {};
    for (let i = 0; i < pools.length; i += 25) {
      const batch = pools.slice(i, i + 25);
      try {
        const g = await fetch(`${GT}/networks/solana/pools/multi/${batch.join(",")}`, { headers: { accept: "application/json" } });
        if (!g.ok) continue;
        const j = await g.json();
        for (const p of j.data || []) {
          const a = p.attributes || {};
          const mc = parseFloat(a.market_cap_usd) || parseFloat(a.fdv_usd) || 0;
          if (a.address && mc > 0) mcByPool[a.address] = mc;
        }
      } catch (e) { /* skip this batch */ }
    }

    // 3. raise peaks that the market actually beat
    let updated = 0;
    for (const row of rows) {
      const mc = mcByPool[String(row.token_key)];
      const base = +row.mc_at || 0;
      if (!mc || !base) continue;
      const mult = mc / base;
      if (mult > (+row.peak_mult || 1) + 0.001) {
        const u = await fetch(`${SB}/rest/v1/callouts?id=eq.${row.id}`, {
          method: "PATCH",
          headers: { ...sbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ peak_mult: +mult.toFixed(3), peak_mc: Math.round(mc), updated_at: new Date().toISOString() }),
        });
        if (u.ok) updated++;
      }
    }
    res.status(200).json({ scanned: rows.length, pools: pools.length, priced: Object.keys(mcByPool).length, updated });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
