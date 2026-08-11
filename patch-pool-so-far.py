#!/usr/bin/env python3
"""
VALO — POOL SO FAR: lead with the $VALO figure, SOL underneath, no captions.

Run from the repo root:   python3 patch-pool-so-far.py

Before:  ◎0.0646
         trade fees, live
         vault 1,668,927 $VALO

After:   1,668,927 $VALO
         ◎0.0646

Tolerant of the font sizes, so it works whether or not the band has been
slimmed.
"""
import sys, os, re

P = "src/components/ValoTerminal.jsx"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "poolSoFar-v2" in s:
    sys.exit("! already patched — nothing to do")

pat = re.compile(
    r"(POOL SO FAR</div>\s*)"
    r"<div style=\{\{ fontSize: \d+(?:\.\d+)?, fontWeight: 900, color: T\.text, fontFamily: T\.mono, lineHeight: 1\.15 \}\}>\s*"
    r"◎\{accSol\.toFixed\(4\)\}\s*"
    r"</div>\s*"
    r"<div style=\{\{ fontSize: 9, color: T\.faint, marginTop: 2 \}\}>\s*"
    r"trade fees, live\s*"
    r"\{vaultTok > 0 \? <><br />vault \{Math\.round\(vaultTok\)\.toLocaleString\(\)\} \$VALO</> : null\}\s*"
    r"</div>",
    re.S,
)

m = pat.search(s)
if not m:
    sys.exit("! POOL SO FAR block not found in the expected shape — stopping "
             "without changes. Paste the cell's markup and it can be matched exactly.")

NEW = r"""\1{/* poolSoFar-v2 — the token figure leads, SOL sits under it */}
                              <div style={{ fontSize: 17, fontWeight: 900, color: T.text,
                                fontFamily: T.mono, lineHeight: 1.15, whiteSpace: "nowrap" }}>
                                {vaultTok > 0 ? Math.round(vaultTok).toLocaleString() : "—"}
                                <span style={{ fontSize: 10, color: VALO_PURPLE, marginLeft: 4 }}>$VALO</span>
                              </div>
                              <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono,
                                marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                                ◎{accSol.toFixed(4)}
                              </div>"""

out = pat.sub(NEW, s, count=1)
if out == s:
    sys.exit("! substitution produced no change — refusing to write")

open(P, "w").write(out)
print("patched", P)
print("  · POOL SO FAR leads with the $VALO total")
print("  · SOL accrual sits beneath it, no caption text")
print()
print("next: npm run build")
