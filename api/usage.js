// VALO — /api/usage : how much of the Birdeye plan you've spent this month.
// Costs 1 CU to ask. Open it any time to see where you stand.
export default async function handler(req, res) {
  const key = (process.env.BIRDEYE_API_KEY || "").trim();
  if (!key) return res.status(200).json({ birdeye: "no key set" });
  try {
    const r = await fetch("https://public-api.birdeye.so/utils/v1/credits",
      { headers: { "X-API-KEY": key, accept: "application/json" } });
    const j = r.ok ? await r.json() : null;
    res.setHeader("Cache-Control", "s-maxage=300");
    res.status(200).json({ birdeye: j || `error ${r.status}`, checkedAt: new Date().toISOString() });
  } catch (e) {
    res.status(200).json({ birdeye: String(e.message || e) });
  }
}
