// VALO — /api/tokens[?page=N&feed=trending|new|top] : Solana pools → VALO shape.
// Multiple feeds keep the scanner ENDLESS and FRESH (new pairs, not the same
// trending set forever). The client rotates feeds as it paginates.
const GT = "https://api.geckoterminal.com/api/v2";
const hueOf = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };

const FEEDS = {
  // freshest launches — this is what makes new tokens "pop up"
  new: (pg) => `${GT}/networks/solana/new_pools?include=base_token&page=${pg}`,
  // biggest by volume/liquidity — deeper catalog than trending
  top: (pg) => `${GT}/networks/solana/pools?include=base_token&page=${pg}&sort=h24_volume_usd_desc`,
  trending: (pg) => `${GT}/networks/solana/trending_pools?include=base_token&page=${pg}`,
};

export default async function handler(req, res) {
  const page = Math.max(1, Math.min(10, parseInt(req.query.page || "1", 10) || 1));
  const feed = FEEDS[String(req.query.feed || "trending")] ? String(req.query.feed) : "trending";
  // 🔄 multi-pool price refresh: ?pools=a,b,c → same token shape for exactly
  // those pools. Keeps watchlists and adopted cards live without full feeds.
  const pools = String(req.query.pools || "").trim();
  try {
    const r = await fetch(pools
      ? `${GT}/networks/solana/pools/multi/${encodeURIComponent(pools.split(",").slice(0, 30).join(","))}?include=base_token`
      : FEEDS[feed](page), {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`GT ${r.status}`);
    const j = await r.json();
    const tokMeta = {};
    for (const inc of j.included || []) if (inc.type === "token") tokMeta[inc.id] = inc.attributes || {};
    const out = [];
    for (const p of j.data || []) {
      const a = p.attributes || {};
      const meta = tokMeta[p.relationships?.base_token?.data?.id] || {};
      const sym = (meta.symbol || (a.name || "").split(" / ")[0] || "???").toUpperCase().slice(0, 10);
      const price = parseFloat(a.base_token_price_usd) || 0;
      const vol24 = parseFloat(a.volume_usd?.h24) || 0;
      const buys24 = a.transactions?.h24?.buys || 0, sells24 = a.transactions?.h24?.sells || 0;
      const created = a.pool_created_at ? Date.parse(a.pool_created_at) : null;

      // shortest window with real activity: 5m → 1h → 24h. (GT reports volume
      // for m5/h1/h6/h24 and transactions for m5/m15/m30/h1/h24.)
      const windows = [
        ["5m",  a.transactions?.m5,  parseFloat(a.volume_usd?.m5)  || 0, parseFloat(a.price_change_percentage?.m5)  || 0],
        ["1h",  a.transactions?.h1,  parseFloat(a.volume_usd?.h1)  || 0, parseFloat(a.price_change_percentage?.h1)  || 0],
        ["24h", a.transactions?.h24, vol24,                              parseFloat(a.price_change_percentage?.h24) || 0],
      ];
      let win = windows[windows.length - 1];
      for (const w of windows) {
        const tx = (w[1]?.buys || 0) + (w[1]?.sells || 0);
        if (tx > 0 && w[2] > 0) { win = w; break; }
      }
      const [statWin, winTx, winVol, winCh] = win;
      const buys = winTx?.buys || 0, sells = winTx?.sells || 0;
      const txTotal = Math.max(1, buys + sells);

      out.push({
        id: a.address, mint: meta.address || null, sym, name: meta.name || sym,
        img: meta.image_url && meta.image_url !== "missing.png" ? meta.image_url : null,
        hue: hueOf(sym), price,
        mc: (() => {
          const mc0 = parseFloat(a.market_cap_usd) || parseFloat(a.fdv_usd) || 0;
          const mint0 = meta.address || null;
          // pump tokens: fixed 1B supply - feed FDV far above price*1B is junk
          if (mint0 && /pump$/i.test(mint0) && price > 0 && (mc0 <= 0 || mc0 > price * 1e9 * 3)) return price * 1e9;
          return mc0;
        })(),
        tvl: parseFloat(a.reserve_in_usd) || 0,
        // the card's flow stats — from the SHORT window, so they actually move
        greenUsd: winVol * (buys / txTotal), redUsd: winVol * (sells / txTotal),
        statWin, ch: winCh, buys, sells,
        vol24,
        ch24: parseFloat(a.price_change_percentage?.h24) || 0,
        traders: buys + sells || (buys24 + sells24), buys24, sells24,
        createdAt: created,
        launchpad: /pump$/i.test(meta.address || "") ? "pump" : "solana",
        page, feed,
      });
    }
    // one row per TOKEN (a big token has many pools) + drop broken FDV rows
    const seenMint = new Set();
    const deduped = [];
    for (const t of out) {
      if ((+t.mc || 0) > 1e11) continue;
      const k = t.mint || t.id;
      if (seenMint.has(k)) continue;
      seenMint.add(k);
      deduped.push(t);
    }
    out.length = 0; out.push(...deduped);
    res.setHeader("Cache-Control", pools ? "s-maxage=10, stale-while-revalidate=30" : feed === "new" ? "s-maxage=8, stale-while-revalidate=20" : "s-maxage=15, stale-while-revalidate=45");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
