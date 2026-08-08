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
const NO_ROUTE = "NOROUTE";
const looksNoRoute = (t) => /ROUTE_NOT_FOUND|COULD_NOT_FIND_ANY_ROUTE|no routes? found|not tradable|TOKEN_NOT_TRADABLE|NOT_SUPPORTED/i.test(String(t || ""));
async function jupGet(path) {
  const errs = [];
  for (const host of JUP_HOSTS) {
    try {
      const r = await fetch(`${host}${path}`, { headers: jupHeaders(), signal: AbortSignal.timeout(9000) });
      if (r.ok) return { json: await r.json(), host };
      const body = await r.text().catch(() => "");
      if (r.status === 400 && looksNoRoute(body)) {
        const e2 = new Error(NO_ROUTE); e2.noRoute = true; e2.jupBody = body.slice(0, 300); throw e2;
      }
      errs.push(`${host} → ${r.status}${body ? ` (${body.slice(0, 200)})` : ""}`);
    } catch (e) {
      if (e && e.noRoute) throw e;
      errs.push(`${host} → ${String(e.message || e)}`);
    }
  }
  throw new Error(`no Jupiter endpoint answered (${errs.join(" | ")})`);
}
async function jupPost(path, body) {
  const errs = [];
  for (const host of JUP_HOSTS) {
    try {
      const r = await fetch(`${host}${path}`, {
        method: "POST", headers: { ...jupHeaders(), "content-type": "application/json" },
        body: JSON.stringify(body), signal: AbortSignal.timeout(9000) });
      if (r.ok) return { json: await r.json(), host };
      const bt = await r.text().catch(() => "");
      errs.push(`${host} → ${r.status}${bt ? ` (${bt.slice(0, 220)})` : ""}`);
    } catch (e) {
      errs.push(`${host} → ${String(e.message || e)}`);
    }
  }
  const be = new Error(`the swap builder refused this trade (${errs.join(" | ")})`);
  be.buildFail = true;
  throw be;
}
const SOL_MINT = "So11111111111111111111111111111111111111112";

// hard ceiling, in SOL, per order. Set VALO_MAX_ORDER_SOL to raise it.
// Deliberately tiny by default: the first live orders should be ones you would
// not mind losing entirely.
const MAX_SOL = Math.max(0.001, parseFloat(process.env.VALO_MAX_ORDER_SOL || "0.05"));
// Ceiling on the priority bid. ~0.0005 SOL buys inclusion during normal
// contention; only what's needed is actually spent. Raise with
// VALO_PRIORITY_MAX_LAMPORTS if fills start dropping during heavy congestion.
const PRIORITY_MAX_LAMPORTS = Math.max(1000,
  parseInt(process.env.VALO_PRIORITY_MAX_LAMPORTS || "500000", 10) || 500000);
const ENABLED = String(process.env.VALO_ONCHAIN || "").trim() === "1";

const isMint = (m) => /^[A-Za-z0-9]{32,50}$/.test(String(m || ""));
const isPumpMint = (m) => /pump$/i.test(String(m || ""));
const FEE_BPS = Math.max(0, Math.min(500, parseInt(process.env.VALO_FEE_BPS || "60", 10) || 0));        // SOL routes: 0.6%
const FEE_BPS_VALO = Math.max(0, Math.min(500, parseInt(process.env.VALO_FEE_BPS_VALO || "30", 10) || 0)); // $VALO routes: 0.3%
// treasury is the default fee destination — VALO_FEE_ACCOUNT only overrides it
const FEE_ACCT = (process.env.VALO_FEE_ACCOUNT || process.env.VALO_TREASURY || "").trim();
const VALO_MINT_ADDR = (process.env.VALO_MINT || "").trim();
const BURN_ADDR = (process.env.VALO_BURN || "1nc1nerator11111111111111111111111111111111").trim();
const EPOCH_ADDR = (process.env.VALO_EPOCH || "").trim();
// per-route fee: any leg in $VALO gets the reduced rate
const bpsFor = (inputMint, outputMint) =>
  VALO_MINT_ADDR && (inputMint === VALO_MINT_ADDR || outputMint === VALO_MINT_ADDR) ? FEE_BPS_VALO : FEE_BPS;
const feeViaJup = FEE_BPS > 0 && isMint(FEE_ACCT);

// Jupiter takes its platform fee into a token account owned by our treasury.
// Look it up on chain — a wallet address here is what caused 0x1789.
const feeAtaCache = new Map();
const feeAtaFor = async (owner, mint) => {
  if (!owner || !mint) return null;
  const key = owner + ":" + mint;
  if (feeAtaCache.has(key)) return feeAtaCache.get(key);
  try {
    const r = await fetch(RPC(), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }] }),
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    const acc = j && j.result && Array.isArray(j.result.value) && j.result.value[0];
    const ata = acc ? acc.pubkey : null;
    feeAtaCache.set(key, ata);
    return ata;
  } catch (e) { return null; }
};

const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

// How many decimals does this mint use? Read from the chain, cached for the
// life of the lambda. Never guessed: being wrong by one place is a 10x order.
const decCache = new Map();
async function mintDecimals(mint) {
  if (decCache.has(mint)) return decCache.get(mint);
  const r = await fetch(RPC(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo",
      params: [mint, { encoding: "jsonParsed" }] }),
  });
  if (!r.ok) throw new Error(`rpc ${r.status} while reading decimals`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error while reading decimals");
  const d = j?.result?.value?.data?.parsed?.info?.decimals;
  if (!Number.isInteger(d)) throw new Error("could not read decimals for this mint");
  decCache.set(mint, d);
  return d;
}

// The order size in base units, from whichever form the client sent:
//   amountRaw — exact base units. Used for full exits, so a float round-trip
//               can never strand unsellable dust in the account.
//   amountUi  — human units, converted here using the mint's real decimals.
//   amount    — base units already (what buys have always sent).
// BigInt throughout: a 9-decimal token with a large balance exceeds what a
// double can hold exactly, and it fails silently when it does.
async function resolveAmount(q, inputMint) {
  const raw = String(q.amountRaw || "").trim();
  if (raw) {
    if (!/^\d+$/.test(raw)) throw new Error("bad amountRaw");
    return BigInt(raw);
  }
  const ui = String(q.amountUi || "").trim();
  if (ui) {
    if (!/^\d+(\.\d+)?$/.test(ui)) throw new Error("bad amountUi");
    const d = await mintDecimals(inputMint);
    const [whole, frac = ""] = ui.split(".");
    return BigInt(whole + (d > 0 ? (frac + "0".repeat(d)).slice(0, d) : ""));
  }
  const legacy = String(q.amount || "").trim();
  if (!/^\d+(\.\d+)?$/.test(legacy)) throw new Error("bad amount");
  return BigInt(Math.floor(parseFloat(legacy)));
}

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
      return res.status(200).json({ enabled: true, feeBps: FEE_BPS, feeBpsValo: FEE_BPS_VALO,
        feeVia: feeViaJup ? "jupiter" : (FEE_BPS > 0 ? "client" : "none"), jupiter: "reachable", via: host, maxSol: MAX_SOL,
        curve: "pump.fun bonding curve used automatically for pre-graduation pump mints",
        feeAccountNote: feeViaJup
          ? "platform fee routes to the treasury's token account for the traded mint (created on first fee)"
          : "no platform fee configured",
        feeSplit: { burn: BURN_ADDR, epoch: EPOCH_ADDR || null, creator: (process.env.VALO_CREATOR || "").trim() || null,
          treasury: (process.env.VALO_TREASURY || "").trim() || null, deployer: (process.env.VALO_DEPLOYER || "").trim() || null } });
    } catch (e) {
      return res.status(200).json({ enabled: true, jupiter: "unreachable", error: String(e.message || e), maxSol: MAX_SOL });
    }
  }
  const inputMint = String(req.query.inputMint || SOL_MINT);
  const outputMint = String(req.query.outputMint || "");
  const DEFAULT_SLIP = Math.max(50, parseInt(process.env.VALO_SLIPPAGE_BPS || "300", 10));
  const slippageBps = Math.min(3000, Math.max(10, parseInt(req.query.slippageBps || String(DEFAULT_SLIP), 10)));
  const userPublicKey = String(req.query.user || "");

  if (!isMint(inputMint) || !isMint(outputMint)) return res.status(400).json({ error: "bad mint" });
  if (inputMint === outputMint) return res.status(400).json({ error: "input and output are the same token" });

  const selling = inputMint !== SOL_MINT;
  let amountBase;
  try {
    amountBase = await resolveAmount(req.query, inputMint);
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  if (!(amountBase > 0n)) return res.status(400).json({ error: "bad amount" });

  // Size ceiling — enforced server-side so a tampered client can't exceed it.
  // It caps BUYS only. A cap on selling would mean someone whose position grew
  // past the limit could not fully exit through VALO, which is the one-way door
  // this whole path exists to avoid. Sells are surfaced to the user instead:
  // the quote reports the SOL coming back and flags when it is unusually large.
  if (!selling) {
    const sol = Number(amountBase) / 1e9;
    if (sol > MAX_SOL) {
      return res.status(400).json({ error: `order too large: ${sol} SOL exceeds the ${MAX_SOL} SOL limit`, maxSol: MAX_SOL });
    }
  }

  // what the receiving side counts in — SOL is 9, every token is its own
  let outDecimals = 9;
  try {
    if (outputMint !== SOL_MINT) outDecimals = await mintDecimals(outputMint);
  } catch (e) { /* fall back to the display default rather than blocking a trade */ }

  try {
    // curve fallback — builds the unsigned tx from pump.fun's own curve
    const pumpLocal = async () => {
      const selling2 = inputMint !== SOL_MINT;
      const mint2 = selling2 ? inputMint : outputMint;
      let amount2;
      if (selling2) {
        const d = await mintDecimals(mint2);
        amount2 = Number(amountBase) / Math.pow(10, d);   // token UI units
      } else {
        amount2 = Number(amountBase) / 1e9;               // SOL
      }
      const body2 = {
        publicKey: userPublicKey, action: selling2 ? "sell" : "buy", mint: mint2,
        amount: amount2, denominatedInSol: selling2 ? "false" : "true",
        slippage: Math.max(1, Math.round(slippageBps / 100)), priorityFee: 0.00008, pool: "auto",
      };
      // providers that can build a pump.fun curve transaction, in order
      const CURVE_HOSTS = [
        "https://pumpportal.fun/api/trade-local",
        "https://api.pumpportal.fun/api/trade-local",
      ];
      const notes = [];
      for (const host2 of CURVE_HOSTS) {
        try {
          const r2 = await fetch(host2, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(body2), signal: AbortSignal.timeout(9000),
          });
          if (!r2.ok) {
            const bt = await r2.text().catch(() => "");
            notes.push(`${host2.replace(/^https:\/\//, "")} → ${r2.status}${bt ? `: ${bt.slice(0, 120)}` : ""}`);
            continue;
          }
          const buf = Buffer.from(await r2.arrayBuffer());
          if (!buf.length) { notes.push(`${host2.replace(/^https:\/\//, "")} → empty transaction`); continue; }
          return buf.toString("base64");
        } catch (e3) {
          notes.push(`${host2.replace(/^https:\/\//, "")} → ${String(e3 && e3.message || e3).slice(0, 90)}`);
        }
      }
      throw new Error(`the pump.fun curve wouldn't build this trade (${notes.join(" | ")})`);
    };

    const qBase = `/quote?inputMint=${inputMint}&outputMint=${outputMint}`
      + `&amount=${amountBase.toString()}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
    const feeQ = feeViaJup ? `&platformFeeBps=${bpsFor(inputMint, outputMint)}` : "";
    let quoteRes = null, curveMode = false, jupErr = null;
    const pumpPair = isPumpMint(inputMint) || isPumpMint(outputMint);
    try { quoteRes = await jupGet(qBase + feeQ); }
    catch (e) {
      jupErr = String(e && e.message || e);
      // a fee leg is often what kills a thin route — retry clean before giving up
      if (feeQ) { try { quoteRes = await jupGet(qBase); } catch (e2) { jupErr = String(e2 && e2.message || e2); } }
      if (!quoteRes) {
        // any pump mint → the bonding curve IS the market. Not a fallback so
        // much as the correct venue before graduation.
        if (pumpPair) curveMode = true;
        else if (e && e.noRoute) curveMode = false;
        else throw e;
      }
    }
    const quote = quoteRes ? quoteRes.json : null;
    const host = quoteRes ? quoteRes.host : "pump.fun-curve";
    if (!curveMode && (!quote || !quote.outAmount)) {
      // no Jupiter path at all → let the pump.fun curve answer (it's the real
      // venue for a token that hasn't graduated yet)
      if (pumpPair) curveMode = true;
      else throw new Error(`no route for this pair (jupiter: ${jupErr || "empty quote"})`);
    }

    if (curveMode) {
      // honest curve summary: pump.fun's curve prices at execution, so there's
      // no pre-trade outAmount to promise — the client shows this plainly.
      if (mode === "quote") {
        res.setHeader("Cache-Control", "no-store");
        return res.status(200).json({ enabled: true, quote: {
          inputMint, outputMint, inAmount: amountBase.toString(), outAmount: null,
          otherAmountThreshold: null, priceImpactPct: null, slippageBps,
          routeHops: 1, routeLabels: ["pump.fun bonding curve"], maxSol: MAX_SOL,
          via: "pump.fun-curve", side: selling ? "sell" : "buy", outDecimals,
          feeBps: bpsFor(inputMint, outputMint), feeVia: bpsFor(inputMint, outputMint) > 0 ? "client" : "none",
          solOut: null, solOutMin: null, aboveTestSize: false, curve: true,
        }});
      }
      if (!isMint(userPublicKey)) return res.status(400).json({ error: "bad user pubkey" });
      let b64;
      try { b64 = await pumpLocal(); }
      catch (ce) {
        // surface the CURVE's own reason — reporting the old Jupiter NOROUTE
        // here sent everyone chasing the wrong problem
        return res.status(200).json({ enabled: true, error: String(ce && ce.message || ce),
          venue: "pump.fun-curve", jupiter: jupErr || null });
      }
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ enabled: true, curve: true, via: "pump.fun-curve",
        swapTransaction: b64, quote: { inAmount: amountBase.toString(), outAmount: null, outDecimals, curve: true } });
    }

    let feeSide = null;   // which mint's treasury account collected: output | input | refused
    const summary = {
      inputMint, outputMint,
      inAmount: quote.inAmount, outAmount: quote.outAmount,
      otherAmountThreshold: quote.otherAmountThreshold,      // the worst case you accept
      priceImpactPct: quote.priceImpactPct != null ? +(+quote.priceImpactPct * 100).toFixed(4) : null,
      slippageBps,
      routeHops: (quote.routePlan || []).length,
      routeLabels: (quote.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean),
      maxSol: MAX_SOL, via: host,
      feeBps: bpsFor(inputMint, outputMint), feeVia: feeViaJup ? "jupiter" : (bpsFor(inputMint, outputMint) > 0 ? "client" : "none"),
      feeSide,
      side: selling ? "sell" : "buy",
      outDecimals,
      // on a sell, what actually lands back in the wallet
      solOut: selling ? Number(quote.outAmount) / 1e9 : null,
      solOutMin: selling ? Number(quote.otherAmountThreshold) / 1e9 : null,
      // not a block — a flag, so the UI can say "this is bigger than your test size"
      aboveTestSize: selling ? (Number(quote.outAmount) / 1e9) > MAX_SOL : false,
    };

    if (mode === "quote") {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ enabled: true, quote: summary });
    }

    // build: return an UNSIGNED transaction. Signing happens in the wallet.
    if (!isMint(userPublicKey)) return res.status(400).json({ error: "bad user pubkey" });
    // fee mint = whichever side of the route Jupiter charges on (the output
    // mint for ExactIn). No ATA → no platform fee → the swap still goes through.
    let feeAta = feeViaJup ? await feeAtaFor(FEE_ACCT, outputMint) : null;
    feeSide = feeAta ? "output" : null;
    // Do NOT fall back to the input-side account: Jupiter builds it and then
    // rejects it on chain with 0x177e. Sells already have SOL as the output.

    let buildQuote = quote;
    let feeDropped = false;
    if (quote && quote.platformFee && !feeAta) {
      // priced with a fee we have no account to receive → re-price clean
      try {
        const rq = await jupGet(qBase);
        if (rq && rq.json && rq.json.outAmount) { buildQuote = rq.json; feeDropped = true; }
      } catch (e) { /* keep the original; the builder error will name the reason */ }
    }
    const buildSwap = (qr, acct) => jupPost("/swap", {
      quoteResponse: qr,
      userPublicKey,
      ...(acct && qr.platformFee ? { feeAccount: acct } : {}),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: {
          maxLamports: PRIORITY_MAX_LAMPORTS,   // ceiling, not a flat charge
          priorityLevel: "high",
          global: false,                        // price against THIS route's accounts
        },
      },
    });
    let sj = null;
    try {
      ({ json: sj } = await buildSwap(buildQuote, feeAta));
    } catch (e1) {
      if (!(feeAta && buildQuote.platformFee)) throw e1;
      // the fee account was refused — take the trade without the fee rather
      // than losing the fill. Which side was tried is reported below.
      feeAta = null; feeSide = "refused"; feeDropped = true;
      const rq2 = await jupGet(qBase);
      buildQuote = (rq2 && rq2.json) || buildQuote;
      ({ json: sj } = await buildSwap(buildQuote, null));
    }
    if (!sj || !sj.swapTransaction) throw new Error("no transaction returned");

    const builtSummary = feeDropped ? { ...summary,
      outAmount: buildQuote.outAmount,
      otherAmountThreshold: buildQuote.otherAmountThreshold,
      feeBps: bpsFor(inputMint, outputMint), feeVia: "client", feeSide,
      feeNote: "no treasury token account for this mint — collected as a SOL transfer instead",
      solOut: selling ? Number(buildQuote.outAmount) / 1e9 : null,
      solOutMin: selling ? Number(buildQuote.otherAmountThreshold) / 1e9 : null,
    } : summary;

    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      enabled: true,
      quote: { ...builtSummary, feeSide },
      swapTransaction: sj.swapTransaction,      // base64, UNSIGNED
      lastValidBlockHeight: sj.lastValidBlockHeight ?? null,
      note: "unsigned — your wallet must approve this before anything happens",
    });
  } catch (e) {
    // 🔬 name the route we tried — a bare "NOROUTE" hides whether Jupiter, the
    // curve, or our own mint detection was the problem
    const msg = String(e && e.message || e);
    res.status(200).json({
      error: (e && e.buildFail) ? msg
        : (msg === NO_ROUTE ? "no route found for this pair" : msg),
      stage: (e && e.buildFail) ? "build" : "quote",
      diag: {
        jupiterSaid: (e && e.jupBody) || msg.slice(0, 400),
        inputMint: String(req.query.inputMint || SOL_MINT),
        outputMint: String(req.query.outputMint || ""),
        pumpPair: isPumpMint(String(req.query.inputMint || "")) || isPumpMint(String(req.query.outputMint || "")),
        curveEligible: isPumpMint(String(req.query.outputMint || "")) || isPumpMint(String(req.query.inputMint || "")),
        mode: String(req.query.mode || "quote"),
        amount: String(req.query.amount || ""),
      },
    });
  }
}
