// VALO — /api/burn : what the burn share has actually done, from the chain.
//
// Two numbers matter and they are different things:
//
//   pendingSol   — SOL sitting in the burn wallet, collected from fees and
//                  waiting to buy $VALO. Not yet a burn.
//   burnedTokens — $VALO permanently removed from supply, measured as genesis
//                  supply minus what the chain reports today. SPL burns shrink
//                  supply directly, so this is verifiable by anyone.
//
// The burn wallet is dedicated to VALO, so its balance is auditable — unlike
// the shared incinerator, where anyone's donations are mixed in and no figure
// can be attributed to us.

const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

const rpc = async (method, params) => {
  const r = await fetch(RPC(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
};

const GENESIS = parseFloat(process.env.VALO_GENESIS_SUPPLY || "1000000000");

export default async function handler(req, res) {
  const burnWallet = (process.env.VALO_BURN || "").trim();
  const mint = (process.env.VALO_MINT || "").trim();

  const out = {
    burnWallet: burnWallet || null,
    dedicated: !!burnWallet && !/^1nc1nerator/i.test(burnWallet),
    pendingSol: 0,
    genesis: GENESIS,
    supply: null,
    burnedTokens: 0,
    burnedPct: 0,
    lastBurnAt: null,
    burns: [],
  };

  // SOL waiting to be spent on a buyback
  if (burnWallet) {
    try {
      const v = await rpc("getBalance", [burnWallet]);
      out.pendingSol = ((v && v.value) || 0) / 1e9;
    } catch (e) { out.pendingSolError = String(e.message || e); }
  }

  // current supply — the only honest measure of what has been burned
  if (mint) {
    try {
      const s = await rpc("getTokenSupply", [mint]);
      const ui = s && s.value && parseFloat(s.value.uiAmountString || s.value.uiAmount || 0);
      if (Number.isFinite(ui) && ui > 0) {
        out.supply = ui;
        out.burnedTokens = Math.max(0, GENESIS - ui);
        out.burnedPct = GENESIS > 0 ? (out.burnedTokens / GENESIS) * 100 : 0;
      }
    } catch (e) { out.supplyError = String(e.message || e); }
  }

  // recent activity from the burn wallet, so the buybacks are visible
  if (burnWallet) {
    try {
      const sigs = await rpc("getSignaturesForAddress", [burnWallet, { limit: 10 }]);
      out.burns = (sigs || []).filter((s) => !s.err).slice(0, 6).map((s) => ({
        sig: s.signature,
        at: s.blockTime ? s.blockTime * 1000 : null,
      }));
      if (out.burns.length && out.burns[0].at) out.lastBurnAt = out.burns[0].at;
    } catch (e) { /* history is a nicety, not a requirement */ }
  }

  res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=60");
  return res.status(200).json(out);
}
