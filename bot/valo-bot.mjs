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
// fixed-width rows inside a ``` block — the only way Telegram aligns columns
const rows = (pairs, pad = 9) => "```\n" + pairs.map(([k, v]) => String(k).toUpperCase().padEnd(pad) + v).join("\n") + "\n```";
const usd = (v) => (v == null || !Number.isFinite(+v) ? "—" : "$" + (+v).toLocaleString(undefined, { maximumFractionDigits: +v < 0.01 ? 8 : 2 }));

// ── commands ────────────────────────────────────────────────────────────────
const commands = {
  async price() {
    const v = await get("/api/valo");
    if (!v || !v.price) return "Couldn't reach the price feed. Try again in a moment.";
    return [
      "*$VALO — LIVE PRICE*",
      rows([
        ["Price", usd(v.price)],
        ["Mkt cap", usd(v.mc)],
        ["Liquidity", usd(v.tvl)],
        ["24h vol", usd(v.vol24)],
      ], 11),
      `\`${CA}\``,
      `[Open the terminal →](${SITE})`,
    ].join("\n");
  },

  async burn() {
    const b = await get("/api/burn");
    if (!b) return "Couldn't reach the burn tracker. Try again in a moment.";
    const genesis = b.genesis || 1e9;
    const supply = b.supply || genesis;
    const burned = b.burnedTokens || 0;
    const pairs = [
      ["Burned", n(burned) + " $VALO"],
      ["Supply", n(supply)],
      ["Genesis", n(genesis)],
      ["Removed", (b.burnedPct || 0).toFixed(4) + "%"],
    ];
    if (b.dedicated && b.pendingSol > 0) pairs.push(["Pending", (+b.pendingSol).toFixed(4) + " SOL"]);
    return [
      "*🔥 BURN TRACKER*",
      rows(pairs, 10),
      "_Burns are permanent. Supply only goes down._",
      `[Verify on chain →](${SITE})`,
    ].join("\n");
  },

  async epoch() {
    const e = await get("/api/epoch");
    if (!e) return "Couldn't reach the epoch feed. Try again in a moment.";
    const lines = [
      "*🎁 THIS EPOCH*",
      rows([
        ["Pool", n(e.pool) + " $VALO"],
        ["Traders", String(e.participants ?? 0)],
        ["Ends in", (e.minsLeft ?? "—") + " min"],
      ], 10),
    ];
    lines.push(e.participants
      ? "_Every real fill adds weight. Payouts land automatically._"
      : "_Nobody has traded this hour yet — the pool is unclaimed._");
    lines.push(`[Trade now →](${SITE})`);
    return lines.join("\n");
  },

  async verify(arg) {
    const given = (arg || "").trim();
    if (!given) return `*Verify a contract address*\n\nSend \`/verify <address>\` and I'll tell you if it's the real $VALO.\n\nThe only real one:\n\`${CA}\``;
    if (given === CA) return `✅ *That is the real $VALO contract.*\n\n\`${CA}\``;
    if (given.toLowerCase() === CA.toLowerCase()) {
      return `⚠️ *Close, but the capitalisation differs.* Solana addresses are case-sensitive — this is a classic lookalike.\n\nThe real one:\n\`${CA}\``;
    }
    return [
      "🚨 *That is NOT the $VALO contract.*",
      "",
      "Whoever sent it to you is trying to take your money. Don't buy it, and report them.",
      "",
      "The only real $VALO:",
      `\`${CA}\``,
    ].join("\n");
  },

  async fees() {
    return [
      "*How the fee works*",
      "",
      "0.6% per trade — 0.3% on $VALO pairs.",
      "",
      "🔥 40% burned — supply drops, permanently",
      "🎁 40% to the hourly reward pool for traders",
      "🏦 20% treasury — hosting, data feeds, development",
      "",
      "80% of every fee goes back to the community.",
      "",
      "Where it's taken depends on the route: sometimes inside the swap itself, sometimes as a separate transfer. Same rate either way, and the review card shows you the exact SOL before you confirm.",
    ].join("\n");
  },

  async rewards() {
    const e = await get("/api/epoch");
    const lines = [
      "*How rewards work*",
      "",
      "Every hour is an epoch. Trade during it and you earn a slice of that hour's pool.",
      "",
      "Your weight = (your $VALO held + SOL you traded) × your leaderboard bonus.",
      "Your share = your weight ÷ everyone's weight.",
      "",
      "Payouts land in your wallet automatically — no claiming, no gas from you.",
    ];
    if (e && e.pool != null) lines.push("", `This hour: *${n(e.pool)} $VALO* · ${e.participants ?? 0} in · ${e.minsLeft ?? "—"} min left`);
    return lines.join("\n");
  },

  async safety() {
    return [
      "*Staying safe*",
      "",
      "• Admins will *never* DM you first",
      "• Nobody will ever ask for your seed phrase or private key — not support, not admins, not anyone",
      "• Always check a contract with `/verify <address>` before buying",
      "• The only official site is valotrading.app",
      "• We will never ask you to \"validate\", \"sync\" or \"connect for verification\"",
      "",
      "If someone DMs you claiming to be from VALO: screenshot it, report it here, and block them.",
    ].join("\n");
  },

  async stats() {
    const [v, b, e] = await Promise.all([get("/api/valo"), get("/api/burn"), get("/api/epoch")]);
    const pairs = [];
    if (v && v.price) {
      pairs.push(["Price", usd(v.price)], ["Mkt cap", usd(v.mc)]);
      if (v.tvl) pairs.push(["Liquidity", usd(v.tvl)]);
    }
    if (b) pairs.push(["Burned", n(b.burnedTokens) + " $VALO"], ["Supply", n(b.supply)]);
    if (e) pairs.push(["Epoch pool", n(e.pool) + " $VALO"], ["Traders", String(e.participants ?? 0)]);
    return [
      "*VALO TERMINAL — LIVE*",
      rows(pairs, 12),
      `\`${CA}\``,
      `[Open the terminal →](${SITE})`,
    ].join("\n");
  },

  async ca() {
    return `*$VALO contract*\n\`${CA}\`\n\nAlways verify against ${SITE} — never trust a CA from a DM.`;
  },

  async help() {
    return [
      "*VALO Terminal*",
      "",
      "/stats — everything at once",
      "/price — live price, mcap, liquidity",
      "/burn — how much $VALO is gone forever",
      "/epoch — this hour's reward pool",
      "/ca — the contract address",
      "/verify <address> — is this the real $VALO?",
      "/fees — how the 0.6% is split",
      "/rewards — how hourly payouts work",
      "/safety — how not to get scammed",
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
const cooldown = new Map();
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

  // someone pasted a pump.fun-style mint that is not ours
  if (!text.startsWith("/")) {
    const hits = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}pump/g) || [];
    const foreign = hits.filter((h) => h !== CA);
    if (foreign.length && !(msg.from && msg.from.is_bot)) {
      const who2 = (msg.from && msg.from.id) || 0;
      const k2 = `warn:${chat}:${who2}`;
      if (Date.now() - (cooldown.get(k2) || 0) > 60000) {
        cooldown.set(k2, Date.now());
        await send(chat, [
          "⚠️ *That is not the $VALO contract.*",
          "",
          "If someone told you it was, they are trying to take your money.",
          "",
          "The only real one:",
          `\`${CA}\``,
          "",
          "Check any address with `/verify <address>`.",
        ].join("\n"), { reply_to_message_id: msg.message_id });
      }
    }
    return;
  }
  if (!text.startsWith("/")) return;
  // strip the @botname suffix Telegram adds in groups
  const cmd = text.slice(1).split(/[\s@]/)[0].toLowerCase();
  const arg = text.slice(1).replace(/^\S+\s*/, "").trim();
  const fn = commands[cmd];
  if (!fn) return;                       // silence on unknown — Rose owns some

  // a bot that answers every repeat instantly IS the spam
  const who = (msg.from && msg.from.id) || 0;
  const key = `${chat}:${who}`;
  const now = Date.now();
  if (now - (cooldown.get(key) || 0) < 4000) return;
  cooldown.set(key, now);
  if (cooldown.size > 5000) cooldown.clear();

  const reply = await fn(arg);
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
