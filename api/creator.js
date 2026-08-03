// 👤 who launched this token — the creator wallet, resolved from the chain.
// pump.fun tokens: the frontend API states the creator outright.
// anything else: Helius — the mint's first mint-to transaction's fee payer
// (the deployer). Cached hard: a token's creator never changes.
export default async function handler(req, res) {
  const mint = String(req.query.mint || "").trim();
  const wallet = String(req.query.wallet || "").trim();
  const short = (w) => `${w.slice(0, 4)}…${w.slice(-4)}`;

  // 🧪 launches mode: every token this wallet created (pump.fun catalog)
  if (wallet && !mint) {
    try {
      const r = await fetch(`https://frontend-api.pump.fun/coins/user-created-coins/${wallet}?offset=0&limit=50&includeNsfw=true`, {
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const j = await r.json();
        const arr = Array.isArray(j) ? j : (j && j.coins) || [];
        const launches = arr.map((c) => ({
          mint: c.mint, sym: c.symbol, name: c.name,
          createdAt: c.created_timestamp || null,
          mc: +c.usd_market_cap || 0,
          complete: !!c.complete,        // graduated to Raydium
          img: c.image_uri || null,
        }));
        res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=600");
        return res.status(200).json({ wallet, launches });
      }
    } catch (e) {}
    res.setHeader("Cache-Control", "s-maxage=120");
    return res.status(200).json({ wallet, launches: [] });
  }
  if (!mint) return res.status(400).json({ error: "mint or wallet required" });

  // 1) pump.fun knows its own launches
  try {
    const r = await fetch(`https://frontend-api.pump.fun/coins/${mint}`, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000),
    });
    if (r.ok) {
      const j = await r.json();
      if (j && j.creator) {
        res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
        return res.status(200).json({ creator: j.creator, short: short(j.creator),
          createdAt: j.created_timestamp || null, src: "pump" });
      }
    }
  } catch (e) {}

  // 2) Helius: earliest transaction touching the mint — its fee payer deployed it
  const key = process.env.HELIUS_API_KEY;
  if (key) {
    try {
      const r = await fetch(`https://api.helius.xyz/v0/addresses/${mint}/transactions?api-key=${key}&limit=100`, {
        signal: AbortSignal.timeout(6000),
      });
      if (r.ok) {
        const txs = await r.json();
        if (Array.isArray(txs) && txs.length) {
          const first = txs[txs.length - 1];   // API returns newest-first
          const payer = first.feePayer || null;
          if (payer) {
            res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800");
            return res.status(200).json({ creator: payer, short: short(payer),
              createdAt: (first.timestamp || 0) * 1000 || null, src: "helius" });
          }
        }
      }
    } catch (e) {}
  }

  res.setHeader("Cache-Control", "s-maxage=600");
  res.status(200).json({ creator: null });
}
