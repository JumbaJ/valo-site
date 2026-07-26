// VALO Phase 2 — /api/trades?pool=<address> → recent real trades for the
// live-trades feed: [{ at, isBuy, usd, price, trader, tx }]. Edge-cached 10s.
const GT = "https://api.geckoterminal.com/api/v2";

export default async function handler(req, res) {
  const pool = String(req.query.pool || "");
  if (!/^[A-Za-z0-9]{20,60}$/.test(pool)) return res.status(400).json({ error: "bad pool" });
  try {
    const r = await fetch(`${GT}/networks/solana/pools/${pool}/trades`, {
      headers: { accept: "application/json" },
    });
    if (!r.ok) throw new Error(`GT ${r.status}`);
    const j = await r.json();
    const out = (j.data || []).map((t) => {
      const a = t.attributes || {};
      const w = a.tx_from_address || "";
      return {
        at: Date.parse(a.block_timestamp) || Date.now(),
        isBuy: a.kind === "buy",
        usd: parseFloat(a.volume_in_usd) || 0,
        price: parseFloat(a.price_to_in_usd) || parseFloat(a.price_from_in_usd) || 0,
        trader: w ? `${w.slice(0, 4)}…${w.slice(-4)}` : "unknown",
        wallet: w,
        tx: a.tx_hash || "",
      };
    });
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
    res.status(200).json(out);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
