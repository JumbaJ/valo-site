// VALO — /api/candles?pool=<address>&tf=<minutes>[&before=<unix seconds>]
// `before` walks backwards through history, which is how the chart loads more
// candles as you pan left — all the way to the pool's first trade.
const GT = "https://api.geckoterminal.com/api/v2";
const TF = (m) => (m >= 1440 ? ["day", 1] : m >= 60 ? ["hour", Math.max(1, Math.round(m / 60))] : ["minute", Math.max(1, m)]);

export default async function handler(req, res) {
  const pool = String(req.query.pool || "");
  const tf = parseInt(req.query.tf || "1", 10);
  const before = parseInt(req.query.before || "0", 10);
  if (!/^[A-Za-z0-9]{20,60}$/.test(pool)) return res.status(400).json({ error: "bad pool" });
  const [frame, agg] = TF(tf);
  try {
    let url = `${GT}/networks/solana/pools/${pool}/ohlcv/${frame}?aggregate=${agg}&limit=300&currency=usd`;
    if (before > 0) url += `&before_timestamp=${before}`;
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`GT ${r.status}`);
    const j = await r.json();
    const list = j?.data?.attributes?.ohlcv_list || [];
    const out = list
      .map(([t, o, h, l, c, v]) => ({ t: t * 1000, o: +o, h: +h, l: +l, c: +c, v: +v }))
      .sort((a, b) => a.t - b.t);
    // history pages can be cached hard — they never change
    res.setHeader("Cache-Control", before > 0 ? "s-maxage=600, stale-while-revalidate=1200" : "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
