// VALO — Telegram bot. Welcomes new members and answers with LIVE chain data
// pulled from valotrading.app's own endpoints, so the group never argues about
// numbers that anyone can verify in two seconds.
//
//   BOT_TOKEN=123:abc node bot/valo-bot.mjs
//
// Long polling — no webhook, no public URL, runs anywhere with outbound
// network. Railway works well; so does a Raspberry Pi.
//
// Getting a token: message @BotFather → /newbot → follow prompts. Then add the
// bot to the group as an ADMIN (it needs admin to see join events).

const TOKEN = (process.env.BOT_TOKEN || "").trim();
if (!TOKEN) { console.error("BOT_TOKEN is not set. Get one from @BotFather."); process.exit(1); }

const SITE = (process.env.VALO_SITE || "https://valotrading.app").replace(/\/$/, "");
const CA = (process.env.VALO_MINT || "8sGztc2R1sMY4WiXSU1vuJqZGtzHXaA832AcifF9pump").trim();
const API = `https://api.telegram.org/bot${TOKEN}`;

const tg = async (method, body) => {
  try {
    const r = await fetch(`${API}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    return await r.json();
  } catch (e) { return null; }
};

const send = (chat_id, text, extra = {}) =>
  tg("sendMessage", { chat_id, text, parse_mode: "Markdown", disable_web_page_preview: true, ...extra });

// site data — every number the bot quotes comes from the chain, via our API
const get = async (path) => {
  try {
    const r = await fetch(`${SITE}${path}`, { signal: AbortSignal.timeout(9000) });
    return r.ok ? await r.json() : null;
  } catch (e) { return null; }
};

const n = (v, d = 0) => (v == null || !Number.isFinite(+v) ? "—" : (+v).toLocaleString(undefined, { maximumFractionDigits: d }));
const usd = (v) => (v == null || !Number.isFinite(+v) ? "—" : "$" + (+v).toLocaleString(undefined, { maximumFractionDigits: +v < 0.01 ? 8 : 2 }));

// ── commands ────────────────────────────────────────────────────────────────
const commands = {
  async price() {
    const v = await get("/api/valo");
    if (!v || !v.price) return "Couldn't reach the price feed. Try again in a moment.";
    return [
      "*$VALO*",
      `price   ${usd(v.price)}`,
      `mcap    ${usd(v.mc)}`,
      `liq     ${usd(v.tvl)}`,
      `24h vol ${usd(v.vol24)}`,
      "",
      `[chart](${SITE}) · \`${CA}\``,
    ].join("\n");
  },

  async burn() {
    const b = await get("/api/burn");
    if (!b) return "Couldn't reach the burn tracker. Try again in a moment.";
    const genesis = b.genesis || 1e9;
    const supply = b.supply || genesis;
    const burned = b.burnedTokens || 0;
    const lines = [
      "*🔥 BURN TRACKER*",
      `burned    ${n(burned)} $VALO`,
      `supply    ${n(supply)} of ${n(genesis)}`,
      `that's    ${(b.burnedPct || 0).toFixed(4)}% gone forever`,
    ];
    if (b.dedicated && b.pendingSol > 0) {
      lines.push("", `pending buyback: ${(+b.pendingSol).toFixed(4)} SOL waiting to buy $VALO and burn it`);
    }
    lines.push("", "Burns are permanent — supply only goes down.");
    return lines.join("\n");
  },

  async epoch() {
    const e = await get("/api/epoch");
    if (!e) return "Couldn't reach the epoch feed. Try again in a moment.";
    const lines = [
      "*🎁 THIS EPOCH*",
      `pool         ${n(e.pool)} $VALO`,
      `participants ${e.participants ?? 0}`,
      `ends in      ${e.minsLeft ?? "—"} min`,
    ];
    if (!e.participants) lines.push("", "Nobody has traded this hour yet — the pool is unclaimed.");
    lines.push("", `Trade on ${SITE} to earn a slice. Every real fill adds weight.`);
    return lines.join("\n");
  },

  async ca() {
    return `*$VALO contract*\n\`${CA}\`\n\nAlways verify against ${SITE} — never trust a CA from a DM.`;
  },

  async help() {
    return [
      "*VALO Terminal*",
      "",
      "/price — live price, mcap, liquidity",
      "/burn — how much $VALO is gone forever",
      "/epoch — this hour's reward pool",
      "/ca — the contract address",
      "",
      `Trade → ${SITE}`,
      "",
      "⚠️ Admins never DM first. Never share your seed phrase.",
    ].join("\n");
  },
};
commands.start = commands.help;
commands.chart = commands.price;
commands.contract = commands.ca;

const WELCOME = (name) => [
  `Welcome to VALO Terminal, ${name}. ⚡`,
  "",
  "Live Solana trading — real on-chain fills, real charts, not a dashboard.",
  "",
  `*$VALO CA:* \`${CA}\``,
  "",
  "Every trade pays 0.6%, split three ways:",
  "🔥 40% burned · 🎁 40% hourly rewards · 🏦 20% treasury",
  "",
  "Try /burn, /price or /epoch for live numbers.",
  "",
  "⚠️ Admins will never DM you first and will never ask for your seed phrase or private key. Anyone who does is a scammer.",
].join("\n");

// ── polling loop ────────────────────────────────────────────────────────────
let offset = 0;
console.log("VALO bot up — polling for updates");

const handle = async (u) => {
  const msg = u.message || u.edited_message;
  if (!msg) return;
  const chat = msg.chat && msg.chat.id;
  if (!chat) return;

  // greet new members
  if (msg.new_chat_members && msg.new_chat_members.length) {
    for (const m of msg.new_chat_members) {
      if (m.is_bot) continue;
      const name = m.first_name || m.username || "trader";
      await send(chat, WELCOME(name));
    }
    return;
  }

  const text = (msg.text || "").trim();
  if (!text.startsWith("/")) return;
  // strip the @botname suffix Telegram adds in groups
  const cmd = text.slice(1).split(/[\s@]/)[0].toLowerCase();
  const fn = commands[cmd];
  if (!fn) return;
  const reply = await fn();
  await send(chat, reply, { reply_to_message_id: msg.message_id });
};

while (true) {
  const r = await tg("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] });
  if (r && r.ok && Array.isArray(r.result)) {
    for (const u of r.result) {
      offset = u.update_id + 1;
      try { await handle(u); } catch (e) { console.error("handler:", e.message); }
    }
  } else {
    await new Promise((res) => setTimeout(res, 3000));   // back off on a bad poll
  }
}
