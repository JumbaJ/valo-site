// 🔭 real on-chain trades of a wallet on a specific token (mint), for marker
// tracking a pinned trader. Uses Helius enhanced transactions — parses SWAP
// events involving both the wallet and the mint, returns buy/sell markers with
// price, amount, and timestamp. Live and historical alike, straight from chain.
export default async function handler(req, res) {
  const wallet = String(req.query.wallet || "").trim();
  const mint = String(req.query.mint || "").trim();   // optional: empty = ALL swaps
  const key = process.env.HELIUS_API_KEY;
  if (!wallet) return res.status(400).json({ error: "wallet required" });
  if (!key) return res.status(200).json({ trades: [], note: "no key" });

  const SOL = "So11111111111111111111111111111111111111112";
  try {
    // pull the wallet's recent enhanced transactions, filtered to SWAPs
    const url = `https://api.helius.xyz/v0/addresses/${wallet}/transactions?api-key=${key}&limit=100`;
    const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error(`helius ${r.status}`);
    const txs = await r.json();
    const SOLM = "So11111111111111111111111111111111111111112";
    const amtOf = (leg) => {
      if (!leg) return 0;
      const raw = leg.rawTokenAmount;
      if (raw && raw.tokenAmount != null) return Math.abs(+raw.tokenAmount) / Math.pow(10, raw.decimals || 0);
      return Math.abs(+leg.tokenAmount) || 0;
    };
    const trades = [];
    for (const tx of (Array.isArray(txs) ? txs : [])) {
      const at = (tx.timestamp || 0) * 1000;
      let side = null, tokenAmt = 0, solAmt = 0, tradeMint = null;

      const se = tx.events && tx.events.swap;
      if (se) {
        const ins = se.tokenInputs || [];
        const outs = se.tokenOutputs || [];
        const gotMint = outs.find((t) => (mint ? t.mint === mint : (t.mint && t.mint !== SOLM)) && t.userAccount === wallet);
        const sentMint = ins.find((t) => (mint ? t.mint === mint : (t.mint && t.mint !== SOLM)) && t.userAccount === wallet);
        // SOL side: native lamports OR the WSOL token leg (pump-era swaps)
        const wsolIn = ins.filter((t) => t.mint === SOLM).reduce((s, t) => s + amtOf(t), 0);
        const wsolOut = outs.filter((t) => t.mint === SOLM).reduce((s, t) => s + amtOf(t), 0);
        const solIn = ((se.nativeInput && +se.nativeInput.amount) || 0) / 1e9 || wsolIn;
        const solOut = ((se.nativeOutput && +se.nativeOutput.amount) || 0) / 1e9 || wsolOut;
        if (gotMint) { side = "buy"; tokenAmt = amtOf(gotMint); solAmt = solIn; tradeMint = gotMint.mint; }
        else if (sentMint) { side = "sell"; tokenAmt = amtOf(sentMint); solAmt = solOut; tradeMint = sentMint.mint; }
      }

      // no swap event (pump curve, aggregators) → read raw transfers:
      // the wallet's token delta + its SOL delta tell the whole story
      if (!side && Array.isArray(tx.tokenTransfers)) {
        const tt = tx.tokenTransfers.filter((t) => t.mint && t.mint !== SOLM && (mint ? t.mint === mint : true));
        const got = tt.find((t) => t.toUserAccount === wallet);
        const sent = tt.find((t) => t.fromUserAccount === wallet);
        const nat = (tx.nativeTransfers || []).reduce((s, n) =>
          s + (n.toUserAccount === wallet ? +n.amount : 0) - (n.fromUserAccount === wallet ? +n.amount : 0), 0) / 1e9;
        if (got && nat < -1e-6) { side = "buy"; tokenAmt = Math.abs(+got.tokenAmount) || 0; solAmt = Math.abs(nat); tradeMint = got.mint; }
        else if (sent && nat > 1e-6) { side = "sell"; tokenAmt = Math.abs(+sent.tokenAmount) || 0; solAmt = nat; tradeMint = sent.mint; }
      }

      // not a trade → is it a plain MOVEMENT? (deposits, sweeps, transfers)
      if (!side) {
        const natNet = (tx.nativeTransfers || []).reduce((s, n) =>
          s + (n.toUserAccount === wallet ? +n.amount : 0) - (n.fromUserAccount === wallet ? +n.amount : 0), 0) / 1e9;
        const tt = (tx.tokenTransfers || []).filter((t) => t.mint && t.mint !== SOLM);
        const tGot = tt.find((t) => t.toUserAccount === wallet);
        const tSent = tt.find((t) => t.fromUserAccount === wallet);
        if (Math.abs(natNet) > 0.0005 && !tGot && !tSent) {
          trades.push({ t: at, side: natNet > 0 ? "in" : "out", tokenAmt: 0, solAmt: Math.abs(natNet), priceSol: 0, mint: null, sig: tx.signature });
        } else if ((tGot || tSent) && Math.abs(natNet) <= 0.0005 && !mint) {
          const leg = tGot || tSent;
          trades.push({ t: at, side: tGot ? "tin" : "tout", tokenAmt: Math.abs(+leg.tokenAmount) || 0, solAmt: 0, priceSol: 0, mint: leg.mint, sig: tx.signature });
        }
        continue;
      }
      if (!(tokenAmt > 0) || !(solAmt > 0)) continue;
      trades.push({ t: at, side, tokenAmt, solAmt, priceSol: solAmt / tokenAmt, mint: tradeMint, sig: tx.signature });
    }
    trades.sort((a, b) => a.t - b.t);
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=90");
    res.status(200).json({ trades, wallet, mint });
  } catch (e) {
    res.status(200).json({ trades: [], error: String(e.message || e) });
  }
}
