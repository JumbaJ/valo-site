// VALO — /api/candles?pool=<pair>&tf=<minutes>[&before=<unix s>][&mint=<mint>]
//
// Chart history, in priority order:
//   1. Birdeye  /defi/ohlcv/pair   — 35 CU per call, paid tier, reliable
//   2. GeckoTerminal               — free fallback if Birdeye is unset or fails
//
// The 5-minute edge cache means one call serves every user for 5 minutes, and
// the terminal's trade tape keeps the newest candle moving in between — so a
// longer cache costs nothing in liveness and keeps CU spend predictable.
const GT = "https://api.geckoterminal.com/api/v2";
const BE = "https://public-api.birdeye.so";

// Birdeye timeframe tokens
const BE_TF = (m) => (m >= 43200 ? "1M" : m >= 10080 ? "1W" : m >= 4320 ? "3D" : m >= 1440 ? "1D"
  : m >= 720 ? "12H" : m >= 480 ? "8H" : m >= 360 ? "6H" : m >= 240 ? "4H" : m >= 120 ? "2H"
  : m >= 60 ? "1H" : m >= 30 ? "30m" : m >= 15 ? "15m" : m >= 5 ? "5m" : m >= 3 ? "3m" : "1m");
const GT_TF = (m) => (m >= 1440 ? ["day", 1] : m >= 60 ? ["hour", Math.max(1, Math.round(m / 60))] : ["minute", Math.max(1, m)]);

// Keep every candle the market actually produced. A meme coin can legitimately
// run 1000× from launch, so filtering by "distance from the median" deletes real
// history and leaves gaps. Only structurally broken rows are dropped here; the
// chart's axis handles outliers by scaling to percentiles.
const clean = (rows) => rows
  .filter((c) => Number.isFinite(c.t) && [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0))
  .filter((c) => c.h >= c.l && c.h / c.l < 5000)         // impossible bar = broken data
  .sort((a, b) => a.t - b.t);

async function fromBirdeye(pool, tf, before, mint) {
  const key = (process.env.BIRDEYE_API_KEY || "").trim();
  if (!key) return [];
  const now = Math.floor(Date.now() / 1000);
  const to = before > 0 ? before : now;
  const from = to - tf * 60 * 300;                       // ~300 candles back
  // TOKEN endpoint = USD prices. PAIR endpoint = base/quote, which is a
  // different unit entirely — mixing the two is what spiked the last candle.
  const url = mint
    ? `${BE}/defi/ohlcv?address=${mint}&type=${BE_TF(tf)}&time_from=${from}&time_to=${to}`
    : `${BE}/defi/ohlcv/pair?address=${pool}&type=${BE_TF(tf)}&time_from=${from}&time_to=${to}`;
  const r = await fetch(url, { headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" } });
  if (!r.ok) throw new Error(`birdeye ${r.status}`);
  const j = await r.json();
  const items = j?.data?.items || j?.data || [];
  return clean(items.map((c) => ({
    t: (c.unixTime || c.time || 0) * 1000,
    o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +(c.v ?? c.volume ?? 0) || 0,
  })));
}

async function fromGecko(pool, tf, before) {
  const [frame, agg] = GT_TF(tf);
  let url = `${GT}/networks/solana/pools/${pool}/ohlcv/${frame}?aggregate=${agg}&limit=300&currency=usd`;
  if (before > 0) url += `&before_timestamp=${before}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`gecko ${r.status}`);
  const j = await r.json();
  return clean((j?.data?.attributes?.ohlcv_list || [])
    .map(([t, o, h, l, c, v]) => ({ t: t * 1000, o: +o, h: +h, l: +l, c: +c, v: +v })));
}

export default async function handler(req, res) {
  const pool = String(req.query.pool || "");
  const tf = parseInt(req.query.tf || "1", 10);
  const before = parseInt(req.query.before || "0", 10);
  if (!/^[A-Za-z0-9]{20,60}$/.test(pool)) return res.status(400).json({ error: "bad pool" });

  let rows = [], src = "none", note = "";
  const mint = String(req.query.mint || "");
  try { rows = await fromBirdeye(pool, tf, before, mint); if (rows.length) src = mint ? "birdeye-token" : "birdeye-pair"; }
  catch (e) { note = String(e.message || e); }
  if (rows.length < 3) {
    try { const g = await fromGecko(pool, tf, before); if (g.length > rows.length) { rows = g; src = "geckoterminal"; } }
    catch (e) { note = note ? note + " | " + e.message : String(e.message || e); }
  }

  res.setHeader("X-Valo-Source", src);
  if (note) res.setHeader("X-Valo-Note", note.slice(0, 120));
  // history pages never change; the live window refreshes every 5 minutes
  res.setHeader("Cache-Control", before > 0
    ? "s-maxage=86400, stale-while-revalidate=172800"
    : "s-maxage=300, stale-while-revalidate=600");
  res.status(200).json(rows);
}
