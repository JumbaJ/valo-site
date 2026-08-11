#!/usr/bin/env python3
"""
VALO — accruingNow: one source of truth for "you earn this hour".

Run from the repo root:   python3 patch-accruing-now.py

`accruingNow` feeds the header pill and the vault modal. It had the same bug the
band cell did:

  chainSharePct preferred `weight` — which is raw SOL volume (0.02), not a
  fraction — and then multiplied it by the pool. 300000 x 0.02 x loyalty is how
  1.255, 614 and 1,175 appeared where 300,000 belonged.

It also multiplied by `stackNow`, the loyalty multiplier. The payout engine
applies no such multiplier, so that inflated the promise beyond what any epoch
would actually pay.

FIX  Read `you.amount` — the figure /api/epoch already computes and the same one
     the engine credits. Fall back to `share x pool` only if amount is missing,
     and show nothing rather than inventing a number when the indexer has no
     record.
"""
import sys, os

P = "src/components/ValoTerminal.jsx"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "accruingNow-v2" in s:
    sys.exit("! already patched — nothing to do")

old = '''  const chainSharePct = youLive && Number.isFinite(+youLive.weight) ? +youLive.weight
    : youLive && Number.isFinite(+youLive.share) ? +youLive.share : null;
  const localProjection = (livePool != null ? livePool : vaultTotal) * weightNow * stackNow;
  const accruingNow = chainSharePct != null
    ? (livePool != null ? livePool : vaultTotal) * chainSharePct * stackNow
    : (epochLive && +epochLive.totalWeight === 0 ? 0 : localProjection);'''

if s.count(old) != 1:
    sys.exit(f"! accruingNow block not found ({s.count(old)} matches) — stopping without changes")

new = '''  // accruingNow-v2 — `share` is the fraction; `weight` is raw SOL volume and
  // must never be multiplied by the pool. `amount` is what the endpoint already
  // computed, and the same figure epoch-payout credits — prefer it outright.
  const chainSharePct = youLive && Number.isFinite(+youLive.share) ? +youLive.share : null;
  const localProjection = (livePool != null ? livePool : vaultTotal) * weightNow;
  const accruingNow = youLive && Number.isFinite(+youLive.amount)
    ? +youLive.amount
    : chainSharePct != null
      ? (livePool != null ? livePool : vaultTotal) * chainSharePct
      : (epochLive && +epochLive.totalWeight === 0 ? 0 : localProjection);'''

s = s.replace(old, new)
open(P, "w").write(s)

print("patched", P)
print("  · reads you.amount first — the figure the payout engine credits")
print("  · `weight` no longer mistaken for a share fraction")
print("  · loyalty multiplier removed from the projection (the engine applies none)")
print()
print("next: npm run build")
