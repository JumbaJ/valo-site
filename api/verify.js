// VALO — /api/verify?pool=<pair>
// Side-by-side truth check: what VALO's own routes report vs what DexScreener
// reports for the same pool, right now. Any drift shows up as a percentage.
export default async function handler(req, res) {
  const pool = String(req.query.pool || "");
  if (!/^[A-Za-z0-9]{20,60}$/.test(pool)) return res.status(400).json({ error: "pass ?pool=<pair address>" });
  const out = { pool, checkedAt: new Date().toISOString() };
  try {
    // DexScreener — the reference
    const r = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pool}`, { headers: { accept: "application/json" } });
    const j = r.ok ? await r.json() : null;
    const p = (j && (j.pair || (j.pairs && j.pairs[0]))) || null;
    out.dexscreener = p ? {
      price: parseFloat(p.priceUsd) || null,
      marketCap: p.marketCap || p.fdv || null,
      liquidityUsd: (p.liquidity && p.liquidity.usd) || null,
      volume24h: (p.volume && p.volume.h24) || null,
      buys24: p.txns?.h24?.buys ?? null,
      sells24: p.txns?.h24?.sells ?? null,
      priceChange24h: p.priceChange?.h24 ?? null,
    } : { error: "pair not found" };

    // GeckoTerminal — what VALO's own routes are built on
    const r2 = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}`, { headers: { accept: "application/json" } });
    const j2 = r2.ok ? await r2.json() : null;
    const a = (j2 && j2.data && j2.data.attributes) || null;
    out.geckoterminal = a ? {
      price: parseFloat(a.base_token_price_usd) || null,
      marketCap: parseFloat(a.market_cap_usd) || parseFloat(a.fdv_usd) || null,
      liquidityUsd: parseFloat(a.reserve_in_usd) || null,
      volume24h: parseFloat(a.volume_usd?.h24) || null,
      buys24: a.transactions?.h24?.buys ?? null,
      sells24: a.transactions?.h24?.sells ?? null,
      priceChange24h: parseFloat(a.price_change_percentage?.h24) ?? null,
    } : { error: "pool not found" };

    // the drift between them, field by field
    const drift = {};
    const pct = (x, y) => (x > 0 && y > 0 ? +(((x - y) / y) * 100).toFixed(3) : null);
    for (const k of ["price", "marketCap", "liquidityUsd", "volume24h"]) {
      drift[k] = pct(out.geckoterminal?.[k], out.dexscreener?.[k]);
    }
    out.driftPercent = drift;
    out.verdict = Object.values(drift).every((d) => d == null || Math.abs(d) < 2)
      ? "in agreement (under 2% on every field)"
      : "check the fields with drift above 2%";
    res.setHeader("Cache-Control", "s-maxage=15");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
