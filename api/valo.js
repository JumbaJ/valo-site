// ◆ /api/valo — the single source of truth for $VALO's market numbers.
// DexScreener's token endpoint needs no key, indexes pump.fun pools within
// seconds of launch, and returns everything the header shows. Falls back to
// GeckoTerminal if DexScreener is cold.
const MINT = () => (process.env.VALO_MINT || "").trim();

const fromDexScreener = async (mint) => {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const pairs = (j && j.pairs) || [];
  if (!pairs.length) return null;
  // the deepest pool is the real market
  pairs.sort((a, b) => (+(b.liquidity && b.liquidity.usd) || 0) - (+(a.liquidity && a.liquidity.usd) || 0));
  const p = pairs[0];
  const tx = (p.txns && (p.txns.h24 || p.txns.h6 || p.txns.h1)) || {};
  const vol24 = +(p.volume && p.volume.h24) || 0;
  const buys = +tx.buys || 0, sells = +tx.sells || 0;
  const total = buys + sells;
  // DexScreener gives counts, not dollar split — apportion volume by count so
  // NET FLOW is an honest estimate rather than an invented number
  const greenUsd = total > 0 ? (vol24 * buys) / total : 0;
  const redUsd = total > 0 ? (vol24 * sells) / total : 0;
  const price = +p.priceUsd || 0;
  const mc = +p.marketCap || +p.fdv || 0;
  return {
    mint, pool: p.pairAddress || null, sym: String((p.baseToken && p.baseToken.symbol) || "VALO").replace(/^\$+/, ""),
    name: (p.baseToken && p.baseToken.name) || "VALO",
    price, mc,
    tvl: +(p.liquidity && p.liquidity.usd) || 0,
    vol24, buys, sells, greenUsd, redUsd,
    ch: +(p.priceChange && (p.priceChange.h1 ?? p.priceChange.h24)) || 0,
    ch24: +(p.priceChange && p.priceChange.h24) || 0,
    statWin: "24h",
    createdAt: p.pairCreatedAt || null,
    supply: price > 0 && mc > 0 ? mc / price : 0,
    dex: p.dexId || null,
    src: "dexscreener",
  };
};

const fromGecko = async (mint) => {
  const r = await fetch(`https://api.geckoterminal.com/api/v2/networks/solana/tokens/${mint}/pools?page=1`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return null;
  const j = await r.json();
  const rows = (j && j.data) || [];
  if (!rows.length) return null;
  const a = rows[0].attributes || {};
  const price = parseFloat(a.base_token_price_usd) || 0;
  const mc = parseFloat(a.market_cap_usd) || parseFloat(a.fdv_usd) || 0;
  const buys = (a.transactions && a.transactions.h24 && a.transactions.h24.buys) || 0;
  const sells = (a.transactions && a.transactions.h24 && a.transactions.h24.sells) || 0;
  const vol24 = parseFloat(a.volume_usd && a.volume_usd.h24) || 0;
  const total = buys + sells;
  return {
    mint, pool: a.address || null, sym: "VALO", name: "VALO",
    price, mc: mc || (price > 0 ? price * 1e9 : 0),
    tvl: parseFloat(a.reserve_in_usd) || 0,
    vol24, buys, sells,
    greenUsd: total > 0 ? (vol24 * buys) / total : 0,
    redUsd: total > 0 ? (vol24 * sells) / total : 0,
    ch: parseFloat(a.price_change_percentage && a.price_change_percentage.h1) || 0,
    ch24: parseFloat(a.price_change_percentage && a.price_change_percentage.h24) || 0,
    statWin: "24h",
    createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) : null,
    supply: price > 0 && mc > 0 ? mc / price : 0,
    src: "geckoterminal",
  };
};

// ⛓ exact circulating supply straight from the SPL mint — MC÷price carries
// rounding error (it reported 1,000,288,007 for a 1B token), and burns are a
// supply delta, so this number has to be exact.
const chainSupply = async (mint) => {
  try {
    const rpc = process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : "https://api.mainnet-beta.solana.com";
    const r = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenSupply", params: [mint] }),
      signal: AbortSignal.timeout(6000) });
    const j = await r.json();
    const v = j && j.result && j.result.value;
    return v && v.uiAmount != null ? +v.uiAmount : null;
  } catch (e) { return null; }
};

export default async function handler(req, res) {
  const mint = String(req.query.mint || MINT() || "").trim();
  if (!mint) {
    res.setHeader("Cache-Control", "s-maxage=30");
    return res.status(200).json({ configured: false, mint: null });
  }
  let out = null;
  try { out = await fromDexScreener(mint); } catch (e) {}
  if (!out) { try { out = await fromGecko(mint); } catch (e) {} }
  if (!out) {
    res.setHeader("Cache-Control", "s-maxage=15");
    return res.status(200).json({ configured: true, mint, indexed: false });
  }
  // burns are a supply delta: pump launches a fixed 1B, SPL burns shrink it
  const GENESIS = 1e9;
  const exact = await chainSupply(mint);
  if (exact != null && exact > 0) { out.supply = exact; out.supplyExact = true; }
  out.burned = out.supply > 0 ? Math.max(0, GENESIS - out.supply) : 0;
  out.burnedPct = out.burned > 0 ? +((out.burned / GENESIS) * 100).toFixed(4) : 0;
  out.genesis = GENESIS;
  out.configured = true;
  out.indexed = true;
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=30");
  return res.status(200).json(out);
}
