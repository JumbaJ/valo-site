// VALO — /api/swap : real on-chain execution, non-custodial.
//
//   ?mode=quote  → what you'd get, before anything is signed
//   ?mode=build  → an UNSIGNED transaction for the user's wallet to sign
//
// VALO never holds a key, never signs, and never submits without the user.
// The server only asks Jupiter for a route and returns the bytes Phantom will
// show them. Every guard below exists because this moves real money.
// Jupiter endpoints, newest first. JUPITER_API overrides the list entirely.
const JUP_HOSTS = (process.env.JUPITER_API
  ? [process.env.JUPITER_API]
  : ["https://lite-api.jup.ag/swap/v1", "https://api.jup.ag/swap/v1", "https://quote-api.jup.ag/v6"]);
const JUP_KEY = (process.env.JUPITER_API_KEY || "").trim();
const jupHeaders = () => (JUP_KEY ? { accept: "application/json", "x-api-key": JUP_KEY } : { accept: "application/json" });

// try each host until one answers; carry the errors so failures are legible
async function jupGet(path) {
  const errs = [];
  for (const host of JUP_HOSTS) {
    try {
      const r = await fetch(`${host}${path}`, { headers: jupHeaders() });
      if (r.ok) return { json: await r.json(), host };
      errs.push(`${host} → ${r.status}`);
    } catch (e) { errs.push(`${host} → ${String(e.message || e)}`); }
  }
  throw new Error(`no Jupiter endpoint answered (${errs.join(" | ")})`);
}
async function jupPost(path, body) {
  const errs = [];
  for (const host of JUP_HOSTS) {
    try {
      const r = await fetch(`${host}${path}`, {
        method: "POST", headers: { ...jupHeaders(), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) return { json: await r.json(), host };
      errs.push(`${host} → ${r.status}`);
    } catch (e) { errs.push(`${host} → ${String(e.message || e)}`); }
  }
  throw new Error(`no Jupiter endpoint answered (${errs.join(" | ")})`);
}
const SOL_MINT = "So11111111111111111111111111111111111111112";

// hard ceiling, in SOL, per order. Set VALO_MAX_ORDER_SOL to raise it.
// Deliberately tiny by default: the first live orders should be ones you would
// not mind losing entirely.
const MAX_SOL = Math.max(0.001, parseFloat(process.env.VALO_MAX_ORDER_SOL || "0.05"));
const ENABLED = String(process.env.VALO_ONCHAIN || "").trim() === "1";

const isMint = (m) => /^[A-Za-z0-9]{32,50}$/.test(String(m || ""));

export default async function handler(req, res) {
  if (!ENABLED) {
    return res.status(200).json({
      enabled: false,
      reason: "on-chain execution is switched off (set VALO_ONCHAIN=1 to enable)",
    });
  }
  const mode = String(req.query.mode || "quote");
  if (mode === "status") {
    // is on-chain live, and can we reach Jupiter at all?
    try {
      const { host } = await jupGet("/quote?inputMint=So11111111111111111111111111111111111111112"
        + "&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=100000&slippageBps=100");
      return res.status(200).json({ enabled: true, jupiter: "reachable", via: host, maxSol: MAX_SOL });
    } catch (e) {
      return res.status(200).json({ enabled: true, jupiter: "unreachable", error: String(e.message || e), maxSol: MAX_SOL });
    }
  }
  const inputMint = String(req.query.inputMint || SOL_MINT);
  const outputMint = String(req.query.outputMint || "");
  const amountLamports = Math.floor(parseFloat(req.query.amount || "0"));
  const slippageBps = Math.min(1000, Math.max(10, parseInt(req.query.slippageBps || "100", 10)));
  const userPublicKey = String(req.query.user || "");

  if (!isMint(inputMint) || !isMint(outputMint)) return res.status(400).json({ error: "bad mint" });
  if (!(amountLamports > 0)) return res.status(400).json({ error: "bad amount" });

  // size ceiling — enforced server-side so a tampered client can't exceed it
  if (inputMint === SOL_MINT) {
    const sol = amountLamports / 1e9;
    if (sol > MAX_SOL) {
      return res.status(400).json({ error: `order too large: ${sol} SOL exceeds the ${MAX_SOL} SOL limit`, maxSol: MAX_SOL });
    }
  }

  try {
    if (inputMint === outputMint) return res.status(400).json({ error: "input and output are the same token" });
    const qPath = `/quote?inputMint=${inputMint}&outputMint=${outputMint}`
      + `&amount=${amountLamports}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
    const { json: quote, host } = await jupGet(qPath);
    if (!quote || !quote.outAmount) throw new Error("no route for this pair");

    const summary = {
      inputMint, outputMint,
      inAmount: quote.inAmount, outAmount: quote.outAmount,
      otherAmountThreshold: quote.otherAmountThreshold,      // the worst case you accept
      priceImpactPct: quote.priceImpactPct != null ? +(+quote.priceImpactPct * 100).toFixed(4) : null,
      slippageBps,
      routeHops: (quote.routePlan || []).length,
      routeLabels: (quote.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean),
      maxSol: MAX_SOL, via: host,
    };

    if (mode === "quote") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ enabled: true, quote: summary });
    }

    // build: return an UNSIGNED transaction. Signing happens in the wallet.
    if (!isMint(userPublicKey)) return res.status(400).json({ error: "bad user pubkey" });
    const { json: sj } = await jupPost("/swap", {
      quoteResponse: quote,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    });
    if (!sj || !sj.swapTransaction) throw new Error("no transaction returned");

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      enabled: true,
      quote: summary,
      swapTransaction: sj.swapTransaction,      // base64, UNSIGNED
      lastValidBlockHeight: sj.lastValidBlockHeight ?? null,
      note: "unsigned — your wallet must approve this before anything happens",
    });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
