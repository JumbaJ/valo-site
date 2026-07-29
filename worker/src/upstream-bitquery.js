// VALO — Bitquery adapter.
// Holds ONE websocket to Bitquery and turns pump.fun / DEX swaps into VALO's
// trade shape: { pool, mint, at, isBuy, usd, price, wallet, tx }.
//
// Swapping providers means writing another file with the same three exports —
// nothing else in the worker changes.
import WebSocket from "ws";

const ENDPOINT = process.env.BITQUERY_WS || "wss://streaming.bitquery.io/eap";
const TOKEN = process.env.BITQUERY_TOKEN || "";

// GraphQL subscription: every DEX trade for the mints we care about.
const SUB = `
subscription($mints: [String!]) {
  Solana {
    DEXTrades(where: {Trade: {Buy: {Currency: {MintAddress: {in: $mints}}}}}) {
      Block { Time }
      Transaction { Signature Signer }
      Trade {
        Buy  { Amount PriceInUSD Currency { MintAddress Symbol } Account { Address } }
        Sell { Amount PriceInUSD Currency { MintAddress Symbol } }
        Market { MarketAddress }
        Dex { ProtocolName }
      }
    }
  }
}`;

export function createUpstream({ onTrade, onStatus }) {
  let ws = null, alive = false, retry = 0, mints = new Set(), subId = 1, timer = null;

  const send = (o) => { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(o)); } catch (e) {} };

  const subscribe = () => {
    if (!alive || !mints.size) return;
    send({ id: String(subId), type: "start",
      payload: { query: SUB, variables: { mints: [...mints] } } });
  };

  const connect = () => {
    if (!TOKEN) { onStatus("no-token"); return; }
    clearTimeout(timer);
    ws = new WebSocket(`${ENDPOINT}?token=${TOKEN}`, ["graphql-ws"]);

    ws.on("open", () => {
      alive = true; retry = 0;
      onStatus("connected");
      send({ type: "connection_init", payload: {} });
      setTimeout(subscribe, 300);
    });

    ws.on("message", (raw) => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
      if (msg.type === "ka" || msg.type === "connection_ack") return;
      const rows = msg?.payload?.data?.Solana?.DEXTrades;
      if (!Array.isArray(rows)) return;
      for (const r of rows) {
        try {
          const buy = r.Trade?.Buy, sell = r.Trade?.Sell;
          const mint = buy?.Currency?.MintAddress;
          if (!mint || !mints.has(mint)) continue;
          const price = Number(buy?.PriceInUSD) || 0;
          const amount = Number(buy?.Amount) || 0;
          if (!(price > 0)) continue;
          onTrade({
            mint,
            pool: r.Trade?.Market?.MarketAddress || null,
            at: Date.parse(r.Block?.Time) || Date.now(),
            // a "buy" of the token means SOL went in
            isBuy: true,
            usd: amount * price,
            price,
            wallet: r.Transaction?.Signer || buy?.Account?.Address || null,
            tx: r.Transaction?.Signature || null,
            dex: r.Trade?.Dex?.ProtocolName || null,
          });
        } catch (e) { /* skip a malformed row */ }
      }
    });

    const down = () => {
      alive = false;
      onStatus("disconnected");
      retry = Math.min(retry + 1, 6);
      timer = setTimeout(connect, 1000 * retry);   // backoff, then try again
    };
    ws.on("close", down);
    ws.on("error", down);
  };

  return {
    start: connect,
    watch(list) {                                  // which mints browsers care about
      const next = new Set(list.filter(Boolean));
      const changed = next.size !== mints.size || [...next].some((m) => !mints.has(m));
      mints = next;
      if (changed && alive) { send({ id: String(subId), type: "stop" }); subId++; subscribe(); }
    },
    stop() { clearTimeout(timer); try { ws && ws.close(); } catch (e) {} },
  };
}
