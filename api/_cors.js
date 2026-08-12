// VALO - CORS for the Chrome extension.
// Pin the id via VALO_EXT_ID once you've loaded unpacked. Unset = any
// extension origin, which is fine for dev only.

const ALLOWED = () => {
  const id = process.env.VALO_EXT_ID;
  return id ? `chrome-extension://${id}` : null;
};

export function cors(req, res) {
  const origin = req.headers.origin || "";
  const pinned = ALLOWED();

  if (origin.startsWith("chrome-extension://")) {
    if (!pinned || origin === pinned) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
  }

  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}
