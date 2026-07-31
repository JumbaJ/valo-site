// VALO — /api/treasury : the live state of VALO's own wallets.
//
// Addresses come from Vercel env vars (public information, but kept in config so
// you can rotate them without a deploy of the terminal):
//   VALO_TREASURY   — fee collection
//   VALO_CREATOR    — creator wallet
//   VALO_EPOCH      — epoch reward vault
//   VALO_DEPLOYER   — deployer
//   VALO_MINT       — the $VALO mint (leave unset until launch)
//   VALO_BURN       — optional burn address
//
// Everything reported here is read from the chain. Nothing is simulated.
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

const valid = (a) => /^[A-Za-z0-9]{32,50}$/.test(String(a || ""));
const short = (a) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : null);

async function walletState(address, mint) {
  if (!valid(address)) return null;
  const [bal, accounts] = await Promise.all([
    rpc("getBalance", [address]).catch(() => null),
    mint ? rpc("getTokenAccountsByOwner", [address, { mint }, { encoding: "jsonParsed" }]).catch(() => null) : null,
  ]);
  let valo = null;
  for (const a of (accounts && accounts.value) || []) {
    const amt = parseFloat(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmountString || "0") || 0;
    valo = (valo || 0) + amt;
  }
  return {
    address, short: short(address),
    sol: bal && bal.value != null ? bal.value / 1e9 : null,
    valo,
    solscan: `https://solscan.io/account/${address}`,
  };
}

export default async function handler(req, res) {
  const mint = (process.env.VALO_MINT || "").trim();
  const wallets = {
    treasury: (process.env.VALO_TREASURY || "").trim(),
    creator: (process.env.VALO_CREATOR || "").trim(),
    epoch: (process.env.VALO_EPOCH || "").trim(),
    deployer: (process.env.VALO_DEPLOYER || "").trim(),
    burn: (process.env.VALO_BURN || "").trim(),
  };
  try {
    const entries = await Promise.all(Object.entries(wallets).map(async ([k, addr]) =>
      [k, addr ? await walletState(addr, valid(mint) ? mint : null).catch(() => null) : null]));
    const out = Object.fromEntries(entries);

    // token facts, once the mint exists
    let token = null;
    if (valid(mint)) {
      const [supplyR] = await Promise.all([rpc("getTokenSupply", [mint]).catch(() => null)]);
      token = {
        mint,
        supply: parseFloat(supplyR?.value?.uiAmountString || supplyR?.value?.uiAmount || "0") || 0,
        decimals: supplyR?.value?.decimals ?? null,
        solscan: `https://solscan.io/token/${mint}`,
        pumpfun: /pump$/i.test(mint) ? `https://pump.fun/coin/${mint}` : null,
      };
    }

    const configured = Object.values(wallets).filter(Boolean).length;
    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({
      live: !!token,                       // false until VALO_MINT is set
      token, wallets: out, configured,
      note: token ? "token live" : "no VALO_MINT set — wallets shown, token pending launch",
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
