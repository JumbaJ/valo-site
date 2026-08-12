#!/usr/bin/env python3
import re

P = "src/components/ValoTerminal.jsx"
s = open(P, encoding="utf-8").read()

if "valo-phantom-addr" in s:
    raise SystemExit("already patched - valo-phantom-addr present. ABORT")

ANCHOR = (
    '  useEffect(() => { try { payoutWallet ? localStorage.setItem("valo-payout-wallet", payoutWallet)'
    ' : localStorage.removeItem("valo-payout-wallet"); } catch (e) {} }, [payoutWallet]);'
)

n = s.count(ANCHOR)
assert n == 1, f"ANCHOR payoutWallet effect: found {n}, need exactly 1 - ABORT"

before = s[: s.index(ANCHOR)]
assert re.search(r'\bwallet\b\s*[,=\]\)]', before), "no `wallet` binding above the anchor - ABORT"

NEW = ANCHOR + (
    '\n  // phantom-addr-v1 - mirror the connected address so it survives reload'
    '\n  // and so the extension bridge can read it. public data, never a key.'
    '\n  useEffect(() => { try { (wallet && wallet.address) '
    '? localStorage.setItem("valo-phantom-addr", wallet.address) '
    ': localStorage.removeItem("valo-phantom-addr"); } catch (e) {} }, [wallet && wallet.address]);'
)

s = s.replace(ANCHOR, NEW)
open(P, "w", encoding="utf-8").write(s)
print("ok  phantom-addr-v1 written after the payoutWallet effect")
