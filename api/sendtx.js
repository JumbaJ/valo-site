// VALO — /api/sendtx : relay an ALREADY-SIGNED transaction to the network.
// The signature was produced by the user's wallet; we only forward the bytes
// and report what the chain says. Optional — the client can submit directly.
const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

export default async function handler(req, res) {
  if (String(process.env.VALO_ONCHAIN || "").trim() !== "1") {
    return res.status(200).json({ enabled: false });
  }
  // GET ?sig=... → has this transaction actually confirmed, and did it succeed?
  if (req.method === "GET" && req.query.blockhash) {
    try {
      const r = await fetch(RPC(), { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestBlockhash", params: [{ commitment: "finalized" }] }) });
      const j = await r.json();
      const v = j && j.result && j.result.value;
      if (!v) return res.status(502).json({ error: "no blockhash" });
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ blockhash: v.blockhash, lastValidBlockHeight: v.lastValidBlockHeight });
    } catch (e) { return res.status(502).json({ error: String(e.message || e) }); }
  }
  if (req.method === "GET") {
    const sig = String(req.query.sig || "");
    if (!/^[A-Za-z0-9]{80,100}$/.test(sig)) return res.status(400).json({ error: "bad signature" });
    try {
      const r = await fetch(RPC(), {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignatureStatuses",
          params: [[sig], { searchTransactionHistory: true }] }),
      });
      const j = await r.json();
      const st = j?.result?.value?.[0] || null;
      res.setHeader("Cache-Control", "no-store");
      if (!st) return res.status(200).json({ found: false, status: "pending" });
      // err is non-null when the transaction ran and reverted — a real failure,
      // not a delay, and the user's funds did not move.
      return res.status(200).json({
        found: true,
        status: st.err ? "failed" : (st.confirmationStatus || "processed"),
        confirmed: !st.err && ["confirmed", "finalized"].includes(st.confirmationStatus),
        err: st.err ? JSON.stringify(st.err) : null,
      });
    } catch (e) {
      return res.status(502).json({ error: String(e.message || e) });
    }
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
    const signed = String(body.signed || "");
    if (!signed) return res.status(400).json({ error: "no signed transaction" });
    const r = await fetch(RPC(), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "sendTransaction",
        params: [signed, { encoding: "base64", maxRetries: 3, skipPreflight: false }],
      }),
    });
    const j = await r.json();
    if (j.error) return res.status(200).json({ ok: false, error: j.error.message || "rejected by the network" });
    res.status(200).json({ ok: true, signature: j.result, solscan: `https://solscan.io/tx/${j.result}` });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
