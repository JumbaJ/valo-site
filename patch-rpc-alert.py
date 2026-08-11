#!/usr/bin/env python3
"""
VALO — make a dead RPC announce itself.

Run from the repo root:   python3 patch-rpc-alert.py

Today's whole cascade came from one silence: when Helius ran out of credits,
tokenBalance() and solBalance() swallowed the error and returned null, so
/api/epoch reported an empty-looking vault and epoch-payout reported "the epoch
vault holds no $VALO" — both indistinguishable from a genuinely empty vault.

This patches two files:

  api/epoch.js        adds `rpcOk` and `alert` so a null balance is visibly a
                      READ FAILURE, not a zero.

  api/epoch-payout.js refuses to conclude "nothing to distribute" when the
                      vault read actually threw. A failed read now returns
                      ok:false with rpcDown:true, so the run is recorded as
                      broken rather than as a legitimately empty epoch.
"""
import sys, os

def load(p):
    if not os.path.exists(p):
        sys.exit(f"! {p} not found — run this from the repo root")
    return open(p).read()

# ─────────────────────────────────────────────────────────────── api/epoch.js
P1 = "api/epoch.js"
s = load(P1)

if "rpcOk" in s:
    print("· api/epoch.js already patched, skipping")
else:
    a = '''    configured: !!EPOCH_W,'''
    if s.count(a) != 1:
        sys.exit(f"! api/epoch.js: expected one `configured:` line, found {s.count(a)}")
    s = s.replace(a, '''    configured: !!EPOCH_W,
    // a null balance means the RPC read FAILED — it does not mean the vault is
    // empty. Without this the two are indistinguishable, which is exactly how
    // an expired Helius key went unnoticed while payouts quietly failed.
    rpcOk: !(EPOCH_W && (vaultTokens === null || poolSol === null)),
    alert: (EPOCH_W && (vaultTokens === null || poolSol === null))
      ? "chain read failed — balances unknown, not zero. Check the RPC provider."
      : null,''')
    open(P1, "w").write(s)
    print("patched", P1)
    print("  · rpcOk + alert added")

# ──────────────────────────────────────────────────────── api/epoch-payout.js
P2 = "api/epoch-payout.js"
s = load(P2)

if "vaultReadOk" in s:
    print("· api/epoch-payout.js already patched, skipping")
    sys.exit(0)

a = '''    const vaultAccs = await rpc("getTokenAccountsByOwner", [EPOCH_ADDR, { mint: MINT }, { encoding: "jsonParsed" }]);
    const vaultHit = vaultAccs && Array.isArray(vaultAccs.value) && vaultAccs.value[0];'''
if s.count(a) != 1:
    sys.exit(f"! api/epoch-payout.js: vault read block not found ({s.count(a)} matches)")

s = s.replace(a, '''    // a throw here used to fall through and look like an empty vault
    let vaultAccs = null, vaultReadOk = true, vaultReadErr = null;
    try {
      vaultAccs = await rpc("getTokenAccountsByOwner", [EPOCH_ADDR, { mint: MINT }, { encoding: "jsonParsed" }]);
    } catch (e) {
      vaultReadOk = false;
      vaultReadErr = String(e && e.message || e).slice(0, 180);
    }
    const vaultHit = vaultAccs && Array.isArray(vaultAccs.value) && vaultAccs.value[0];''')

b = '''    if (!vaultAta || vaultBal <= 0n) {
      return res.status(200).json({ ok: true, epoch, executed: false, note: "the epoch vault holds no $VALO — nothing to distribute" });
    }'''
if s.count(b) != 1:
    sys.exit(f"! api/epoch-payout.js: empty-vault guard not found ({s.count(b)} matches)")

s = s.replace(b, '''    // never report "empty vault" when the truth is "could not read the vault"
    if (!vaultReadOk) {
      return res.status(200).json({
        ok: false, rpcDown: true, epoch, executed: false,
        error: `could not read the epoch vault: ${vaultReadErr}`,
        note: "NOTHING WAS PAID. This is an RPC failure, not an empty vault — check the provider's credits and retry this epoch with ?force=1.",
      });
    }
    if (!vaultAta || vaultBal <= 0n) {
      return res.status(200).json({ ok: true, epoch, executed: false, note: "the epoch vault holds no $VALO — nothing to distribute" });
    }''')

open(P2, "w").write(s)
print("patched", P2)
print("  · a failed vault read now returns rpcDown instead of 'nothing to distribute'")
print()
print("next: node --check api/epoch.js && node --check api/epoch-payout.js")
