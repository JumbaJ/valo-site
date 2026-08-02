// VALO — /api/wallet?address=<wallet>
// Real balance, real holdings, real trade count — all from Helius RPC/DAS.
// Prices come from DexScreener so holdings can be valued in USD.
const DS = "https://api.dexscreener.com/latest/dex/tokens";
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

async function priceMap(mints) {
  const out = {};
  for (let i = 0; i < mints.length; i += 25) {
    try {
      const r = await fetch(`${DS}/${mints.slice(i, i + 25).join(",")}`, { headers: { accept: "application/json" } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const p of j.pairs || []) {
        const m = p.baseToken && p.baseToken.address;
        const px = parseFloat(p.priceUsd) || 0;
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        if (!m || !(px > 0)) continue;
        if (!out[m] || liq > out[m].liq) {
          out[m] = { price: px, liq, sym: (p.baseToken.symbol || "").toUpperCase(),
            name: p.baseToken.name || null, img: (p.info && p.info.imageUrl) || null, pool: p.pairAddress || null };
        }
      }
    } catch (e) { /* skip batch */ }
  }
  return out;
}

export default async function handler(req, res) {
  const address = String(req.query.address || "");
  if (!/^[A-Za-z0-9]{32,50}$/.test(address)) return res.status(400).json({ error: "bad address" });
  try {
    const [bal, accountsV1, accountsV2, sigs] = await Promise.all([
      rpc("getBalance", [address]).catch(() => null),
      rpc("getTokenAccountsByOwner", [address, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }]).catch(() => null),
      rpc("getTokenAccountsByOwner", [address, { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }, { encoding: "jsonParsed" }]).catch(() => null),
      rpc("getSignaturesForAddress", [address, { limit: 100 }]).catch(() => null),
    ]);

    const sol = bal && bal.value != null ? bal.value / 1e9 : null;

    let holdings = [];
    const allAccounts = [...(((accountsV1 && accountsV1.value) || [])), ...(((accountsV2 && accountsV2.value) || []))];
    for (const a of allAccounts) {
      const info = a?.account?.data?.parsed?.info;
      const amt = parseFloat(info?.tokenAmount?.uiAmountString || info?.tokenAmount?.uiAmount || "0") || 0;
      if (!info?.mint || !(amt > 0)) continue;
      holdings.push({
        mint: info.mint,
        qty: amt,
        raw: String(info?.tokenAmount?.amount ?? ""),          // exact base units
        decimals: Number(info?.tokenAmount?.decimals ?? 0),
      });
    }
    const px = await priceMap(holdings.slice(0, 60).map((h) => h.mint));
    holdings = holdings.map((h) => {
      const p = px[h.mint];
      return { ...h, sym: p?.sym || null, name: p?.name || null, img: p?.img || null,
        pool: p?.pool || null, price: p?.price || 0, usd: (p?.price || 0) * h.qty };
    });
    // fill in names DexScreener doesn't know — straight from on-chain metadata
    const unnamed = holdings.filter((h) => !h.sym && !h.name).map((h) => h.mint).slice(0, 50);
    if (unnamed.length && process.env.HELIUS_API_KEY) {
      try {
        const dr = await fetch(`https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: "das", method: "getAssetBatch", params: { ids: unnamed } }),
        });
        const dj = await dr.json();
        const meta = {};
        for (const a of (dj && dj.result) || []) {
          if (!a || !a.id) continue;
          const m = a.content && a.content.metadata;
          const links = a.content && a.content.links;
          meta[a.id] = { sym: (m && m.symbol) || null, name: (m && m.name) || null, img: (links && links.image) || null };
        }
        holdings = holdings.map((h) => {
          const d = meta[h.mint];
          return d ? { ...h, sym: h.sym || d.sym, name: h.name || d.name, img: h.img || d.img } : h;
        });
      } catch (e) { /* names are a nicety — never block balances on them */ }
    }
    holdings = holdings.filter((h) => h.qty > 0)
      .sort((a, b) => b.usd - a.usd).slice(0, 80);

    // recent activity, newest first — signatures are cheap and always available
    const trades = ((sigs || []).slice(0, 24)).map((s) => ({
      at: s.blockTime ? s.blockTime * 1000 : null,
      tx: s.signature || null, err: !!s.err, sym: null, usd: 0, price: 0,
    })).filter((t) => t.at);

    res.setHeader("X-Valo-Source", process.env.HELIUS_API_KEY ? "helius" : "public-rpc");
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=180");
    res.status(200).json({
      address, sol,
      holdings, tokensUsd: holdings.reduce((s, h) => s + h.usd, 0), holdingsCount: holdings.length,
      trades, txCount: (sigs || []).length,
      solscan: `https://solscan.io/account/${address}`,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
