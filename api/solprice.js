import { cors } from "./_cors.js";
// VALO — /api/solprice : the live SOL/USD price.
// Every dollar figure on the site converts through this, so it must be real.
// Source: the deepest SOL/USDC pool on DexScreener, with CoinGecko as a check.
export default async function handler(req, res) {
  if (cors(req, res)) return;
  let price = null, src = null;
  // 1) deepest SOL/USDC pair — same data the charts price against
  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/tokens/So11111111111111111111111111111111111111112",
      { headers: { accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      let best = 0;
      for (const p of j.pairs || []) {
        if (p.chainId !== "solana") continue;
        const q = (p.quoteToken && p.quoteToken.symbol || "").toUpperCase();
        if (!["USDC", "USDT"].includes(q)) continue;
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        const px = parseFloat(p.priceUsd) || 0;
        if (px > 0 && liq > best) { best = liq; price = px; src = "dexscreener"; }
      }
    }
  } catch (e) {}
  // 2) fallback
  if (!(price > 0)) {
    try {
      const r2 = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        { headers: { accept: "application/json" } });
      if (r2.ok) {
        const j2 = await r2.json();
        const px = j2?.solana?.usd;
        if (px > 0) { price = px; src = "coingecko"; }
      }
    } catch (e) {}
  }
  if (!(price > 0)) return res.status(502).json({ error: "no sol price" });
  res.setHeader("Cache-Control", "s-maxage=45, stale-while-revalidate=120");
  res.status(200).json({ price, source: src, at: Date.now() });
}
