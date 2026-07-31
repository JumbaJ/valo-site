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
