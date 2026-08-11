#!/usr/bin/env python3
"""
VALO — wire the vault panel to the pending_rewards table.

Run from the repo root:   python3 patch-pending-rewards.py

Until now the CLAIMABLE NOW figure came from local state only, so rows the
hourly job credits in Supabase never appeared and CLAIM had nothing to send.
This adds an effect that reads the user's unclaimed rows and feeds the panel.

Placement matters: the effect must sit AFTER `sb` and `cloudUser` are declared,
or React throws a temporal-dead-zone error on render. The script verifies that
ordering before writing anything.
"""
import sys, os, re

P = "src/components/ValoTerminal.jsx"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "pending_rewards" in s and "the real ledger" in s:
    sys.exit("! already patched — nothing to do")

BLOCK = '''  // 🎁 the real ledger: the unclaimed rows the hourly job credited to this
  // wallet. Without this the panel only ever showed local state, so a balance
  // sitting in pending_rewards was invisible and CLAIM had nothing to send.
  useEffect(() => {
    if (!cloudUser || !cloudUser.id) return;
    let stop = false;
    const pull = async () => {
      try {
        const { data, error } = await sb
          .from("pending_rewards")
          .select("id,epoch,tokens,created_at")
          .eq("user_id", cloudUser.id)
          .is("claimed_at", null)
          .order("id", { ascending: true });
        if (stop || error || !Array.isArray(data)) return;
        setPendingEpochs(data.map((r) => ({
          epoch: r.epoch,
          amount: +r.tokens || 0,
          root: null, weightPct: 0, holdPct: 0, volPct: 0,
          at: r.created_at,
        })));
      } catch (e) { /* panel keeps whatever it had */ }
    };
    pull();
    const iv = setInterval(pull, 45000);
    const wake = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") pull();
    };
    window.addEventListener("focus", wake);
    return () => { stop = true; clearInterval(iv); window.removeEventListener("focus", wake); };
  }, [cloudUser && cloudUser.id]);

'''

# ── the anchor: an App-scope declaration that comes after sb / cloudUser
anchor = "  const [mktHits, setMktHits] = useState([]);"
if s.count(anchor) != 1:
    sys.exit(f"! expected exactly one `{anchor.strip()}` — found {s.count(anchor)}")

i_anchor = s.index(anchor)

m_cloud = re.search(r"const \[cloudUser, setCloudUser\]", s)
m_sb = re.search(r"\bconst sb = ", s)
m_pend = re.search(r"const \[pendingEpochs, setPendingEpochs\]", s)
for name, m in (("cloudUser", m_cloud), ("sb", m_sb), ("pendingEpochs", m_pend)):
    if not m:
        sys.exit(f"! could not find the declaration of {name}")
    if m.start() > i_anchor:
        sys.exit(f"! {name} is declared AFTER the anchor — placing the effect here "
                 f"would crash on render. Stopping without changes.")

out = s[:i_anchor] + BLOCK + s[i_anchor:]

# ── sanity: the file must not have grown by more than the block
if len(out) - len(s) != len(BLOCK):
    sys.exit("! unexpected size change — refusing to write")

open(P, "w").write(out)
print("patched", P)
print(f"  · vault panel now reads pending_rewards (+{len(BLOCK)} chars)")
print()
print("next:")
print("  npx esbuild src/components/ValoTerminal.jsx --jsx=automatic --loader:.jsx=jsx --outfile=/dev/null")
print("  (or just run your normal build)")
