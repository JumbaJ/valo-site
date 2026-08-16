// 🧑‍🤝‍🧑 real holder counts + pump.fun stats for a batch of mints.
// GeckoTerminal doesn't expose holders; pump.fun's public frontend API does,
// and for graduated tokens Helius can count token accounts. We try pump.fun
// first (fast, has live-ish holder + reply counts), fall back to Helius.
const PUMP = "https://frontend-api.pump.fun/coins";

async function pumpStats(mint) {
  try {
    const r = await fetch(`${PUMP}/${mint}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || typeof j !== "object") return null;
    return {
      holders: Number.isFinite(+j.holder_count) ? +j.holder_count : null,
      // pump.fun exposes reply/comment counts; not a viewer count, but a real
      // live-engagement signal we can show honestly as "pump.fun activity"
      replies: Number.isFinite(+j.reply_count) ? +j.reply_count : null,
      mc: Number.isFinite(+j.usd_market_cap) ? +j.usd_market_cap : null,
      graduated: !!j.complete,
    };
  } catch (e) { return null; }
}

async function heliusHolders(mint) {
  const key = process.env.HELIUS_API_KEY;
  if (!key) return null;
  try {
    // count token accounts holding a non-zero balance
    let holders = 0, cursor = undefined, pages = 0, capped = false;
    do {
      const body = { jsonrpc: "2.0", id: "h", method: "getTokenAccounts",
        params: { mint, limit: 1000, ...(cursor ? { cursor } : {}) } };
      const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(9000) });
      const j = await r.json();
      const accts = (j && j.result && j.result.token_accounts) || [];
      holders += accts.filter((a) => +a.amount > 0).length;
      cursor = j && j.result && j.result.cursor;
      pages++;
    } while (cursor && pages < 6);   // cap ~6k accounts, enough for a count badge
    if (cursor) capped = true;       // budget exhausted mid-scan: this is a FLOOR, not a count
    return holders > 0 ? { n: holders, capped } : null;
  } catch (e) { return null; }
}

export default async function handler(req, res) {
  const mintsParam = String(req.query.mints || req.query.mint || "").trim();
  if (!mintsParam) return res.status(400).json({ error: "no mints" });
  const mints = mintsParam.split(",").map((m) => m.trim()).filter(Boolean).slice(0, 30);

  const out = {};
  await Promise.all(mints.map(async (mint) => {
    const p = await pumpStats(mint);
    let holders = p && p.holders;
    let holdersFloor = false;
    // the chain's own supply, decimals included - the truth anchor for pairs
    // whose stream-derived numbers carry the wrong decimal assumption
    let supplyUi = null;
    try {
      const key = process.env.HELIUS_API_KEY;
      if (key) {
        const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${key}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "s", method: "getTokenSupply", params: [mint] }),
          signal: AbortSignal.timeout(8000) });
        const j = await r.json();
        const v = j && j.result && j.result.value;
        if (v && Number.isFinite(+v.uiAmount)) supplyUi = +v.uiAmount;
      }
    } catch (e) {}
    if (!(holders > 0)) {
      const h = await heliusHolders(mint);
      if (h) { holders = h.n; holdersFloor = !!h.capped; }
    }
    out[mint] = {
      holders: holders > 0 ? holders : null,
      holdersFloor,
      supplyUi,
      replies: p ? p.replies : null,
      graduated: p ? p.graduated : null,
    };
  }));

  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
  res.status(200).json(out);
}
