#!/usr/bin/env python3
import re

P = "src/components/ValoTerminal.jsx"
s = open(P, encoding="utf-8").read()

def sub1(old, new, label):
    global s
    n = s.count(old)
    assert n == 1, f"ANCHOR {label}: found {n}, need exactly 1 - ABORT"
    s = s.replace(old, new)
    print("  ok  " + label)

# 1 - uid state, beside epochLive so the setter exists high in the tree
sub1(
'  const [epochLive, setEpochLive] = useState(null);       // \u26d3 the real epoch, from chain',
'  const [epochLive, setEpochLive] = useState(null);       // \u26d3 the real epoch, from chain\n'
'  const [epochUid, setEpochUid] = useState(null);         // epoch-uid-v3',
"epochUid state")

# 2 - the fetch identifies the caller
sub1(
'        const uid = uidRef.current;',
'        const uid = epochUid || uidRef.current;                 // epoch-uid-v3',
"fetch uid")

# 3 - deps. anchored on setEpochLive, which occurs exactly once
sub1(
"""        if (!stop) setEpochLive(j);
      } catch (e) { /* the panel falls back to local numbers */ }
    };
    pull();
    const t = setInterval(pull, 30000);
    return () => { stop = true; clearInterval(t); };
  }, []);""",
"""        if (!stop) setEpochLive(j);
      } catch (e) { /* the panel falls back to local numbers */ }
    };
    pull();
    const t = setInterval(pull, 30000);
    return () => { stop = true; clearInterval(t); };
  }, [epochUid]);""",
"fetch deps")

# 4 - the writer, BELOW the cloudUser binding to stay out of the TDZ
m = re.search(r'^[ \t]*const \[?cloudUser\b.*$', s, re.M)
assert m, "no cloudUser declaration found - ABORT"
decl = m.group(0)
assert decl.rstrip().endswith(';'), "cloudUser decl is multi-line, insert by hand:\n" + decl
assert s.index('const [epochUid') < m.start(), "cloudUser sits ABOVE epochUid - ABORT"
s = s[:m.end()] + (
'\n  useEffect(() => {                                       // epoch-uid-v3'
'\n    const id = (cloudUser && cloudUser.id) || null;'
'\n    uidRef.current = id;'
'\n    setEpochUid(id);'
'\n  }, [cloudUser && cloudUser.id]);'
) + s[m.end():]
print("  ok  uid writer after: " + decl.strip()[:60])

# 5 - a failed chain read renders zero, never a random number in green
sub1(
'      : (epochLive && +epochLive.totalWeight === 0 ? 0 : localProjection);',
'      : 0;   // epoch-uid-v3 - no you block means zero, not localProjection',
"honest zero")

open(P, "w", encoding="utf-8").write(s)
print("patched " + P)
