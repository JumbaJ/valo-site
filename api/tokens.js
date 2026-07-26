// VALO Phase 2 — /api/tokens : trending Solana pools → VALO token shape.
// Source: GeckoTerminal public API (no key). Edge-cached so all users share
// one upstream call per 20s window.
const GT = "https://api.geckoterminal.com/api/v2";

const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };

export default async function handler(req, res) {
  try {
    const r = await fetch(`${GT}/networks/solana/trending_pools?include=base_token&page=1`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`GT ${r.status}`);
    const j = await r.json();
    const tokMeta = {};
    for (const inc of j.included || []) {
      if (inc.type === "token") tokMeta[inc.id] = inc.attributes || {};
    }
    const out = [];
    for (const p of j.data || []) {
      const a = p.attributes || {};
      const baseId = p.relationships?.base_token?.data?.id;
      const meta = tokMeta[baseId] || {};
      const sym = (meta.symbol || (a.name || "").split(" / ")[0] || "???").toUpperCase().slice(0, 10);
      const price = parseFloat(a.base_token_price_usd) || 0;
      const vol24 = parseFloat(a.volume_usd?.h24) || 0;
      const buys = a.transactions?.h24?.buys || 0;
      const sells = a.transactions?.h24?.sells || 0;
      const txTotal = Math.max(1, buys + sells);
      out.push({
        id: a.address,                       // pool address = token id in live mode
        mint: meta.address || null,          // base token mint
        sym,
        name: meta.name || sym,
        img: meta.image_url && meta.image_url !== "missing.png" ? meta.image_url : null,
        hue: hueOf(sym),
        price,
        mc: parseFloat(a.market_cap_usd) || parseFloat(a.fdv_usd) || 0,
        tvl: parseFloat(a.reserve_in_usd) || 0,
        greenUsd: vol24 * (buys / txTotal),  // buy-side volume estimate from tx ratio
        redUsd: vol24 * (sells / txTotal),
        ch24: parseFloat(a.price_change_percentage?.h24) || 0,
        traders: txTotal,
        buys24: buys,
        sells24: sells,
      });
    }
    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
