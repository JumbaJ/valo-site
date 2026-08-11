#!/usr/bin/env python3
"""
VALO — make the epoch panel and band show YOUR live numbers.

Run from the repo root:   python3 patch-epoch-live-user.py

The app polls /api/epoch with no user parameter, so the endpoint's `you` block
comes back null and every "you earn this hour" figure reads zero. This passes
the signed-in user's id, which populates:

  · the epoch band's YOU EARN THIS HOUR cell
  · the vault modal's projection card
  · the header pill's "this hour" line

Placement note: the polling effect sits ABOVE where cloudUser is declared, so
the id is carried in a ref that is assigned later — no temporal-dead-zone risk.
The script verifies that ordering before writing.
"""
import sys, os, re

P = "src/components/ValoTerminal.jsx"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "uidRef" in s:
    sys.exit("! already patched — nothing to do")

# ── 1. a ref to carry the user id up to the poller ──────────────────────────
a1 = "  const [epochLive, setEpochLive] = useState(null);"
if s.count(a1) != 1:
    sys.exit(f"! expected one epochLive declaration, found {s.count(a1)}")
s = s.replace(a1, "  const uidRef = useRef(null);                            // 🎁 who we are, for /api/epoch\n" + a1)

# ── 2. the poll carries it ──────────────────────────────────────────────────
a2 = '        const r = await fetch("/api/epoch");'
if s.count(a2) != 1:
    sys.exit(f"! expected one plain /api/epoch fetch, found {s.count(a2)}")
s = s.replace(a2, '''        const uid = uidRef.current;
        const r = await fetch(`/api/epoch${uid ? `?user=${encodeURIComponent(uid)}` : ""}`);''')

# ── 3. keep the ref current, right where cloudUser is set ───────────────────
a3 = "  const [cloudUser, setCloudUser] = useState(null);"
if s.count(a3) != 1:
    sys.exit(f"! expected one cloudUser declaration, found {s.count(a3)}")

i_uid = s.index("  const uidRef = useRef(null);")
i_cloud = s.index(a3)
if not i_uid < i_cloud:
    sys.exit("! uidRef must be declared before cloudUser — stopping without changes")

s = s.replace(a3, a3 + '''
  useEffect(() => { uidRef.current = (cloudUser && cloudUser.id) || null; }, [cloudUser && cloudUser.id]);''')

open(P, "w").write(s)
print("patched", P)
print("  · /api/epoch now receives the signed-in user")
print("  · YOU EARN THIS HOUR, the vault projection and the header pill go live")
print()
print("next: npm run build")
