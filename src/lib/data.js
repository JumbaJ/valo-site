// VALO Phase 2 — live-data fetchers. Same-origin /api/* (Vercel serverless),
// so no base URL and no keys in the browser. Master switch: VITE_LIVE_DATA=1.
export const LIVE = import.meta.env.VITE_LIVE_DATA === "1";

export async function fetchTokens() {
  const r = await fetch("/api/tokens");
  if (!r.ok) throw new Error("tokens " + r.status);
  return r.json();
}
export async function fetchCandles(pool, tfMin) {
  const r = await fetch(`/api/candles?pool=${encodeURIComponent(pool)}&tf=${tfMin}`);
  if (!r.ok) throw new Error("candles " + r.status);
  return r.json();
}
export async function fetchTrades(pool) {
  const r = await fetch(`/api/trades?pool=${encodeURIComponent(pool)}`);
  if (!r.ok) throw new Error("trades " + r.status);
  return r.json();
}
