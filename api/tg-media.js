// VALO — /api/tg-media?id=<file_id> : streams Telegram media for the ✈ room.
// The bot token never reaches the browser — this route resolves the file
// server-side and pipes the bytes through with long cache headers.
const TOKEN = process.env.BOT_TOKEN || "";

export default async function handler(req, res) {
  try {
    const id = String(req.query.id || "");
    if (!TOKEN) return res.status(503).json({ error: "BOT_TOKEN not configured" });
    if (!/^[A-Za-z0-9_-]{20,}$/.test(id)) return res.status(400).json({ error: "bad file id" });

    const meta = await fetch(`https://api.telegram.org/bot${TOKEN}/getFile?file_id=${encodeURIComponent(id)}`)
      .then((r) => r.json());
    const path = meta && meta.ok && meta.result && meta.result.file_path;
    if (!path) return res.status(404).json({ error: "file not found" });
    if (meta.result.file_size && meta.result.file_size > 12 * 1024 * 1024)
      return res.status(413).json({ error: "file too large" });

    const file = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${path}`);
    if (!file.ok) return res.status(502).json({ error: "telegram fetch failed" });

    const type = path.endsWith(".mp4") ? "video/mp4"
      : path.endsWith(".webp") ? "image/webp"
      : path.endsWith(".png") ? "image/png"
      : path.endsWith(".gif") ? "image/gif"
      : "image/jpeg";
    res.setHeader("content-type", type);
    res.setHeader("cache-control", "public, max-age=604800, immutable");
    const buf = Buffer.from(await file.arrayBuffer());
    return res.status(200).send(buf);
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e).slice(0, 140) });
  }
}
