// VALO — /api/tg-send : site users speak into the Telegram group, via the bot.
// POST { text, name } → posts "💬 name: text" to the group AND mirrors the row
// into tg_feed so the sender sees it on-site immediately (the bot's relay
// skips its own posts, so nothing doubles).
const TOKEN = process.env.BOT_TOKEN || "";
const CHAT = process.env.CHAT_ID || "";
const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// a light per-instance limiter — a deterrent, not a fortress
const recent = new Map();
const limited = (key) => {
  const now = Date.now();
  const hits = (recent.get(key) || []).filter((t) => now - t < 60000);
  if (hits.length >= 10 || (hits.length && now - hits[hits.length - 1] < 4000)) return true;
  hits.push(now); recent.set(key, hits);
  if (recent.size > 500) recent.clear();
  return false;
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    if (!TOKEN || !CHAT) return res.status(503).json({ error: "bridge not configured" });

    const { text, name } = req.body || {};
    const msg = String(text || "").replace(/\s+/g, " ").trim().slice(0, 280);
    const who = String(name || "").replace(/[^\w .\-]/g, "").trim().slice(0, 32) || "anon";
    if (msg.length < 1) return res.status(400).json({ error: "empty message" });

    const key = (req.headers["x-forwarded-for"] || "ip").toString().split(",")[0] + "|" + who;
    if (limited(key)) return res.status(429).json({ error: "slow down — a few seconds between messages" });

    const tg = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT, parse_mode: "Markdown",
        text: `💬 [${who}](https://valotrading.app/?u=${encodeURIComponent(who)}): ${msg}`,
        disable_web_page_preview: true }),
    }).then((r) => r.json());
    if (!tg || !tg.ok) return res.status(502).json({ error: "telegram rejected the message" });

    // mirror on-site immediately
    if (SB_URL && SB_KEY) {
      await fetch(`${SB_URL}/rest/v1/tg_feed`, {
        method: "POST",
        headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json",
          prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify([{ msg_id: tg.result && tg.result.message_id, name: `${who} · site`,
          text: msg, kind: "text", file_id: null, ts: Math.floor(Date.now() / 1000) }]),
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 140) });
  }
}
