// VALO — /api/tokeninfo?mint=<token mint>[&pool=<pair>]
// Returns the token's official links (site, X, telegram, discord) plus the
// canonical pages to open it on. Source: DexScreener (keyless). Cached 5 min.
export default async function handler(req, res) {
  const mint = String(req.query.mint || "");
  const pool = String(req.query.pool || "");
  if (!/^[A-Za-z0-9]{20,60}$/.test(mint)) return res.status(400).json({ error: "bad mint" });
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`ds ${r.status}`);
    const j = await r.json();
    const pairs = (j.pairs || []).filter((p) => p.chainId === "solana");
    const pair = pairs.find((p) => p.pairAddress === pool) || pairs[0] || null;
    const info = (pair && pair.info) || {};
    const socials = {};
    for (const s of info.socials || []) {
      const ty = String(s.type || s.platform || "").toLowerCase();
      if (ty && s.url && !socials[ty]) socials[ty] = s.url;
    }
    const sites = (info.websites || []).map((w) => (typeof w === "string" ? w : w.url)).filter(Boolean);
    const isPump = /pump$/i.test(mint);
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    res.status(200).json({
      mint,
      name: (pair && pair.baseToken && pair.baseToken.name) || null,
      sym: (pair && pair.baseToken && pair.baseToken.symbol) || null,
      img: info.imageUrl || null,
      websites: sites,
      socials,                                   // { twitter, telegram, discord, ... }
      links: {
        dexscreener: pair ? `https://dexscreener.com/solana/${pair.pairAddress}` : `https://dexscreener.com/solana/${mint}`,
        pumpfun: isPump ? `https://pump.fun/coin/${mint}` : null,
        solscan: `https://solscan.io/token/${mint}`,
        jupiter: `https://jup.ag/swap/SOL-${mint}`,
      },
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
