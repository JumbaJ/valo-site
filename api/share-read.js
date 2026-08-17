// VALO — /api/share-read
// Posts a user's AI-read card into #ai-reads via webhook: their take, the
// clickable /t/<mint> chart link, attribution, and the PNG attached. The
// link is IN the message, guaranteed — no clipboard roulette.
//
// Auth: same as /api/brief — the user's Supabase token. Cap: 20 shares/day
// per user (a webhook into a public channel is a spam surface).
//
// Env: DISCORD_WEBHOOK_AIREADS  (webhook created in #ai-reads)
// Supabase (run once, service-key-only like the others):
//   create table share_usage ( user_id uuid not null, day date not null,
//     n int not null default 0, primary key (user_id, day) );
//   alter table share_usage enable row level security;

const SB_URL = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SB_KEY = () => (process.env.SUPABASE_SERVICE_KEY || "").trim();

const sb = async (path, opts = {}) => {
  if (!SB_URL() || !SB_KEY()) return null;
  try {
    const r = await fetch(`${SB_URL()}/rest/v1/${path}`, {
      ...opts,
      headers: { apikey: SB_KEY(), authorization: `Bearer ${SB_KEY()}`, "content-type": "application/json", ...(opts.headers || {}) },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch (e) { return null; }
};

const userFrom = async (req) => {
  const tok = String(req.headers["x-valo-auth"] || "").trim();
  if (!tok) return null;
  try {
    const r = await fetch(`${SB_URL()}/auth/v1/user`, {
      headers: { apikey: SB_KEY(), authorization: `Bearer ${tok}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.id ? j : null;
  } catch (e) { return null; }
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const hook = (process.env.DISCORD_WEBHOOK_AIREADS || "").trim();
  if (!hook) return res.status(200).json({ ok: false, error: "sharing not configured" });

  const user = await userFrom(req);
  if (!user) return res.status(401).json({ ok: false, error: "sign in to share" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const mint = String((body && body.mint) || "").trim();
  const sym = String((body && body.sym) || "?").slice(0, 12).replace(/[^\w$.-]/g, "");
  const take = String((body && body.take) || "").slice(0, 400);
  const handle = String((body && body.handle) || "a trader").slice(0, 24).replace(/[@#`]/g, "");
  const png = String((body && body.png) || "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return res.status(200).json({ ok: false, error: "bad mint" });
  if (!png.startsWith("data:image/png;base64,") || png.length > 3_500_000)
    return res.status(200).json({ ok: false, error: "bad or oversized image" });

  // 20/day per user
  const day = new Date().toISOString().slice(0, 10);
  const u = await sb(`share_usage?user_id=eq.${user.id}&day=eq.${day}&select=n`);
  const used = u && u.length ? u[0].n : 0;
  if (used >= 20) return res.status(200).json({ ok: false, error: "daily share limit reached (20)" });
  await sb("share_usage", {
    method: "POST", headers: { prefer: "resolution=merge-duplicates" },
    body: JSON.stringify([{ user_id: user.id, day, n: used + 1 }]),
  });

  // build the Discord message as an EMBED - masked links render reliably
  // there, the card displays inside it, and the purple bar brands it
  const chartUrl = `https://valotrading.app/t/${mint}`;
  const fname = `valo-ai-read-${sym}.png`;
  const desc = (take.trim() ? take.trim() + "\n\n" : "")
    + `\u2728 **$${sym}** \u00b7 [\u{1F4C8} open the live chart](${chartUrl})`;

  try {
    const bytes = Buffer.from(png.slice("data:image/png;base64,".length), "base64");
    const form = new FormData();
    form.append("payload_json", JSON.stringify({
      embeds: [{
        description: desc.slice(0, 2048),
        color: 0x7d5cf0,
        image: { url: `attachment://${fname}` },
        footer: { text: `shared by ${handle} \u00b7 valotrading.app` },
        timestamp: new Date().toISOString(),
      }],
      allowed_mentions: { parse: [] },
    }));
    form.append("files[0]", new Blob([bytes], { type: "image/png" }), fname);
    const r = await fetch(hook, { method: "POST", body: form, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.status(200).json({ ok: false, error: `discord rejected the post (${r.status})` });
  } catch (e) {
    return res.status(200).json({ ok: false, error: `post failed: ${String(e.message || e).slice(0, 80)}` });
  }

  return res.status(200).json({ ok: true, url: chartUrl, remaining: 19 - used });
}

export const config = { maxDuration: 30, api: { bodyParser: { sizeLimit: "4mb" } } };
