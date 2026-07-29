// VALO — /api/chains : which networks can we actually get real data for?
// Open this on your site and it reports, live, whether GeckoTerminal and
// DexScreener index Robinhood Chain (and what id to use for it).
export default async function handler(req, res) {
  const out = { geckoterminal: { ok: false, solana: false, robinhood: null, sample: [] },
                dexscreener: { ok: false, chainIds: [] }, checkedAt: new Date().toISOString() };
  // ---- GeckoTerminal: list every network it indexes, look for Robinhood Chain
  try {
    const all = [];
    for (let page = 1; page <= 4; page++) {
      const r = await fetch(`https://api.geckoterminal.com/api/v2/networks?page=${page}`, { headers: { accept: "application/json" } });
      if (!r.ok) break;
      const j = await r.json();
      const rows = (j.data || []).map((d) => ({ id: d.id, name: (d.attributes && d.attributes.name) || "" }));
      all.push(...rows);
      if (!rows.length) break;
    }
    out.geckoterminal.ok = all.length > 0;
    out.geckoterminal.count = all.length;
    out.geckoterminal.solana = all.some((n) => n.id === "solana");
    const rh = all.filter((n) => /robin|rhc|4663/i.test(n.id + " " + n.name));
    out.geckoterminal.robinhood = rh.length ? rh : null;
    out.geckoterminal.sample = all.slice(0, 8);
  } catch (e) { out.geckoterminal.error = String(e.message || e); }
  // ---- DexScreener: which chains show up for a broad query
  try {
    const r = await fetch("https://api.dexscreener.com/latest/dex/search?q=usdc", { headers: { accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      const ids = [...new Set((j.pairs || []).map((p) => p.chainId).filter(Boolean))];
      out.dexscreener.ok = true;
      out.dexscreener.chainIds = ids.slice(0, 40);
      out.dexscreener.robinhoodLike = ids.filter((c) => /robin|rhc/i.test(c));
    }
  } catch (e) { out.dexscreener.error = String(e.message || e); }
  res.setHeader("Cache-Control", "s-maxage=300");
  res.status(200).json(out);
}
