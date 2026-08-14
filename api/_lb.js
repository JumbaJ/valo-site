// VALO — leaderboard weighting, server side.
//
// ONE COPY, ON PURPOSE
//   The bonus curve previously existed in four places: three in
//   ValoTerminal.jsx (lbBonus, lbBonusOf, lbBonusFor) and one in the payout
//   job. Four copies of a number that decides payouts is three chances for
//   them to drift apart, and the drift would be invisible until someone
//   compared a projection against what actually landed.
//
//   The browser copies still exist for rendering the board. This file is what
//   money is calculated from — /api/epoch projects with it and
//   /api/epoch-payout pays with it, so those two can never disagree.

export const LB_MS = {
  "1H": 3600e3, "12H": 12 * 3600e3, "1D": 86400e3, "7D": 7 * 86400e3,
  "30D": 30 * 86400e3, "180D": 180 * 86400e3, "365D": 365 * 86400e3,
};

// Raised so the +4.0 cap can actually be reached: rank 1 across all seven
// boards now totals +4.2 and clips to the ceiling. Under the old curve the
// theoretical maximum was +3.5, so the cap was decoration and topping every
// board earned strictly less than the whitepaper implied was possible.
export const lbBonusOf = (r) =>
  r < 1 ? 0
  : r === 1 ? 0.60 : r === 2 ? 0.50 : r === 3 ? 0.43 : r === 4 ? 0.38
  : r === 5 ? 0.34 : r === 6 ? 0.31 : r === 7 ? 0.28 : r === 8 ? 0.25
  : r === 9 ? 0.22 : r === 10 ? 0.19 : r <= 100 ? 0.12 : 0;

export const MAX_BONUS = 4;

const sbGet = async (path) => {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
  const key = (process.env.SUPABASE_SERVICE_KEY || "").trim();
  if (!url || !key) return null;
  try {
    const r = await fetch(`${url}/rest/v1/${path}`, {
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch (e) { return null; }
};

// Every user's standing across every board, derived from the callouts table.
//
// WHY NOT READ epoch_activity.callout_mult
//   That column is written by the browser, and only while a leaderboard modal
//   is mounted, and only for the period tab currently selected. Trade without
//   opening the board and it is never written at all. It is a display value.
//
// RANK IS THE ROW'S POSITION, MATCHING THE VISIBLE BOARD
//   The board ranks callout rows, so one user holding positions 1 and 2 does
//   push the next person to rank 3. Ranking by user would be arguably fairer
//   but would mean the bonus you earn differs from the position you can see,
//   which is worse. Your rank is your best row's position.
//
// Returns { userId: { mult, ranks: { "1D": 3, … } } }
export const calloutStandings = async () => {
  const acc = {};
  for (const [period, ms] of Object.entries(LB_MS)) {
    const since = new Date(Date.now() - ms).toISOString();
    const rows = await sbGet(`callouts?ts=gte.${since}&select=user_id,peak_mult&order=peak_mult.desc&limit=250`);
    if (!rows || !rows.length) continue;
    const seen = new Set();
    rows.forEach((r, i) => {
      if (!r.user_id || seen.has(r.user_id)) return;
      seen.add(r.user_id);
      const rank = i + 1;
      const b = lbBonusOf(rank);
      if (b <= 0) return;                       // outside the top 100, no bonus
      const e = acc[r.user_id] || (acc[r.user_id] = { total: 0, ranks: {} });
      e.total += b;
      e.ranks[period] = rank;
    });
  }
  const out = {};
  for (const [u, e] of Object.entries(acc)) {
    out[u] = { mult: 1 + Math.min(MAX_BONUS, e.total), ranks: e.ranks };
  }
  return out;
};

// Convenience for callers that only need the number.
export const calloutMultipliers = async () => {
  const s = await calloutStandings();
  const out = {};
  for (const [u, v] of Object.entries(s)) out[u] = v.mult;
  return out;
};
