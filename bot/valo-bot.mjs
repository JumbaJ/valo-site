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
const PUMP = `https://pump.fun/coin/${CA}`;
const DEX = `https://dexscreener.com/solana/${CA}`;
const links = () => `[Trade on VALO →](${SITE}) · [pump.fun](${PUMP}) · [chart](${DEX})`;
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
      links(),
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
      links(),
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
    lines.push(links());
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
      links(),
    ].join("\n");
  },

  async ca() {
    return [
      "*$VALO — CONTRACT ADDRESS*",
      "",
      `\`${CA}\``,
      "",
      `[pump.fun](https://pump.fun/coin/${CA}) · [DexScreener](https://dexscreener.com/solana/${CA}) · [Solscan](https://solscan.io/token/${CA})`,
      `[Trade on VALO →](${SITE})`,
      "",
      "_This is the only real one. Check any address you're sent with_ `/verify <address>` _— never trust a contract from a DM._",
    ].join("\n");
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
commands.chatid = async () => "This chat's id is below. Put it in `CHAT_ID` so the bot can post epoch alerts here.";

commands.start = commands.help;
commands.chart = commands.price;
commands.contract = commands.ca;

const WELCOME = (name) => [
  `Welcome, ${name} ⚡ [valotrading.app](https://valotrading.app) — live Solana trading, hourly $VALO rewards.`,
  `CA: \`${CA}\` · /price /burn /epoch for live numbers`,
  "⚠️ Admins never DM first or ask for keys.",
].join("\n");

// ── polling loop ────────────────────────────────────────────────────────────
const cooldown = new Map();
let offset = 0;

// ── epoch announcer ─────────────────────────────────────────────────────────
const CHAT_ID = (process.env.CHAT_ID || "").trim();
const seen = { epoch: null, warned: null, pool: 0, participants: 0 };

const announce = async () => {
  if (!CHAT_ID) return;
  const e = await get("/api/epoch");
  if (!e || !e.epoch) return;

  // the hour rolled over — report what the epoch that just closed held
  if (seen.epoch && e.epoch !== seen.epoch) {
    const had = seen.participants;
    await send(CHAT_ID, had
      ? [
          "*⏱ EPOCH CLOSED*",
          rows([
            ["Pool", n(seen.pool) + " $VALO"],
            ["Traders", String(had)],
          ], 10),
          "_Payouts are landing in wallets now — no claiming needed._",
          "",
          "*A new hour is open.* Trade to earn a slice of the next one.",
          links(),
        ].join("\n")
      : [
          "*⏱ NEW EPOCH OPEN*",
          rows([["Pool", n(e.pool) + " $VALO"], ["Ends in", "60 min"]], 10),
          "_Last hour went unclaimed — nobody traded. This one is wide open._",
          links(),
        ].join("\n"));
    seen.warned = null;
  }

  // final call, once per epoch
  if (e.minsLeft != null && e.minsLeft <= 10 && seen.warned !== e.epoch) {
    seen.warned = e.epoch;
    await send(CHAT_ID, [
      `*⏳ ${e.minsLeft} MINUTES LEFT*`,
      rows([
        ["Pool", n(e.pool) + " $VALO"],
        ["Traders", String(e.participants ?? 0)],
      ], 10),
      (e.participants
        ? "_Every trade this hour adds weight. Fewer traders means a bigger slice each._"
        : "_Nobody has traded yet — whoever trades takes the whole pool._"),
      links(),
    ].join("\n"));
  }

  seen.epoch = e.epoch;
  seen.pool = e.pool || 0;
  seen.participants = e.participants || 0;
};

// ── buy alerts ──────────────────────────────────────────────────────────────
const MIN_BUY_USD = parseFloat(process.env.MIN_BUY_USD || "10");
const posted = new Set();
let valoPool = null;
let primed = false;   // never dump the backlog on startup

const buyLine = (usd) => {
  const n2 = Math.min(28, Math.max(1, Math.round(usd / Math.max(5, MIN_BUY_USD / 2))));
  return "🟢".repeat(n2);
};

const watchBuys = async () => {
  if (!CHAT_ID) return;
  if (!valoPool) {
    const v = await get("/api/valo");
    valoPool = (v && v.pool) || null;
    if (!valoPool) return;
  }
  const trades = await get(`/api/trades?pool=${valoPool}`);
  const list = Array.isArray(trades) ? trades : (trades && trades.trades) || [];
  if (!list.length) return;

  // first pass just records what already happened
  if (!primed) {
    for (const t of list) if (t && t.tx) posted.add(t.tx);
    primed = true;
    console.log(`buy watcher primed on ${list.length} existing trades`);
    return;
  }

  const fresh = list
    .filter((t) => t && t.isBuy && t.tx && !posted.has(t.tx) && (+t.usd || 0) >= MIN_BUY_USD)
    .sort((a, b) => a.at - b.at)
    .slice(-3);                       // a burst posts at most three lines

  for (const t of list) if (t && t.tx) posted.add(t.tx);
  if (posted.size > 3000) posted.clear();

  for (const t of fresh) {
    const who = t.trader ? `${String(t.trader).slice(0, 4)}…${String(t.trader).slice(-4)}` : "someone";
    await send(CHAT_ID, [
      "*🟢 $VALO BUY*",
      buyLine(+t.usd),
      rows([
        ["Size", usd(+t.usd)],
        ["Price", usd(+t.price)],
        ["Buyer", who],
      ], 8),
      t.tx ? `[Transaction ↗](https://solscan.io/tx/${t.tx})` : "",
      links(),
    ].filter(Boolean).join("\n"));
  }
};

if (CHAT_ID) {
  console.log("epoch announcer on for chat", CHAT_ID);
  console.log(`buy alerts on — minimum ${MIN_BUY_USD} USD`);
  watchBuys();
  setInterval(() => { watchBuys().catch((e) => console.error("buys:", e.message)); }, 25000);
  announce();
  setInterval(() => { announce().catch((e) => console.error("announce:", e.message)); }, 60000);
} else {
  console.log("epoch announcer off — set CHAT_ID to enable (run /chatid in the group)");
}
console.log("VALO bot up — polling for updates");

// ── TG → SITE RELAY — mirrors the group into Supabase so the terminal's
// ✈ TELEGRAM room shows the live conversation (text, photos, gifs, stickers).
const BOT_USERNAME = process.env.BOT_USERNAME || "ValoTerminalBot";
const SB_URL = process.env.SUPABASE_URL || "";
const SB_KEY = process.env.SUPABASE_SERVICE_KEY || "";
const relayToSite = async (msg) => {
  if (!SB_URL || !SB_KEY) return;                       // relay off until envs set
  if (String(msg.chat.id) !== String(CHAT_ID)) return;  // the group only
  const from = msg.from || {};
  if (from.is_bot && from.username === BOT_USERNAME) return; // not our own posts
  let kind = "text", file_id = null;
  if (msg.animation) { kind = "gif"; file_id = msg.animation.file_id; }
  else if (msg.photo && msg.photo.length) { kind = "photo"; file_id = msg.photo[msg.photo.length - 1].file_id; }
  else if (msg.sticker) { kind = "sticker"; file_id = msg.sticker.thumbnail ? msg.sticker.thumbnail.file_id : null; }
  else if (msg.video) { kind = "video"; file_id = msg.video.file_id; }
  const text = msg.text || msg.caption || (kind === "sticker" && !file_id ? (msg.sticker.emoji || "🩵") : "");
  if (!text && !file_id) return;
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "anon";
  try {
    await fetch(`${SB_URL}/rest/v1/tg_feed`, {
      method: "POST",
      headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json",
        prefer: "resolution=ignore-duplicates" },
      body: JSON.stringify([{ msg_id: msg.message_id, name: String(name).slice(0, 48),
        text: String(text).slice(0, 900), kind, file_id, ts: (msg.date || Math.floor(Date.now() / 1000)) }]),
    });
  } catch (e) { console.error("relay:", e.message); }
};

const syncEditToSite = async (msg) => {
  if (!SB_URL || !SB_KEY || String(msg.chat.id) !== String(CHAT_ID)) return;
  const newText = msg.text || msg.caption || "";
  if (!newText) return;
  await fetch(`${SB_URL}/rest/v1/tg_feed?msg_id=eq.${msg.message_id}`, {
    method: "PATCH",
    headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ text: String(newText).slice(0, 900) }),
  }).catch(() => {});
};

const handle = async (u) => {
  if (u.edited_message) { syncEditToSite(u.edited_message).catch(() => {}); return; }
  const msg = u.message;
  if (!msg) return;
  const chat = msg.chat && msg.chat.id;
  if (!chat) return;
  relayToSite(msg).catch(() => {});

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

  // ── MODERATION — /scrub (reply) deletes a message from Telegram AND the
  // site feed in one act; /scrubuser <name> purges a sender from the site.
  if (text.startsWith("/scrub") && String(chat) === String(CHAT_ID)) {
    const isAdmin = await fetch(`${API}/getChatMember?chat_id=${chat}&user_id=${msg.from.id}`)
      .then((r) => r.json()).then((j) => j.ok && ["creator", "administrator"].includes(j.result.status))
      .catch(() => false);
    if (!isAdmin) return;
    const sbDel = async (filter) => {
      if (!SB_URL || !SB_KEY) return;
      await fetch(`${SB_URL}/rest/v1/tg_feed?${filter}`, {
        method: "DELETE",
        headers: { apikey: SB_KEY, authorization: `Bearer ${SB_KEY}` },
      }).catch(() => {});
    };
    if (text.startsWith("/scrubuser")) {
      const who3 = text.replace("/scrubuser", "").trim().slice(0, 48);
      if (who3) {
        await sbDel(`name=ilike.${encodeURIComponent(who3 + "*")}`);
        await fetch(`${API}/deleteMessage?chat_id=${chat}&message_id=${msg.message_id}`).catch(() => {});
      }
      return;
    }
    const target = msg.reply_to_message;
    if (target) {
      await fetch(`${API}/deleteMessage?chat_id=${chat}&message_id=${target.message_id}`).catch(() => {});
      await sbDel(`msg_id=eq.${target.message_id}`);
    }
    await fetch(`${API}/deleteMessage?chat_id=${chat}&message_id=${msg.message_id}`).catch(() => {});
    return;
  }

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

  let reply = await fn(arg);
  if (cmd === "chatid") reply += `\n\n\`${chat}\``;
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
