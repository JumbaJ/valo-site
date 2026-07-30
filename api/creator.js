// VALO — /api/creator
//   ?mint=<mint>     → who launched this token, and when
//   ?wallet=<addr>   → every token that wallet has launched
//
// Helius DAS replaces Bitquery here: getAsset gives the creator, and
// getAssetsByCreator is purpose-built for a launch history. Free tier, 1 credit
// per call, no 402s.
const HELIUS = () => (process.env.HELIUS_API_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}` : null);

async function das(method, params) {
  const url = HELIUS();
  if (!url) throw new Error("no HELIUS_API_KEY");
  const r = await fetch(url, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "valo", method, params }),
  });
  if (!r.ok) throw new Error(`helius ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "das error");
  return j.result;
}

const short = (w) => (w ? `${w.slice(0, 4)}…${w.slice(-4)}` : null);

export default async function handler(req, res) {
  const mint = String(req.query.mint || "");
  const wallet = String(req.query.wallet || "");
  try {
    if (mint) {
      if (!/^[A-Za-z0-9]{30,50}$/.test(mint)) return res.status(400).json({ error: "bad mint" });
      const a = await das("getAsset", { id: mint });
      // pump.fun writes the launcher into the creators array; the update
      // authority is the fallback when creators is empty
      const creators = (a && a.creators) || [];
      const primary = creators.find((c) => c.share > 0) || creators[0] || null;
      const auth = (a && a.authorities || []).find((x) => (x.scopes || []).includes("full")) || null;
      const w = (primary && primary.address) || (auth && auth.address) || null;
      const meta = (a && a.content && a.content.metadata) || {};
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=172800");
      return res.status(200).json({
        mint, creator: w, short: short(w),
        verified: !!(primary && primary.verified),
        name: meta.name || null, sym: meta.symbol || null,
        createdAt: null,                       // DAS doesn't carry a mint timestamp
        source: "helius-das",
      });
    }
    if (wallet) {
      if (!/^[A-Za-z0-9]{30,50}$/.test(wallet)) return res.status(400).json({ error: "bad wallet" });
      const r = await das("getAssetsByCreator", {
        creatorAddress: wallet, onlyVerified: false, page: 1, limit: 100,
      });
      const items = (r && r.items) || [];
      const launches = [];
      const seen = new Set();
      for (const it of items) {
        const id = it.id;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const meta = (it.content && it.content.metadata) || {};
        // fungible tokens only — skip NFTs so a dev's art doesn't pollute the list
        const iface = String(it.interface || "");
        if (iface && !/Fungible/i.test(iface)) continue;
        launches.push({
          mint: id, sym: meta.symbol || "???", name: meta.name || meta.symbol || "token",
          createdAt: null,
        });
      }
      res.setHeader("Cache-Control", "s-maxage=900, stale-while-revalidate=1800");
      return res.status(200).json({ wallet, launches, total: launches.length, source: "helius-das" });
    }
    res.status(400).json({ error: "pass ?mint= or ?wallet=" });
  } catch (e) {
    // never 502 the UI over this — it degrades to the simulated dev instead
    res.setHeader("Cache-Control", "s-maxage=60");
    res.status(200).json({ error: String(e.message || e), creator: null, launches: [] });
  }
}
