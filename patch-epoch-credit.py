#!/usr/bin/env python3
"""
VALO — patch api/epoch-payout.js for CREDIT mode.

Run from the repo root:   python3 patch-epoch-credit.py

Adds a mode where the hourly job CREDITS pending_rewards instead of sending.
Nothing else changes: weights, merkle root, dry-run, and the live send path all
stay exactly as they are. Switch with the env var VALO_EPOCH_MODE:

    (unset) or "send"  → current behaviour, sends tokens hourly
    "credit"           → writes balances, tokens stay in the vault until claimed
"""
import sys, os

P = "api/epoch-payout.js"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()
orig = s

# ── 1. idempotency also recognises a credited epoch ──────────────────────────
old = '''const done = await sb(`epoch_payouts?epoch=eq.${epoch}&status=eq.sent&select=epoch&limit=1`);'''
assert s.count(old) == 1, "anchor 1 (idempotency check) not found"
s = s.replace(old, '''const done = await sb(`epoch_payouts?epoch=eq.${epoch}&status=in.(sent,credited)&select=epoch&limit=1`);''')

# ── 2. the credit branch, before the dry-run gate ────────────────────────────
old = '''    // 6. dry run unless armed'''
assert s.count(old) == 1, "anchor 2 (dry-run gate) not found"
s = s.replace(old, '''    // 5b. CREDIT MODE — the epoch does not send. Each wallet's slice is written
    // to pending_rewards and the tokens stay in the vault until the user signs
    // a claim. No VALO_EPOCH_SECRET needed: nothing moves on chain here.
    if (String(process.env.VALO_EPOCH_MODE || "send").toLowerCase() === "credit") {
      // credit everyone with a real share — even wallets that have not set a
      // payout address yet. They set it before claiming; nothing is lost.
      const creditable = payouts.filter((p) => BigInt(p.amountBase) > 0n);
      if (!creditable.length) {
        return res.status(200).json({ ok: true, mode: "credit", epoch, credited: 0, note: "no non-zero shares in that epoch" });
      }

      const ins = await sb("pending_rewards", {
        method: "POST",
        headers: { prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(creditable.map((p) => ({
          user_id: p.user,
          epoch: String(epoch),
          tokens: p.amount,
          wallet: p.wallet || null,
        }))),
      });
      if (ins === null) {
        // the write failed — say so loudly rather than reporting a false success
        return res.status(200).json({
          ok: false, mode: "credit", epoch,
          error: "could not write pending_rewards — nothing was credited. Check the table exists and SUPABASE_SERVICE_KEY is set.",
        });
      }

      // the ledger row, same shape as a send, so history stays uniform
      try {
        const stamp = new Date().toISOString();
        await sb("epoch_payouts", {
          method: "POST",
          headers: { prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(creditable.map((p) => ({
            epoch, user_id: p.user, wallet: p.wallet, amount: p.amount,
            status: "credited", sig: null, err: null, merkle_root: root, paid_at: stamp,
          }))),
        });
      } catch (e) {}

      return res.status(200).json({
        ok: true, mode: "credit", epoch, executed: true,
        credited: creditable.length,
        tokensCredited: creditable.reduce((a, p) => a + p.amount, 0),
        vaultTokens: Number(vaultBal) / 10 ** decimals,
        totalWeight: +totalW.toFixed(4), merkleRoot: root,
        note: "balances written — tokens stay in the vault until each wallet claims",
      });
    }

    // 6. dry run unless armed''')

if s == orig:
    sys.exit("! nothing changed — the file may already be patched")

open(P, "w").write(s)
print("patched", P)
print("  · idempotency now covers credited epochs")
print("  · credit mode added (VALO_EPOCH_MODE=credit)")
print()
print("next: node --check api/epoch-payout.js")
