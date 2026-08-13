// VALO — turbo control, standalone.
//
// A page of its own at /unlock.html. Not a route inside ValoTerminal.jsx, not
// an overlay grafted into a 21,000-line component — a separate entry that does
// exactly one job: hold the turbo key and sign what the extension asks for.
//
// WHY IT LIVES HERE AND NOT IN THE EXTENSION
//   The PIN is typed into valotrading.app, on its own origin, with the URL bar
//   visible. It is never passed through postMessage and never leaves this page.
//   An extension popup that collects a wallet PIN is indistinguishable from the
//   phishing extensions people get drained by, and it would put the secret in a
//   channel every script on the page can read.
//
// WHY IT IS SEPARATE FROM THE TERMINAL
//   Same origin, so it shares localStorage and reads the same valo-turbo-v1
//   record with the same PBKDF2/AES-GCM parameters. But it is its own bundle,
//   so nothing here can break the terminal and nothing there can break this.
//
// The decrypted key lives in this page's memory only. Close the window and it
// is gone — which is the property that makes the PIN worth having.

import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

const SOLM = "So11111111111111111111111111111111111111112";
const KEY = "valo-turbo-v1";

// identical parameters to the terminal's turboCrypto — a mismatch here would
// silently fail to decrypt a perfectly good record
const crypt = {
  async derive(pin, salt) {
    const km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  },
  async decrypt(blob, pin) {
    const u8 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
    const key = await this.derive(pin, u8(blob.salt));
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8(blob.iv) }, key, u8(blob.ct)));
  },
};

let web3mod = null;
const loadWeb3 = async () => {
  if (!web3mod) web3mod = await import("https://esm.sh/@solana/web3.js@1.95.3");
  return web3mod;
};

const T = {
  bg: "#0B0E14", card: "#11151d", line: "#1c2230", line2: "#262d3d",
  text: "#E6E9F0", dim: "#8A93A6", faint: "#5C6478",
  purple: "#7D5CF0", green: "#16C784", red: "#EA3943", amber: "#F5A524",
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
};

function Unlock() {
  const [rec, setRec] = useState(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [armed, setArmed] = useState(false);
  const [log, setLog] = useState([]);
  const kpRef = useRef(null);
  const armedRef = useRef(false);
  const [armLeft, setArmLeft] = useState(0);   // seconds of standing permission
  // ?sign=1 - the extension needs a page with Phantom's provider on it, not the
  // turbo key. Showing a PIN box here would ask for a secret the request does
  // not use.
  const signMode = (() => { try { return /[?&]sign=1/.test(window.location.search); } catch (e) { return false; } })();

  const say = (t) => setLog((L) => [{ t, at: Date.now() }, ...L].slice(0, 6));

  useEffect(() => {
    try { setRec(JSON.parse(localStorage.getItem(KEY) || "null")); } catch (e) { setRec(null); }
  }, []);

  const doUnlock = async () => {
    if (!rec) { setErr("no turbo wallet on this device"); return; }
    setBusy(true); setErr("");
    try {
      const secret = await crypt.decrypt(rec, pin);
      const web3 = await loadWeb3();
      kpRef.current = web3.Keypair.fromSecretKey(secret);
      setUnlocked(true); setPin("");
      say("unlocked");
    } catch (e) {
      // AES-GCM auth failure — a wrong PIN and a corrupt record look the same,
      // and neither leaks anything about the key
      setErr("wrong PIN");
    }
    setBusy(false);
  };

  // ARM is a standing permission: while it holds, any script running on this
  // origin can post a sellConfirm and it will sign. The origin check proves the
  // message came from this page, not that it came from the user. So it expires.
  const ARM_SECONDS = 900;
  useEffect(() => {
    if (!armed) { setArmLeft(0); return; }
    setArmLeft(ARM_SECONDS);
    const iv = setInterval(() => {
      setArmLeft((n) => {
        if (n <= 1) { setArmed(false); armedRef.current = false; say("auto-disarmed"); return 0; }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(iv);
  }, [armed]);

  const doLock = () => {
    kpRef.current = null;
    setUnlocked(false);
    setArmed(false); armedRef.current = false;
    say("locked");
  };

  // ---- the extension bridge -------------------------------------------
  // Same protocol as the terminal's listener: same-origin only, nonce echoed,
  // and no operation accepts a destination from the caller.
  useEffect(() => {
    const onMsg = async (ev) => {
      if (ev.source !== window || ev.origin !== window.location.origin) return;
      const d = ev.data;
      if (!d || d.__VALO_EXT_BRIDGE__ !== 1 || !d.nonce) return;
      // identify the responder, so a wrong answer names its own source
      const reply = (p) => window.postMessage(
        { __VALO_EXT_BRIDGE__: 2, nonce: d.nonce,
          from: "unlock", path: window.location.pathname,
          ops: ["hasKey", "ready", "send", "sellQuote", "sellConfirm"], ...p },
        window.location.origin);

      const kp = kpRef.current;
      try {
        if (d.op === "hasKey" || d.op === "ready") {
          reply({ ok: true, unlocked: !!kp, armed: armedRef.current,
            turbo: (rec && rec.pubkey) || null });
          return;
        }
        // These guards protect the TURBO key. A Phantom-owned position is
        // signed by Phantom, which raises its own approval every time - so it
        // needs neither an unlock nor an arm, and demanding them was raising
        // the PIN window for a sale that has nothing to do with that key.
        const phantomOwned = d.src === "phantom" ||
          (!!d.owner && !!rec && d.owner !== rec.pubkey);
        if (!phantomOwned) {
          if (!kp) { reply({ ok: false, locked: true, err: "turbo is locked" }); return; }
          if (!armedRef.current) { reply({ ok: false, err: "not armed — arm this window first" }); return; }
        }

        // amountRaw is exact base units and is what the endpoint prefers; a UI
        // amount rounds, which leaves dust behind on what should be a full exit.
        const amtOf = (m) => (m.raw ? `&amountRaw=${m.raw}` : `&amountUi=${m.qty}`);

        // sweep: turbo -> phantom. The destination is NOT taken from the
        // message — it is whatever Phantom is connected on this device, read
        // here. A bridge message can never name a payee.
        if (d.op === "send") {
          const dest = (() => { try { return localStorage.getItem("valo-phantom-addr"); } catch (e) { return null; } })();
          // validated here, not trusted: the value is read from this origin's
          // own storage, but a malformed address would fail deep inside web3
          if (!dest || !/^[A-Za-z0-9]{32,50}$/.test(dest)) {
            reply({ ok: false, err: "connect phantom first" }); return;
          }
          if (dest === rec.pubkey) { reply({ ok: false, err: "same wallet" }); return; }
          say("sweeping\u2026");
          const web3 = await loadWeb3();
          const bal = await (await fetch(`/api/wallet?address=${rec.pubkey}&t=${Date.now()}`)).json();
          const lamports = Math.floor(((bal && bal.sol) || 0) * 1e9);
          // Solana's rule: an account may be emptied to EXACTLY 0, or must keep
          // the rent-exempt minimum. Anything in between is rejected outright.
          const FEE = 5000, RENT_MIN = 895000;
          const attempt = async (lam) => {
            if (lam <= 0) throw new Error("nothing to sweep");
            const bh = await (await fetch("/api/sendtx?blockhash=1&t=" + Date.now())).json();
            if (!bh || !bh.blockhash) throw new Error((bh && bh.error) || "no blockhash");
            const tx = new web3.Transaction({
              feePayer: new web3.PublicKey(rec.pubkey), recentBlockhash: bh.blockhash });
            tx.add(web3.SystemProgram.transfer({
              fromPubkey: new web3.PublicKey(rec.pubkey),
              toPubkey: new web3.PublicKey(dest),
              lamports: lam,
            }));
            tx.sign(kp);
            const out = await relay(web3, tx);
            if (!out.sig) throw new Error(out.err);
            return { sig: out.sig, sol: lam / 1e9 };
          };
          try {
            const r1 = await attempt(lamports - FEE);            // empty to exactly 0
            say("swept " + r1.sol.toFixed(6) + " SOL");
            reply({ ok: true, sig: r1.sig, sol: r1.sol });
          } catch (e1) {
            if (!/rent/i.test(String(e1.message || e1))) {
              say("sweep failed: " + String(e1.message || e1));
              reply({ ok: false, err: String(e1.message || e1) });
              return;
            }
            // stale balance or an edge case - leave the rent minimum behind
            const r2 = await attempt(lamports - FEE - RENT_MIN);
            say("swept " + r2.sol.toFixed(6) + " SOL");
            reply({ ok: true, sig: r2.sig, sol: r2.sol });
          }
          return;
        }

        if (d.op === "sellQuote") {
          if (!d.raw && !(Number(d.qty) > 0)) { reply({ ok: false, err: "no amount for that holding" }); return; }
          const r = await fetch(`/api/swap?mode=quote&inputMint=${d.mint}&outputMint=${SOLM}${amtOf(d)}&slippageBps=${d.slip || 500}`);
          const j = await r.json();
          if (!r.ok || j.error) { reply({ ok: false, err: j.error || "no route" }); return; }
          const outSol = Number(j.outAmount || (j.quote && j.quote.outAmount) || 0) / 1e9;
          reply({ ok: true, quote: true, outSol,
            impact: Number(j.priceImpactPct || (j.quote && j.quote.priceImpactPct) || 0) });
          return;
        }

        if (d.op === "sellConfirm") {
          say("selling " + String(d.mint).slice(0, 6));
          const web3 = await loadWeb3();
          if (!d.raw && !(Number(d.qty) > 0)) { reply({ ok: false, err: "no amount for that holding" }); return; }
          const br = await fetch(`/api/swap?mode=build&inputMint=${d.mint}&outputMint=${SOLM}${amtOf(d)}&slippageBps=${d.slip || 600}&user=${d.owner || rec.pubkey}`);
          const bj = await br.json();
          if (!br.ok || bj.error || !bj.swapTransaction) { reply({ ok: false, err: bj.error || "no route" }); return; }
          const raw = Uint8Array.from(atob(bj.swapTransaction), (c) => c.charCodeAt(0));
          const tx = web3.VersionedTransaction.deserialize(raw);
          if (phantomOwned) {
            // Phantom signs AND submits in one call, over this page
            const prov = (window.phantom && window.phantom.solana) ||
              (window.solana && window.solana.isPhantom ? window.solana : null);
            if (!prov) { reply({ ok: false, err: "phantom not found on this page" }); return; }
            if (!prov.isConnected || !prov.publicKey) {
              try { await prov.connect(); }
              catch (e) { reply({ ok: false, err: "declined in phantom" }); return; }
            }
            try {
              const res = await prov.signAndSendTransaction(tx);
              const sig = res && (res.signature || res.sig);
              say(sig ? "sold" : "sell failed");
              reply(sig ? { ok: true, sig } : { ok: false, err: "no signature" });
            } catch (e) {
              const m = String((e && e.message) || e);
              say("sell failed: " + m);
              reply({ ok: false, err: /reject|4001|denied/i.test(m) ? "declined in phantom" : m });
            }
            return;
          }

          tx.sign([kp]);
          const out = await relay(web3, tx);
          say(out.sig ? "sold" : "sell failed: " + out.err);
          reply(out.sig ? { ok: true, sig: out.sig } : { ok: false, err: out.err });
          return;
        }

        reply({ ok: false, err: "unknown op: " + String(d.op) });
      } catch (e) { reply({ ok: false, err: String((e && e.message) || e) }); }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [rec]);

  // /api/sendtx relays an already-signed transaction and answers
  //   { ok:true, signature, solscan } | { ok:false, error, program, errorName, logs }
  // The failure branch carries the simulation logs naming the program that
  // threw — far more useful than a bare "not confirmed", so it is surfaced.
  const relay = async (web3, tx) => {
    const bytes = tx.serialize();
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const r = await fetch("/api/sendtx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ signed: btoa(bin) }),
    });
    const j = await r.json();
    if (j && j.ok && j.signature) return { sig: j.signature };
    return { err: (j && (j.error || j.errorName)) || "rejected by the network" };
  };

  const box = { background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: 16 };
  const btn = (bg, fg) => ({ padding: "10px 16px", border: bg === "transparent" ? `1px solid ${T.line2}` : 0,
    borderRadius: 8, background: bg, color: fg, fontWeight: 900, fontSize: 12, cursor: "pointer" });

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, padding: 18,
      font: "13px/1.5 ui-sans-serif, system-ui, sans-serif" }}>
      <div style={{ fontWeight: 900, letterSpacing: 1.6, fontSize: 12, marginBottom: 14 }}>
        VALO<span style={{ color: T.purple }}>·</span>TURBO
      </div>

      {signMode && (
        <div style={{ ...box, marginBottom: 12 }}>
          <div style={{ fontSize: 8.5, letterSpacing: 1.5, fontWeight: 900, color: T.faint, marginBottom: 6 }}>
            PHANTOM
          </div>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 5 }}>Approve in your wallet</div>
          <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.6 }}>
            Phantom signs this itself and shows you the amounts. The turbo key is
            not involved, so there is no PIN to enter.
          </div>
        </div>
      )}

      <div style={{ ...box, marginBottom: 12, display: signMode ? "none" : undefined }}>
        <div style={{ fontSize: 8.5, letterSpacing: 1.5, fontWeight: 900, color: T.faint, marginBottom: 6 }}>
          TRADING KEY
        </div>
        <div style={{ fontSize: 15, fontWeight: 900, color: unlocked ? T.green : T.amber, marginBottom: 6 }}>
          {unlocked ? "UNLOCKED" : rec ? "LOCKED" : "NO WALLET"}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, wordBreak: "break-all" }}>
          {(rec && rec.pubkey) || "create one in the terminal first"}
        </div>

        {!unlocked && rec && (
          <div style={{ marginTop: 12 }}>
            <input autoFocus type="password" inputMode="numeric" value={pin} placeholder="PIN"
              onChange={(e) => { setPin(e.target.value); setErr(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") doUnlock(); }}
              style={{ width: "100%", boxSizing: "border-box", background: "#0d1119",
                border: `1px solid ${T.line2}`, color: T.text, borderRadius: 8,
                padding: "11px 12px", fontSize: 16, fontFamily: T.mono, letterSpacing: 4 }} />
            {err && <div style={{ color: T.amber, fontSize: 11, marginTop: 7 }}>{err}</div>}
            <button disabled={busy || !pin} onClick={doUnlock}
              style={{ ...btn(T.purple, "#fff"), width: "100%", marginTop: 10, opacity: busy || !pin ? 0.5 : 1 }}>
              {busy ? "UNLOCKING…" : "UNLOCK"}
            </button>
          </div>
        )}

        {unlocked && (
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={doLock} style={btn("transparent", T.dim)}>LOCK</button>
          </div>
        )}
      </div>

      {unlocked && (
        <div style={{ ...box, marginBottom: 12, borderColor: armed ? T.purple : T.line }}>
          <div style={{ fontSize: 8.5, letterSpacing: 1.5, fontWeight: 900, color: T.faint, marginBottom: 6 }}>
            EXTENSION SIGNING
          </div>
          <div style={{ fontSize: 11, color: T.dim, lineHeight: 1.6, marginBottom: 12 }}>
            {armed
              ? `Armed for ${Math.floor(armLeft / 60)}:${String(armLeft % 60).padStart(2, "0")}. Sells from the extension sign here with no further prompt, and anything else running on this page could ask too — so it expires on its own.`
              : "Unlocked but not armed. Nothing signs until you arm it — an unlocked key alone is not permission."}
          </div>
          <button onClick={() => { const v = !armed; setArmed(v); armedRef.current = v; say(v ? "armed" : "disarmed"); }}
            style={{ ...btn(armed ? "transparent" : T.purple, armed ? T.amber : "#fff"), width: "100%" }}>
            {armed ? `DISARM · ${Math.floor(armLeft / 60)}:${String(armLeft % 60).padStart(2, "0")}` : "ARM FOR EXTENSION"}
          </button>
        </div>
      )}

      {!!log.length && (
        <div style={{ ...box, padding: 12 }}>
          {log.map((l) => (
            <div key={l.at + l.t} style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>
              {new Date(l.at).toLocaleTimeString()} · {l.t}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 10, color: T.faint, marginTop: 14, lineHeight: 1.6 }}>
        Your PIN is entered here, on valotrading.app, and never reaches the
        extension. The decrypted key exists only in this window's memory.
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Unlock />);
