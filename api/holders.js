// VALO — /api/holders?mint=<token mint>&price=<usd> → top holders via Solana
// RPC getTokenLargestAccounts + getTokenSupply. Uses Helius when
// HELIUS_API_KEY is set in Vercel env vars; falls back to the public
// mainnet RPC otherwise (works, just stricter rate limits). Edge-cached 60s.
export default async function handler(req, res) {
  const mint = String(req.query.mint || "");
  const price = parseFloat(req.query.price || "0") || 0;
  if (!/^[A-Za-z0-9]{30,50}$/.test(mint)) return res.status(400).json({ error: "bad mint" });
  const key = process.env.HELIUS_API_KEY;
  const rpc = key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "https://api.mainnet-beta.solana.com";
  const call = async (method, params) => {
    const r = await fetch(rpc, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!r.ok) throw new Error(`rpc ${r.status}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "rpc error");
    return j.result;
  };
  try {
    const [largest, supplyR] = await Promise.all([
      call("getTokenLargestAccounts", [mint]),
      call("getTokenSupply", [mint]),
    ]);
    const supply = parseFloat(supplyR?.value?.uiAmountString || supplyR?.value?.uiAmount || "0") || 0;
    const out = (largest?.value || []).map((a, i) => {
      const qty = parseFloat(a.uiAmountString || a.uiAmount || "0") || 0;
      const addr = String(a.address || "");
      return {
        i,
        wal: addr ? addr.slice(0, 4) + "…" + addr.slice(-4) : "????…????",
        address: addr,
        qty,
        usd: qty * price,
        supPct: supply > 0 ? (qty / supply) * 100 : 0,
      };
    });
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=120");
    res.status(200).json({ supply, holders: out });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
