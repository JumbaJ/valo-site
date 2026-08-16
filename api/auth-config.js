// VALO — /api/auth-config
// The standalone sign-in page (/signin.html) lives outside the React build,
// so it can't read import.meta.env. This hands it the two PUBLIC values it
// needs. The anon key is public by design — it ships in the app bundle today.
export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, max-age=300");
  const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
  const anon = (process.env.VITE_SUPABASE_ANON || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !anon) return res.status(200).json({ ok: false });
  return res.status(200).json({ ok: true, url, anon });
}
