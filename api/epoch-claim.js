// 🎁 /api/epoch-claim — the user's claim.
//
// Under credit mode the hourly job writes balances into pending_rewards and
// sends nothing. This endpoint is where tokens actually move: the user signs
// in, clicks CLAIM, and the vault sends everything they are owed in one
// transfer.
//
// NO npm dependencies — built on _solana-lite.js for the same reason
// epoch-payout.js is: @solana/web3.js pulls rpc-websockets, which crashes
// Vercel's runtime with ERR_REQUIRE_ESM.
//
// SAFETY MODEL:
//   • the caller proves who they are with their own Supabase session token
//   • rows are locked before the send, so a double-click cannot pay twice
//   • a failed send unlocks them again — a balance is never silently lost
//   • claimed_at is stamped ONLY after the chain confirms the signature
//   • the destination is read from chain when it exists, derived only when new
import {
  b58decode, keypairFrom, buildTx, findAta,
  ixCreateAta, ixTransferChecked, TOKEN_PROGRAM, TOKEN_2022_PROGRAM,
} from "./_solana-lite.js";

const RPC = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
  : "https://api.mainnet-beta.solana.com");

const rpc = async (method, params) => {
  const r = await fetch(RPC(), {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(12000),
  });
  const j = await r.json();
  if (j && j.error) throw new Error(j.error.message || JSON.stringify(j.error));
  return j && j.result;
};

const SB_URL = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SB_KEY = () => (process.env.SUPABASE_SERVICE_KEY || "").trim();

const sb = async (path, opts = {}) => {
  const url = SB_URL(), key = SB_KEY();
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(opts.headers || {}) },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch (e) { return null; }
};

// the caller's identity, verified by Supabase against their own token
const userFromToken = async (token) => {
  const url = SB_URL(), key = SB_KEY();
  if (!token || !url || !key) return null;
  try {
    const r = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.id ? j : null;
  } catch (e) { return null; }
};

// the recipient's real token account, from chain; derived only if they hold none
const destFor = async (owner, mint, tokenProgram) => {
  try {
    const r = await rpc("getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
    const hit = r && Array.isArray(r.value) && r.value[0];
    if (hit && hit.pubkey) return { ata: hit.pubkey, exists: true };
  } catch (e) {}
  return { ata: findAta(owner, mint, tokenProgram), exists: false };
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (!SB_URL() || !SB_KEY()) return res.status(200).json({ ok: false, error: "storage not configured" });

    const MINT = (process.env.VALO_MINT || "").trim();
    const EPOCH_ADDR = (process.env.VALO_EPOCH || "").trim();
    const SECRET = (process.env.VALO_EPOCH_SECRET || "").trim();
    if (!MINT || !EPOCH_ADDR) return res.status(200).json({ ok: false, error: "VALO_MINT and VALO_EPOCH must be set" });
    if (!SECRET) return res.status(200).json({ ok: false, error: "claiming is not armed yet — VALO_EPOCH_SECRET is unset" });

    // ── who is asking
    const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const user = await userFromToken(token);
    if (!user) return res.status(401).json({ ok: false, error: "sign in to claim" });

    // ── where it goes
    const profs = await sb(`profiles?id=eq.${user.id}&select=payout_wallet`);
    const dest = profs && profs[0] && profs[0].payout_wallet;
    if (!dest) return res.status(200).json({ ok: false, error: "set a payout wallet in the vault panel first" });
    try { b58decode(dest); }
    catch (e) { return res.status(200).json({ ok: false, error: "your saved payout wallet is not a valid address" }); }

    // ── what is owed
    const rows = await sb(`pending_rewards?user_id=eq.${user.id}&claimed_at=is.null&claiming_at=is.null&select=id,tokens,epoch`);
    if (rows === null) return res.status(200).json({ ok: false, error: "could not read pending rewards" });
    if (!rows.length) return res.status(200).json({ ok: true, tokens: 0, rows: 0, note: "nothing pending" });
    const tokens = rows.reduce((a, r) => a + (+r.tokens || 0), 0);
    if (!(tokens > 0)) return res.status(200).json({ ok: true, tokens: 0, rows: 0 });

    // ── lock first: a second click finds nothing claimable
    const ids = rows.map((r) => r.id).join(",");
    const locked = await sb(`pending_rewards?id=in.(${ids})&claimed_at=is.null&claiming_at=is.null`, {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({ claiming_at: new Date().toISOString() }),
    });
    if (!Array.isArray(locked) || locked.length !== rows.length) {
      return res.status(200).json({ ok: false, error: "a claim is already in flight — try again in a moment" });
    }
    const unlock = () => sb(`pending_rewards?id=in.(${ids})&claimed_at=is.null`, {
      method: "PATCH", body: JSON.stringify({ claiming_at: null }),
    }).catch(() => {});

    // ── chain facts
    let decimals = 6, tokenProgram = TOKEN_PROGRAM, vaultAta = null, vaultBal = 0n;
    try {
      const mintAcc = await rpc("getAccountInfo", [MINT, { encoding: "jsonParsed" }]);
      const parsed = mintAcc && mintAcc.value && mintAcc.value.data && mintAcc.value.data.parsed;
      if (parsed && parsed.info && Number.isInteger(parsed.info.decimals)) decimals = parsed.info.decimals;
      if (mintAcc && mintAcc.value && mintAcc.value.owner === TOKEN_2022_PROGRAM) tokenProgram = TOKEN_2022_PROGRAM;

      const vaultAccs = await rpc("getTokenAccountsByOwner", [EPOCH_ADDR, { mint: MINT }, { encoding: "jsonParsed" }]);
      const hit = vaultAccs && Array.isArray(vaultAccs.value) && vaultAccs.value[0];
      vaultAta = hit ? hit.pubkey : null;
      vaultBal = hit ? BigInt(hit.account.data.parsed.info.tokenAmount.amount || "0") : 0n;
    } catch (e) {
      await unlock();
      return res.status(200).json({ ok: false, error: `chain read failed: ${String(e.message || e).slice(0, 150)}` });
    }

    const amountBase = BigInt(Math.floor(tokens * 10 ** decimals));
    if (amountBase <= 0n) { await unlock(); return res.status(200).json({ ok: false, error: "amount too small to send" }); }
    if (!vaultAta || vaultBal < amountBase) {
      await unlock();
      return res.status(200).json({ ok: false, error: "the vault is short right now — your balance is untouched, try again later" });
    }

    let signer;
    try { signer = keypairFrom(SECRET); }
    catch (e) { await unlock(); return res.status(200).json({ ok: false, error: "vault key unreadable" }); }
    if (signer.publicKey !== EPOCH_ADDR) {
      await unlock();
      return res.status(200).json({ ok: false, error: "vault key does not match VALO_EPOCH — refusing to send" });
    }

    // ── send
    let sig = null;
    try {
      const { ata, exists } = await destFor(dest, MINT, tokenProgram);
      const ixs = [];
      if (!exists) ixs.push(ixCreateAta({ payer: signer.publicKey, ata, owner: dest, mint: MINT, tokenProgram }));
      ixs.push(ixTransferChecked({
        source: vaultAta, mint: MINT, dest: ata, owner: signer.publicKey,
        amount: amountBase.toString(), decimals, tokenProgram,
      }));
      const bh = await rpc("getLatestBlockhash", [{ commitment: "confirmed" }]);
      const blockhash = bh && bh.value && bh.value.blockhash;
      if (!blockhash) throw new Error("no blockhash");
      const raw = buildTx({ payer: signer.publicKey, instructions: ixs, recentBlockhash: blockhash, signer });
      sig = await rpc("sendTransaction", [raw, { encoding: "base64", maxRetries: 3, skipPreflight: false }]);
    } catch (e) {
      await unlock();
      return res.status(200).json({ ok: false, error: `send failed: ${String(e.message || e).slice(0, 180)} — your balance is untouched` });
    }

    // ── confirm before recording. A signature is not a settlement.
    let confirmed = false;
    for (let i = 0; i < 12 && !confirmed; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      try {
        const st = await rpc("getSignatureStatuses", [[sig], { searchTransactionHistory: true }]);
        const v = st && st.value && st.value[0];
        if (v && v.err) throw new Error("transaction failed on chain");
        if (v && (v.confirmationStatus === "confirmed" || v.confirmationStatus === "finalized")) confirmed = true;
      } catch (e) {
        await unlock();
        return res.status(200).json({ ok: false, error: `claim failed on chain: ${String(e.message || e).slice(0, 150)}`, sig });
      }
    }
    if (!confirmed) {
      // do NOT unlock — the transfer may still land. Leave it locked for a
      // human to reconcile rather than risk paying the same balance twice.
      return res.status(200).json({
        ok: false, pending: true, sig,
        solscan: `https://solscan.io/tx/${sig}`,
        error: "sent but not confirmed yet — check Solscan; this balance is held until it settles",
      });
    }

    await sb(`pending_rewards?id=in.(${ids})`, {
      method: "PATCH",
      body: JSON.stringify({ claimed_at: new Date().toISOString(), claim_sig: sig, claiming_at: null }),
    });

    return res.status(200).json({
      ok: true, tokens, rows: rows.length, wallet: dest,
      signature: sig, solscan: `https://solscan.io/tx/${sig}`,
    });
  } catch (e) {
    return res.status(200).json({ ok: false, error: String(e && e.message || e).slice(0, 250) });
  }
}
