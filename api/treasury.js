// 🏛 /api/treasury — what the CLIENT needs to know about VALO's own token and
// wallets. The terminal calls this on boot to learn the mint; without it the
// whole $VALO side of the UI silently falls back to placeholder numbers.
//
// Public, read-only, no secrets: addresses and balances are on chain anyway.
const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

const rpc = async (method, params) => {
  try {
    const r = await fetch(RPC(), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(7000),
    });
    const j = await r.json();
    return j && j.result;
  } catch (e) { return null; }
};

const solOf = async (addr) => {
  if (!addr) return null;
  const v = await rpc("getBalance", [addr]);
  return v && v.value != null ? v.value / 1e9 : null;
};

// live market row for the token — same source the header stats use
const marketOf = async (mint) => {
  if (!mint) return null;
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, {
      headers: { accept: "application/json" }, signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const pairs = (j && j.pairs) || [];
    if (!pairs.length) return null;
    pairs.sort((a, b) => (+(b.liquidity && b.liquidity.usd) || 0) - (+(a.liquidity && a.liquidity.usd) || 0));
    const p = pairs[0];
    return {
      price: +p.priceUsd || 0,
      mc: +p.marketCap || +p.fdv || 0,
      tvl: +(p.liquidity && p.liquidity.usd) || 0,
      vol24: +(p.volume && p.volume.h24) || 0,
      pool: p.pairAddress || null,
      ch24: +(p.priceChange && p.priceChange.h24) || 0,
    };
  } catch (e) { return null; }
};

export default async function handler(req, res) {
  const MINT = (process.env.VALO_MINT || "").trim();
  const TREASURY = (process.env.VALO_TREASURY || process.env.VALO_FEE_ACCOUNT || "").trim();
  const EPOCH = (process.env.VALO_EPOCH || "").trim();
  const CREATOR = (process.env.VALO_CREATOR || "").trim();
  const DEPLOYER = (process.env.VALO_DEPLOYER || "").trim();
  const BURN = (process.env.VALO_BURN || "1nc1nerator11111111111111111111111111111111").trim();

  const [treasurySol, epochSol, creatorSol, deployerSol, market, supplyRes] = await Promise.all([
    solOf(TREASURY), solOf(EPOCH), solOf(CREATOR), solOf(DEPLOYER),
    marketOf(MINT),
    MINT ? rpc("getTokenSupply", [MINT]) : Promise.resolve(null),
  ]);

  const supply = supplyRes && supplyRes.value && supplyRes.value.uiAmount != null ? +supplyRes.value.uiAmount : null;
  const GENESIS = 1e9;
  const burned = supply != null ? Math.max(0, GENESIS - supply) : null;

  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=45");
  return res.status(200).json({
    ok: true,
    token: {
      mint: MINT || null,
      launched: !!MINT,
      price: market ? market.price : null,
      mc: market ? market.mc : null,
      tvl: market ? market.tvl : null,
      vol24: market ? market.vol24 : null,
      ch24: market ? market.ch24 : null,
      pool: market ? market.pool : null,
      supply, genesis: GENESIS, burned,
      burnedPct: burned != null ? +((burned / GENESIS) * 100).toFixed(4) : null,
      indexed: !!market,
    },
    wallets: {
      treasury: { address: TREASURY || null, sol: treasurySol },
      epoch: { address: EPOCH || null, sol: epochSol },
      creator: { address: CREATOR || null, sol: creatorSol },
      deployer: { address: DEPLOYER || null, sol: deployerSol },
      burn: { address: BURN, sol: null },
    },
    fees: {
      bps: Math.max(0, parseInt(process.env.VALO_FEE_BPS || "60", 10) || 0),
      bpsValo: Math.max(0, parseInt(process.env.VALO_FEE_BPS_VALO || "30", 10) || 0),
      split: { burnPct: 40, epochPct: 40, treasuryPct: 20 },
    },
  });
}
