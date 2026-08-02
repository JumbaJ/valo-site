// 🔭 real on-chain trades of a wallet on a specific token (mint), for marker
// tracking a pinned trader. Uses Helius enhanced transactions — parses SWAP
// events involving both the wallet and the mint, returns buy/sell markers with
// price, amount, and timestamp. Live and historical alike, straight from chain.
export default async function handler(req, res) {
  const wallet = String(req.query.wallet || "").trim();
  const mint = String(req.query.mint || "").trim();
  const key = process.env.HELIUS_API_KEY;
  if (!wallet || !mint) return res.status(400).json({ error: "wallet + mint required" });
  if (!key) return res.status(200).json({ trades: [], note: "no key" });

  const SOL = "So11111111111111111111111111111111111111112";
  try {
    // pull the wallet's recent enhanced transactions, filtered to SWAPs
    const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&type=SWAP&limit=100`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`helius ${r.status}`);
    const txs = await r.json();
    const trades = [];
    for (const tx of (Array.isArray(txs) ? txs : [])) {
      const se = tx.events && tx.events.swap;
      if (!se) continue;
      // token inputs/outputs on this swap
      const ins = se.tokenInputs || [];
      const outs = se.tokenOutputs || [];
      const touchesMint = [...ins, ...outs].some((t) => t && t.mint === mint);
      if (!touchesMint) continue;

      // native SOL legs (lamports) tell us the SOL side of the trade
      const solIn = (se.nativeInput && +se.nativeInput.amount) || 0;
      const solOut = (se.nativeOutput && +se.nativeOutput.amount) || 0;

      // did the wallet RECEIVE the mint (buy) or SEND it (sell)?
      const gotMint = outs.find((t) => t.mint === mint && t.userAccount === wallet);
      const sentMint = ins.find((t) => t.mint === mint && t.userAccount === wallet);
      let side = null, tokenAmt = 0, solAmt = 0;
      if (gotMint) { side = "buy"; tokenAmt = +gotMint.rawTokenAmount?.tokenAmount / Math.pow(10, gotMint.rawTokenAmount?.decimals || 0) || +gotMint.tokenAmount || 0; solAmt = solIn / 1e9; }
      else if (sentMint) { side = "sell"; tokenAmt = +sentMint.rawTokenAmount?.tokenAmount / Math.pow(10, sentMint.rawTokenAmount?.decimals || 0) || +sentMint.tokenAmount || 0; solAmt = solOut / 1e9; }
      else continue;
      if (!(tokenAmt > 0)) continue;

      const at = (tx.timestamp || 0) * 1000;
      const priceSol = tokenAmt > 0 ? solAmt / tokenAmt : 0;
      trades.push({
        t: at, side, tokenAmt, solAmt, priceSol,
        sig: tx.signature,
      });
    }
    trades.sort((a, b) => a.t - b.t);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=90");
    res.status(200).json({ trades, wallet, mint });
  } catch (e) {
    res.status(200).json({ trades: [], error: String(e.message || e) });
  }
}
