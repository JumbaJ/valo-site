// VALO — /api/holders?mint=<mint>[&price=<usd>]
//
// Two different questions, answered separately:
//   holders  → the TOP holders (getTokenLargestAccounts returns 20, max)
//   count    → how many wallets actually hold it, counted properly
//
// The old version reported holders.length as the holder count, which could
// never exceed 20 — that's why the number on cards was wrong.
const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");
const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

async function rpc(method, params) {
  const r = await fetch(RPC(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

// count every token account for this mint that holds a non-zero balance.
// dataSlice keeps the response tiny — we only need the amount field.
async function realHolderCount(mint) {
  const res = await rpc("getProgramAccounts", [TOKEN_PROGRAM, {
    encoding: "base64",
    dataSlice: { offset: 64, length: 8 },          // just the u64 amount
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }],
  }]);
  if (!Array.isArray(res)) return null;
  let held = 0;
  for (const a of res) {
    const b64 = a?.account?.data?.[0];
    if (!b64) continue;
    const buf = Buffer.from(b64, "base64");
    if (buf.length >= 8) {
      // non-zero little-endian u64 → this wallet holds some
      for (let i = 0; i < 8; i++) { if (buf[i] !== 0) { held++; break; } }
    }
  }
  return held;
}

export default async function handler(req, res) {
  const mint = String(req.query.mint || "");
  const price = parseFloat(req.query.price || "0") || 0;
  if (!/^[A-Za-z0-9]{30,50}$/.test(mint)) return res.status(400).json({ error: "bad mint" });
  try {
    const [largest, supplyR, countR] = await Promise.all([
      rpc("getTokenLargestAccounts", [mint]).catch(() => null),
      rpc("getTokenSupply", [mint]).catch(() => null),
      realHolderCount(mint).catch(() => null),        // heavy call — may be refused
    ]);
    const supply = parseFloat(supplyR?.value?.uiAmountString || supplyR?.value?.uiAmount || "0") || 0;
    const holders = ((largest && largest.value) || []).map((a, i) => {
      const qty = parseFloat(a.uiAmountString || a.uiAmount || "0") || 0;
      const addr = String(a.address || "");
      return { i, wal: addr ? addr.slice(0, 4) + "…" + addr.slice(-4) : "????…????",
        address: addr, qty, usd: qty * price, supPct: supply > 0 ? (qty / supply) * 100 : 0 };
    });
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.status(200).json({
      supply,
      holders,                                       // the top 20, for the HOLDERS tab
      count: countR,                                 // the true wallet count, or null
      countExact: countR != null,
      top10Pct: supply > 0 ? holders.slice(0, 10).reduce((s, h) => s + h.supPct, 0) : null,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
