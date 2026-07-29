// VALO — /api/creator
//   ?mint=<token mint>    → who launched this token, and when
//   ?wallet=<address>     → every token that wallet has launched
//
// Source: Bitquery (same account as the stream worker). Set BITQUERY_TOKEN in
// Vercel's env vars — the key never reaches the browser.
const EP = "https://streaming.bitquery.io/eap";

async function gql(query, variables) {
  const token = process.env.BITQUERY_TOKEN;
  if (!token) throw new Error("no BITQUERY_TOKEN");
  const r = await fetch(EP, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  });
  if (!r.ok) throw new Error(`bitquery ${r.status}`);
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(j.errors[0].message || "query error");
  return j.data;
}

// who created this mint (pump.fun writes the creator into the launch instruction)
const Q_CREATOR = `
query($mint: String!) {
  Solana {
    TokenSupplyUpdates(
      where: {TokenSupplyUpdate: {Currency: {MintAddress: {is: $mint}}}}
      orderBy: {ascending: Block_Time}
      limit: {count: 1}
    ) {
      Block { Time }
      Transaction { Signer Signature }
      TokenSupplyUpdate { Currency { Name Symbol MintAddress Uri } }
    }
  }
}`;

// everything this wallet has launched
const Q_LAUNCHES = `
query($wallet: String!) {
  Solana {
    TokenSupplyUpdates(
      where: {Transaction: {Signer: {is: $wallet}}}
      orderBy: {descending: Block_Time}
      limit: {count: 50}
    ) {
      Block { Time }
      TokenSupplyUpdate { Currency { Name Symbol MintAddress } PostBalance }
    }
  }
}`;

export default async function handler(req, res) {
  const mint = String(req.query.mint || "");
  const wallet = String(req.query.wallet || "");
  try {
    if (mint) {
      if (!/^[A-Za-z0-9]{30,50}$/.test(mint)) return res.status(400).json({ error: "bad mint" });
      const d = await gql(Q_CREATOR, { mint });
      const row = d?.Solana?.TokenSupplyUpdates?.[0];
      if (!row) return res.status(200).json({ mint, creator: null });
      const w = row.Transaction?.Signer || null;
      res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=172800"); // never changes
      return res.status(200).json({
        mint,
        creator: w,
        short: w ? `${w.slice(0, 4)}…${w.slice(-4)}` : null,
        createdAt: row.Block?.Time ? Date.parse(row.Block.Time) : null,
        name: row.TokenSupplyUpdate?.Currency?.Name || null,
        sym: row.TokenSupplyUpdate?.Currency?.Symbol || null,
        tx: row.Transaction?.Signature || null,
      });
    }
    if (wallet) {
      if (!/^[A-Za-z0-9]{30,50}$/.test(wallet)) return res.status(400).json({ error: "bad wallet" });
      const d = await gql(Q_LAUNCHES, { wallet });
      const rows = d?.Solana?.TokenSupplyUpdates || [];
      const seen = new Set();
      const out = [];
      for (const r of rows) {
        const c = r.TokenSupplyUpdate?.Currency;
        if (!c || !c.MintAddress || seen.has(c.MintAddress)) continue;
        seen.add(c.MintAddress);
        out.push({
          mint: c.MintAddress, sym: c.Symbol || "???", name: c.Name || c.Symbol || "token",
          createdAt: r.Block?.Time ? Date.parse(r.Block.Time) : null,
        });
      }
      res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=1800");
      return res.status(200).json({ wallet, launches: out });
    }
    res.status(400).json({ error: "pass ?mint= or ?wallet=" });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
