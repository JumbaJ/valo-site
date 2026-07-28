// VALO — /api/candles?pool=<address>&tf=<minutes>[&before=<unix s>][&mint=<mint>]
//
// Chart data, in priority order:
//   1. GeckoTerminal  — official free OHLCV, covers most listed pools
//   2. Birdeye        — catches brand-new launches GT hasn't indexed yet
//                       (only used when BIRDEYE_API_KEY is set in Vercel)
// DexScreener is deliberately NOT used here: they publish pair stats, not a
// public candles API, so we take price/liquidity/socials from them elsewhere
// and leave charting to the sources that license it.
const GT = "https://api.geckoterminal.com/api/v2";
const TF = (m) => (m >= 1440 ? ["day", 1] : m >= 60 ? ["hour", Math.max(1, Math.round(m / 60))] : ["minute", Math.max(1, m)]);
const BE_TF = (m) => (m >= 1440 ? "1D" : m >= 240 ? "4H" : m >= 60 ? "1H" : m >= 30 ? "30m" : m >= 15 ? "15m" : m >= 5 ? "5m" : "1m");

async function fromGecko(pool, tf, before) {
  const [frame, agg] = TF(tf);
  let url = `${GT}/networks/solana/pools/${pool}/ohlcv/${frame}?aggregate=${agg}&limit=300&currency=usd`;
  if (before > 0) url += `&before_timestamp=${before}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.data?.attributes?.ohlcv_list || [])
    .map(([t, o, h, l, c, v]) => ({ t: t * 1000, o: +o, h: +h, l: +l, c: +c, v: +v }));
}

async function fromBirdeye(mint, tf, before) {
  const key = process.env.BIRDEYE_API_KEY;
  if (!key || !mint) return [];
  const now = Math.floor(Date.now() / 1000);
  const to = before > 0 ? before : now;
  const from = to - tf * 60 * 300;                       // 300 candles back
  const url = `https://public-api.birdeye.so/defi/ohlcv?address=${mint}&type=${BE_TF(tf)}&time_from=${from}&time_to=${to}`;
  const r = await fetch(url, { headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" } });
  if (!r.ok) return [];
  const j = await r.json();
  return (j?.data?.items || []).map((c) => ({ t: (c.unixTime || 0) * 1000, o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +c.v || 0 }));
}

export default async function handler(req, res) {
  const pool = String(req.query.pool || "");
  const mint = String(req.query.mint || "");
  const tf = parseInt(req.query.tf || "1", 10);
  const before = parseInt(req.query.before || "0", 10);
  if (!/^[A-Za-z0-9]{20,60}$/.test(pool)) return res.status(400).json({ error: "bad pool" });
  try {
    let rows = [];
    let src = "geckoterminal";
    try { rows = await fromGecko(pool, tf, before); } catch (e) { rows = []; }
    if (rows.length < 5) {                                // not indexed yet → try the catcher
      try {
        const be = await fromBirdeye(mint, tf, before);
        if (be.length > rows.length) { rows = be; src = "birdeye"; }
      } catch (e) {}
    }
    const out = rows
      .filter((c) => [c.o, c.h, c.l, c.c].every((v) => Number.isFinite(v) && v > 0))
      .sort((a, b) => a.t - b.t);
    res.setHeader("X-Valo-Source", src);
    res.setHeader("Cache-Control", before > 0 ? "s-maxage=600, stale-while-revalidate=1200" : "s-maxage=30, stale-while-revalidate=60");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
