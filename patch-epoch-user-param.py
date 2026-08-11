#!/usr/bin/env python3
"""
VALO — /api/epoch: read ?user= reliably.

Run from the repo root:   python3 patch-epoch-user-param.py

`you` comes back null even when the caller IS the epoch's only participant,
which points at req.query being empty in this runtime. This falls back to
parsing the query string off req.url, so the projection populates either way.
"""
import sys, os

P = "api/epoch.js"
if not os.path.exists(P):
    sys.exit(f"! {P} not found — run this from the repo root")

s = open(P).read()

if "searchParams.get" in s:
    sys.exit("! already patched — nothing to do")

old = '''  const user = String(req.query.user || "").trim();'''
if s.count(old) != 1:
    sys.exit(f"! expected one user-param line, found {s.count(old)}")

new = '''  // req.query is not always populated here — fall back to the raw URL so the
  // per-user projection never silently returns null.
  let user = String((req.query && req.query.user) || "").trim();
  if (!user) {
    try { user = (new URL(req.url, "http://x").searchParams.get("user") || "").trim(); }
    catch (e) { user = ""; }
  }'''

s = s.replace(old, new)
open(P, "w").write(s)
print("patched", P)
print("  · ?user= now read from req.query OR the raw URL")
print()
print("next: node --check api/epoch.js")
