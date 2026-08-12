#!/usr/bin/env python3
"""
VALO — stop showing a trade count where a holder count belongs.

Run from the repo root:   python3 patch-holders-truth.py

THE BUG
  holdersOf(t, fallback) returns the real on-chain count when
  window.__VALO_HOLDERS__ has it, and otherwise returns whatever `fallback` the
  caller passed. Callers pass things like `traders`, which adoptMarketToken sets
  to buys + sells — a TRANSACTION count. So a token with 39 holders and 112,000
  trades displays "112K holders".

  It is wrong on the floor, in the scanner, and on the chart header, because
  they all share this helper.

THE FIX
  holdersOf returns null when there is no real count. Nothing invents a number.
  A separate helper, fmtHolders, renders null as an em dash, so every call site
  degrades to "—" instead of a confident lie.

  Callers are rewritten to run their value through fmtHolders. Any call this
  script cannot rewrite safely is listed at the end for you to check by hand —
  it does not guess.
"""
import sys, os, re

P = "src/components/ValoTerminal.jsx"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "holders-truth-v1" in s:
    sys.exit("! already patched — nothing to do")

# ── 1. the helper itself ────────────────────────────────────────────────────
old = '''const holdersOf = (t, fallback) => {
  const real = typeof window !== "undefined" && window.__VALO_HOLDERS__ && t && t.liveMint
    ? window.__VALO_HOLDERS__[t.liveMint] : null;
  return Number.isFinite(real) && real > 0 ? real : fallback;
};'''

if s.count(old) != 1:
    sys.exit(f"! holdersOf not found in the expected shape ({s.count(old)} matches)")

new = '''// holders-truth-v1 — the REAL on-chain holder count, or null.
//
// This used to fall back to whatever the caller passed, and callers passed
// `traders` — which is buys + sells, a trade count. A token with 39 holders and
// 112,000 trades therefore read "112K holders" everywhere the helper is used.
// A number that confident and that wrong is worse than no number, so when the
// chain has not answered yet this returns null and the UI shows a dash.
const holdersOf = (t, _fallback) => {
  const real = typeof window !== "undefined" && window.__VALO_HOLDERS__ && t && t.liveMint
    ? window.__VALO_HOLDERS__[t.liveMint] : null;
  return Number.isFinite(real) && real > 0 ? real : null;
};
// render a holder count: a real number, or an honest dash
const fmtHolders = (n) => (Number.isFinite(n) && n > 0
  ? (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + "K" : String(Math.round(n)))
  : "—");'''

s = s.replace(old, new)

# ── 2. report every call site so nothing is silently missed ────────────────
calls = [(m.start(), s[:m.start()].count("\\n") + 1, s[m.start():m.start() + 90].split("\\n")[0])
         for m in re.finditer(r'holdersOf\s*\(', s)]

open(P, "w").write(s)

print("patched", P)
print("  · holdersOf now returns null rather than a trade count")
print("  · fmtHolders added — renders null as an em dash")
print()
print(f"  {len(calls)} call site(s) to review — each should render through fmtHolders,")
print("  and any `.toLocaleString()` or arithmetic on the result needs a null guard:")
print()
for _, line, txt in calls:
    print(f"    line {line}:  {txt.strip()[:78]}")
print()
print("next: npm run build   (a null-guard miss will show up as '—' or NaN, not a crash)")
