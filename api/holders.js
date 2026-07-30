// VALO — /api/holders?mint=<mint>[&price=<usd>]
//
//   count    → the TRUE number of wallets holding this token
//   holders  → the top holders, for the HOLDERS tab
//
// Birdeye /defi/v3/token/holder (35 CU) gives both cleanly. Helius RPC is the
// fallback and also serves supply. Cached 30 minutes: holder counts move slowly
// and this is the most expensive call on the page.
const BE = "https://public-api.birdeye.so";
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

async function fromBirdeye(mint) {
  const key = (process.env.BIRDEYE_API_KEY || "").trim();
  if (!key) return null;
  const r = await fetch(`${BE}/defi/v3/token/holder?address=${mint}&offset=0&limit=100`,
    { headers: { "X-API-KEY": key, "x-chain": "solana", accept: "application/json" } });
  if (!r.ok) throw new Error(`birdeye ${r.status}`);
  const j = await r.json();
  const d = j?.data || {};
  const items = d.items || [];
  // Birdeye reports the full count alongside the page it returns
  const total = [d.total, d.totalCount, d.holder_count, d.holders].find((v) => Number.isFinite(v));
  return { items, total: Number.isFinite(total) ? total : null };
}

// fallback: count every non-zero token account for the mint
async function countViaRpc(mint) {
  const res = await rpc("getProgramAccounts", [TOKEN_PROGRAM, {
    encoding: "base64",
    dataSlice: { offset: 64, length: 8 },
    filters: [{ dataSize: 165 }, { memcmp: { offset: 0, bytes: mint } }],
  }]);
  if (!Array.isArray(res)) return null;
  let held = 0;
  for (const a of res) {
    const b64 = a?.account?.data?.[0];
    if (!b64) continue;
    const buf = Buffer.from(b64, "base64");
    for (let i = 0; i < Math.min(8, buf.length); i++) { if (buf[i] !== 0) { held++; break; } }
  }
  return held;
}

export default async function handler(req, res) {
  const mint = String(req.query.mint || "");
  const price = parseFloat(req.query.price || "0") || 0;
  if (!/^[A-Za-z0-9]{30,50}$/.test(mint)) return res.status(400).json({ error: "bad mint" });

  let src = "none", holders = [], count = null, supply = 0;
  try {
    const [be, supplyR] = await Promise.all([
      fromBirdeye(mint).catch(() => null),
      rpc("getTokenSupply", [mint]).catch(() => null),
    ]);
    supply = parseFloat(supplyR?.value?.uiAmountString || supplyR?.value?.uiAmount || "0") || 0;

    if (be && be.items.length) {
      src = "birdeye";
      count = be.total;
      holders = be.items.slice(0, 30).map((h, i) => {
        const addr = String(h.owner || h.address || h.wallet || "");
        const qty = parseFloat(h.ui_amount ?? h.uiAmount ?? h.amount ?? 0) || 0;
        return { i, address: addr,
          wal: addr ? addr.slice(0, 4) + "…" + addr.slice(-4) : "????…????",
          qty, usd: qty * price, supPct: supply > 0 ? (qty / supply) * 100 : 0 };
      });
    } else {
      // Birdeye unavailable → largest accounts from the chain
      const largest = await rpc("getTokenLargestAccounts", [mint]).catch(() => null);
      src = "rpc";
      holders = ((largest && largest.value) || []).map((a, i) => {
        const qty = parseFloat(a.uiAmountString || a.uiAmount || "0") || 0;
        const addr = String(a.address || "");
        return { i, address: addr,
          wal: addr ? addr.slice(0, 4) + "…" + addr.slice(-4) : "????…????",
          qty, usd: qty * price, supPct: supply > 0 ? (qty / supply) * 100 : 0 };
      });
    }
    if (count == null) count = await countViaRpc(mint).catch(() => null);

    res.setHeader("X-Valo-Source", src);
    res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
    res.status(200).json({
      supply, holders, count, countExact: count != null,
      top10Pct: supply > 0 ? holders.slice(0, 10).reduce((s, h) => s + h.supPct, 0) : null,
      source: src,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
