// VALO — /api/new : freshly launched Solana pools, newest first.
// This is the firehose the live scanner watches so new coins appear as they
// launch. Source: GeckoTerminal new_pools (keyless). Cached 15s.
const GT = "https://api.geckoterminal.com/api/v2";
const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };

export default async function handler(req, res) {
  try {
    const r = await fetch(`${GT}/networks/solana/new_pools?include=base_token&page=1`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`GT ${r.status}`);
    const j = await r.json();
    const meta = {};
    for (const inc of j.included || []) if (inc.type === "token") meta[inc.id] = inc.attributes || {};
    const out = [];
    for (const p of j.data || []) {
      const a = p.attributes || {};
      const m = meta[p.relationships?.base_token?.data?.id] || {};
      const price = parseFloat(a.base_token_price_usd) || 0;
      if (!(price > 0)) continue;
      const sym = (m.symbol || (a.name || "").split(" / ")[0] || "???").toUpperCase().slice(0, 12);
      const buys = a.transactions?.h24?.buys || 0, sells = a.transactions?.h24?.sells || 0;
      const vol = parseFloat(a.volume_usd?.h24) || 0, tot = Math.max(1, buys + sells);
      const created = a.pool_created_at ? Date.parse(a.pool_created_at) : null;
      out.push({
        id: a.address, mint: m.address || null, sym, name: m.name || sym,
        img: m.image_url && m.image_url !== "missing.png" ? m.image_url : null, hue: hueOf(sym),
        price, mc: parseFloat(a.market_cap_usd) || parseFloat(a.fdv_usd) || 0,
        tvl: parseFloat(a.reserve_in_usd) || 0,
        greenUsd: vol * (buys / tot), redUsd: vol * (sells / tot),
        ch24: parseFloat(a.price_change_percentage?.h24) || 0,
        traders: tot, buys24: buys, sells24: sells,
        createdAt: created, ageMin: created ? Math.max(0, Math.round((Date.now() - created) / 60000)) : null,
        launchpad: /pump$/i.test(m.address || "") ? "pump" : "solana",
      });
    }
    out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
