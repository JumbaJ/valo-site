// VALO stream worker
// ------------------
// One upstream subscription, many browsers. Clients connect over websocket,
// tell us which token they're watching, and receive that token's trades as
// they land on-chain. If the upstream drops, clients keep their REST polling
// and simply reconnect — nothing in the terminal breaks.
import http from "http";
import { WebSocketServer } from "ws";
import { createUpstream } from "./upstream-bitquery.js";

const PORT = process.env.PORT || 8080;
const ORIGINS = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);

const rooms = new Map();          // mint → Set<ws>
const recent = new Map();         // mint → last trades, so a new viewer sees history instantly
let upstreamStatus = "starting";

const roomsList = () => [...rooms.keys()];
const remember = (mint, trade) => {
  const arr = recent.get(mint) || [];
  arr.push(trade);
  if (arr.length > 200) arr.splice(0, arr.length - 200);
  recent.set(mint, arr);
};

const upstream = createUpstream({
  onStatus: (s) => { upstreamStatus = s; console.log("[upstream]", s); },
  onTrade: (t) => {
    remember(t.mint, t);
    const room = rooms.get(t.mint);
    if (!room || !room.size) return;
    const msg = JSON.stringify({ type: "trade", trade: t });
    for (const ws of room) { if (ws.readyState === 1) ws.send(msg); }
  },
});

const server = http.createServer((req, res) => {
  // a tiny health page so you can see the worker is alive from a browser
  if (req.url.startsWith("/health")) {
    res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify({ ok: true, upstream: upstreamStatus, rooms: roomsList().length,
      clients: [...rooms.values()].reduce((a, s) => a + s.size, 0) }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("VALO stream worker\n");
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  const origin = req.headers.origin || "";
  if (ORIGINS.length && !ORIGINS.some((o) => origin.startsWith(o))) { ws.close(1008, "origin"); return; }
  ws.watching = null;
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });

  ws.send(JSON.stringify({ type: "hello", upstream: upstreamStatus }));

  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (m.type !== "watch" || typeof m.mint !== "string") return;
    // leave the previous room
    if (ws.watching && rooms.has(ws.watching)) {
      rooms.get(ws.watching).delete(ws);
      if (!rooms.get(ws.watching).size) rooms.delete(ws.watching);
    }
    ws.watching = m.mint;
    if (!rooms.has(m.mint)) rooms.set(m.mint, new Set());
    rooms.get(m.mint).add(ws);
    upstream.watch(roomsList());
    // hand over what we already have so the chart fills immediately
    const back = recent.get(m.mint) || [];
    if (back.length) ws.send(JSON.stringify({ type: "backfill", mint: m.mint, trades: back.slice(-120) }));
  });

  ws.on("close", () => {
    if (ws.watching && rooms.has(ws.watching)) {
      rooms.get(ws.watching).delete(ws);
      if (!rooms.get(ws.watching).size) { rooms.delete(ws.watching); recent.delete(ws.watching); }
      upstream.watch(roomsList());
    }
  });
});

// drop dead sockets so rooms don't leak
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false; try { ws.ping(); } catch (e) {}
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`[valo] stream worker listening on ${PORT}`);
  upstream.start();
});
