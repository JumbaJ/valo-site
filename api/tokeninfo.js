// VALO — /api/tokeninfo?mint=<mint>[&pool=<pair>]
// Real links AND the project's own description.
//   • DexScreener → socials, websites, image, canonical pages
//   • GeckoTerminal → the description the team actually published
// Nothing here is invented: if a token has no description, we say so and VALO
// shows facts instead of a blurb.
const GT = "https://api.geckoterminal.com/api/v2";

export default async function handler(req, res) {
  const mint = String(req.query.mint || "");
  const pool = String(req.query.pool || "");
  if (!/^[A-Za-z0-9]{20,60}$/.test(mint)) return res.status(400).json({ error: "bad mint" });

  const out = { mint, name: null, sym: null, img: null, websites: [], socials: {}, description: null, links: {} };

  // ---- DexScreener: pair, socials, image
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`, { headers: { accept: "application/json" } });
    if (r.ok) {
      const j = await r.json();
      const pairs = (j.pairs || []).filter((p) => p.chainId === "solana");
      const pair = pairs.find((p) => p.pairAddress === pool) || pairs[0] || null;
      const info = (pair && pair.info) || {};
      for (const s of info.socials || []) {
        const ty = String(s.type || s.platform || "").toLowerCase();
        if (ty && s.url && !out.socials[ty]) out.socials[ty] = s.url;
      }
      out.websites = (info.websites || []).map((w) => (typeof w === "string" ? w : w.url)).filter(Boolean);
      out.img = info.imageUrl || null;
      out.name = (pair && pair.baseToken && pair.baseToken.name) || null;
      out.sym = (pair && pair.baseToken && pair.baseToken.symbol) || null;
      const isPump = /pump$/i.test(mint);
      out.links = {
        dexscreener: pair ? `https://dexscreener.com/solana/${pair.pairAddress}` : `https://dexscreener.com/solana/${mint}`,
        pumpfun: isPump ? `https://pump.fun/coin/${mint}` : null,
        solscan: `https://solscan.io/token/${mint}`,
        jupiter: `https://jup.ag/swap/SOL-${mint}`,
      };
    }
  } catch (e) { /* links stay empty */ }

  // ---- GeckoTerminal: the team's own description
  try {
    const r2 = await fetch(`${GT}/networks/solana/tokens/${mint}/info`, { headers: { accept: "application/json" } });
    if (r2.ok) {
      const j2 = await r2.json();
      const a = (j2.data && j2.data.attributes) || {};
      const d = (a.description || "").trim();
      if (d) out.description = d.length > 400 ? d.slice(0, 397) + "…" : d;
      if (!out.img && a.image_url && a.image_url !== "missing.png") out.img = a.image_url;
      if (!out.name && a.name) out.name = a.name;
      if (!out.sym && a.symbol) out.sym = a.symbol;
      for (const [k, v] of Object.entries({ twitter: a.twitter_handle, telegram: a.telegram_handle })) {
        if (v && !out.socials[k]) {
          out.socials[k] = k === "twitter" ? `https://x.com/${String(v).replace(/^@/, "")}`
                                           : `https://t.me/${String(v).replace(/^@/, "")}`;
        }
      }
      if (!out.websites.length && Array.isArray(a.websites)) out.websites = a.websites.filter(Boolean);
    }
  } catch (e) { /* description stays null */ }

  res.setHeader("Cache-Control", "s-maxage=1800, stale-while-revalidate=3600");
  res.status(200).json(out);
}
