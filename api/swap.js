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
const looksNoRoute = (t) => /route|ROUTE_NOT_FOUND|COULD_NOT_FIND/i.test(String(t || ""));
async function jupGet(path) {
  const errs = [];
  for (const host of JUP_HOSTS) {
    try {
      const r = await fetch(`${host}${path}`, { headers: jupHeaders() });
      if (r.ok) return { json: await r.json(), host };
      const body = await r.text().catch(() => "");
      if (r.status === 400 && looksNoRoute(body)) {
        const e2 = new Error(NO_ROUTE); e2.noRoute = true; throw e2;   // definitive — stop asking
      }
      errs.push(`${host} → ${r.status}${body ? ` (${body.slice(0, 120)})` : ""}`);
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
        body: JSON.stringify(body),
      });
      if (r.ok) return { json: await r.json(), host };
      const bt = await r.text().catch(() => "");
      if (r.status === 400 && looksNoRoute(bt)) {
        const e2 = new Error(NO_ROUTE); e2.noRoute = true; throw e2;
      }
      errs.push(`${host} → ${r.status}${bt ? ` (${bt.slice(0, 120)})` : ""}`);
    } catch (e) {
      if (e && e.noRoute) throw e;
      errs.push(`${host} → ${String(e.message || e)}`);
    }
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
      return res.status(200).json({ enabled: true, jupiter: "reachable", via: host, maxSol: MAX_SOL });
    } catch (e) {
      return res.status(200).json({ enabled: true, jupiter: "unreachable", error: String(e.message || e), maxSol: MAX_SOL });
    }
  }
  const inputMint = String(req.query.inputMint || SOL_MINT);
  const outputMint = String(req.query.outputMint || "");
  const slippageBps = Math.min(1000, Math.max(10, parseInt(req.query.slippageBps || "100", 10)));
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
      const r2 = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          publicKey: userPublicKey, action: selling2 ? "sell" : "buy", mint: mint2,
          amount: amount2, denominatedInSol: selling2 ? "false" : "true",
          slippage: Math.max(1, Math.round(slippageBps / 100)), priorityFee: 0.00008, pool: "auto",
        }),
      });
      if (!r2.ok) {
        const bt = await r2.text().catch(() => "");
        throw new Error(`no Jupiter route, and the pump.fun curve refused it too (${r2.status}${bt ? `: ${bt.slice(0, 140)}` : ""})`);
      }
      const buf = Buffer.from(await r2.arrayBuffer());
      if (!buf.length) throw new Error("pump.fun curve returned an empty transaction");
      return buf.toString("base64");
    };

    const qPath = `/quote?inputMint=${inputMint}&outputMint=${outputMint}`
      + `&amount=${amountBase.toString()}&slippageBps=${slippageBps}&onlyDirectRoutes=false`;
    let quoteRes = null, curveMode = false;
    try { quoteRes = await jupGet(qPath); }
    catch (e) {
      if (!(e && e.noRoute)) throw e;
      curveMode = true;   // pre-migration pump coin — the curve is the venue
    }
    const quote = quoteRes ? quoteRes.json : null;
    const host = quoteRes ? quoteRes.host : "pump.fun-curve";
    if (!curveMode && (!quote || !quote.outAmount)) throw new Error("no route for this pair");

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
          solOut: null, solOutMin: null, aboveTestSize: false, curve: true,
        }});
      }
      if (!isMint(userPublicKey)) return res.status(400).json({ error: "bad user pubkey" });
      const b64 = await pumpLocal();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ enabled: true, curve: true, via: "pump.fun-curve",
        swapTransaction: b64, quote: { inAmount: amountBase.toString(), outAmount: null, outDecimals, curve: true } });
    }

    const summary = {
      inputMint, outputMint,
      inAmount: quote.inAmount, outAmount: quote.outAmount,
      otherAmountThreshold: quote.otherAmountThreshold,      // the worst case you accept
      priceImpactPct: quote.priceImpactPct != null ? +(+quote.priceImpactPct * 100).toFixed(4) : null,
      slippageBps,
      routeHops: (quote.routePlan || []).length,
      routeLabels: (quote.routePlan || []).map((r) => r?.swapInfo?.label).filter(Boolean),
      maxSol: MAX_SOL, via: host,
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
