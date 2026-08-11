#!/usr/bin/env python3
"""
VALO — YOU EARN THIS HOUR: read the real figure, and show what's claimable.

Run from the repo root:   python3 patch-you-earn.py

Two bugs and one addition.

BUG 1  The cell read `yr.tokens`. The endpoint returns `amount`. That field is
       never present, so the code always fell through to the local fallback.

BUG 2  The fallback multiplied the pool by `yw`, which preferred `weight` — a
       raw SOL volume figure (0.02), not a fraction. 300000 x 0.02 = 6,000, and
       with earlier inputs, the 614 and 1,175 that were on screen. `share` is
       the fraction; `weight` never was.

FIX    Read `amount` first, then `share x pool`. If the indexer has no record,
       show a dash — not an invented number.

ADD    A claimable line beneath the figure, shown only when rewards are waiting
       in the vault, so the band tells you both what this hour is generating and
       what is already yours.
"""
import sys, os, re

P = "src/components/ValoTerminal.jsx"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "youEarn-v2" in s:
    sys.exit("! already patched — nothing to do")

# ── 1. the derivation ───────────────────────────────────────────────────────
old = '''                      const yw = yr && Number.isFinite(+yr.weight) ? +yr.weight
                        : yr && Number.isFinite(+yr.share) ? +yr.share : 0;
                      const epochYou = yr && Number.isFinite(+yr.tokens) ? +yr.tokens : poolNow * yw;'''
if s.count(old) != 1:
    sys.exit(f"! derivation block not found ({s.count(old)} matches) — stopping without changes")

new = '''                      // youEarn-v2 — `amount` is what /api/epoch actually returns.
                      // `share` is the fraction; `weight` is raw SOL volume and must
                      // never be multiplied by the pool (that produced the phantom
                      // 614 and 1,175 figures).
                      const yShare = yr && Number.isFinite(+yr.share) ? +yr.share : null;
                      const epochYou = yr && Number.isFinite(+yr.amount) ? +yr.amount
                        : (yShare != null && poolNow > 0 ? poolNow * yShare : null);
                      // what is already yours, waiting in the vault
                      const youClaimable = Array.isArray(pendingEpochs)
                        ? pendingEpochs.reduce((a, e) => a + (+(e && e.amount) || 0), 0) : 0;'''

s = s.replace(old, new)

# `yw` may be referenced elsewhere in this block — keep it defined, harmlessly
s = s.replace(new, new + '''
                      const yw = yShare != null ? yShare : 0;''')

# ── 2. the cell: null means "—", never a guess ──────────────────────────────
old2 = '''                                {epochYou > 0
                                  ? epochYou.toLocaleString(undefined, { maximumFractionDigits: epochYou >= 1 ? 0 : 3 })
                                  : "0"}'''
if s.count(old2) != 1:
    sys.exit(f"! figure block not found ({s.count(old2)} matches)")
s = s.replace(old2, '''                                {epochYou == null ? "—"
                                  : epochYou > 0
                                    ? epochYou.toLocaleString(undefined, { maximumFractionDigits: epochYou >= 1 ? 0 : 3 })
                                    : "0"}''')

# ── 3. the caption + the claimable line ─────────────────────────────────────
old3 = '''                              <div style={{ fontSize: 9, color: T.faint, fontFamily: T.mono, marginTop: 3 }}>
                                {epochYou > 0
                                  ? `$VALO · ≈ $${(epochYou * (valoLive && +valoLive.price > 0 ? +valoLive.price : 0)).toFixed(2)}`
                                  : "trade this hour to be in the split"}
                              </div>'''
if s.count(old3) != 1:
    sys.exit(f"! caption block not found ({s.count(old3)} matches)")
s = s.replace(old3, '''                              <div style={{ fontSize: 9, color: T.faint, fontFamily: T.mono, marginTop: 3 }}>
                                {epochYou == null ? "no activity recorded yet"
                                  : epochYou > 0
                                    ? `$VALO · ≈ $${(epochYou * (valoLive && +valoLive.price > 0 ? +valoLive.price : 0)).toFixed(2)}`
                                    : "trade this hour to be in the split"}
                              </div>
                              {youClaimable > 0 && (
                                <div
                                  onClick={() => setClaimOpen(true)}
                                  style={{ fontSize: 10, color: T.green, fontFamily: T.mono, fontWeight: 900,
                                    marginTop: 5, paddingTop: 5, borderTop: `1px solid ${T.border}`, cursor: "pointer" }}>
                                  {Math.round(youClaimable).toLocaleString()} claimable →
                                </div>
                              )}''')

# ── 4. scope check: everything referenced must already exist ────────────────
i_use = s.index("youEarn-v2")
for name in ("pendingEpochs", "setClaimOpen"):
    m = re.search(rf"const \[{name}, |const \[\w+, {name}\] = useState", s)
    if not m:
        sys.exit(f"! could not find {name}'s declaration — refusing to write")
    if m.start() > i_use:
        sys.exit(f"! {name} is declared after this render site — refusing to write")

open(P, "w").write(s)
print("patched", P)
print("  · reads `amount`, falls back to `share x pool`, shows — when unknown")
print("  · phantom weight-times-pool math removed")
print("  · claimable line added beneath, tap to open the vault")
print()
print("next: npm run build")
