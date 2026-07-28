// VALO — /api/search?q=<name | symbol | mint | pair>
// Searches the whole Solana market (every pump.fun / Robinhood-chain token
// DexScreener indexes), not just what's loaded in the scanner. Keyless.
const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };

export default async function handler(req, res) {
  const q = String(req.query.q || "").trim();
  if (q.length < 2) return res.status(200).json([]);
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`ds ${r.status}`);
    const j = await r.json();
    const out = (j.pairs || [])
      .filter((p) => p.chainId === "solana" && p.priceUsd && +p.priceUsd > 0)
      .sort((a, b) => ((b.volume && b.volume.h24) || 0) - ((a.volume && a.volume.h24) || 0))
      .slice(0, 30)
      .map((p) => {
        const base = p.baseToken || {};
        const sym = (base.symbol || "???").toUpperCase().slice(0, 12);
        const buys = (p.txns && p.txns.h24 && p.txns.h24.buys) || 0;
        const sells = (p.txns && p.txns.h24 && p.txns.h24.sells) || 0;
        const vol = (p.volume && p.volume.h24) || 0;
        const tot = Math.max(1, buys + sells);
        return {
          id: p.pairAddress, mint: base.address || null, sym, name: base.name || sym,
          img: (p.info && p.info.imageUrl) || null, hue: hueOf(sym),
          price: +p.priceUsd, mc: p.marketCap || p.fdv || 0,
          tvl: (p.liquidity && p.liquidity.usd) || 0,
          greenUsd: vol * (buys / tot), redUsd: vol * (sells / tot),
          ch24: (p.priceChange && p.priceChange.h24) || 0,
          traders: tot, buys24: buys, sells24: sells,
          dex: p.dexId || null,
          launchpad: /pump$/i.test(base.address || "") ? "pump" : (p.dexId || "").toLowerCase().includes("meteora") ? "meteora" : "rh",
          createdAt: p.pairCreatedAt || null,
        };
      });
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
