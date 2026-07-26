// VALO Phase 2 — /api/candles?pool=<address>&tf=<minutes> → [{t,o,h,l,c,v}]
// tf minutes → GeckoTerminal timeframe/aggregate. Edge-cached 30s.
const GT = "https://api.geckoterminal.com/api/v2";
const TF = (m) => (m >= 1440 ? ["day", 1] : m >= 60 ? ["hour", Math.max(1, Math.round(m / 60))] : ["minute", Math.max(1, m)]);

export default async function handler(req, res) {
  const pool = String(req.query.pool || "");
  const tf = parseInt(req.query.tf || "1", 10);
  if (!/^[A-Za-z0-9]{20,60}$/.test(pool)) return res.status(400).json({ error: "bad pool" });
  const [frame, agg] = TF(tf);
  try {
    const r = await fetch(`${GT}/networks/solana/pools/${pool}/ohlcv/${frame}?aggregate=${agg}&limit=300&currency=usd`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`GT ${r.status}`);
    const j = await r.json();
    const list = j?.data?.attributes?.ohlcv_list || [];
    const out = list
      .map(([t, o, h, l, c, v]) => ({ t: t * 1000, o: +o, h: +h, l: +l, c: +c, v: +v }))
      .sort((a, b) => a.t - b.t);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
