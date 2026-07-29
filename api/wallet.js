// VALO — /api/wallet?address=<solana wallet>
// Everything a profile needs, straight from the chain:
//   • SOL balance                     (RPC getBalance)
//   • token holdings + USD value      (RPC getTokenAccountsByOwner + DexScreener prices)
//   • recent buys / sells             (Bitquery DEXTrades by signer)
// Uses HELIUS_API_KEY when present, otherwise the public mainnet RPC.
const DS = "https://api.dexscreener.com/latest/dex/tokens";

const rpcUrl = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

async function rpc(method, params) {
  const r = await fetch(rpcUrl(), {
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
    const batch = mints.slice(i, i + 25);
    try {
      const r = await fetch(`${DS}/${batch.join(",")}`, { headers: { accept: "application/json" } });
      if (!r.ok) continue;
      const j = await r.json();
      for (const p of j.pairs || []) {
        const m = p.baseToken && p.baseToken.address;
        const px = parseFloat(p.priceUsd) || 0;
        if (!m || !(px > 0)) continue;
        // keep the deepest pair's price for each mint
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        if (!out[m] || liq > out[m].liq) {
          out[m] = { price: px, liq, sym: (p.baseToken.symbol || "").toUpperCase(), name: p.baseToken.name || null,
            img: (p.info && p.info.imageUrl) || null, pool: p.pairAddress || null };
        }
      }
    } catch (e) { /* skip batch */ }
  }
  return out;
}

const Q_TRADES = `
query($wallet: String!) {
  Solana {
    DEXTrades(
      where: {Transaction: {Signer: {is: $wallet}}}
      orderBy: {descending: Block_Time}
      limit: {count: 40}
    ) {
      Block { Time }
      Transaction { Signature }
      Trade {
        Buy  { Amount PriceInUSD Currency { MintAddress Symbol } }
        Sell { Amount PriceInUSD Currency { MintAddress Symbol } }
        Dex { ProtocolName }
      }
    }
  }
}`;

async function walletTrades(wallet) {
  const token = (process.env.BITQUERY_TOKEN || "").trim();
  if (!token) return null;                       // not configured → skip, don't fail
  const r = await fetch("https://streaming.bitquery.io/eap", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: Q_TRADES, variables: { wallet } }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (j.errors && j.errors.length) return null;
  return (j.data?.Solana?.DEXTrades || []).map((t) => {
    const buy = t.Trade?.Buy, sell = t.Trade?.Sell;
    const bPx = parseFloat(buy?.PriceInUSD) || 0, sPx = parseFloat(sell?.PriceInUSD) || 0;
    const bAmt = parseFloat(buy?.Amount) || 0;
    return {
      at: Date.parse(t.Block?.Time) || null,
      sym: buy?.Currency?.Symbol || sell?.Currency?.Symbol || "?",
      mint: buy?.Currency?.MintAddress || null,
      usd: bAmt * bPx || 0,
      price: bPx || sPx || 0,
      dex: t.Trade?.Dex?.ProtocolName || null,
      tx: t.Transaction?.Signature || null,
    };
  });
}

export default async function handler(req, res) {
  const address = String(req.query.address || "");
  if (!/^[A-Za-z0-9]{32,50}$/.test(address)) return res.status(400).json({ error: "bad address" });
  try {
    const [lamports, accounts, trades] = await Promise.all([
      rpc("getBalance", [address]).catch(() => null),
      rpc("getTokenAccountsByOwner", [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }]).catch(() => null),
      walletTrades(address).catch(() => null),
    ]);

    const sol = lamports && lamports.value != null ? lamports.value / 1e9 : null;

    let holdings = [];
    const raw = (accounts && accounts.value) || [];
    for (const a of raw) {
      const info = a?.account?.data?.parsed?.info;
      const amt = parseFloat(info?.tokenAmount?.uiAmountString || info?.tokenAmount?.uiAmount || "0") || 0;
      if (!info?.mint || !(amt > 0)) continue;
      holdings.push({ mint: info.mint, qty: amt });
    }
    // price the biggest positions and drop dust
    const px = await priceMap(holdings.slice(0, 60).map((h) => h.mint));
    holdings = holdings.map((h) => {
      const p = px[h.mint];
      return { ...h, sym: p?.sym || null, name: p?.name || null, img: p?.img || null,
        pool: p?.pool || null, price: p?.price || 0, usd: (p?.price || 0) * h.qty };
    }).filter((h) => h.usd >= 1)                       // ignore sub-$1 dust
      .sort((a, b) => b.usd - a.usd).slice(0, 40);

    const tokensUsd = holdings.reduce((s, h) => s + h.usd, 0);

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=90");
    res.status(200).json({
      address, sol,
      solUsd: sol != null ? sol * 190 : null,          // rough SOL price for display only
      holdings, tokensUsd, holdingsCount: holdings.length,
      trades: trades || [],
      tradesSource: trades ? "bitquery" : "unavailable",
      solscan: `https://solscan.io/account/${address}`,
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
