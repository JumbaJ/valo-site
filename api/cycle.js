// 🔄 /api/cycle — the whole VALO money loop in one call.
//
// Answers, from chain only: is the creator wallet earning? is the treasury
// collecting fees? is the epoch vault filling? has anything actually burned?
// Every figure here is verifiable on Solscan — no site-side bookkeeping.
const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

const rpc = async (method, params) => {
  const r = await fetch(RPC(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json();
  return j && j.result;
};

const solOf = async (addr) => {
  if (!addr) return null;
  try {
    const v = await rpc("getBalance", [addr]);
    return v && v.value != null ? v.value / 1e9 : null;
  } catch (e) { return null; }
};

// recent SOL in/out for a wallet, from parsed transaction history
const flowsOf = async (addr, limit = 25) => {
  if (!addr) return { inSol: 0, outSol: 0, count: 0, recent: [] };
  try {
    const sigs = await rpc("getSignaturesForAddress", [addr, { limit }]);
    if (!Array.isArray(sigs) || !sigs.length) return { inSol: 0, outSol: 0, count: 0, recent: [] };
    let inSol = 0, outSol = 0;
    const recent = [];
    // batch the parsed lookups, newest first
    for (const sg of sigs.slice(0, 15)) {
      try {
        const tx = await rpc("getTransaction", [sg.signature, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]);
        if (!tx || !tx.meta) continue;
        const keys = (tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys) || [];
        const idx = keys.findIndex((k) => (typeof k === "string" ? k : k.pubkey) === addr);
        if (idx < 0) continue;
        const delta = ((tx.meta.postBalances[idx] || 0) - (tx.meta.preBalances[idx] || 0)) / 1e9;
        if (delta > 0.000001) inSol += delta;
        else if (delta < -0.000001) outSol += Math.abs(delta);
        if (Math.abs(delta) > 0.000001) {
          recent.push({ sig: sg.signature, t: (sg.blockTime || 0) * 1000,
            solDelta: +delta.toFixed(6), dir: delta > 0 ? "in" : "out",
            solscan: `https://solscan.io/tx/${sg.signature}` });
        }
      } catch (e) {}
    }
    return { inSol: +inSol.toFixed(6), outSol: +outSol.toFixed(6), count: sigs.length, recent: recent.slice(0, 8) };
  } catch (e) { return { inSol: 0, outSol: 0, count: 0, recent: [] }; }
};

export default async function handler(req, res) {
  const MINT = (process.env.VALO_MINT || "").trim();
  const CREATOR = (process.env.VALO_CREATOR || "").trim();
  const TREASURY = (process.env.VALO_TREASURY || process.env.VALO_FEE_ACCOUNT || "").trim();
  const EPOCH = (process.env.VALO_EPOCH || "").trim();
  const DEPLOYER = (process.env.VALO_DEPLOYER || "").trim();
  const BURN = (process.env.VALO_BURN || "1nc1nerator11111111111111111111111111111111").trim();

  const deep = String(req.query.deep || "") === "1";   // ?deep=1 also reads flows

  // wallet balances — always cheap
  const [creatorSol, treasurySol, epochSol, deployerSol] = await Promise.all([
    solOf(CREATOR), solOf(TREASURY), solOf(EPOCH), solOf(DEPLOYER),
  ]);

  // token supply → burns are the delta from genesis
  let supply = null, burned = null;
  if (MINT) {
    try {
      const v = await rpc("getTokenSupply", [MINT]);
      supply = v && v.value && v.value.uiAmount != null ? +v.value.uiAmount : null;
      if (supply != null) burned = Math.max(0, 1e9 - supply);
    } catch (e) {}
  }

  // how much SOL has ever landed in the incinerator from us? (deep only)
  const flows = deep
    ? {
        creator: await flowsOf(CREATOR),
        treasury: await flowsOf(TREASURY),
        epoch: await flowsOf(EPOCH),
      }
    : null;

  const wallets = {
    creator: { address: CREATOR || null, sol: creatorSol, role: "collects pump.fun creator fees — you claim, then split with 👑",
      solscan: CREATOR ? `https://solscan.io/account/${CREATOR}` : null },
    treasury: { address: TREASURY || null, sol: treasurySol, role: "receives the 20% treasury slice of every site fee",
      solscan: TREASURY ? `https://solscan.io/account/${TREASURY}` : null },
    epoch: { address: EPOCH || null, sol: epochSol, role: "the hourly reward vault — 40% of every site fee lands here",
      solscan: EPOCH ? `https://solscan.io/account/${EPOCH}` : null },
    deployer: { address: DEPLOYER || null, sol: deployerSol, role: "deployer wallet",
      solscan: DEPLOYER ? `https://solscan.io/account/${DEPLOYER}` : null },
    burn: { address: BURN, role: "40% of every site fee is sent here permanently",
      solscan: `https://solscan.io/account/${BURN}` },
  };

  const configured = {
    mint: !!MINT, creator: !!CREATOR, treasury: !!TREASURY, epoch: !!EPOCH, deployer: !!DEPLOYER,
  };
  const missing = Object.entries(configured).filter(([, v]) => !v).map(([k]) => k);

  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
  return res.status(200).json({
    ok: true,
    checkedAt: new Date().toISOString(),
    mint: MINT || null,
    token: { supply, genesis: 1e9, burned, burnedPct: burned != null ? +((burned / 1e9) * 100).toFixed(4) : null },
    wallets,
    flows,
    configured, missing,
    note: deep
      ? "flows = real SOL in/out from recent transactions on each wallet"
      : "add ?deep=1 for recent SOL in/out per wallet (slower)",
  });
}
