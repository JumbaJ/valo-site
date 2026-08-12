#!/usr/bin/env python3
"""
VALO — epoch band: shorter on mobile, matched cells.

Run from the repo root:   python3 patch-band-mobile.py

1. The band's vertical padding drops on mobile so it takes less of the screen
   before the floor tokens.
2. YOU EARN THIS HOUR matches TOTAL POOL exactly — same minWidth, so the two
   read as a pair instead of one being visibly wider.
3. The earn cell's captions were full sentences that wrapped to two lines on a
   phone, making that cell taller than its neighbour no matter what the widths
   said. They are shortened on mobile only; desktop keeps the fuller wording.
"""
import sys, os

P = "src/components/ValoTerminal.jsx"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "band-mobile-v2" in s:
    sys.exit("! already patched — nothing to do")

# ── 1. shorter band on mobile ───────────────────────────────────────────────
a1 = '''flexWrap: "wrap", padding: isMobile ? "14px 14px" : "16px 20px", marginBottom: 16,'''
if s.count(a1) != 1:
    sys.exit(f"! band padding not found ({s.count(a1)} matches)")
s = s.replace(a1, '''flexWrap: "wrap", padding: isMobile ? "9px 12px" : "16px 20px",
                          marginBottom: isMobile ? 11 : 16,  /* band-mobile-v2 */''')

# ── 2. the countdown's own type, a touch tighter on mobile ──────────────────
a2 = '''<span style={{ fontSize: isMobile ? 24 : 28, fontWeight: 900, color: T.text,'''
if s.count(a2) != 1:
    sys.exit(f"! countdown span not found ({s.count(a2)} matches)")
s = s.replace(a2, '''<span style={{ fontSize: isMobile ? 21 : 28, fontWeight: 900, color: T.text,''')

# ── 3. the two cells, same width ────────────────────────────────────────────
a3 = '''                              padding: "10px 14px", minWidth: 158,'''
if s.count(a3) != 1:
    sys.exit(f"! earn cell padding not found ({s.count(a3)} matches)")
s = s.replace(a3, '''                              padding: isMobile ? "8px 12px" : "10px 14px",
                              minWidth: isMobile ? 128 : 148, flex: isMobile ? 1 : "none",''')

a4 = '''<div style={{ border: `1px solid ${T.border2}`, borderRadius: 10, padding: "10px 14px", minWidth: 148 }}>'''
if s.count(a4) != 1:
    sys.exit(f"! total pool cell not found ({s.count(a4)} matches)")
s = s.replace(a4, '''<div style={{ border: `1px solid ${T.border2}`, borderRadius: 10,
                              padding: isMobile ? "8px 12px" : "10px 14px",
                              minWidth: isMobile ? 128 : 148, flex: isMobile ? 1 : "none" }}>''')

# ── 4. short captions on mobile, so the cell can't grow a second line ───────
a5 = '''                                    ? `$VALO · ≈ $${(epochYou * (valoLive && +valoLive.price > 0 ? +valoLive.price : 0)).toFixed(2)}`
                                    : "trade this hour to be in the split"}'''
if s.count(a5) != 1:
    sys.exit(f"! earn caption not found ({s.count(a5)} matches)")
s = s.replace(a5, '''                                    ? `$VALO · ≈ $${(epochYou * (valoLive && +valoLive.price > 0 ? +valoLive.price : 0)).toFixed(2)}`
                                    : isMobile ? "trade to enter" : "trade this hour to be in the split"}''')

a6 = '''                                {epochYou == null ? "no activity recorded yet"'''
if s.count(a6) != 1:
    sys.exit(f"! earn null caption not found ({s.count(a6)} matches)")
s = s.replace(a6, '''                                {epochYou == null ? (isMobile ? "no activity yet" : "no activity recorded yet")''')

open(P, "w").write(s)
print("patched", P)
print("  · band is shorter on mobile (9px padding, tighter countdown)")
print("  · both cells share minWidth and padding — matched pair")
print("  · captions shortened on mobile so neither cell wraps to two lines")
print()
print("next: npm run build")
