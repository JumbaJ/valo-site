// PHASE 2 — real market data fetchers (all disabled until VITE_LIVE_DATA=1).
// Every function returns data mapped into the EXACT shapes App.jsx already
// uses, so flipping the flag swaps simulation for reality with no UI changes.
export const LIVE = import.meta.env.VITE_LIVE_DATA === "1";
const BASE = import.meta.env.VITE_API_BASE || "";

export async function fetchTokens() {
  const r = await fetch(`${BASE}/api/tokens?list=trending`);
  return r.json(); // [{ id, sym, name, price, mc, tvl, greenUsd, redUsd, traders, hue, img, candles }]
}
export async function fetchCandles(mint, tf) {
  const r = await fetch(`${BASE}/api/candles?mint=${mint}&tf=${tf}`);
  return r.json();
}
export async function fetchTrades(mint) {
  const r = await fetch(`${BASE}/api/trades?mint=${mint}`);
  return r.json();
}
export async function fetchHolders(mint) {
  const r = await fetch(`${BASE}/api/holders?mint=${mint}`);
  return r.json();
}
