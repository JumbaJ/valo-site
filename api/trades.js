// VALO — /api/trades?pool=<address> → real trades for the tape and the
// live-trades feed: [{ at, isBuy, usd, price, trader, tx }]
//
// PRICE SELECTION MATTERS: a pool trade has two sides. On a buy the token is
// what's being received (price_to_*); on a sell it's what's being given
// (price_from_*). Always taking `to` meant every sell reported SOL's price
// (~$75–200) instead of the token's — which wrecked any chart built from it.
const GT = "https://api.geckoterminal.com/api/v2";

export default async function handler(req, res) {
  const pool = String(req.query.pool || "");
  if (!/^[A-Za-z0-9]{20,60}$/.test(pool)) return res.status(400).json({ error: "bad pool" });
  try {
    const r = await fetch(`${GT}/networks/solana/pools/${pool}/trades`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`GT ${r.status}`);
    const j = await r.json();
    const raw = (j.data || []).map((t) => {
      const a = t.attributes || {};
      const isBuy = a.kind === "buy";
      // the TOKEN side of the trade, never the SOL side
      const tokenPrice = isBuy
        ? parseFloat(a.price_to_in_usd)
        : parseFloat(a.price_from_in_usd);
      const other = isBuy ? parseFloat(a.price_from_in_usd) : parseFloat(a.price_to_in_usd);
      const w = a.tx_from_address || "";
      return {
        at: Date.parse(a.block_timestamp) || Date.now(),
        isBuy,
        usd: parseFloat(a.volume_in_usd) || 0,
        price: Number.isFinite(tokenPrice) && tokenPrice > 0 ? tokenPrice : 0,
        quotePrice: Number.isFinite(other) ? other : null,
        trader: w ? `${w.slice(0, 4)}…${w.slice(-4)}` : "unknown",
        wallet: w,
        tx: a.tx_hash || "",
      };
    }).filter((x) => x.price > 0);

    // last defence: drop any print more than 25× off the median token price
    if (raw.length > 4) {
      const sorted = [...raw].map((x) => x.price).sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)];
      if (med > 0) {
        for (let i = raw.length - 1; i >= 0; i--) {
          const p = raw[i].price;
          if (p > med * 25 || p < med / 25) raw.splice(i, 1);
        }
      }
    }

    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
    res.status(200).json(raw);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
