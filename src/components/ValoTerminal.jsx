import { useState, useEffect, useRef, useMemo, useCallback } from "react";

/* ================================================================
   VALO TERMINAL — $VALO
   • Chat sits UNDER the chart: PUBLIC social feed + PRIVATE trade log
     (your fills & PnL never enter the public feed)
   • Order ticket stays on the right, with INSTANT BUY / INSTANT SELL
   • Click-to-trade: arm buy/sell, click the chart → instant fill,
     marker stamped exactly where you clicked
   • BIG GREEN alerts: launches & updrift candles · BIG RED: hard drops
   • Callout news banner (right→left, pauses on hover, click → chart)
     — callouts above 2x show green entry MC → current MC after username
   • Callout badges per coin: gray → light green → bright green,
     10+ callouts earns a golden border
   • Pan / zoom / crosshair charts, floating market flow, burn tax
     0.3% $VALO · 0.6% SOL — each split 50% burn pool / 50% airdrop vault
   • Rolling hourly Merkle epochs: vault half is distributed by holder weight
     + trading volume; unclaimed epochs stack until claimed
   Wire real feeds at // API: markers.
   ================================================================ */

const T = {
  bg: "#0a0d13", panel: "#11151d", panel2: "#161b25",
  border: "#232a38", border2: "#2e3648",
  text: "#e6e9ef", dim: "#8b93a7", faint: "#5b6375",
  green: "#16c784", red: "#ea3943", amber: "#f0b90b", blue: "#4c9aff",
  mono: "'SF Mono','Roboto Mono',Menlo,monospace",
  sans: "'Inter','Segoe UI',system-ui,sans-serif",
};

// ---- background modes (easter egg: tap the VALO wordmark to cycle) ----
// Only surface colours change; green/red/amber stay put so the charts stay readable.
const BASE_T = {
  bg: "#0a0d13", panel: "#11151d", panel2: "#161b25",
  border: "#232a38", border2: "#2e3648",
  text: "#e6e9ef", dim: "#8b93a7", faint: "#5b6375",
};
const THEMES = [
  { key: "natural", label: "NATURAL", swatch: "#11151d", word: ["hsl(258 80% 68%)", "hsl(230 75% 55%)"], vars: BASE_T },
  { key: "dark", label: "MIDNIGHT", swatch: "#000000", word: ["hsl(210 24% 86%)", "hsl(212 28% 52%)"], vars: {
      bg: "#000000", panel: "#07090d", panel2: "#0b0f15",
      border: "#171c26", border2: "#222936",
      text: "#f2f5fa", dim: "#7f8798", faint: "#4c5361",
    } },
  { key: "valo", label: "VALO", swatch: "#7D5CF0", word: ["hsl(272 92% 74%)", "hsl(292 78% 58%)"], vars: {
      bg: "#0b0718", panel: "#14102a", panel2: "#1b1638",
      border: "#2a2350", border2: "#3b3170",
      text: "#efeaff", dim: "#a79bd4", faint: "#6f649c",
    } },
];

const COLOR_WORDS = {
  red: 0, crimson: 348, blood: 355, fire: 15, orange: 28, gold: 45, yellow: 52,
  lemon: 58, lime: 85, green: 130, pepe: 110, frog: 105, mint: 160, teal: 175,
  cyan: 185, aqua: 190, sky: 200, blue: 220, navy: 230, purple: 270, grape: 280,
  violet: 275, pink: 330, rose: 340, magenta: 300, banana: 52, sun: 48, moon: 210,
  ice: 195, snow: 205, ghost: 240, shadow: 260, doge: 45, shib: 30, cat: 35,
  rocket: 12, lava: 8, toxic: 95, slime: 100, ocean: 205, storm: 235, neon: 315,
  valo: 258,
};
function symbolHue(sym) {
  const s = sym.toLowerCase();
  for (const w in COLOR_WORDS) if (s.includes(w)) return COLOR_WORDS[w];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
const accent = (h, l = 60) => `hsl(${h} 75% ${l}%)`;
const VALO_PURPLE = "hsl(258 75% 68%)"; // brand purple used for $VALO
const cardGrad = (h) =>
  `linear-gradient(160deg, hsla(${h},60%,50%,0.10) 0%, hsla(${h},60%,40%,0.035) 40%, transparent 75%), ${T.panel}`;

const rnd = (a, b) => a + Math.random() * (b - a);

// ---- fee schedule: 50% burn pool / 50% airdrop vault ----
const TAX = { SOL: 0.6, VALO: 0.3 };            // % per transaction
const taxFor = (pay) => (pay === "SOL" ? TAX.SOL : TAX.VALO);
// fee-safe buy sizing: every %/MAX chip shaves the site tax + a tx-fee cushion
// off the top, so a MAX buy clears cleanly instead of bouncing on the last cent
const feeSafe = (raw, pay) => {
  const net = raw * (1 - taxFor(pay) / 100) - (pay === "SOL" ? 0.002 : 0);
  const v = Math.max(0, net * 0.999);
  return pay === "SOL" ? +v.toFixed(3) : Math.floor(v);
};
const splitFee = (amt, pay) => {
  const total = amt * (taxFor(pay) / 100);
  return { total, burn: total / 2, vault: total / 2 };
};
const EPOCH_MS = 60 * 60 * 1000;                 // rolling hourly distribution
const SOL_USD = 165; // API: live SOL/USD price for $ conversions
const epochOf = (t) => Math.floor(t / EPOCH_MS);
const fmtDur = (ms) => {
  const s2 = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s2 / 3600)).padStart(2, "0")}:${String(Math.floor(s2 % 3600 / 60)).padStart(2, "0")}:${String(s2 % 60).padStart(2, "0")}`;
};
// display-only stand-in for the real root your cron publishes on-chain
const fakeRoot = (seed) => {
  let h = 0x811c9dc5 >>> 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return "0x" + h.toString(16).padStart(8, "0").repeat(8).slice(0, 60);
};
const fmt$ = (raw) => {
  const n = Number(raw);
  if (!isFinite(n)) return "$0.00";
  return n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
};
function subZeros(p) {
  const s = p.toFixed(12).replace("0.", "");
  let z = 0; while (s[z] === "0") z++;
  const subs = "₀₁₂₃₄₅₆₇₈₉";
  return String(z).split("").map((d) => subs[+d]).join("") + s.slice(z, z + 4);
}
const fmtP = (raw) => {
  const p = Number(raw);                              // markers can hand us strings — never crash a formatter
  if (!isFinite(p) || p <= 0) return "0";
  return p >= 1 ? p.toFixed(4) : p >= 0.001 ? p.toFixed(6) : "0.0" + subZeros(p);
};
const pct = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

// ---------------- candle engine ----------------
const HISTORY_MIN = 60 * 26;
function seedCandles(startPrice, momentum) {
  const out = []; const now = Date.now();
  let p = startPrice * rnd(0.45, 1.4);
  for (let i = HISTORY_MIN; i > 0; i--) {
    const t = now - i * 60000;
    const drift = (momentum - 50) / 60000;
    const vol = rnd(0.002, 0.02);
    const o = p, c = Math.max(1e-12, o * (1 + drift + rnd(-vol, vol)));
    out.push({ t, o, c, h: Math.max(o, c) * (1 + rnd(0, vol * 0.7)), l: Math.min(o, c) * (1 - rnd(0, vol * 0.7)), v: rnd(50, 4000) });
    p = c;
  }
  return out;
}
function tickCandles(candles, momentum, buyP) {
  const now = Date.now();
  const last = candles[candles.length - 1];
  const drift = (momentum - 50) / 30000 + (buyP - 50) / 40000;
  const vol = rnd(0.002, 0.018);
  const nc = Math.max(1e-12, last.c * (1 + drift + rnd(-vol, vol)));
  const bucket = Math.floor(now / 60000) * 60000;
  if (last.t >= bucket) {
    return [...candles.slice(0, -1), { ...last, c: nc, h: Math.max(last.h, nc), l: Math.min(last.l, nc), v: last.v + rnd(20, 500) }];
  }
  return [...candles.slice(-HISTORY_MIN), { t: bucket, o: last.c, h: Math.max(last.c, nc), l: Math.min(last.c, nc), c: nc, v: rnd(50, 800) }];
}
function aggregate(candles, tfMin) {
  if (tfMin <= 1) return candles;
  const out = []; const ms = tfMin * 60000; let cur = null;
  for (const c of candles) {
    const b = Math.floor(c.t / ms) * ms;
    if (!cur || cur.t !== b) { if (cur) out.push(cur); cur = { t: b, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v }; }
    else { cur.h = Math.max(cur.h, c.h); cur.l = Math.min(cur.l, c.l); cur.c = c.c; cur.v += c.v; }
  }
  if (cur) out.push(cur);
  return out;
}
const TIMEFRAMES = [
  { k: "1m", m: 1 }, { k: "5m", m: 5 }, { k: "15m", m: 15 }, { k: "30m", m: 30 },
  { k: "1H", m: 60 }, { k: "3H", m: 180 }, { k: "5H", m: 300 }, { k: "10H", m: 600 }, { k: "1D", m: 1440 },
];

// ---------------- tokens ----------------
const NAMES = [
  ["PEPEGOLD", "Pepe Gold", "pump"], ["MOONCAT", "Moon Cat", "pump"],
  ["BLOODWOLF", "Blood Wolf", "pump"], ["ICEDOGE", "Ice Doge", "robinhood"],
  ["NEONRAT", "Neon Rat", "pump"], ["LIMEFROG", "Lime Frog", "pump"],
  ["SKYWHALE", "Sky Whale", "robinhood"], ["LAVASHIB", "Lava Shib", "pump"],
  ["GRAPEAPE", "Grape Ape", "pump"], ["GHOSTFISH", "Ghost Fish", "robinhood"],
  ["SUNBIRD", "Sun Bird", "pump"], ["TOXICPUP", "Toxic Pup", "pump"],
];
let nid = 0;
function makeToken([sym, name, chain], isNew = false) {
  const price = isNew ? rnd(5e-7, 5e-6) : rnd(1e-6, 0.045);
  const traders = Math.floor(isNew ? rnd(15, 120) : rnd(150, 6200));
  const tvl = traders * rnd(40, 900);
  const greenPct = rnd(0.25, 0.78);
  const momentum = Math.round(rnd(10, 96));
  const candles = seedCandles(price, momentum);
  return {
    id: ++nid, sym, name, chain, isNew,
    hasDex: !isNew && Math.random() > 0.15, // API: dexscreener pair lookup
    traders, tvl, greenUsd: tvl * greenPct, redUsd: tvl * (1 - greenPct),
    momentum, buyPressure: Math.round(rnd(15, 92)),
    liq: tvl * rnd(0.15, 0.6), vol24: tvl * rnd(0.4, 3),
    ageMin: isNew ? Math.floor(rnd(1, 30)) : Math.floor(rnd(60, 20000)),
    hue: symbolHue(sym), candles, price: candles[candles.length - 1].c,
    supply: rnd(2e8, 1e9),
    // contract address (mint) — API: real pump.fun mint address
    ca: (() => {
      const c = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ123456789";
      return Array.from({ length: 44 }, () => c[Math.floor(Math.random() * c.length)]).join("") + "pump";
    })(),
    // socials — API: pump.fun / token metadata links
    // socials — API: pump.fun / token metadata links. Only present ones are shown.
    socials: (() => {
      const s = { pump: "https://pump.fun/" }; // pump link always exists (it's a pump.fun token)
      if (Math.random() > 0.12) s.x = `https://x.com/search?q=%24${sym}`;
      if (Math.random() > 0.45) s.tg = "https://t.me/";
      if (Math.random() > 0.5) s.site = "https://example.com/";
      return s;
    })(),
    // "why it's trending" blurb + dev wallet stats (API: pump.fun coin + creator endpoints)
    trending: {
      reason: `$${sym} is trending: a wave of new holders piled in over the last hour as volume spiked and the chart broke out. Callouts across Solana meme channels pushed fresh eyes to the pair.`,
      tweet: { user: `@${sym.toLowerCase()}whale`, text: `$${sym} looking absolutely dialed 🚀 volume ripping, holders up only. this is the one anon 👀`, likes: Math.floor(rnd(120, 4200)), rts: Math.floor(rnd(30, 900)) },
      desc: `${name} (${sym}) is a community meme token on ${chain === "pump" ? "pump.fun" : "the Robinhood chain"} / Solana. Fair launch, no presale.`,
    },
    dev: (() => {
      const now = Date.now();
      const span = candles.length * 60000; // candle window in ms
      const nTrades = Math.floor(rnd(3, 7));
      const devWallet = "7v" + Array.from({ length: 6 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("") + "…" + Array.from({ length: 4 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("");
      const trades = Array.from({ length: nTrades }, () => {
        const at = now - Math.floor(rnd(0.05, 0.95) * span);
        const side = Math.random() > 0.45 ? "buy" : "sell";
        const p = price * rnd(0.4, 1.8);
        const amt = rnd(0.5, 25);
        const entry = p * rnd(0.5, 0.95);
        const pnlPct = side === "sell" ? (p - entry) / entry : null;
        return { t: at, side, p, price: p, amt: +amt.toFixed(2), unit: "SOL", mc: p * rnd(2e8, 9e8),
          entry, pnlPct, pnlMoney: pnlPct != null ? amt * pnlPct : null, dev: true, sym, trader: devWallet,
          tx: Array.from({ length: 8 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("") };
      }).sort((a, b) => a.t - b.t);
      const launches = Array.from({ length: Math.floor(rnd(1, 6)) }, () => {
        const s = ["MOON", "DEGEN", "FROG", "TURBO", "WOJAK", "BONK2", "SNIPE", "GIGA", "APEX", "FOMO"][Math.floor(Math.random() * 10)] + Math.floor(rnd(1, 99));
        const pr = rnd(1e-6, 0.02);
        return { sym: s, price: pr, mc: pr * rnd(2e8, 9e8), hue: symbolHue(s), dead: Math.random() > 0.7 };
      });
      return {
        wallet: devWallet,
        tokensLaunched: launches.length + 1,
        rugged: launches.filter((l) => l.dead).length,
        launches,
        trades,
        creatorRewardsSol: rnd(2, 180),
        feesDay: rnd(0.2, 12), feesMonth: rnd(20, 400), feesYear: rnd(200, 5200),
        withdrawals: [
          { when: "2d ago", amt: rnd(5, 40), tx: Array.from({ length: 6 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("") },
          { when: "6d ago", amt: rnd(5, 40), tx: Array.from({ length: 6 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("") },
          { when: "3w ago", amt: rnd(10, 80), tx: Array.from({ length: 6 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("") },
        ],
        feeHistory: Array.from({ length: 30 }, (_, i) => rnd(0.1, 8) * (1 + i / 40)),
      };
    })(),
    // API: real token image URL from pump.fun / DexScreener metadata.
    // null until it resolves — the identicon shows in the meantime.
    img: null,
  };
}
const mcOf = (t) => t.price * t.supply;
const posTokenQty = (t, p) => ((p.pay === "SOL" ? p.amt * SOL_USD : p.amt * 0.0125) / (p.entry || t.price)); // token units held
const fmtQty = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + "B" : n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(0));

// callout badge: 0 = gray → light green → bright green; 10+ = gold border
function calloutStyle(n) {
  if (n <= 0) return { color: "#7d8496", bg: "rgba(125,132,150,0.10)", border: "#3a4152", gold: false };
  const k = Math.min(n, 10) / 10; // 0..1
  const light = 78 - k * 26;       // 78% (very light) → 52% (bright)
  const sat = 30 + k * 55;         // pale → vivid
  const c = `hsl(145 ${sat}% ${light}%)`;
  return {
    color: c,
    bg: `hsla(145, ${sat}%, ${light}%, 0.12)`,
    border: n > 10 ? "#e7b93c" : `hsla(145, ${sat}%, ${light}%, 0.45)`,
    gold: n > 10,
  };
}
const CALLERS = ["degenmike", "solqueen", "0xflip", "moonboi", "chartwitch", "apestrong", "rektless", "valohunter", "sniperjoe", "pnl_pat", "wagmi_wes", "drdip"];
// buy vs sell trade counts within the currently-shown chart window (tfMin * count
// minutes). Deterministic per token so it's stable, weighted by buy pressure, and
// scales with the selected timeframe duration.
// Deterministic trade history for any trader on any token. Same trader + same
// token always yields the same trades, so a followed wallet's markers are stable
// across sessions and across every chart you open.
// API: replace with a real per-wallet trade query for this mint.
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function traderTradesFor(token, trader) {
  if (!token || !trader) return [];
  if (trader === "__dev__") return token.dev?.trades || [];
  let seed = hashStr(trader + "|" + token.sym);
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const now = Date.now();
  const span = (token.candles?.length || 300) * 60000;
  const n = 2 + Math.floor(rand() * 5);
  return Array.from({ length: n }, () => {
    const at = now - Math.floor((0.05 + rand() * 0.9) * span);
    const side = rand() > 0.46 ? "buy" : "sell";
    const p = token.price * (0.45 + rand() * 1.3);
    const amt = +(0.3 + rand() * 18).toFixed(2);
    const entry = p * (0.5 + rand() * 0.45);
    const pnlPct = side === "sell" ? (p - entry) / entry : null;
    return {
      t: at, side, p, price: p, amt, unit: "SOL", mc: p * (2e8 + rand() * 7e8),
      entry, pnlPct, pnlMoney: pnlPct != null ? amt * pnlPct : null,
      sym: token.sym, trader,
      tx: Array.from({ length: 8 }, () => "abcdef0123456789"[Math.floor(rand() * 16)]).join(""),
    };
  }).sort((a, b) => a.t - b.t);
}

// Cached <img> objects for trader marker icons, so the canvas can draw them
// without reloading on every frame. Repaints once when a new icon finishes.
const ICONS = new Map();
function getIcon(src, onLoad) {
  if (!src) return null;
  if (ICONS.has(src)) return ICONS.get(src);
  const img = new Image();
  img.onload = () => { if (onLoad) onLoad(); };
  img.src = src;
  ICONS.set(src, img);
  return img;
}

// a stable default colour per trader until the user picks their own
function pickTraderColor(trader) {
  const pool = ["#4c9aff", "#a98fff", "#ff8fd1", "#ffb648", "#4ad9c6", "#8ee34a", "#ff7a6b", "#c0a3ff"];
  return pool[hashStr(String(trader)) % pool.length];
}

function buysSellsFor(t, tfMin, count = 90) {
  const windowMin = tfMin * count;
  // base activity ~ traders + volume; roughly N trades per minute
  const perMin = Math.max(0.3, (t.traders / 380) + (t.vol24 / 4e6));
  const total = Math.round(windowMin * perMin * 0.06) + 6;
  const buys = Math.round(total * (t.buyPressure / 100));
  return { buys, sells: Math.max(0, total - buys) };
}

function scoreToken(t) {
  const g = t.greenUsd / (t.greenUsd + t.redUsd);
  const liq = Math.min(100, (t.liq / t.tvl) * 180);
  const age = Math.min(100, t.ageMin / 14);
  return Math.round(t.momentum * 0.25 + t.buyPressure * 0.25 + g * 100 * 0.25 + liq * 0.15 + age * 0.1);
}
const rating = (s) => (s >= 66 ? "SAFE" : s >= 40 ? "CAUTION" : "RISKY");
const ratingColor = (s) => (s >= 66 ? T.green : s >= 40 ? T.amber : T.red);

// ================================================================
// CHART
// ================================================================
function ProChart({ candles, hue, synthetic, mode, tfMin, trades, clickMode, onChartTrade, onSelToken, onMarkerClick, position, price, sym, height = 380, isMobile = false, highlightTx = null, traderPrefs = {}, theme = 0, pendingLevels = [], botRuns = [], botSetMode = false, onBotDraft, onBotSet, onBotArm, onBotLineDrag, selectedLineId = null, editLineReq = null, onLineSelect }) {
  const wrapRef = useRef(null);
  const cvsRef = useRef(null);
  const [cross, setCross] = useState(null);
  const [hover, setHover] = useState(null);
  const [pulseTick, setPulseTick] = useState(0);
  const requestRepaint = useCallback(() => setPulseTick((t) => t + 1), []);
  const markerHitsRef = useRef([]);
  const lastPxRef = useRef({ visible: false });
  const [, forceTick] = useState(0);
  useEffect(() => { const iv = setInterval(() => forceTick((n) => n + 1), 400); return () => clearInterval(iv); }, []);
  // count = visible slots (can exceed data → free zoom-out); offset can go
  // negative (pan data off the left) or past total (pan off the right)
  const [view, setView] = useState({ count: 90, offset: 0, priceOff: 0 });
  const dragRef = useRef(null);

  useEffect(() => { setView({ count: 90, offset: 0, priceOff: 0 }); }, [tfMin]);

  const agg = useMemo(() => aggregate(candles, tfMin), [candles, tfMin]);
  const total = agg.length;
  const count = Math.max(12, Math.min(view.count, 60000));
  const offset = Math.max(-(count + 20), Math.min(view.offset, total + 20));
  // window of slots: slot s ↔ agg index (total - count - offset + s)
  const winStart = total - count - offset;

  const geom = useRef({});

  const draw = useCallback(() => {
    const cvs = cvsRef.current, wrap = wrapRef.current;
    if (!cvs || !wrap || !total) return;
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = height;
    cvs.width = W * dpr; cvs.height = H * dpr;
    const ctx = cvs.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const padR = 74, padB = 26, padT = 12, volH = 42;
    const chartH = H - padB - padT - volH;
    const plotW = W - padR;
    const step = plotW / count;
    const x = (s) => s * step + step / 2;
    const slotOf = (i) => i - winStart;          // agg index → slot
    const idxOf = (s) => winStart + s;           // slot → agg index
    const inData = (i) => i >= 0 && i < total;

    // visible candles
    let lo = Infinity, hi = -Infinity, vMax = 0, anyVisible = false;
    for (let s = 0; s < count; s++) {
      const i = idxOf(s);
      if (!inData(i)) continue;
      anyVisible = true;
      const c = agg[i];
      lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); vMax = Math.max(vMax, c.v);
    }
    if (!anyVisible) { // fully panned off — keep a sane price scale
      const last = agg[total - 1];
      lo = last.l * 0.9; hi = last.h * 1.1; vMax = 1;
    }
    const p8 = (hi - lo) * 0.1 || hi * 0.01; lo -= p8; hi += p8;
    // vertical free-drag: shift the visible price window up/down without clamping
    const vShift = (view.priceOff || 0) * (hi - lo);
    lo -= vShift; hi -= vShift;
    const y = (p) => padT + (1 - (p - lo) / (hi - lo)) * chartH;
    const tfMs = tfMin * 60000;
    const timeAtSlot = (s) => agg[0].t + idxOf(s) * tfMs; // extrapolates into empty space
    geom.current = { y, x, step, lo, hi, padT, chartH, plotW, slotOf, idxOf, inData, timeAtSlot, hiLoRange: hi - lo };

    ctx.font = `10px ${T.mono}`; ctx.textBaseline = "middle";
    // zoom strip: tint the price-axis gutter so it reads as a draggable control
    ctx.fillStyle = "rgba(76,154,255,0.05)";
    ctx.fillRect(plotW, padT, padR, chartH);
    ctx.strokeStyle = "rgba(76,154,255,0.12)";
    ctx.beginPath(); ctx.moveTo(plotW + 0.5, padT); ctx.lineTo(plotW + 0.5, padT + chartH); ctx.stroke();
    // tiny ↕ zoom hint glyph at the top of the strip
    ctx.fillStyle = "rgba(76,154,255,0.5)"; ctx.textAlign = "center"; ctx.font = `9px ${T.mono}`;
    ctx.fillText("↕", plotW + padR / 2, padT + 8);
    ctx.font = `10px ${T.mono}`; ctx.textAlign = "left";
    for (let i = 0; i <= 5; i++) {
      const p = lo + ((hi - lo) * i) / 5, yy = y(p);
      ctx.strokeStyle = "rgba(255,255,255,0.045)";
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillStyle = T.faint; ctx.fillText(fmtP(p), plotW + 8, yy);
    }
    ctx.textAlign = "center";
    const nLab = 6;
    for (let i = 0; i < nLab; i++) {
      const s = Math.floor((i / (nLab - 1)) * (count - 1));
      const xx = x(s);
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      ctx.beginPath(); ctx.moveTo(xx, padT); ctx.lineTo(xx, padT + chartH + volH); ctx.stroke();
      const d = new Date(timeAtSlot(s));
      const lab = tfMin >= 180
        ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      ctx.fillStyle = T.faint; ctx.fillText(lab, xx, H - 10);
    }
    ctx.textAlign = "left";

    if (!anyVisible) {
      ctx.fillStyle = T.faint; ctx.font = `11px ${T.mono}`; ctx.textAlign = "center";
      ctx.fillText("— chart panned off screen · hit LIVE ⟶ to return —", plotW / 2, padT + chartH / 2);
      ctx.textAlign = "left"; ctx.font = `10px ${T.mono}`;
    }

    // yellow dotted line = a bot waiting to trigger at that price. On mobile
    // candle charts these draw BENEATH the candles so the chart stays first.
    const drawBotLines = () => {
      lineHitsRef.current = [];
      // pair key: a visual pair's buy + exit share one key; a run's exits share
      // the runId — grabbing any member lights the whole family, rest go faint
      const keyOf = (o) => (typeof o.id === "string" && o.id.endsWith("::vtSell")) ? o.id.slice(0, -8)
        : o.runId != null ? "run:" + o.runId
        : o.vt && o.vtSell > 0 ? String(o.id)
        : o.id != null ? String(o.id) : null;
      const activeId = (lineDragRef.current && lineDragRef.current.id) != null
        ? lineDragRef.current.id
        : (stickyRef.current && stickyRef.current.id) != null ? stickyRef.current.id : selectedLineId;
      let activeKey = null;
      if (activeId != null) {
        const src0 = (pendingLevels || []).find((o) => o.id === activeId);
        if (src0) activeKey = keyOf(src0);
      }
      (pendingLevels || []).forEach((o) => {
        if (o.level < lo || o.level > hi) return;
        const byY = y(o.level);
        if (o.id != null && !o.draft) lineHitsRef.current.push({ id: o.id, y: byY });
        const grabbed = activeId != null && activeId === o.id;
        const paired = !grabbed && activeKey != null && keyOf(o) === activeKey;
        const dimmed = activeKey != null && !grabbed && !paired && !o.draft;
        const sell = o.side === "sell";
        // visual-trading buy in = GREEN and stays until hit; exits & sells = RED
        const col = sell ? T.red : o.vt ? T.green : T.amber;
        ctx.setLineDash(o.draft ? [6, 3] : grabbed || paired ? [8, 3] : [2, 4]); ctx.strokeStyle = col;
        ctx.globalAlpha = o.draft || grabbed ? 1 : paired ? 0.95 : dimmed ? 0.28 : 0.62;
        ctx.lineWidth = grabbed ? 2.4 : paired ? 2 : o.draft ? 1.8 : 1.4;
        ctx.beginPath(); ctx.moveTo(0, byY); ctx.lineTo(plotW, byY); ctx.stroke();
        ctx.setLineDash([]); ctx.lineWidth = 1;
        ctx.fillStyle = col; ctx.font = `bold 9px ${T.mono}`;
        // exact amount at 0.1 precision on every bot line
        const amtN = o.amt != null ? (Math.round(o.amt * 10) / 10).toFixed(1) : null;
        const amtTxt = amtN != null ? ` · ${amtN} ${o.pay || ""}` : "";
        const label = o.draft
          ? (isMobile ? `${sell ? "SELL" : "BUY"} ${fmtP(o.level)}` : `${sell ? "🔻 SELL" : o.vt ? "🟢 BUY IN" : "🤖 BUY-IN"} MOVING @ ${fmtP(o.level)}`)
          : isMobile ? `${fmtP(o.level)}${amtTxt}`
          : sell ? `${o.vt ? "🔴 EXIT POINT" : "🔻 SELL"} @ ${fmtP(o.level)}${amtTxt}`
          : o.vt ? `🟢 BUY IN @ ${fmtP(o.level)}${amtTxt}`
          : `🤖 BUY BOT TRIGGERS @ ${fmtP(o.level)}${amtTxt}`;
        ctx.fillText(label, 6, byY - 5);
        ctx.globalAlpha = 1;
        ctx.font = `10px ${T.mono}`;
      });
    };
    if (isMobile && mode === "candles") drawBotLines(); // behind the candles
    // running bots — live PnL tag riding at the entry price
    const drawRunTags = () => {
      (botRuns || []).forEach((r) => {
        if (r.entry < lo || r.entry > hi) return;
        const ry = y(r.entry);
        const pct = (price / r.entry - 1) * 100;
        const usd = (r.remaining * (price / r.entry) - r.remaining) * (r.pay === "SOL" ? SOL_USD : 0.0125);
        const up = pct >= 0, col = up ? T.green : T.red;
        ctx.setLineDash([1, 3]); ctx.strokeStyle = col; ctx.globalAlpha = 0.55;
        ctx.beginPath(); ctx.moveTo(0, ry); ctx.lineTo(plotW, ry); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        const label = `🤖 LIVE ${up ? "+" : "−"}${Math.abs(pct).toFixed(1)}% · ${up ? "+" : "−"}$${Math.abs(usd).toFixed(2)}`;
        ctx.font = `bold 9px ${T.mono}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(10,13,19,0.85)"; ctx.fillRect(4, ry + 3, tw + 8, 13);
        ctx.fillStyle = col; ctx.fillText(label, 8, ry + 12);
        ctx.font = `10px ${T.mono}`;
      });
    };
    drawRunTags();

    // volume
    const volTop = padT + chartH + 6;
    for (let s = 0; s < count; s++) {
      const i = idxOf(s); if (!inData(i)) continue;
      const c = agg[i], up = c.c >= c.o;
      ctx.fillStyle = up ? "rgba(22,199,132,0.28)" : "rgba(234,57,67,0.28)";
      const vh = (c.v / vMax) * volH;
      ctx.fillRect(x(s) - Math.max(0.6, step * 0.32), volTop + volH - vh, Math.max(1.2, step * 0.64), vh);
    }

    if (mode === "candles") {
      const bw = Math.max(1, Math.min(12, step * 0.62));
      for (let s = 0; s < count; s++) {
        const i = idxOf(s); if (!inData(i)) continue;
        const c = agg[i], up = c.c >= c.o, col = up ? T.green : T.red;
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x(s), y(c.h)); ctx.lineTo(x(s), y(c.l)); ctx.stroke();
        const yo = y(c.o), yc = y(c.c);
        ctx.fillRect(x(s) - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
      }
    } else if (anyVisible) {
      const g = ctx.createLinearGradient(0, padT, 0, padT + chartH);
      g.addColorStop(0, `hsla(${hue},80%,60%,0.22)`); g.addColorStop(1, `hsla(${hue},80%,60%,0)`);
      ctx.beginPath();
      let started = false, firstS = null, lastS = null;
      for (let s = 0; s < count; s++) {
        const i = idxOf(s); if (!inData(i)) continue;
        const c = agg[i];
        if (!started) { ctx.moveTo(x(s), y(c.c)); started = true; firstS = s; }
        else ctx.lineTo(x(s), y(c.c));
        lastS = s;
      }
      ctx.strokeStyle = accent(hue); ctx.lineWidth = 1.8; ctx.stroke();
      if (firstS != null) {
        ctx.lineTo(x(lastS), padT + chartH); ctx.lineTo(x(firstS), padT + chartH);
        ctx.closePath(); ctx.fillStyle = g; ctx.fill();
      }
    }

    // trade markers — one consolidated arrow badge per bar per side.
    // buys: green ▲ above the bar; sells: red ▼ below the bar. Click → summary.
    markerHitsRef.current = [];
    if (trades && trades.length) {
      const byIdx = new Map();
      for (const tr of trades) {
        const bucket = Math.floor(tr.t / tfMs) * tfMs;
        const i = Math.round((bucket - agg[0].t) / tfMs);
        if (!inData(i)) continue;
        const s = slotOf(i);
        if (s < 0 || s >= count) continue;
        if (!byIdx.has(s)) byIdx.set(s, { buy: [], sell: [] });
        (tr.side === "buy" ? byIdx.get(s).buy : byIdx.get(s).sell).push(tr);
      }
      byIdx.forEach((sides, s) => {
        const c = agg[idxOf(s)];
        const px = x(s);
        // one badge per trader per side, stacked so followed wallets stay distinct
        const drawSide = (all, isBuy) => {
          if (!all.length) return;
          const byTrader = new Map();
          for (const tr of all) {
            const key = tr.trader || (tr.dev ? "__dev__" : "__me__");
            if (!byTrader.has(key)) byTrader.set(key, []);
            byTrader.get(key).push(tr);
          }
          let rank = 0;
          byTrader.forEach((list, traderKey) => {
            const pref = traderPrefs[traderKey];
            const mine = traderKey === "__me__";
            const hiIn = highlightTx && list.some((t) => t.tx === highlightTx);
            const baseY = (isBuy ? y(c.h) - 16 : y(c.l) + 16) + (isBuy ? -rank * 19 : rank * 19);
            // badge body is always the gain/loss colour (green buy / red sell) so
            // direction reads instantly; the trader's own colour becomes the ring.
            const own = isBuy ? T.green : T.red;
            // a tracked trader's chosen colour paints the ENTIRE badge body
            const trackedCol = !mine && pref && pref.color ? pref.color : null;
            const badgeCol = hiIn ? "#f0b90b" : trackedCol || (list[0].dev && !mine ? "#a98fff" : own);
            const ringCol = trackedCol ? "rgba(255,255,255,0.85)" : null;
            const icon = !mine && pref && pref.icon ? getIcon(pref.icon, requestRepaint) : null;
            const w = icon ? 22 : list.length > 1 ? 26 : 18, h = 15;
            // triangle pointer toward the bar
            ctx.beginPath();
            if (isBuy) { ctx.moveTo(px, baseY + 9); ctx.lineTo(px - 5, baseY + 3); ctx.lineTo(px + 5, baseY + 3); }
            else { ctx.moveTo(px, baseY - 9); ctx.lineTo(px - 5, baseY - 3); ctx.lineTo(px + 5, baseY - 3); }
            ctx.closePath(); ctx.fillStyle = badgeCol; ctx.fill();
            const bx = px - w / 2, by = isBuy ? baseY - h + 3 : baseY - 3;
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 5); else ctx.rect(bx, by, w, h);
            ctx.fillStyle = badgeCol; ctx.fill();
            if (hiIn) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke(); }
            else if (ringCol) { ctx.strokeStyle = ringCol; ctx.lineWidth = pref && pref.following ? 2 : 1.25; ctx.stroke(); }
            if (icon && icon.complete && icon.naturalWidth) {
              // the image covers the FULL badge body, edge to edge
              ctx.save();
              ctx.beginPath();
              if (ctx.roundRect) ctx.roundRect(bx, by, w, h, 5); else ctx.rect(bx, by, w, h);
              ctx.clip();
              ctx.drawImage(icon, bx, by, w, h);
              ctx.restore();
              ctx.font = `bold 8px ${T.mono}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
              ctx.lineWidth = 2.5; ctx.strokeStyle = "rgba(0,0,0,0.75)"; ctx.fillStyle = "#fff";
              const glyph = list.length > 1 ? String(list.length) : (isBuy ? "▲" : "▼");
              ctx.strokeText(glyph, px, by + h / 2 + 0.5); ctx.fillText(glyph, px, by + h / 2 + 0.5);
            } else {
              ctx.fillStyle = isBuy ? "#07130d" : "#170808"; ctx.font = `bold 9px ${T.mono}`;
              ctx.textAlign = "center"; ctx.textBaseline = "middle";
              ctx.fillText(list.length > 1 ? `${isBuy ? "▲" : "▼"}${list.length}` : (list[0].dev ? "D" : isBuy ? "▲" : "▼"), px, by + h / 2 + 0.5);
            }
            ctx.textAlign = "left"; ctx.textBaseline = "middle";
            markerHitsRef.current.push({ x: px, y: by + h / 2, r: 12, group: { side: isBuy ? "buy" : "sell", list, sym: list[0] && list[0].sym, trader: traderKey } });
            rank++;
          });
        };
        drawSide(sides.buy, true);
        drawSide(sides.sell, false);
      });
    }

    // last price line
    const lastSlot = slotOf(total - 1);
    const last = agg[total - 1];
    if (lastSlot >= 0 && lastSlot < count && last.c >= lo && last.c <= hi) {
      const ly = y(last.c), up = last.c >= last.o;
      ctx.setLineDash([4, 4]); ctx.strokeStyle = up ? T.green : T.red;
      ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(plotW, ly); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = up ? T.green : T.red;
      ctx.fillRect(plotW + 2, ly - 9, padR - 4, 18);
      ctx.fillStyle = "#0a0d13"; ctx.fillText(fmtP(last.c), plotW + 8, ly);
      lastPxRef.current = { y: ly, x: x(lastSlot), plotW, visible: true };
    } else {
      lastPxRef.current = { visible: false };
    }

    // pending bot levels — dashed lines waiting to be hit
    // (bot trigger lines drawn via drawBotLines — order depends on platform/mode)
    if (!(isMobile && mode === "candles")) drawBotLines();

    // crosshair
    if (cross && !dragRef.current?.moved) {
      const { cx, cy } = cross;
      const s = Math.max(0, Math.min(count - 1, Math.round((cx - step / 2) / step)));
      const sx = x(s);
      const armCol = clickMode === "buy" ? T.green : clickMode === "sell" ? T.red : "rgba(255,255,255,0.35)";
      ctx.setLineDash([3, 3]); ctx.strokeStyle = armCol;
      ctx.beginPath(); ctx.moveTo(sx, padT); ctx.lineTo(sx, padT + chartH + volH); ctx.stroke();
      if (cy >= padT && cy <= padT + chartH) {
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(plotW, cy); ctx.stroke();
        const price = lo + (1 - (cy - padT) / chartH) * (hi - lo);
        ctx.setLineDash([]);
        ctx.fillStyle = "#2e3648"; ctx.fillRect(plotW + 2, cy - 9, padR - 4, 18);
        ctx.fillStyle = T.text; ctx.fillText(fmtP(price), plotW + 8, cy);
        if (clickMode) {
          ctx.fillStyle = armCol; ctx.font = `bold 10px ${T.mono}`;
          ctx.fillText(clickMode === "buy" ? "CLICK = ARM BUY BOT HERE 🤖" : "CLICK = ARM SELL BOT HERE 🤖", Math.min(sx + 12, plotW - 170), Math.max(cy - 14, padT + 10));
          ctx.font = `10px ${T.mono}`;
        }
      }
      ctx.setLineDash([]);
      const d = new Date(timeAtSlot(s));
      const tl = tfMin >= 180
        ? d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const tw = ctx.measureText(tl).width + 12;
      ctx.fillStyle = "#2e3648";
      ctx.fillRect(Math.min(Math.max(0, sx - tw / 2), plotW - tw), H - 20, tw, 16);
      ctx.fillStyle = T.text; ctx.textAlign = "center";
      ctx.fillText(tl, Math.min(Math.max(tw / 2, sx), plotW - tw / 2), H - 12);
      ctx.textAlign = "left";
    }
  }, [agg, total, count, offset, winStart, hue, mode, cross, height, tfMin, trades, clickMode, view.priceOff, highlightTx, pulseTick, traderPrefs, theme, pendingLevels, botRuns, price]);

  // keep repainting while a marker is highlighted so its ring pulses
  useEffect(() => {
    if (!highlightTx) return;
    let raf;
    const tick = () => { setPulseTick((t) => t + 1); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [highlightTx]);

  useEffect(() => { draw(); }, [draw]);
  useEffect(() => {
    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [draw]);

  // free wheel-zoom — no upper clamp against data size
  useEffect(() => {
    const cvs = cvsRef.current; if (!cvs) return;
    const onWheel = (e) => {
      e.preventDefault();
      setView((v) => ({ ...v, count: Math.max(12, Math.min(60000, Math.round(v.count * (e.deltaY > 0 ? 1.18 : 1 / 1.18)))) }));
    };
    cvs.addEventListener("wheel", onWheel, { passive: false });
    return () => cvs.removeEventListener("wheel", onWheel);
  }, []);

  // Lock the page while a finger is on the chart. React binds touch events as
  // PASSIVE, so preventDefault() inside onTouchMove is ignored and the page
  // scrolls behind your drag. Binding natively as non-passive fixes it — the
  // chart owns the gesture from touchstart until you lift off.
  // live refs so the native handler always sees the CURRENT armed mode —
  // effect closures went stale and mobile taps missed the trade path entirely
  const clickModeRef = useRef(clickMode); clickModeRef.current = clickMode;
  const onChartTradeRef = useRef(onChartTrade); onChartTradeRef.current = onChartTrade;
  // bot-set mode: dragging the chart paints the buy-in line instead of panning
  const botSetRef = useRef({}); botSetRef.current = { on: botSetMode, draft: onBotDraft, set: onBotSet, arm: onBotArm, lineDrag: onBotLineDrag };
  const lineHitsRef = useRef([]);      // grabbable bot lines: {id, y}
  const lineDragRef = useRef(null);    // active line drag: {id}
  const touchIntentRef = useRef(null); // first-move decision: chart gesture vs page scroll
  const pendGrabRef = useRef(null);    // touch press-and-hold before a line grab engages
  const stickyRef = useRef(null);      // instant-edit: the line rides the cursor until you click/release
  useEffect(() => {
    if (!editLineReq || editLineReq.id == null) return;
    // remember where the line IS — it stays put and moves relative to your hand,
    // so recent buy/sell lines hold their spot for slight adjustments
    stickyRef.current = { id: editLineReq.id, level0: editLineReq.level != null ? editLineReq.level : null, off: null };
    lineDragRef.current = { id: editLineReq.id };
    onLineSelect && onLineSelect(editLineReq.id);
  }, [editLineReq && editLineReq.n]);
  // sticky price with anchoring: first contact locks the offset between cursor
  // and line, then every move is a delta from the line's own position
  const stickyPriceAt = (cy) => {
    const st = stickyRef.current; const g = geom.current;
    const clampY = (v) => Math.min(Math.max(v, g.padT), g.padT + g.chartH);
    let yy = clampY(cy);
    if (st && st.off == null) {
      const y0 = st.level0 != null && g.y ? g.y(st.level0) : yy;
      st.off = y0 - yy;
    }
    return priceAtY(clampY(yy + ((st && st.off) || 0)));
  };
  const priceAtY = (cy) => { const g = geom.current; return g.hi - ((cy - g.padT) / g.chartH) * (g.hi - g.lo); };
  useEffect(() => {
    const cvs = cvsRef.current; if (!cvs) return;
    // SCROLL-FRIENDLY TOUCH: the first ~7px of movement decides the gesture.
    // Mostly-vertical swipe (no special mode active) → the page scrolls
    // normally. Horizontal movement, drag-set, line-grabs, or axis drags →
    // the chart takes the gesture and the page holds still.
    const chartForced = () => {
      const d = dragRef.current, bs = botSetRef.current;
      return (bs && bs.on) || lineDragRef.current || axisRef.current || (d && d.botset);
    };
    const onTS = (e) => {
      const p0 = e.touches && e.touches[0]; if (!p0) return;
      touchIntentRef.current = { x: p0.clientX, y: p0.clientY, decided: false, scroll: false };
      if (chartForced()) { touchIntentRef.current.decided = true; e.preventDefault(); }
    };
    const onTM = (e) => {
      const it = touchIntentRef.current; const p0 = e.touches && e.touches[0];
      if (pendGrabRef.current && p0) {
        const r0 = cvs.getBoundingClientRect();
        const mx = Math.abs(p0.clientX - r0.left - pendGrabRef.current.x), my = Math.abs(p0.clientY - r0.top - pendGrabRef.current.y);
        if (Math.max(mx, my) > 7) { clearTimeout(pendGrabRef.current.timer); pendGrabRef.current = null; } // moved → it's a pan
      }
      if (it && !it.decided && p0) {
        if (chartForced()) { it.decided = true; }
        else {
          const dx = Math.abs(p0.clientX - it.x), dy = Math.abs(p0.clientY - it.y);
          if (Math.max(dx, dy) > 7) {
            it.decided = true;
            it.scroll = dy > dx * 1.25; // clearly vertical → let the page move
            if (it.scroll) { dragRef.current = null; setCross(null); }
          }
        }
      }
      if (it && it.decided && it.scroll) return; // browser scrolls the page
      e.preventDefault();
      const ldm = stickyRef.current || lineDragRef.current;
      if (ldm && p0 && botSetRef.current.lineDrag) {
        const r = cvs.getBoundingClientRect();
        const cy = p0.clientY - r.top;
        botSetRef.current.lineDrag(ldm.id, stickyRef.current ? stickyPriceAt(cy) : priceAtY(Math.min(Math.max(cy, geom.current.padT), geom.current.padT + geom.current.chartH)), false);
        return;
      }
      const d = dragRef.current, bs = botSetRef.current;
      if (d && d.botset && p0 && bs.draft) {
        d.moved = true;
        const r = cvs.getBoundingClientRect();
        const g = geom.current;
        const cy = Math.min(Math.max(p0.clientY - r.top, g.padT), g.padT + g.chartH);
        bs.draft(g.hi - ((cy - g.padT) / g.chartH) * (g.hi - g.lo));
      }
    };
    cvs.addEventListener("touchstart", onTS, { passive: false });
    cvs.addEventListener("touchmove", onTM, { passive: false });
    // Native touchend for $ markers AND armed trades. React's synthetic
    // touchend is unreliable on mobile, so BOTH paths must live here.
    const onTouchEndNative = (e) => {
      if (pendGrabRef.current) { clearTimeout(pendGrabRef.current.timer); pendGrabRef.current = null; }
      const it = touchIntentRef.current; touchIntentRef.current = null;
      if (it && it.decided && it.scroll) { lineDragRef.current = null; return; }
      const ld0 = stickyRef.current || lineDragRef.current;
      if (ld0) {
        const r = cvs.getBoundingClientRect();
        const p0 = e.changedTouches && e.changedTouches[0];
        if (p0 && botSetRef.current.lineDrag) {
          const cy = p0.clientY - r.top;
          botSetRef.current.lineDrag(ld0.id, stickyRef.current ? stickyPriceAt(cy) : priceAtY(Math.min(Math.max(cy, geom.current.padT), geom.current.padT + geom.current.chartH)), true);
        }
        stickyRef.current = null; lineDragRef.current = null;
        return;
      }
      const d = dragRef.current;
      const bs = botSetRef.current;
      if (d && d.botset) {
        const r = cvs.getBoundingClientRect();
        const p0 = e.changedTouches && e.changedTouches[0];
        if (p0) {
          const g = geom.current;
          const cy = Math.min(Math.max(p0.clientY - r.top, g.padT), g.padT + g.chartH);
          bs.set && bs.set(g.hi - ((cy - g.padT) / g.chartH) * (g.hi - g.lo));
        }
        dragRef.current = null;
        return;
      }
      if (!d || d.moved) return;
      const r = cvs.getBoundingClientRect();
      const p = e.changedTouches && e.changedTouches[0];
      if (!p) return;
      const cx = p.clientX - r.left, cy = p.clientY - r.top;
      const hit = markerHitsRef.current.find((m) => Math.hypot(m.x - cx, m.y - cy) <= m.r + 12);
      if (hit && onMarkerClick) { e.preventDefault(); onMarkerClick(hit.group || hit.tr); dragRef.current = null; return; }
      // armed tap → arm a bot at the tapped price level
      const cm = clickModeRef.current, oct = onChartTradeRef.current;
      const g = geom.current;
      if (cm && oct && g.idxOf &&
          cy >= g.padT && cy <= g.padT + g.chartH && cx <= g.plotW &&
          Date.now() - d.t0 >= 90) {
        e.preventDefault();
        dragRef.current = null; // so the React handler can't double-fire
        const level = g.hi - ((cy - g.padT) / g.chartH) * (g.hi - g.lo);
        oct({ side: cm, level });
      }
    };
    cvs.addEventListener("touchend", onTouchEndNative, { passive: false });
    return () => {
      cvs.removeEventListener("touchstart", onTS);
      cvs.removeEventListener("touchmove", onTM);
      cvs.removeEventListener("touchend", onTouchEndNative);
    };
  }, [onMarkerClick]);

  const ptOf = (e) => {
    const r = cvsRef.current.getBoundingClientRect();
    const p = e.touches ? e.touches[0] : e.changedTouches ? e.changedTouches[0] : e;
    return { cx: p.clientX - r.left, cy: p.clientY - r.top };
  };
  const axisRef = useRef(null); // dragging the price-axis strip = zoom
  const onDown = (e) => {
    const { cx, cy } = ptOf(e);
    const g = geom.current;
    // touch/press starting in the right-hand price-number strip = zoom mode:
    // run finger UP to zoom in, DOWN to zoom out. No pinch, no browser fight.
    if (g.plotW != null && cx >= g.plotW - 4) {
      axisRef.current = { sy: cy, c0: count };
      dragRef.current = null;
      setCross(null);
      return;
    }
    const bs = botSetRef.current;
    if (bs.on && g.idxOf && cy >= g.padT && cy <= g.padT + g.chartH && cx <= g.plotW) {
      // drag anywhere on the plot → the yellow buy-in line follows the finger
      dragRef.current = { botset: true, moved: false, t0: Date.now(), touch: !!e.touches };
      bs.draft && bs.draft(priceAtY(cy));
      setCross(null);
      return;
    }
    // instant-edit in progress? this press LOCKS the line at this exact price
    if (stickyRef.current) {
      botSetRef.current.lineDrag && botSetRef.current.lineDrag(stickyRef.current.id, stickyPriceAt(cy), true);
      stickyRef.current = null; lineDragRef.current = null;
      return;
    }
    // grab an armed bot line? Mouse grabs instantly. Touch uses PRESS-AND-HOLD
    // (~180ms still) so panning around the chart never snags a line by accident
    const slopL = e.touches ? 11 : 8;
    const gL = geom.current;
    if (gL.plotW != null && cx < gL.plotW - 4 && botSetRef.current.lineDrag) {
      const grab = lineHitsRef.current.find((l) => Math.abs(l.y - cy) <= slopL);
      if (grab) {
        if (!e.touches) {
          lineDragRef.current = { id: grab.id };
          onLineSelect && onLineSelect(grab.id);
          botSetRef.current.lineDrag(grab.id, priceAtY(cy), false);
          dragRef.current = null; setCross(null);
          return;
        }
        // touch: arm a hold-timer; if the finger stays put it becomes a grab,
        // if it moves first it's a normal pan/scroll
        if (pendGrabRef.current) clearTimeout(pendGrabRef.current.timer);
        pendGrabRef.current = {
          id: grab.id, x: cx, y: cy,
          timer: setTimeout(() => {
            const pg = pendGrabRef.current; if (!pg) return;
            pendGrabRef.current = null;
            lineDragRef.current = { id: pg.id };
            dragRef.current = null; setCross(null);
            if (navigator.vibrate) navigator.vibrate(12); // felt feedback: line picked up
            botSetRef.current.lineDrag && botSetRef.current.lineDrag(pg.id, priceAtY(pg.y), false);
          }, 180),
        };
        // fall through — panning starts normally and wins if the finger moves
      }
    }
    onLineSelect && onLineSelect(null); // tapped open chart — drop the highlight
    dragRef.current = { sx: cx, sy: cy, startOffset: offset, startPriceOff: view.priceOff || 0, moved: false, t0: Date.now(), touch: !!e.touches };
    setCross({ cx, cy });
  };
  const onMove = (e) => {
    const { cx, cy } = ptOf(e);
    const st = stickyRef.current;
    if (st && !e.touches) {
      botSetRef.current.lineDrag && botSetRef.current.lineDrag(st.id, stickyPriceAt(cy), false);
      return;
    }
    const ld = lineDragRef.current;
    if (ld) {
      const g = geom.current;
      const yy = Math.min(Math.max(cy, g.padT), g.padT + g.chartH);
      botSetRef.current.lineDrag && botSetRef.current.lineDrag(ld.id, priceAtY(yy), false);
      return;
    }
    const d0 = dragRef.current;
    if (d0 && d0.botset) {
      d0.moved = true;
      const bs = botSetRef.current;
      bs.draft && bs.draft(priceAtY(Math.min(Math.max(cy, geom.current.padT), geom.current.padT + geom.current.chartH)));
      return;
    }
    const ax = axisRef.current;
    if (ax) {
      // up (negative dy) → fewer candles (zoom in); down → more (zoom out)
      const dy = cy - ax.sy;
      const factor = Math.pow(1.9, dy / 120); // smooth, ~1.9× per 120px
      setView((v) => ({ ...v, count: Math.max(12, Math.min(60000, Math.round(ax.c0 * factor))) }));
      return;
    }
    const d = dragRef.current;
    if (d) {
      const dx = cx - d.sx;
      const dyTot = cy - d.sy;
      const thr = d.touch ? 12 : 5;
      if (Math.abs(dx) > thr || Math.abs(dyTot) > thr) d.moved = true;
      if (d.moved) {
        const g = geom.current;
        // horizontal → time offset; vertical → free price shift (no bar limit)
        const priceShift = (dyTot / (g.chartH || 300)); // fraction of visible range
        setView((v) => ({
          ...v,
          offset: d.startOffset + Math.round(dx / (g.step || 6)),
          priceOff: (d.startPriceOff || 0) - priceShift,
        }));
        return;
      }
    }
    setCross({ cx, cy });
    const g = geom.current;
    if (g.idxOf) {
      const s = Math.max(0, Math.round((cx - g.step / 2) / g.step));
      const i = g.idxOf(s);
      setHover(g.inData(i) ? agg[i] : null);
    }
  };
  const onUp = (e) => {
    const ld = lineDragRef.current;
    if (ld) {
      const { cy } = ptOf(e);
      const g = geom.current;
      const yy = Math.min(Math.max(cy, g.padT), g.padT + g.chartH);
      botSetRef.current.lineDrag && botSetRef.current.lineDrag(ld.id, priceAtY(yy), true);
      lineDragRef.current = null;
      return;
    }
    const dBS = dragRef.current;
    if (dBS && dBS.botset) {
      const { cy } = ptOf(e);
      const bs = botSetRef.current;
      const lvl = priceAtY(Math.min(Math.max(cy, geom.current.padT), geom.current.padT + geom.current.chartH));
      bs.set && bs.set(lvl, e && e.clientX != null ? { x: e.clientX, y: e.clientY } : null); // locked in
      dragRef.current = null;
      return;
    }
    if (axisRef.current) { axisRef.current = null; return; }
    const d = dragRef.current;
    dragRef.current = null;
    // a clean tap on a $ marker opens its receipt — takes priority over trading
    if (d && !d.moved) {
      const { cx, cy } = ptOf(e);
      const pad = d.touch ? 10 : 0; // fatter target for fingers
      const hit = markerHitsRef.current.find((m) => Math.hypot(m.x - cx, m.y - cy) <= m.r + pad);
      if (hit && onMarkerClick) { onMarkerClick(hit.group || hit.tr); return; }
    }
    if (d && !d.moved && clickMode && onChartTrade) {
      const { cx, cy } = ptOf(e);
      const g = geom.current;
      if (!g.idxOf) return;
      if (cy < g.padT || cy > g.padT + g.chartH || cx > g.plotW) return;
      if (d.touch && Date.now() - d.t0 < 90) return; // ignore accidental brushes
      // the tapped PRICE level — away from market it becomes a pending order
      const level = g.hi - ((cy - g.padT) / g.chartH) * (g.hi - g.lo);
      onChartTrade({ side: clickMode, level });
    }
  };

  const ohlc = hover || agg[total - 1];
  const chg = ohlc ? ((ohlc.c - ohlc.o) / ohlc.o) * 100 : 0;

  return (
    <div ref={wrapRef}
      onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()}
      data-chart="1"
      style={{ position: "relative", background: "#0c0f16", border: `1px solid ${clickMode ? (clickMode === "buy" ? T.green : T.red) : T.border}`, borderRadius: 10, overflow: "hidden", transition: "border-color .2s", touchAction: "pan-y", overscrollBehavior: "contain" }}>
      {/* mobile: OHLC readout + LIVE/fit share a flow header row ABOVE the chart */}
      {isMobile ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6, padding: "7px 10px 4px", background: "#0c0f16", flexWrap: "nowrap" }}>
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.dim, display: "flex", gap: 7, flexWrap: "wrap", minWidth: 0 }}>
            {ohlc && (<>
              <span>O <b style={{ color: T.text }}>{fmtP(ohlc.o)}</b></span>
              <span>H <b style={{ color: T.green }}>{fmtP(ohlc.h)}</b></span>
              <span>L <b style={{ color: T.red }}>{fmtP(ohlc.l)}</b></span>
              <span>C <b style={{ color: chg >= 0 ? T.green : T.red }}>{fmtP(ohlc.c)}</b></span>
              <span style={{ color: chg >= 0 ? T.green : T.red }}>{pct(chg)}</span>
            </>)}
          </div>
          <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
            <button onClick={() => setView({ count: 18, offset: 0, priceOff: 0, follow: true })}
              style={{ height: 22, padding: "0 9px", borderRadius: 6, border: `1px solid ${T.blue}55`, background: "rgba(76,154,255,0.15)", color: T.blue, cursor: "pointer", fontSize: 9.5, fontWeight: 700, fontFamily: T.mono }}>◉ LIVE</button>
            {(offset !== 0 || count > total + 10 || Math.abs(view.priceOff || 0) > 0.01) && (
              <button onClick={() => setView({ count: Math.min(90, Math.max(15, total)), offset: 0, priceOff: 0, follow: false })}
                style={{ height: 22, padding: "0 8px", borderRadius: 6, border: `1px solid ${T.border2}`, background: "rgba(17,21,29,0.85)", color: T.dim, cursor: "pointer", fontSize: 9.5, fontFamily: T.mono }}>⤢ fit</button>
            )}
          </div>
        </div>
      ) : (
        <>
          <div style={{ position: "absolute", top: 8, left: 10, zIndex: 3, fontFamily: T.mono, fontSize: 10.5, color: T.dim, display: "flex", gap: 10, flexWrap: "wrap", pointerEvents: "none" }}>
            {ohlc && (<>
              <span>O <b style={{ color: T.text }}>{fmtP(ohlc.o)}</b></span>
              <span>H <b style={{ color: T.green }}>{fmtP(ohlc.h)}</b></span>
              <span>L <b style={{ color: T.red }}>{fmtP(ohlc.l)}</b></span>
              <span>C <b style={{ color: chg >= 0 ? T.green : T.red }}>{fmtP(ohlc.c)}</b></span>
              <span style={{ color: chg >= 0 ? T.green : T.red }}>{pct(chg)}</span>
            </>)}
          </div>
          <div style={{ position: "absolute", top: 8, right: 82, zIndex: 3, display: "flex", gap: 4 }}>
            <button onClick={() => setView({ count: 18, offset: 0, priceOff: 0, follow: true })}
              title="Zoom to the live edge and follow the price"
              style={{ height: 24, padding: "0 10px", borderRadius: 6, border: `1px solid ${T.blue}55`, background: "rgba(76,154,255,0.15)", color: T.blue, cursor: "pointer", fontSize: 10, fontWeight: 700, fontFamily: T.mono }}>◉ LIVE</button>
            {(offset !== 0 || count > total + 10 || Math.abs(view.priceOff || 0) > 0.01) && (
              <button onClick={() => setView({ count: Math.min(90, Math.max(15, total)), offset: 0, priceOff: 0, follow: false })}
                style={{ height: 24, padding: "0 8px", borderRadius: 6, border: `1px solid ${T.border2}`, background: "rgba(17,21,29,0.85)", color: T.dim, cursor: "pointer", fontSize: 10, fontFamily: T.mono }}>⤢ fit</button>
            )}
          </div>
        </>
      )}
      <div style={{ position: "absolute", bottom: 30, right: 84, zIndex: 3, fontFamily: T.mono, fontSize: 9, letterSpacing: 1, color: synthetic ? T.amber : T.faint, pointerEvents: "none" }}>
        {synthetic ? "⟲ SYNTH" : "DEXSCREENER"} · drag ⇄ pan · drag price axis ↕ zoom
      </div>
      <canvas
        ref={cvsRef}
        style={{ width: "100%", height, display: "block", cursor: clickMode ? "pointer" : "crosshair", touchAction: "pan-y", overscrollBehavior: "contain", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onDoubleClick={(e) => {
          const bs = botSetRef.current; if (!bs.on || !bs.arm) return;
          const { cx, cy } = ptOf(e); const g = geom.current;
          if (!g.idxOf || cy < g.padT || cy > g.padT + g.chartH || cx > g.plotW) return;
          bs.arm(priceAtY(cy)); // set as many as you like — no ARM press needed
        }}
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        onMouseLeave={() => { setCross(null); setHover(null); dragRef.current = null; }}
      />
      {/* live PnL box riding the latest price on the right side */}
      {position && position.amt > 0 && lastPxRef.current.visible && (() => {
        const entry = position.entry;
        const pnlPct = ((price - entry) / entry) * 100;
        // EXACT same math as every Live P/L display: settlement units → USD
        const pnlMoney = (position.amt * (price / entry) - position.amt) * ((position.pay || "SOL") === "SOL" ? SOL_USD : 0.0125);
        const col = pnlPct > 0.001 ? T.green : pnlPct < -0.001 ? T.red : T.dim;
        const top = Math.max(14, Math.min(height - 46, lastPxRef.current.y - 22));
        // hug the LATEST candle: sit just right of it, clamped inside the plot,
        // so the box shifts and bounces with the bar itself — not the price axis
        const lp = lastPxRef.current;
        // rigid to the bar with breathing room (+18px) — and when the bar rides
        // the right edge, the box slides OVER the price axis (half-visible past
        // the edge) instead of being blocked by that right-side wall
        const left = Math.max(6, Math.min((lp.x != null ? lp.x : lp.plotW) + (isMobile ? 12 : 18), lp.plotW + 46));
        return (
          <div style={{ position: "absolute", left, top, zIndex: 4, pointerEvents: "none", transform: isMobile ? "scale(0.78)" : "none", transformOrigin: "left top",
            background: "rgba(10,13,19,0.94)", border: `1px solid ${col}`, borderRadius: 8, padding: "5px 8px",
            fontFamily: T.mono, textAlign: "right", boxShadow: `0 0 12px ${col}44` }}>
            <div style={{ fontSize: 8, letterSpacing: 1, color: T.faint }}>POSITION PnL</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: col }}>{pnlMoney >= 0 ? "+" : "−"}${Math.abs(pnlMoney).toFixed(2)}</div>
            <div style={{ fontSize: 9, color: col }}>{pct(pnlPct)}</div>
            <div style={{ fontSize: 8, color: T.faint, marginTop: 2 }}>in @ ${fmtP(entry)}</div>
          </div>
        );
      })()}
    </div>
  );
}

// ---------------- UI atoms ----------------
// double-tap (mobile), hold ~500ms, double-click or right-click (PC) → edit the chip
const chipEditProps = (fn) => ({
  // HOLD (~450ms) to edit — mobile-first. PC: double-click or right-click.
  onTouchStart: (e) => {
    const n = e.currentTarget; const t = e.touches && e.touches[0]; if (!t) return;
    n._hx = t.clientX; n._hy = t.clientY;
    if (n._ht) clearTimeout(n._ht);
    n._ht = setTimeout(() => {
      n._ht = null; n._held = true;
      if (navigator.vibrate) navigator.vibrate(12);
      fn();
    }, 450);
  },
  onTouchMove: (e) => {
    const n = e.currentTarget; const t = e.touches && e.touches[0];
    if (t && n._ht && (Math.abs(t.clientX - n._hx) > 10 || Math.abs(t.clientY - n._hy) > 10)) { clearTimeout(n._ht); n._ht = null; }
  },
  onTouchEnd: (e) => { const n = e.currentTarget; if (n._ht) { clearTimeout(n._ht); n._ht = null; } },
  onClickCapture: (e) => { const n = e.currentTarget; if (n._held) { n._held = false; e.preventDefault(); e.stopPropagation(); } },
  onContextMenu: (e) => { e.preventDefault(); fn(); },
  onDoubleClick: (e) => { e.preventDefault(); fn(); },
})
// sandboxed frames (like the Claude preview) block window.prompt — so the chip
// editor is a real in-app sheet, registered by App and callable from any panel
let __openChipEditor = null;
const askPct = (cur, cb) => { __openChipEditor && __openChipEditor({ title: "SET CHIP — PERCENT", hint: "any whole % from 1 to 100", value: String(cur), unit: "%", validate: (v) => { const n = parseFloat(v); return n >= 1 && n <= 100 ? Math.round(n) : null; }, cb }); };
const askAmt = (cur, cb) => { __openChipEditor && __openChipEditor({ title: "SET CHIP — AMOUNT", hint: "0.01 and up — anything you like", value: String(cur), unit: "", validate: (v) => { const n = parseFloat(v); return n >= 0.01 ? n : null; }, cb }); };
const chip = (active) => ({
  border: `1px solid ${active ? T.border2 : T.border}`,
  background: active ? T.panel2 : "transparent",
  color: active ? T.text : T.dim,
  borderRadius: 6, padding: "4px 9px", fontSize: 11, fontFamily: T.mono, cursor: "pointer",
});
const lbl = { display: "block", fontSize: 10, letterSpacing: 1.2, color: T.dim, fontFamily: T.mono, marginBottom: 5, textTransform: "uppercase" };
const inp = { width: "100%", boxSizing: "border-box", background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 7, color: T.text, padding: "9px 11px", fontFamily: T.mono, fontSize: 13, outline: "none" };
const inpS = { ...inp, padding: "6px 8px", fontSize: 12 };

function Meter({ label, value, color }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: T.dim, fontFamily: T.mono, marginBottom: 4 }}>
        <span>{label}</span><span style={{ color, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 4, background: "#0c0f16", borderRadius: 2, border: `1px solid ${T.border}` }}>
        <div style={{ height: "100%", width: `${Math.min(100, value)}%`, background: color, borderRadius: 2, transition: "width .7s ease" }} />
      </div>
    </div>
  );
}

// ---------------- order ticket (right side) ----------------
function TradePanel({ token, onExecute, amount, pay, setPay, onDraftLevel, editBot, onRelaunch, setAmount, botLock, dragSetOn, onToggleDragSet, compactArm = false, wide = false, onReadyArm, solBalance = 0, valoWallet = 0 }) {
  const [stopLoss, setStopLoss] = useState(25);
  const [armFlash, setArmFlash] = useState(0); // lights the arm button when a bot goes live
  const [showLine, setShowLine] = useState(false); // 📍 buy-in line painted on the chart
  const [tpQuick, setTpQuick] = useState([0.5, 1, 2, 5]);   // dbl-tap a chip to retype it
  const [tpPcts, setTpPcts] = useState([25, 50, 75, 100]);
  useEffect(() => {
    if (!showLine) return;
    const cancel = (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-chart], [data-botui]')) return;
      setShowLine(false); onDraftLevel && onDraftLevel(null);
    };
    window.addEventListener("pointerdown", cancel, true);
    return () => window.removeEventListener("pointerdown", cancel, true);
  }, [showLine]);
  // buy-in price: follows live until touched
  const [buyTouched, setBuyTouched] = useState(false);
  const [buyInPrice, setBuyInPrice] = useState(token.price);
  useEffect(() => { if (!buyTouched) setBuyInPrice(token.price); }, [token.price, buyTouched]);
  useEffect(() => { if (showLine) onDraftLevel && onDraftLevel(buyInPrice, token.id, "buy"); }, [buyInPrice, showLine]);
  const [legs, setLegs] = useState([{ mult: 2, trail: 10, alloc: 50 }, { mult: 4, trail: 15, alloc: 50 }]);
  // editing an existing bot: preload every metric it launched with
  useEffect(() => {
    if (!editBot) return;
    setBuyTouched(true); setBuyInPrice(editBot.level);
    setStopLoss(editBot.stopLoss > 0 ? Math.max(1, Math.round((1 - editBot.stopLoss / editBot.level) * 100)) : 25);
    setLegs(editBot.legs && editBot.legs.length ? editBot.legs.map((l) => ({ ...l })) : [{ mult: 2, trail: 10, alloc: 100 }]);
    setAmount && setAmount(String(editBot.amt));
    onDraftLevel && onDraftLevel(editBot.level, editBot.tokenId, "buy");
  }, [editBot && editBot.id]);
  // chart-drag lock: the level dragged on the chart becomes the buy-in price
  useEffect(() => {
    if (!botLock || !(botLock.level > 0) || botLock.side === "sell") return;
    setBuyTouched(true); setBuyInPrice(botLock.level);
  }, [botLock && botLock.n]);
  const buyMin = Math.min(token.price * 0.6, buyInPrice), buyMax = Math.max(token.price * 1.4, buyInPrice);
  const buyPct = ((buyInPrice - token.price) / token.price) * 100;
  const allocTotal = legs.reduce((a, l) => a + Number(l.alloc || 0), 0);
  const tax = taxFor(pay);
  const amt = parseFloat(amount) || 0;
  const fee = splitFee(amt, pay);
  const armNow = () => {
    const payload = { side: "buy", pay, amt, mode: "auto", limitBuy: buyTouched ? fmtP(buyInPrice) : "", limitBuyPrice: buyTouched ? buyInPrice : null, stopLoss, legs, tax, burn: fee.total };
    if (editBot && onRelaunch) onRelaunch(editBot.id, payload);
    else onExecute(payload);
    setArmFlash(Date.now()); setTimeout(() => setArmFlash(0), 900);
  };
  const setLeg = (i, k, v) => setLegs((L) => L.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const invalid = allocTotal !== 100;
  const armRef = useRef(null); armRef.current = armNow;
  useEffect(() => {
    onReadyArm && onReadyArm(invalid ? null : () => armRef.current && armRef.current());
    return () => { onReadyArm && onReadyArm(null); };
  }, [invalid, !!onReadyArm]);
  const flashOn = !!armFlash;

  return (
    <div data-botui="1" style={{ background: wide ? "transparent" : T.panel, border: wide ? "none" : `1px solid ${T.border2}`, borderRadius: 12, padding: wide ? 0 : 14,
      ...(wide ? { display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" } : {}) }}>
      {!wide && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.dim, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          🤖 AUTO TRADER · <b style={{ color: accent(token.hue) }}>{token.sym}</b>
        </div>
        {compactArm && (
          <button disabled={invalid} onClick={armNow}
            style={{ flex: "0 0 auto", border: "none", borderRadius: 8, padding: "7px 13px", fontFamily: T.mono, fontSize: 10.5, letterSpacing: 1, fontWeight: 900,
              background: invalid ? "#1a2030" : editBot ? T.amber : T.blue, color: invalid ? T.faint : editBot ? "#1d1503" : "#07101d", cursor: invalid ? "not-allowed" : "pointer",
              transform: flashOn ? "scale(1.08)" : "scale(1)", transition: "transform .18s, box-shadow .18s",
              boxShadow: invalid ? "none" : flashOn ? `0 0 22px ${editBot ? T.amber : T.blue}` : `0 0 10px ${editBot ? "rgba(240,185,11,0.4)" : "rgba(46,112,204,0.45)"}` }}>
            {flashOn ? "✓ ARMED" : editBot ? "🔁 RELAUNCH" : "🤖 ARM"}
          </button>
        )}
      </div>
      )}

      <div style={wide ? { border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.015)", flex: "1 1 210px", minWidth: 200 } : undefined}>
      {/* BUY-IN AMOUNT — swap SOL / $VALO freely */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <label style={{ ...lbl, marginBottom: 0 }}>Buy-in amount</label>
        {setPay && (
          <span style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setPay("SOL")} style={{ ...chip(pay === "SOL"), padding: "3px 9px", fontSize: 8.5, fontWeight: 800, color: pay === "SOL" ? T.blue : T.faint }}>SOL</button>
            <button onClick={() => setPay("VALO")} style={{ ...chip(pay === "VALO"), padding: "3px 9px", fontSize: 8.5, fontWeight: 800, color: pay === "VALO" ? VALO_PURPLE : T.faint }}>$VALO</button>
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "5px 0 4px" }}>
        <button onClick={() => setAmount && setAmount(Math.max(0, (parseFloat(amount) || 0) - 0.1).toFixed(1))}
          style={{ ...chip(false), flex: "0 0 auto", padding: wide ? "6px 10px" : "9px 12px", fontSize: 13, fontWeight: 900 }}>−</button>
        <input value={amount} onChange={(e) => setAmount && setAmount(e.target.value)} inputMode="decimal"
          style={{ ...inp, flex: 1, minWidth: 0, fontSize: wide ? 13 : 15, fontWeight: 800, padding: wide ? "7px 9px" : "10px 12px", textAlign: "center" }} />
        <button onClick={() => setAmount && setAmount(((parseFloat(amount) || 0) + 0.1).toFixed(1))}
          style={{ ...chip(false), flex: "0 0 auto", padding: wide ? "6px 10px" : "9px 12px", fontSize: 13, fontWeight: 900 }}>+</button>
        <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 800, color: pay === "SOL" ? T.blue : VALO_PURPLE, flex: "0 0 auto" }}>{pay}</span>
      </div>
      <div style={{ display: "flex", gap: 5, marginBottom: wide ? 4 : 10 }}>
        {tpQuick.map((v, ci) => (
          <button key={ci} onClick={() => setAmount && setAmount(String(v))}
            {...chipEditProps(() => { askAmt(v, (nv) => setTpQuick((A) => A.map((x, j) => (j === ci ? nv : x)))); })}
            style={{ ...chip(parseFloat(amount) === v), flex: 1, textAlign: "center", padding: "5px 0", fontSize: 9.5, fontWeight: 800 }}>{v}</button>
        ))}
        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, alignSelf: "center", flex: "0 0 auto", marginLeft: 4 }}>
          ≈ ${(amt * (pay === "SOL" ? SOL_USD : 0.0125)).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD
        </span>
      </div>
      {!compactArm && (() => {
        const bal = pay === "SOL" ? solBalance : valoWallet;
        const unit$ = pay === "SOL" ? SOL_USD : 0.0125;
        return (
          <>
            <div style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 900, color: T.blue,
              background: "rgba(76,154,255,0.10)", border: `1px solid ${T.blue}55`, borderRadius: 8,
              padding: "6px 10px", margin: "4px 0 6px", display: "flex", justifyContent: "space-between", alignItems: "baseline",
              boxShadow: "0 0 12px rgba(76,154,255,0.18)" }}>
              <span>💼 {bal.toFixed(2)} {pay}</span>
              <span style={{ fontSize: 9.5, opacity: 0.85 }}>≈ ${(bal * unit$).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {tpPcts.map((pc, ci) => (
                <button key={ci} onClick={() => setAmount && setAmount(String(feeSafe((bal * pc) / 100, pay)))}
                  {...chipEditProps(() => { askPct(pc, (nv) => setTpPcts((A) => A.map((x, j) => (j === ci ? nv : x)))); })}
                  style={{ ...chip(false), flex: 1, textAlign: "center", padding: "3px 0", fontSize: 8.5, fontWeight: 800 }}>{pc === 100 ? "MAX" : `${pc}%`}</button>
              ))}
            </div>
          </>
        );
      })()}

      </div>
      <div style={wide ? { border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.015)", flex: "1.1 1 230px", minWidth: 220 } : undefined}>
      {/* buy-in price slider — tracks live price, drag to set a higher/lower entry */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 7 }}>
        {onDraftLevel && (
          <button onClick={() => { const on = !showLine; setShowLine(on); onDraftLevel(on ? buyInPrice : null, token.id, "buy"); }}
            title={showLine ? "Hide the buy-in line on the chart" : "Show the buy-in line on the chart"}
            style={{ ...chip(showLine), flex: "0 0 auto", padding: "4px 9px", fontSize: 11, fontWeight: 900, color: showLine ? T.green : T.dim, borderColor: showLine ? `${T.green}88` : T.border, boxShadow: showLine ? `0 0 8px ${T.green}55` : "none" }}>📍</button>
        )}
        {onToggleDragSet && (
          <button onClick={() => { const on = !dragSetOn; onToggleDragSet(); if (on) onDraftLevel && onDraftLevel(buyInPrice, token.id, "buy"); }}
            title={dragSetOn ? "Drag-set ON — drag on the chart (double-click arms instantly)" : "Drag-set: click, then drag on the chart to set the buy-in with the mouse"}
            style={{ ...chip(!!dragSetOn), flex: "0 0 auto", padding: "4px 9px", fontSize: 11, fontWeight: 900, color: dragSetOn ? T.amber : T.dim, borderColor: dragSetOn ? `${T.amber}88` : T.border, boxShadow: dragSetOn ? `0 0 8px ${T.amber}55` : "none" }}>✋</button>
        )}
        <label style={{ ...lbl, marginBottom: 0, flex: 1 }}>Buy-in price {buyTouched ? "" : "· tracking live"}</label>
        {buyTouched && (
          <button onClick={() => { setBuyTouched(false); setBuyInPrice(token.price); onDraftLevel && onDraftLevel(null); }}
            style={{ ...chip(false), padding: "2px 7px", fontSize: 9 }}>↻ live</button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "3px 0 2px" }}>
        <span style={{ fontFamily: T.mono, fontSize: wide ? 13 : 15, fontWeight: 800, color: buyTouched ? (buyPct >= 0 ? T.green : T.red) : T.text }}>${fmtP(buyInPrice)}</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: buyPct >= 0 ? T.green : T.red }}>{buyPct >= 0 ? "+" : ""}{buyPct.toFixed(1)}% vs live</span>
      </div>
      <input type="range" min={buyMin} max={buyMax} step={(buyMax - buyMin) / 400} value={Math.min(buyMax, Math.max(buyMin, buyInPrice))}
        onChange={(e) => { setBuyTouched(true); setBuyInPrice(+e.target.value); onDraftLevel && onDraftLevel(+e.target.value, token.id, "buy"); }}
        style={{ width: "100%", accentColor: accent(token.hue) }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 8, color: T.faint, marginTop: -2 }}>
        <span>−40%</span><span>live ${fmtP(token.price)}</span><span>+40%</span>
      </div>

      </div>
      <div style={wide ? { border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.015)", flex: "1.3 1 260px", minWidth: 250 } : undefined}>
      <label style={{ ...lbl, marginTop: wide ? 0 : 12 }}>Stop loss — {stopLoss}% below entry</label>
      <input type="range" min={1} max={100} value={stopLoss} onChange={(e) => setStopLoss(+e.target.value)} style={{ width: "100%", accentColor: T.red }} />

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, marginBottom: 6 }}>
        <span style={{ ...lbl, marginBottom: 0 }}>Trailing take-profit legs</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: allocTotal === 100 ? T.green : T.red }}>Σ {allocTotal}% {allocTotal === 100 ? "✓" : "must=100"}</span>
      </div>
      {legs.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 28px", gap: wide ? 4 : 6, marginBottom: wide ? 3 : 6 }}>
          <div>
            <span style={{ ...lbl, fontSize: 9, marginBottom: 2 }}>at ×</span><input value={l.mult} onChange={(e) => setLeg(i, "mult", e.target.value)} style={inpS} />
            {(() => { const m = parseFloat(l.mult) || 0, al = Number(l.alloc || 0); const est = amt * (al / 100) * (m - 1) * (pay === "SOL" ? SOL_USD : 0.0125);
              return m > 1 && al > 0 ? <span style={{ display: "block", fontFamily: T.mono, fontSize: 7.5, fontWeight: 800, color: T.green, marginTop: 2 }}>≈ +${est.toFixed(0)} · ×{m}</span> : null; })()}
          </div>
          <div><span style={{ ...lbl, fontSize: 9, marginBottom: 2 }}>trail%</span><input value={l.trail} onChange={(e) => setLeg(i, "trail", e.target.value)} style={inpS} /></div>
          <div><span style={{ ...lbl, fontSize: 9, marginBottom: 2 }}>sell%</span><input value={l.alloc} onChange={(e) => setLeg(i, "alloc", +e.target.value)} style={inpS} /></div>
          <button onClick={() => setLegs((L) => L.filter((_, j) => j !== i))} style={{ ...chip(false), alignSelf: "end", padding: "5px 0", textAlign: "center" }}>−</button>
        </div>
      ))}
      <button onClick={() => setLegs((L) => [...L, { mult: 3, trail: 12, alloc: 0 }])} style={{ ...chip(false), width: "100%", textAlign: "center" }}>+ add leg</button>
      {wide && (
        <button disabled={invalid} onClick={armNow}
          style={{ width: "100%", marginTop: 7, border: "none", borderRadius: 8, padding: "8px", fontFamily: T.mono, fontSize: 11, letterSpacing: 1.2, fontWeight: 900,
            background: invalid ? "#1a2030" : editBot ? T.amber : T.blue, color: invalid ? T.faint : editBot ? "#1d1503" : "#07101d", cursor: invalid ? "not-allowed" : "pointer",
            transform: flashOn ? "scale(1.02)" : "scale(1)", transition: "transform .18s, box-shadow .18s",
            boxShadow: flashOn ? `0 0 20px ${editBot ? T.amber : T.blue}` : "none" }}>
          {flashOn ? "✓ ARMED" : editBot ? "🔁 RELAUNCH" : "🤖 ARM"}
        </button>
      )}
      </div>
      {!(compactArm || wide) && !onReadyArm && (
        <button disabled={invalid} onClick={armNow}
          style={{
            gridColumn: wide ? "1 / -1" : undefined,
            width: "100%", marginTop: wide ? 4 : 10, border: "none", borderRadius: 9, padding: wide ? "9px" : "12px", fontFamily: T.mono, fontSize: wide ? 11.5 : 12.5, letterSpacing: 1.5, fontWeight: 800,
            background: invalid ? "#1a2030" : editBot ? T.amber : T.blue, color: invalid ? T.faint : editBot ? "#1d1503" : "#07101d", cursor: invalid ? "not-allowed" : "pointer",
            transform: flashOn ? "scale(1.02)" : "scale(1)", transition: "transform .18s, box-shadow .18s",
            boxShadow: flashOn ? `0 0 22px ${editBot ? T.amber : T.blue}` : "none",
          }}>{flashOn ? "✓ ARMED" : editBot ? "🔁 RELAUNCH BOT" : "🤖 ARM AUTO STRATEGY"}</button>
      )}

      <div style={{ width: wide ? "100%" : undefined, fontFamily: T.mono, fontSize: wide ? 8 : 9, color: T.faint, marginTop: wide ? 2 : 9, lineHeight: 1.5, borderTop: wide ? "none" : `1px solid ${T.border}`, paddingTop: wide ? 0 : 8 }}>
        <div>🔥 {fee.burn.toFixed(5)} → burn pool · 🎁 {fee.vault.toFixed(5)} → airdrop vault ({pay === "SOL" ? "0.6%" : "0.3%"} fee)</div>
      </div>
    </div>
  );
}

// full desktop ticket — settlement, instant buy/sell, click-to-trade arming,
// plus the auto strategy. Desktop keeps the complete toolset.
// held positions dropdown — every open position with per-token PnL, click-to-open, per-token & bulk close
function HeldPositions({ positions, tokens, pay, onOpenToken, onSellAll, onCloseAll, onTrade, solBalance = 0, valoWallet = 0 }) {
  const [rowMode, setRowMode] = useState({}); // { [tokenId]: "buy" } — toggle flips the bar
  const [confirmSel, setConfirmSel] = useState(null); // { tid, side, pct } — two-tap safety
  const confTO = useRef(null);
  const [open, setOpen] = useState(false);
  const held = Object.entries(positions)
    .map(([id, p]) => { const t = tokens.find((x) => x.id === +id); return t && p && p.amt > 0 ? { t, p } : null; })
    .filter(Boolean);

  // per-token PnL in USD
  const pnlUsdOf = ({ t, p }) => {
    const pnlPct = (t.price - p.entry) / p.entry;
    const sizeSol = p.pay === "SOL" ? p.amt : (p.amt * t.price) / SOL_USD;
    return sizeSol * pnlPct * SOL_USD;
  };
  const valueSolOf = ({ t, p }) => (p.pay === "SOL" ? p.amt : (p.amt * t.price) / SOL_USD);
  const costSolOf = ({ t, p }) => (p.pay === "SOL" ? p.amt : (p.amt * p.entry) / SOL_USD);
  const totalPnlUsd = held.reduce((a, h) => a + pnlUsdOf(h), 0);
  const totalSol = held.reduce((a, h) => a + valueSolOf(h), 0);
  const investedUsd = held.reduce((a, h) => a + costSolOf(h) * SOL_USD, 0);
  const currentUsd = investedUsd + totalPnlUsd;
  const bulkGain = totalPnlUsd >= 0;

  return (
    <div style={{ marginTop: 10 }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", border: `1px solid ${T.border2}`, borderRadius: 9, padding: "9px 12px", background: "rgba(255,255,255,0.02)", cursor: "pointer", fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: T.text }}>
        <span>▾ MY POSITIONS · {held.length}</span>
        <span style={{ color: totalPnlUsd >= 0 ? T.green : T.red }}>{totalPnlUsd >= 0 ? "+" : "−"}${Math.abs(totalPnlUsd).toFixed(2)}</span>
      </button>

      {open && (
        <div style={{ marginTop: 8, display: "grid", gap: 7 }}>
          {held.length === 0 && (
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, textAlign: "center", padding: "10px 0" }}>No open positions.</div>
          )}
          {held.length > 0 && (
            <button onClick={onCloseAll}
              style={{ width: "100%", boxSizing: "border-box", border: "none", borderRadius: 10, padding: "10px", fontFamily: T.mono, fontWeight: 800,
                background: bulkGain ? T.green : T.red, color: bulkGain ? "#07130d" : "#170808", cursor: "pointer", lineHeight: 1.35,
                boxShadow: `0 0 14px ${bulkGain ? "rgba(22,199,132,0.35)" : "rgba(234,57,67,0.35)"}` }}>
              <div style={{ fontSize: 12.5 }}>✕ CLOSE ALL · {bulkGain ? "+" : "−"}${Math.abs(totalPnlUsd).toFixed(2)}</div>
              <div style={{ fontSize: 8.5, opacity: 0.9 }}>put in ${investedUsd.toFixed(0)} → now ${currentUsd.toFixed(0)} · {totalSol.toFixed(2)} SOL</div>
            </button>
          )}
          {held.map((h) => {
            const pnl = pnlUsdOf(h); const gain = pnl >= 0;
            return (
              <div key={h.t.id}
                onClick={() => onOpenToken(h.t.id)}
                style={{
                  border: `1.5px solid ${gain ? "rgba(22,199,132,0.4)" : "rgba(234,57,67,0.4)"}`,
                  background: gain ? "rgba(22,199,132,0.08)" : "rgba(234,57,67,0.08)",
                  borderRadius: 11, padding: "9px 10px", cursor: "pointer",
                  transition: "box-shadow .15s, border-color .15s",
                }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <TokenAvatar sym={h.t.sym} hue={h.t.hue} img={h.t.img} size={18} />
                    <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 800, color: T.text }}>{h.t.sym}</span>
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                    <MultBadge mult={h.p.entry > 0 ? h.t.price / h.p.entry : 0} live small />
                    <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: gain ? T.green : T.red }}>
                      {gain ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
                    </span>
                  </span>
                </div>
                {(() => {
                  const buyMode = rowMode[h.t.id] === "buy";
                  const payU = h.p.pay || pay;
                  const bal = payU === "SOL" ? solBalance : valoWallet;
                  const unit$ = payU === "SOL" ? SOL_USD : 0.0125;
                  const fmtUsd = (u) => (u >= 1000 ? "$" + (u / 1000).toFixed(1) + "K" : "$" + u.toFixed(u < 10 ? 2 : 0));
                  // two-tap safety: first tap shows ✓ + the exact $ at stake; second tap executes
                  const pctBtn = (pct, side) => {
                    const amt = +(((side === "sell" ? h.p.amt : bal) * pct) / 100).toFixed(4);
                    const usd = amt * unit$;
                    const isConf = confirmSel && confirmSel.tid === h.t.id && confirmSel.side === side && confirmSel.pct === pct;
                    const col = side === "sell" ? T.red : T.green;
                    return (
                      <button key={side + pct} onClick={(e) => {
                          e.stopPropagation();
                          if (amt <= 0) return;
                          if (isConf) { clearTimeout(confTO.current); setConfirmSel(null); onTrade && onTrade(h.t, side, amt); }
                          else { setConfirmSel({ tid: h.t.id, side, pct }); clearTimeout(confTO.current); confTO.current = setTimeout(() => setConfirmSel(null), 2600); }
                        }}
                        title={isConf ? `Tap again to confirm ${side} of ${fmtUsd(usd)}` : `${side === "sell" ? "Sell" : "Buy"} ${pct}% — ${fmtUsd(usd)} (two-tap)`}
                        style={{ flex: 1, minWidth: 40, flexBasis: 40, border: `1px solid ${isConf ? col : col + "80"}`,
                          background: isConf ? col : "transparent",
                          color: isConf ? (side === "sell" ? "#170808" : "#07130d") : col,
                          borderRadius: 7, padding: "4px 0", fontFamily: T.mono, fontWeight: 800, cursor: "pointer", lineHeight: 1.35 }}>
                        <span style={{ display: "block", fontSize: 12 }}>{isConf ? "✓" : pct + "%"}</span>
                        <span style={{ display: "block", fontSize: 8.5, opacity: 0.9, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{amt >= 1000 ? (amt / 1000).toFixed(1) + "K" : amt.toFixed(amt < 10 ? 2 : 1)} {payU}</span>
                      </button>
                    );
                  };
                  return (
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
                      {/* mode toggle — vertical label reads bottom-up: green BUY while
                          selling, red SELL while buying */}
                      <button onClick={() => { setConfirmSel(null); setRowMode((M) => ({ ...M, [h.t.id]: buyMode ? undefined : "buy" })); }}
                        title={buyMode ? "Back to selling" : "Switch to buying — increase this position"}
                        style={{ flex: "0 0 auto", width: 26, border: `1px solid ${buyMode ? T.red : T.green}`, background: buyMode ? "rgba(234,57,67,0.14)" : "rgba(22,199,132,0.14)", color: buyMode ? T.red : T.green, borderRadius: 7, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, transition: "background .2s, color .2s, border-color .2s" }}>
                        <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: T.mono, fontSize: 8.5, fontWeight: 900, letterSpacing: 1.5 }}>{buyMode ? "SELL" : "BUY"}</span>
                      </button>
                      {[10, 25, 50, 75].map((pct) => pctBtn(pct, buyMode ? "buy" : "sell"))}
                      {buyMode ? (
                        (() => {
                          const isConf = confirmSel && confirmSel.tid === h.t.id && confirmSel.side === "buy" && confirmSel.pct === "ALL";
                          return (
                            <button onClick={(e) => {
                                e.stopPropagation();
                                if (bal <= 0) return;
                                if (isConf) { clearTimeout(confTO.current); setConfirmSel(null); onTrade && onTrade(h.t, "buy", +bal.toFixed(4)); }
                                else { setConfirmSel({ tid: h.t.id, side: "buy", pct: "ALL" }); clearTimeout(confTO.current); confTO.current = setTimeout(() => setConfirmSel(null), 2600); }
                              }}
                              title={isConf ? "Tap again to confirm going ALL IN" : "ALL IN — your whole balance (two-tap)"}
                              style={{ flex: "1 1 130px", minWidth: 120, border: isConf ? `1px solid ${T.green}` : "none", borderRadius: 7, padding: "4px 8px", boxSizing: "border-box", fontFamily: T.mono, fontWeight: 900, background: isConf ? "#0d1f16" : T.green, color: isConf ? T.green : "#07130d", cursor: "pointer", lineHeight: 1.35, textAlign: "center" }}>
                              <span style={{ display: "block", fontSize: 12, letterSpacing: 1 }}>{isConf ? "✓ ALL IN?" : "ALL IN"}</span>
                              <span style={{ display: "block", fontSize: 8.5, opacity: 0.92, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{bal.toFixed(2)} {payU} · ${(bal * unit$).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
                            </button>
                          );
                        })()
                      ) : (
                        <button onClick={(e) => { e.stopPropagation(); onSellAll(h.t); }}
                          style={{ flex: "1 1 130px", minWidth: 120, boxSizing: "border-box", border: "none", borderRadius: 7, padding: "7px 9px", fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, background: gain ? T.green : T.red, color: gain ? "#07130d" : "#170808", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                          <span>SELL ALL</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                            <span style={{ fontSize: 9, opacity: 0.8 }}>{fmtQty(posTokenQty(h.t, h.p))}</span>
                            <span>{gain ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
                          </span>
                        </button>
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DesktopTradePanel({ token, onExecute, clickMode, setClickMode, amount, setAmount, pay, setPay, position, solBalance, valoBalance, positions, tokens, onOpenToken, onCloseAll, bestMult, pctSel, setPctSel, pendingOrders = [], onOpenBot, onCancelBot, onPosTrade, onDraftLevel, realized24 = 0 }) {
  const [dtBuyPcts, setDtBuyPcts] = useState([10, 25, 50, 75, 100]);  // dbl-click / right-click a chip to retype it
  const [dtSellPcts, setDtSellPcts] = useState([10, 25, 50, 75, 100]);
  const [dtFixed, setDtFixed] = useState([0.5, 1, 2, 5]);
  const [autoOpen, setAutoOpen] = useState(false); // AUTO-TRADING collapsible
  const amt = parseFloat(amount) || 0;
  const fee = splitFee(amt, pay);
  const armNow = () => {
    const payload = { side: "buy", pay, amt, mode: "auto", limitBuy: buyTouched ? fmtP(buyInPrice) : "", limitBuyPrice: buyTouched ? buyInPrice : null, stopLoss, legs, tax, burn: fee.total };
    if (editBot && onRelaunch) onRelaunch(editBot.id, payload);
    else onExecute(payload);
  };
  const held = position?.amt || 0;
  const pnlPct = position ? ((token.price - position.entry) / position.entry) * 100 : 0;
  const heldSol = pay === "SOL" ? held : (held * token.price) / SOL_USD;
  const livePnlUsd = position ? (heldSol * pnlPct / 100) * SOL_USD : 0;
  const liveMult = position ? token.price / position.entry : 0;
  const gain = livePnlUsd >= 0;
  const setPct = (p, ofHoldings) => {
    if (ofHoldings) { setAmount(pay === "SOL" ? (held * p / 100).toFixed(4) : Math.floor(held * p / 100).toString()); }
    else { const bal = pay === "SOL" ? solBalance : valoBalance; setAmount(pay === "SOL" ? (bal * p / 100).toFixed(2) : Math.floor(bal * p / 100).toString()); }
  };
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, padding: 16 }}>
      {/* LIVE PnL + multiplier header — fluctuates while you hold */}
      {position ? (
        <div style={{ borderRadius: 10, padding: "10px 12px", marginBottom: 12, background: gain ? "rgba(22,199,132,0.1)" : "rgba(234,57,67,0.1)", border: `1px solid ${gain ? "rgba(22,199,132,0.4)" : "rgba(234,57,67,0.4)"}`, transition: "background .3s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>LIVE P/L · {token.sym}</div>
              <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 900, color: gain ? T.green : T.red }}>{gain ? "+" : "−"}${Math.abs(livePnlUsd).toFixed(2)}</div>
              <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: T.text, opacity: 0.9 }}>{fmtQty(posTokenQty(token, position))} tokens</div>
              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>avg ${fmtP(position.entry)} → ${fmtP(token.price)}</div>
              {/* manual money only — bots keep their own book */}
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, marginTop: 3, lineHeight: 1.5 }}>
                BUY-IN ${((position.amt || 0) * (pay === "SOL" ? SOL_USD : 0.0125)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
                <span style={{ color: (realized24 || 0) >= 0 ? T.green : T.red }}> · REALIZED 24H {(realized24 || 0) >= 0 ? "+" : "−"}${Math.abs(realized24 || 0).toFixed(2)}</span>
                <span style={{ color: gain ? T.green : T.red }}> · UNREALIZED {gain ? "+" : "−"}${Math.abs(livePnlUsd).toFixed(2)}</span>
              </div>
            </div>
            <MultBadge mult={liveMult} live />
          </div>
        </div>
      ) : bestMult && bestMult > 0 ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 10, padding: "8px 12px", marginBottom: 12, background: "rgba(255,255,255,0.02)", border: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>YOUR BEST ON {token.sym}</span>
          <MultBadge mult={bestMult} record />
        </div>
      ) : null}

      <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.dim, marginBottom: 12 }}>
        ORDER TICKET · <b style={{ color: accent(token.hue) }}>{token.sym}</b>
      </div>

      <label style={lbl}>Settlement</label>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        {[["SOL", "SOL · 0.6% fee"], ["VALO", "$VALO · 0.3% fee"]].map(([k, l]) => (
          <button key={k} onClick={() => setPay(k)} style={{ ...chip(pay === k), flex: 1, textAlign: "center", padding: "7px" }}>{l}</button>
        ))}
      </div>

      <label style={lbl}>Amount ({pay === "SOL" ? "SOL" : "$VALO"})</label>
      <input value={amount} onChange={(e) => { setAmount(e.target.value); setPctSel && setPctSel(null); }} style={{ ...inp, width: "100%", marginBottom: 6 }} />
      {(() => {
        const balP = pay === "SOL" ? solBalance : valoBalance;
        const unitP = pay === "SOL" ? SOL_USD : 0.0125;
        return (
          <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 900, color: T.blue,
            background: "rgba(76,154,255,0.10)", border: `1px solid ${T.blue}55`, borderRadius: 8,
            padding: "5px 10px", marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "baseline",
            boxShadow: "0 0 12px rgba(76,154,255,0.18)" }}>
            <span>💼 {pay === "SOL" ? balP.toFixed(2) : fmtQty(balP)} {pay === "SOL" ? "SOL" : "$VALO"}</span>
            <span style={{ fontSize: 9, opacity: 0.85 }}>≈ ${(balP * unitP).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</span>
          </div>
        );
      })()}

      {(() => {
        const bidSol = pay === "SOL" ? amt : (amt * token.price) / SOL_USD;
        const sellCol = !position ? T.red : pnlPct > 0.05 ? T.green : pnlPct < -0.05 ? T.red : "#4a5266";
        const sellAllSol = pay === "SOL" ? held : (held * token.price) / SOL_USD;
        return (<>
          {/* BUY block — % of your wallet balance */}
          <div style={{ background: "rgba(22,199,132,0.05)", border: "1px solid rgba(22,199,132,0.25)", borderRadius: 10, padding: 10, marginBottom: 8 }}>
            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.green, letterSpacing: 1, marginBottom: 6 }}>BUY · % of your {pay === "SOL" ? `${solBalance.toFixed(2)} SOL` : `${Math.floor(valoBalance).toLocaleString()} $VALO`}</div>
            <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
              {dtBuyPcts.map((p, ci) => {
                const on = pctSel && pctSel.side === "buy" && pctSel.p === p;
                return (
                  <button key={ci} onClick={() => { setPct(p, false); setPctSel && setPctSel({ side: "buy", p }); }}
                    {...chipEditProps(() => askPct(p, (nv) => setDtBuyPcts((A) => A.map((x, j) => (j === ci ? nv : x)))))}
                    title="Double-click or right-click to set your own %"
                    style={{ ...chip(false), flex: 1, textAlign: "center", padding: "5px 0", fontSize: 9.5,
                      fontWeight: on ? 900 : 400,
                      color: on ? "#07130d" : p === 100 ? T.amber : T.dim,
                      background: on ? T.green : "transparent",
                      borderColor: on ? T.green : p === 100 ? "rgba(240,185,11,0.4)" : T.border,
                      boxShadow: on ? "0 0 10px rgba(22,199,132,0.4)" : "none",
                      transition: "background .15s, color .15s, box-shadow .15s" }}>{p === 100 ? "MAX" : p + "%"}</button>
                );
              })}
            </div>
            {/* fixed amounts — same chips as the mobile hotbar & traders, editable too */}
            <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
              {dtFixed.map((v, ci) => (
                <button key={ci} onClick={() => { setAmount(String(v)); setPctSel && setPctSel(null); }}
                  {...chipEditProps(() => askAmt(v, (nv) => setDtFixed((A) => A.map((x, j) => (j === ci ? nv : x)))))}
                  title="Double-click or right-click to set your own amount"
                  style={{ ...chip(parseFloat(amount) === v), flex: 1, textAlign: "center", padding: "4px 0", fontSize: 9, fontWeight: 800, color: T.green }}>{v}</button>
              ))}
            </div>
            <button onClick={() => onExecute({ side: "buy", pay, amt, mode: "instant", tax: taxFor(pay), burn: fee.total, legs: [] })}
              style={{ width: "100%", border: "none", borderRadius: 9, padding: "10px 6px", fontFamily: T.mono, fontWeight: 900, cursor: "pointer", background: T.green, color: "#07130d", boxShadow: "0 0 16px rgba(22,199,132,0.25)", lineHeight: 1.25 }}>
              <div style={{ fontSize: 12.5 }}>⚡ BUY</div>
              <div style={{ fontSize: 8.5, opacity: 0.85 }}>{bidSol.toFixed(2)} SOL · ${(bidSol * SOL_USD).toFixed(0)}</div>
            </button>
          </div>

          {/* SELL block — % of your current holdings */}
          <div style={{ background: "rgba(234,57,67,0.05)", border: "1px solid rgba(234,57,67,0.25)", borderRadius: 10, padding: 10, marginBottom: 12 }}>
            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.red, letterSpacing: 1, marginBottom: 6 }}>SELL · % of your {held > 0 ? `${heldSol.toFixed(3)} SOL held` : "position"}</div>
            <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
              {dtSellPcts.map((p, ci) => {
                const on = pctSel && pctSel.side === "sell" && pctSel.p === p;
                return (
                  <button key={ci} onClick={() => { setPct(p, true); setPctSel && setPctSel({ side: "sell", p }); }} disabled={held <= 0}
                    {...chipEditProps(() => askPct(p, (nv) => setDtSellPcts((A) => A.map((x, j) => (j === ci ? nv : x)))))}
                    title="Double-click or right-click to set your own %"
                    style={{ ...chip(false), flex: 1, textAlign: "center", padding: "5px 0", fontSize: 9.5,
                      fontWeight: on ? 900 : 400,
                      color: on ? "#170808" : held <= 0 ? T.faint : p === 100 ? T.amber : T.dim,
                      background: on ? T.red : "transparent",
                      borderColor: on ? T.red : p === 100 ? "rgba(240,185,11,0.4)" : T.border,
                      boxShadow: on ? "0 0 10px rgba(234,57,67,0.4)" : "none",
                      opacity: held <= 0 ? 0.5 : 1,
                      transition: "background .15s, color .15s, box-shadow .15s" }}>{p === 100 ? "ALL" : p + "%"}</button>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={() => onExecute({ side: "sell", pay, amt, mode: "instant", tax: taxFor(pay), burn: fee.total, legs: [] })}
                style={{ flex: 1.4, border: "none", borderRadius: 9, padding: "10px 6px", fontFamily: T.mono, fontWeight: 900, cursor: "pointer", background: sellCol, color: "#170808", lineHeight: 1.25, transition: "background .3s" }}>
                <div style={{ fontSize: 12.5 }}>⚡ SELL {position ? (pnlPct >= 0 ? "▲" : "▼") : ""}</div>
                <div style={{ fontSize: 8.5, opacity: 0.85 }}>{bidSol.toFixed(2)} SOL · ${(bidSol * SOL_USD).toFixed(0)}</div>
              </button>
              <button onClick={() => { if (held > 0) onExecute({ side: "sell", pay, amt: held, mode: "instant", tax: taxFor(pay), burn: splitFee(held, pay).total, legs: [] }); }}
                disabled={held <= 0}
                style={{ flex: 1, border: `1px solid ${sellCol}`, borderRadius: 9, padding: "10px 4px", fontFamily: T.mono, fontSize: 10, fontWeight: 800, background: `${sellCol}22`, color: sellCol, cursor: held > 0 ? "pointer" : "not-allowed", opacity: held > 0 ? 1 : 0.5, lineHeight: 1.2 }}>
                <div>SELL ALL</div>
                <div style={{ fontSize: 8, opacity: 0.9 }}>{held > 0 ? `${sellAllSol.toFixed(2)} SOL` : "—"}</div>
              </button>
            </div>
          </div>
        </>);
      })()}

      {/* held positions dropdown */}
      <HeldPositions positions={positions} tokens={tokens} pay={pay} onTrade={onPosTrade} solBalance={solBalance} valoWallet={valoBalance}
        onOpenToken={onOpenToken}
        onSellAll={(t) => { const p = positions[t.id]; if (p && p.amt > 0) onExecute({ side: "sell", pay: p.pay, amt: p.amt, mode: "instant", tax: taxFor(p.pay), burn: splitFee(p.amt, p.pay).total, legs: [] }, t); }}
        onCloseAll={onCloseAll} />

      <label style={lbl}>Click-to-trade on chart</label>
      <div style={{ display: "flex", gap: 6, marginBottom: clickMode ? 6 : 12 }}>
        <button onClick={() => setClickMode(clickMode === "buy" ? null : "buy")}
          style={{ ...chip(clickMode === "buy"), flex: 1, textAlign: "center", color: clickMode === "buy" ? T.green : T.dim, borderColor: clickMode === "buy" ? T.green : T.border }}>▲ ARM BUY</button>
        <button onClick={() => setClickMode(clickMode === "sell" ? null : "sell")}
          style={{ ...chip(clickMode === "sell"), flex: 1, textAlign: "center", color: clickMode === "sell" ? T.red : T.dim, borderColor: clickMode === "sell" ? T.red : T.border }}>▼ ARM SELL</button>
      </div>
      {clickMode && <div style={{ fontFamily: T.mono, fontSize: 9.5, color: clickMode === "buy" ? T.green : T.red, marginBottom: 12 }}>
        Armed — click the chart to fill instantly & stamp the spot.
      </div>}

      <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 12 }}>

      </div>
    </div>
  );
}

// multiplier badge — animated when live, static record otherwise
// Multiplier display rule:
//  • at or above break-even → climbs in 0.1 steps: 1.0× 1.1× 2.4× 19×
//  • below break-even → shows the shortfall as a negative fraction: −0.003×
// ---- MC callout tiers — the ring climbs through these as your call multiplies.
// Fill shows progress toward the NEXT tier; colors walk the full hue wheel then
// into metals, gems, the bull run, and finally the spinning diamond at 100x+.
const CALLOUT_TIERS = [
  { min: 1,   label: "JEET",            color: "#ea3943", fx: 0 },  // red candles
  { min: 1.5, label: "PLEB",            color: "#f0672f", fx: 0 },  // embers — it's heating up
  { min: 2,   label: "TRENCHES",        color: "#f0d90b", fx: 0 },  // grinding it out
  { min: 3,   label: "DEGEN",           color: "#b0e02a", fx: 0 },  // yellowish green
  { min: 4,   label: "NORMIE",          color: "#16c784", fx: 0 },  // full green
  { min: 5,   label: "SNIPER",          color: "#8fd9c2", fx: 1 },  // green fading to silver
  { min: 7,   label: "CHAD",            color: "#c9cfdb", fx: 1 },
  { min: 10,  label: "CABAL",           color: "#ddca8e", fx: 1 },  // silver turning gold
  { min: 13,  label: "GOLD",            color: "#f0b90b", fx: 2 },
  { min: 16,  label: "GOLD·PLATINUM",   color: "#e6dfc2", fx: 2 },
  { min: 20,  label: "PLATINUM",        color: "#dfe6ef", fx: 3 },
  { min: 25,  label: "PLAT·DIAMOND",    color: "#b9e9f7", fx: 3 },
  { min: 30,  label: "DIAMOND",         color: "#7de3ff", fx: 3 },
  { min: 40,  label: "ONYXISH",         color: "#8a80a8", fx: 3 },  // diamond fading to onyx
  { min: 50,  label: "ONYX",            color: "#5d5478", fx: 3 },
  { min: 55,  label: "BULLISH",         color: "#c98a3d", fx: 4 },  // onyx → bull transition
  { min: 60,  label: "BULL",            color: "#d98c3c", fx: 4, bull: true, horn: null, rage: 0 },        // natural ivory horns
  { min: 70,  label: "SILVER BULL",     color: "#c9cfdb", fx: 4, bull: true, horn: "#c9cfdb", rage: 1 },  // silver horns · eyes go red
  { min: 80,  label: "GOLD BULL",       color: "#f0b90b", fx: 4, bull: true, horn: "#f0b90b", rage: 2 },  // gold horns · + angry brow, hot nostrils
  { min: 90,  label: "DIAMOND BULL",    color: "#7de3ff", fx: 4, bull: true, horn: "#7de3ff", rage: 3 },  // diamond horns · + smoke from the nose
  { min: 95,  label: "ONYX BULL",       color: "#8a80a8", fx: 4, bull: true, horn: "#3a3348", hornGlow: "#8a80a8", rage: 4 }, // onyx horns · full rage
  { min: 100, label: "DIAMOND APEX",    color: "#9ceaff", fx: 5, apex: true }, // rotating shiny diamond
];
function calloutTier(mult) {
  let i = 0;
  for (let k = 0; k < CALLOUT_TIERS.length; k++) if (mult >= CALLOUT_TIERS[k].min) i = k;
  return { tier: CALLOUT_TIERS[i], next: CALLOUT_TIERS[i + 1] || null };
}
// Realistic-style black bull head, drawn as layered vector art: gradient black
// hide, broad grey muzzle with flared nostrils. The HORNS take the tier metal:
// natural ivory on the plain bull, then silver → gold → diamond → onyx with a
// matching glow as the tiers climb.
// rage escalation: 1 red eyes · 2 +angry brow & hot nostrils · 3 +smoke puffs
// from the nose · 4 full rage (blazing eyes, heavy smoke, red aura).
function BullHead({ size = 20, horn, glow, rage = 0 }) {
  const g = glow || horn;
  const hornFill = horn || "url(#bhHorn)";
  const hornStyle = horn ? { filter: `drop-shadow(0 0 2.5px ${g})` } : undefined;
  const smoke = (cx0, dir, begin, dur = "1.5s") => (
    <circle cx={cx0} cy="34.4" r="0.5" fill="#9aa0ad" opacity="0">
      <animate attributeName="cy" values="34.4;39.2" dur={dur} begin={begin} repeatCount="indefinite" />
      <animate attributeName="cx" values={`${cx0};${cx0 + dir * 2.2}`} dur={dur} begin={begin} repeatCount="indefinite" />
      <animate attributeName="r" values="0.5;1.8" dur={dur} begin={begin} repeatCount="indefinite" />
      <animate attributeName="opacity" values="0.6;0" dur={dur} begin={begin} repeatCount="indefinite" />
    </circle>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 48 48"
      style={{ display: "block", overflow: "visible", filter: rage >= 4 ? "drop-shadow(0 0 4px rgba(234,57,67,0.55))" : undefined }}>
      <defs>
        <linearGradient id="bhHide" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#35313c" /><stop offset="0.55" stopColor="#211f26" /><stop offset="1" stopColor="#141317" />
        </linearGradient>
        <linearGradient id="bhMuzzle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4550" /><stop offset="1" stopColor="#2a272f" />
        </linearGradient>
        <linearGradient id="bhHorn" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#c6b998" /><stop offset="0.65" stopColor="#efe7d4" /><stop offset="1" stopColor="#8d8168" />
        </linearGradient>
      </defs>
      {/* horns — sweep out from the poll, curving up; tier metal from 70×+ */}
      <path d="M10.5 13 C4.5 12, 1.5 7.5, 3 2.5 C6 6.5, 9.5 8.5, 13.5 9.5 C12 10.6, 11 11.7, 10.5 13 Z" fill={hornFill} style={hornStyle} />
      <path d="M37.5 13 C43.5 12, 46.5 7.5, 45 2.5 C42 6.5, 38.5 8.5, 34.5 9.5 C36 10.6, 37 11.7, 37.5 13 Z" fill={hornFill} style={hornStyle} />
      {/* horn sheen when metallic */}
      {horn && (
        <>
          <path d="M4.6 4.6 C6.4 7, 8.8 8.4, 11.4 9.3" stroke="#ffffff" strokeWidth="0.55" opacity="0.45" fill="none" strokeLinecap="round" />
          <path d="M43.4 4.6 C41.6 7, 39.2 8.4, 36.6 9.3" stroke="#ffffff" strokeWidth="0.55" opacity="0.45" fill="none" strokeLinecap="round" />
        </>
      )}
      {/* ears, tucked under the horns */}
      <path d="M8 16 C4.8 15.2, 3 16.4, 2.6 18.4 C5 19.6, 7.6 19.4, 9.8 18 Z" fill="#1c1a20" />
      <path d="M40 16 C43.2 15.2, 45 16.4, 45.4 18.4 C43 19.6, 40.4 19.4, 38.2 18 Z" fill="#1c1a20" />
      {/* head — broad poll, heavy jowls tapering into the muzzle */}
      <path d="M24 8.5 C31 8.5, 36.5 12, 37.5 17.5 C38.3 22, 36.6 26.5, 33.8 30.2 C31.5 33.2, 28.5 35, 24 35 C19.5 35, 16.5 33.2, 14.2 30.2 C11.4 26.5, 9.7 22, 10.5 17.5 C11.5 12, 17 8.5, 24 8.5 Z" fill="url(#bhHide)" />
      {/* poll curls */}
      <path d="M18 10.2 C20 12.4, 28 12.4, 30 10.2 C28.4 8.9, 19.6 8.9, 18 10.2 Z" fill="#0f0e12" />
      {/* brow shading over the eyes */}
      <path d="M14 18 C17 16.4, 21 16.2, 23 17.4 C21 18.6, 16.6 19, 14 18 Z" fill="#0f0e12" opacity="0.6" />
      <path d="M34 18 C31 16.4, 27 16.2, 25 17.4 C27 18.6, 31.4 19, 34 18 Z" fill="#0f0e12" opacity="0.6" />
      {/* rage 2+: angry brows slanting down toward center */}
      {rage >= 2 && (
        <>
          <path d="M13.6 17.2 C16.8 17.6, 20.2 18.8, 22.6 20.4" stroke="#08070a" strokeWidth="1.7" fill="none" strokeLinecap="round" />
          <path d="M34.4 17.2 C31.2 17.6, 27.8 18.8, 25.4 20.4" stroke="#08070a" strokeWidth="1.7" fill="none" strokeLinecap="round" />
        </>
      )}
      {/* eyes — dark; amber catchlight normally, red and blazing with rage */}
      <ellipse cx="16.8" cy="20.6" rx="1.7" ry="1.25" fill="#0a090c" />
      <ellipse cx="31.2" cy="20.6" rx="1.7" ry="1.25" fill="#0a090c" />
      {rage >= 1 ? (
        <>
          <circle cx="16.8" cy="20.6" r={rage >= 4 ? 1.05 : 0.8} fill={rage >= 4 ? "#ff2d3a" : "#ea3943"}
            style={{ filter: `drop-shadow(0 0 ${rage >= 4 ? 3 : 2}px #ff4b55)` }} />
          <circle cx="31.2" cy="20.6" r={rage >= 4 ? 1.05 : 0.8} fill={rage >= 4 ? "#ff2d3a" : "#ea3943"}
            style={{ filter: `drop-shadow(0 0 ${rage >= 4 ? 3 : 2}px #ff4b55)` }} />
        </>
      ) : (
        <>
          <circle cx="17.3" cy="20.1" r="0.45" fill="#cf9b4a" opacity="0.9" />
          <circle cx="31.7" cy="20.1" r="0.45" fill="#cf9b4a" opacity="0.9" />
        </>
      )}
      {/* muzzle — broad and grey with a wet sheen */}
      <path d="M24 24.5 C29 24.5, 32.5 26.8, 32.8 31 C33.1 35.6, 29.6 38.8, 24 38.8 C18.4 38.8, 14.9 35.6, 15.2 31 C15.5 26.8, 19 24.5, 24 24.5 Z" fill="url(#bhMuzzle)" />
      <path d="M18.5 27 C21.5 25.8, 26.5 25.8, 29.5 27 C27 28.2, 21 28.2, 18.5 27 Z" fill="#5c5764" opacity="0.5" />
      {/* flared comma nostrils */}
      <path d="M18.6 31.2 C18 32.6, 18.6 34, 20 34.3 C20.9 33.2, 20.8 31.7, 19.9 30.7 Z" fill="#0c0b0e" />
      <path d="M29.4 31.2 C30 32.6, 29.4 34, 28 34.3 C27.1 33.2, 27.2 31.7, 28.1 30.7 Z" fill="#0c0b0e" />
      {/* rage 2+: nostrils running hot */}
      {rage >= 2 && (
        <>
          <circle cx="19.3" cy="32.5" r="1.3" fill="#ea3943" opacity={rage >= 4 ? 0.3 : 0.18} />
          <circle cx="28.7" cy="32.5" r="1.3" fill="#ea3943" opacity={rage >= 4 ? 0.3 : 0.18} />
        </>
      )}
      {/* rage 3+: smoke puffing out of the nose */}
      {rage >= 3 && (
        <g>
          {smoke(19.2, -1, "0s")}
          {smoke(28.8, 1, "0.75s")}
          {rage >= 4 && smoke(19.2, -1, "0.4s", "1.1s")}
          {rage >= 4 && smoke(28.8, 1, "1.05s", "1.1s")}
        </g>
      )}
    </svg>
  );
}
// Circular gauge for a live callout. Terminal-styled radar ring that gains
// layers the higher the tier: fx0 plain arc · fx1 +inner hairline ·
// fx2 +orbiting dashed halo · fx3 +cardinal sparkles & pulsing arc ·
// fx4 +counter-orbiting second halo · fx5 +comet orbit (apex). Only moves up.
function CalloutRing({ mult, size = 34 }) {
  const { tier, next } = calloutTier(mult);
  const frac = tier.apex ? 1 : next ? Math.max(0.04, Math.min(1, (mult - tier.min) / (next.min - tier.min))) : 1;
  const s = size, r = s / 2 - 3.5, C = 2 * Math.PI * r;
  const fx = tier.fx || 0;
  const spinO = { transformOrigin: `${s / 2}px ${s / 2}px` };
  const multTxt = mult >= 10 ? `${Math.floor(mult)}×` : `${mult.toFixed(1)}×`;
  return (
    <div title={`${tier.label} · ${mult.toFixed(2)}× since callout${next ? ` · next tier at ${next.min}×` : ""}`}
      style={{ position: "relative", width: s, height: s, flex: "0 0 auto" }}>
      <svg width={s} height={s} style={{ display: "block", transform: "rotate(-90deg)", overflow: "visible" }}>
        {/* ticked track — radar/terminal style */}
        <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={T.border2} strokeWidth="2.5"
          strokeDasharray="1.6 3.1" opacity="0.8" />
        {/* fx1+: inner hairline in the tier metal */}
        {fx >= 1 && <circle cx={s / 2} cy={s / 2} r={r - 3.2} fill="none" stroke={tier.color} strokeWidth="0.75" opacity="0.35" />}
        {/* fx2+: slow-orbiting dashed halo */}
        {fx >= 2 && (
          <g style={{ ...spinO, animation: "coOrbit 7s linear infinite" }}>
            <circle cx={s / 2} cy={s / 2} r={r + 2.6} fill="none" stroke={tier.color} strokeWidth="0.9"
              strokeDasharray="1.2 5.2" opacity="0.55" strokeLinecap="round" />
          </g>
        )}
        {/* fx4+: counter-orbiting outer halo */}
        {fx >= 4 && (
          <g style={{ ...spinO, animation: "coOrbitR 11s linear infinite" }}>
            <circle cx={s / 2} cy={s / 2} r={r + 4.6} fill="none" stroke={tier.color} strokeWidth="0.7"
              strokeDasharray="3.6 7.4" opacity="0.4" strokeLinecap="round" />
          </g>
        )}
        {/* charge arc */}
        <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={tier.color} strokeWidth="2.5"
          strokeLinecap="round" strokeDasharray={`${C * frac} ${C}`} className={fx >= 3 ? "co-pulse" : undefined}
          style={{ filter: `drop-shadow(0 0 4px ${tier.color})`, transition: "stroke-dasharray .5s ease, stroke .5s ease" }} />
        {/* fx3+: twinkling cardinal sparkles */}
        {fx >= 3 && [0, 90, 180, 270].map((a, i) => (
          <circle key={a} cx={s / 2 + (r + 2.6) * Math.cos((a * Math.PI) / 180)} cy={s / 2 + (r + 2.6) * Math.sin((a * Math.PI) / 180)}
            r="1" fill={tier.color} style={{ animation: `coTwinkle 1.8s ease-in-out ${i * 0.45}s infinite`, filter: `drop-shadow(0 0 2px ${tier.color})` }} />
        ))}
        {/* fx5: comet orbit — apex only */}
        {fx >= 5 && (
          <g style={{ ...spinO, animation: "coOrbit 3.2s linear infinite" }}>
            <circle cx={s / 2 + r + 4.6} cy={s / 2} r="1.4" fill="#d9f9ff" style={{ filter: "drop-shadow(0 0 3px #7de3ff)" }} />
          </g>
        )}
      </svg>
      {/* center: multiplier / bull head / apex diamond */}
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
        {tier.apex ? (
          <span style={{ width: s * 0.32, height: s * 0.32, borderRadius: 3,
            background: "linear-gradient(135deg, #d9f9ff, #7de3ff 45%, #c3b6ff)",
            boxShadow: "0 0 10px #7de3ff, 0 0 22px rgba(125,227,255,0.55)",
            animation: "coSpin 2.6s linear infinite" }} />
        ) : tier.bull ? (
          <span style={{ filter: `drop-shadow(0 0 4px ${tier.color}88)`, marginTop: s * 0.06 }}>
            <BullHead size={s * 0.66} horn={tier.horn} glow={tier.hornGlow} rage={tier.rage || 0} />
          </span>
        ) : null}
        <span style={{ fontFamily: T.mono, fontWeight: 900, color: tier.color,
          fontSize: tier.bull || tier.apex ? s * 0.17 : s * 0.26,
          marginTop: tier.bull || tier.apex ? 0.5 : 0,
          textShadow: `0 0 6px ${tier.color}66` }}>{multTxt}</span>
      </div>
    </div>
  );
}

// ---- CALLOUT HUB — opens when you click a live callout multiplier ----------
// Tab 1: the full tier list, rendered with the real rings.
// Tab 2: site-wide callout leaderboards — top 250 per period + lifetime.
const LB_PERIODS = ["1H", "12H", "1D", "7D", "30D", "180D", "365D", "LIFETIME"];
const LB_MAX = { "1H": 12, "12H": 35, "1D": 60, "7D": 110, "30D": 180, "180D": 320, "365D": 520, "LIFETIME": 900 };
const LB_FXNOTE = ["plain arc", "+ inner hairline", "+ orbiting halo", "+ sparkles & pulse", "+ counter halo", "+ comet orbit"];
function seededRand(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function genLeaderboard(period) {
  // API: replace with the real callout-leaderboard endpoint per period
  const rand = seededRand(hashStr("lb-" + period));
  const P1 = ["degen", "moon", "sol", "ape", "rug", "pump", "alpha", "chart", "snipe", "wagmi", "fomo", "gm", "diamond", "paper", "turbo", "giga"];
  const P2 = ["mike", "queen", "lord", "boi", "wizard", "chad", "cat", "dog", "hunter", "pat", "wes", "dip", "god", "smith", "jones", "x"];
  const syms = NAMES.map((n) => n[0]);
  const max = LB_MAX[period] || 900;
  const out = [];
  for (let i = 0; i < 250; i++) {
    const base = 1 + (max - 1) * Math.pow(1 - i / 250, 3.4);
    const mult = Math.max(1.05, base * (0.92 + rand() * 0.16));
    const user = rand() < 0.25
      ? CALLERS[Math.floor(rand() * CALLERS.length)]
      : P1[Math.floor(rand() * P1.length)] + P2[Math.floor(rand() * P2.length)] + (rand() < 0.4 ? String(Math.floor(rand() * 99)) : "");
    const sym = syms[Math.floor(rand() * syms.length)];
    const mcAt = 4000 * Math.pow(10, rand() * 2.7); // $4K .. ~$2M entries
    out.push({ user, sym, hue: symbolHue(sym), mcAt, mult });
  }
  return out.sort((a, b) => b.mult - a.mult);
}
// full tier ladder — JEET at the bottom, DIAMOND APEX at the top
function TierListModal({ onClose, isMobile, myBest = 0, embed = false }) {
  const ladder = [...CALLOUT_TIERS].slice().reverse(); // highest first
  if (embed) return (
    <div style={{ padding: "8px 2px 4px" }}>
      <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, marginBottom: 10 }}>
        Your best peak decides your rank — from JEET all the way to DIAMOND APEX. Every tier upgrades your ring.
      </div>
      {ladder.map((tr) => {
        const mine = myBest >= tr.min && (ladder.find((x) => x.min > tr.min && myBest >= x.min) == null);
        return (
          <div key={tr.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 10, marginBottom: 4,
            border: mine ? `1.5px solid ${tr.color}` : `1px solid ${tr.color}33`, background: mine ? `${tr.color}14` : `${tr.color}07`,
            boxShadow: mine ? `0 0 12px ${tr.color}44` : "none" }}>
            <CalloutRing mult={Math.max(tr.min, 1.01)} size={27} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 900, color: tr.color }}>{tr.label}{mine ? " · YOU" : ""}</div>
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>peak ×{tr.min}{tr.apex ? "+ — the summit" : "+"}</div>
            </div>
            <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 900, color: tr.color }}>×{tr.min}</span>
          </div>
        );
      })}
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 76, background: "rgba(4,6,10,0.82)", backdropFilter: "blur(5px)", display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "center",
      padding: isMobile ? "max(14px, env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom))" : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: isMobile ? 375 : 540, maxHeight: isMobile ? "calc(100dvh - max(14px, env(safe-area-inset-top)) - 22px)" : "80vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.65)" }}>
        <div style={{ position: "sticky", top: 0, background: T.panel, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 13px", borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 900, letterSpacing: 1.5 }}>🏆 CALLOUT TIER LIST</span>
          <button onClick={onClose} style={{ ...chip(false), padding: "5px 9px", fontSize: 12 }}>✕</button>
        </div>
        <div style={{ padding: "10px 12px 14px" }}>
          <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, marginBottom: 10 }}>
            Your best peak decides your rank — from JEET all the way to DIAMOND APEX. Every tier upgrades your ring.
          </div>
          {ladder.map((tr) => {
            const mine = myBest >= tr.min && (ladder.find((x) => x.min > tr.min && myBest >= x.min) == null);
            return (
              <div key={tr.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 9px", borderRadius: 10, marginBottom: 4,
                border: mine ? `1.5px solid ${tr.color}` : `1px solid ${tr.color}33`, background: mine ? `${tr.color}14` : `${tr.color}07`,
                boxShadow: mine ? `0 0 12px ${tr.color}44` : "none" }}>
                <CalloutRing mult={Math.max(tr.min, 1.01)} size={27} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 900, color: tr.color }}>{tr.label}{mine ? " · YOU" : ""}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>peak ×{tr.min}{tr.apex ? "+ — the summit" : "+"}</div>
                </div>
                <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 900, color: tr.color }}>×{tr.min}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// compact leaderboard — the tier-list's sibling: same frame, top-10 badges per
// duration, your rank, and the epoch bonus each placement pays
function LeaderboardModal({ onClose, isMobile, myCallouts = {}, tokens = [], onOpenUser, embed = false, focusUser = null }) {
  const [period, setPeriod] = useState("1D");
  const [hl, setHl] = useState(!!focusUser); // the jumped-to name glows, then fades
  const focusRef = useRef(null);
  useEffect(() => { if (!focusUser) return; const t = setTimeout(() => setHl(false), 5000); return () => clearTimeout(t); }, [focusUser]);
  const lbBonus = (r) => r < 1 ? 0 : r === 1 ? 0.5 : r === 2 ? 0.42 : r === 3 ? 0.36 : r === 4 ? 0.32 : r === 5 ? 0.29 : r === 6 ? 0.26 : r === 7 ? 0.23 : r === 8 ? 0.20 : r === 9 ? 0.17 : r === 10 ? 0.14 : r <= 100 ? 0.10 : 0;
  const board = useMemo(() => {
    const mine = Object.entries(myCallouts).map(([id, c]) => {
      const tk = tokens.find((t) => String(t.id) === String(id));
      return tk ? { user: "you", you: true, sym: tk.sym, hue: tk.hue, mcAt: c.mcAt, mult: c.peak } : null;
    }).filter(Boolean);
    return [...genLeaderboard(period), ...mine].sort((a, b) => b.mult - a.mult);
  }, [period, myCallouts, tokens]);
  const myRank = board.findIndex((e) => e.you) + 1;
  const focusRank = focusUser ? board.findIndex((e) => !e.you && e.user === focusUser) + 1 : 0;
  const listEnd = focusRank > 25 && focusRank <= 250 ? focusRank + 2 : 25;
  useEffect(() => {
    if (focusRank > 0 && focusRef.current) focusRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusRank, period]);
  const body = (
    <>
        <div style={{ position: "sticky", top: 0, background: T.panel, zIndex: 2, padding: embed ? "6px 2px 8px" : "11px 13px 9px", borderBottom: `1px solid ${T.border}` }}>
          {!embed && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontFamily: T.mono, fontSize: isMobile ? 11 : 13, fontWeight: 900, letterSpacing: 1.5 }}>📊 CALLOUT LEADERBOARD</span>
            <button onClick={onClose} style={{ ...chip(false), padding: "4px 8px", fontSize: 11 }}>✕</button>
          </div>
          )}
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {Object.keys(LB_MAX).map((p) => (
              <button key={p} onClick={() => setPeriod(p)} style={{ ...chip(period === p), padding: "3px 7px", fontSize: 8, fontWeight: 800 }}>{p}</button>
            ))}
          </div>
        </div>
        <div style={{ padding: embed ? "9px 2px 4px" : "9px 11px 12px" }}>
          {myRank > 0 && (
            <div style={{ fontFamily: T.mono, fontSize: 8.5, fontWeight: 800, color: myRank <= 100 ? T.green : T.faint, border: `1px solid ${myRank <= 100 ? "rgba(22,199,132,0.4)" : T.border}`, background: myRank <= 100 ? "rgba(22,199,132,0.07)" : "transparent", borderRadius: 9, padding: "6px 9px", marginBottom: 8 }}>
              YOU · #{myRank} {period}{lbBonus(myRank) > 0 ? ` → +${lbBonus(myRank).toFixed(2)}× every epoch (stacks across boards)` : " · crack the top 100 for an epoch bonus"}
            </div>
          )}
          {!isMobile && !embed && board.length >= 3 && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 10, margin: "4px 0 14px" }}>
              {[1, 0, 2].map((bi) => {
                const r = board[bi]; const rk = bi + 1; const tr = calloutTier(r.mult);
                const hgt = rk === 1 ? 148 : rk === 2 ? 120 : 104;
                const medal = rk === 1 ? "🥇" : rk === 2 ? "🥈" : "🥉";
                return (
                  <div key={bi} className="lb-pod" onClick={() => !r.you && onOpenUser && onOpenUser(r.user)}
                    style={{ flex: 1, height: hgt, border: `1.5px solid ${tr.color}`, background: `linear-gradient(180deg, ${tr.color}22, ${tr.color}08)`,
                      borderRadius: 12, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, padding: "10px 8px",
                      cursor: "pointer", boxShadow: rk === 1 ? `0 0 22px ${tr.color}55` : `0 0 10px ${tr.color}22` }}>
                    <span style={{ fontSize: rk === 1 ? 20 : 15 }}>{medal}</span>
                    <CalloutRing mult={r.mult} size={rk === 1 ? 44 : 34} />
                    <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 900, color: r.you ? T.green : T.text, maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{r.user}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 900, color: tr.color }}>×{r.mult.toFixed(1)}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 8, fontWeight: 800, color: VALO_PURPLE }}>+{(rk === 1 ? 0.5 : rk === 2 ? 0.42 : 0.36).toFixed(2)}×/epoch</span>
                  </div>
                );
              })}
            </div>
          )}
          {board.slice(0, listEnd).map((r, i) => {
            const rk = i + 1;
            const tr = calloutTier(r.mult);
            const isFocus = focusRank === rk && !r.you;
            return (
              <div key={i} ref={isFocus ? focusRef : undefined} className="lb-row" onClick={() => !r.you && onOpenUser && onOpenUser(r.user)}
                title={r.you ? "That's you" : `Open @${r.user}'s portfolio`}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", borderRadius: 9, marginBottom: 3, cursor: r.you ? "default" : "pointer",
                border: r.you ? `1.5px solid ${T.green}` : isFocus && hl ? `1.5px solid ${VALO_PURPLE}` : `1px solid ${rk <= 3 ? `${tr.color}55` : T.border}`,
                background: r.you ? "rgba(22,199,132,0.08)" : isFocus && hl ? "rgba(125,92,240,0.16)" : rk <= 3 ? `${tr.color}0a` : "rgba(255,255,255,0.015)",
                boxShadow: isFocus && hl ? `0 0 18px ${VALO_PURPLE}66` : "none",
                transition: "background 1.2s ease, border-color 1.2s ease, box-shadow 1.2s ease" }}>
                <span style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 900, color: rk <= 3 ? tr.color : T.faint, width: 26 }}>#{rk}</span>
                {rk <= 10 && <CalloutRing mult={r.mult} size={rk <= 3 ? 26 : 21} />}
                <span style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 800, color: r.you ? T.green : isFocus && hl ? VALO_PURPLE : T.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{r.user}</span>
                <span style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>${r.sym}</span>
                <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 900, color: tr.color }}>×{r.mult.toFixed(1)}</span>
                {lbBonus(rk) > 0 && <span style={{ fontFamily: T.mono, fontSize: 7.5, fontWeight: 800, color: VALO_PURPLE }}>+{lbBonus(rk).toFixed(2)}×</span>}
              </div>
            );
          })}
          <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, marginTop: 7, lineHeight: 1.6 }}>
            Top 100 of ANY duration earns an epoch bonus: #1 +0.50× · #2 +0.42× · #3 +0.36× … #10 +0.14× · #11–100 +0.10×. Bonuses stack across every board — up to +4.0× total.
          </div>
        </div>
    </>
  );
  if (embed) return body;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 76, background: "rgba(4,6,10,0.82)", backdropFilter: "blur(5px)", display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "center",
      padding: isMobile ? "max(14px, env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom))" : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: isMobile ? 375 : 620, maxHeight: isMobile ? "calc(100dvh - max(14px, env(safe-area-inset-top)) - 22px)" : "82vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.65)" }}>
        {body}
      </div>
    </div>
  );
}

// 🔥 burn stats — everything the burn buttons track, moving live with trades
function BurnModal({ onClose, isMobile, myBurned = 0, siteBurned = 0 }) {
  const TOTAL = 1e9; // genesis supply
  const circ = Math.max(0, TOTAL - siteBurned);
  const pct = (siteBurned / TOTAL) * 100;
  const row = (label, val, sub, col) => (
    <div style={{ border: `1px solid ${col}44`, background: `${col}0d`, borderRadius: 11, padding: "11px 13px", marginBottom: 8 }}>
      <div style={{ fontFamily: T.mono, fontSize: 8, letterSpacing: 1.5, color: T.faint, marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 900, color: col }}>{val}</div>
      {sub && <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, marginTop: 3 }}>{sub}</div>}
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 76, background: "rgba(4,6,10,0.82)", backdropFilter: "blur(5px)", display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "center",
      padding: isMobile ? "max(14px, env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom))" : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 390, maxHeight: isMobile ? "calc(100dvh - max(14px, env(safe-area-inset-top)) - 22px)" : "80vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.65)" }}>
        <div style={{ position: "sticky", top: 0, background: T.panel, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 13px", borderBottom: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 900, letterSpacing: 1.5 }}>🔥 BURN TRACKER · LIVE</span>
          <button onClick={onClose} style={{ ...chip(false), padding: "4px 8px", fontSize: 11 }}>✕</button>
        </div>
        <div style={{ padding: "11px 12px 13px" }}>
          {row("YOUR TOTAL BURNED", `${myBurned.toFixed(4)} $VALO`, "the burn slice of every fee you've ever paid", "#f97316")}
          {row("SITE TOTAL BURN", `${fmtQty(siteBurned)} $VALO`, "every trader's burn pool + hourly buyback burns, on-chain forever", T.red)}
          {row("CIRCULATING SUPPLY", `${fmtQty(circ)} $VALO`, `of ${fmtQty(TOTAL)} genesis — shrinking with every trade`, T.green)}
          <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint, margin: "4px 0 5px", display: "flex", justifyContent: "space-between" }}>
            <span>SUPPLY BURNED</span><span style={{ color: "#f97316", fontWeight: 800 }}>{pct.toFixed(5)}%</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: "#1a1f2a", overflow: "hidden" }}>
            <div style={{ width: `${Math.max(0.4, Math.min(100, pct))}%`, height: "100%", background: "linear-gradient(90deg,#f97316,#ea3943)", transition: "width .4s ease" }} />
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
            Numbers move in real time — every buy, sell, and bot fill on the site feeds the burn, and the hourly creator-fee buyback torches its slice on top. Burns are permanent: supply only goes down.
          </div>
        </div>
      </div>
    </div>
  );
}

// badge page — tiers & leaderboards side by side; jumped-to names glow & fade
function RanksModal({ onClose, isMobile, myCallouts = {}, tokens = [], myBest = 0, focusUser = null, onOpenUser }) {
  const inTop250 = useMemo(() => {
    if (!focusUser) return false;
    const rk = genLeaderboard("1D").sort((a, b) => b.mult - a.mult).findIndex((e) => e.user === focusUser) + 1;
    return rk > 0 && rk <= 250;
  }, [focusUser]);
  const [tab, setTab] = useState(inTop250 ? "board" : "tiers");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 82, background: "rgba(4,6,10,0.82)", backdropFilter: "blur(5px)", display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "center",
      padding: isMobile ? "max(14px, env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom))" : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: isMobile ? 375 : 560, maxHeight: isMobile ? "calc(100dvh - max(14px, env(safe-area-inset-top)) - 22px)" : "82vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,0.65)" }}>
        <div style={{ position: "sticky", top: 0, background: T.panel, zIndex: 3, padding: "11px 13px 0", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9 }}>
            <span style={{ fontFamily: T.mono, fontSize: isMobile ? 11 : 12.5, fontWeight: 900, letterSpacing: 1.5 }}>🎖 CALLOUT RANKS</span>
            <button onClick={onClose} style={{ ...chip(false), padding: "4px 8px", fontSize: 11 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 6, paddingBottom: 9 }}>
            <button onClick={() => setTab("tiers")} style={{ ...chip(tab === "tiers"), flex: 1, textAlign: "center", padding: "8px", fontSize: 10, fontWeight: 900 }}>🏆 TIERS</button>
            <button onClick={() => setTab("board")} style={{ ...chip(tab === "board"), flex: 1, textAlign: "center", padding: "8px", fontSize: 10, fontWeight: 900, color: tab === "board" ? VALO_PURPLE : T.dim, borderColor: tab === "board" ? `${VALO_PURPLE}66` : T.border }}>📊 LEADERBOARD</button>
          </div>
        </div>
        <div style={{ padding: "4px 11px 12px" }}>
          {tab === "tiers"
            ? <TierListModal embed isMobile={isMobile} myBest={myBest} />
            : <LeaderboardModal embed isMobile={isMobile} myCallouts={myCallouts} tokens={tokens} onOpenUser={onOpenUser} focusUser={inTop250 ? focusUser : null} />}
        </div>
      </div>
    </div>
  );
}

function CalloutHubModal({ onClose, isMobile, myCallouts = {}, tokens = [] }) {
  const [tab, setTab] = useState("tiers");   // tiers | board
  const [period, setPeriod] = useState("1D");
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  const board = useMemo(() => {
    const gen = genLeaderboard(period);
    const mine = Object.entries(myCallouts).map(([id, c]) => {
      const tk = tokens.find((t) => String(t.id) === String(id));
      return tk ? { user: "you", you: true, sym: tk.sym, hue: tk.hue, mcAt: c.mcAt, mult: c.peak } : null;
    }).filter(Boolean);
    return [...gen, ...mine].sort((a, b) => b.mult - a.mult).slice(0, 250);
  }, [period, myCallouts, tokens]);
  const rankCol = (i) => (i === 0 ? "#f0b90b" : i === 1 ? "#c9cfdb" : i === 2 ? "#cd7f32" : T.faint);
  const tabBtn = (k, l) => (
    <button onClick={() => setTab(k)} style={{ ...chip(tab === k), flex: 1, textAlign: "center", padding: "9px", fontSize: 11, fontWeight: 800 }}>{l}</button>
  );
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 61, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 780, maxHeight: "88vh", display: "flex", flexDirection: "column", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, overflow: "hidden" }}>
        {/* header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 2 }}>📣 CALLOUTS</div>
            <div style={{ fontWeight: 800, fontSize: 15 }}>{tab === "tiers" ? "Tier list" : "Leaderboards"}</div>
          </div>
          <button onClick={onClose} style={{ ...chip(false), padding: "6px 11px", fontSize: 12 }}>✕ Close</button>
        </div>
        {/* tabs */}
        <div style={{ display: "flex", gap: 8, padding: "10px 14px 0" }}>
          {tabBtn("tiers", "🎖 TIER LIST")}
          {tabBtn("board", "🏆 LEADERBOARDS")}
        </div>
        {/* body */}
        <div style={{ overflowY: "auto", padding: 14 }}>
          {tab === "tiers" ? (
            <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 138 : 158}px, 1fr))`, gap: 10 }}>
              {CALLOUT_TIERS.map((t, i) => {
                const next = CALLOUT_TIERS[i + 1];
                const sample = t.apex ? 128 : t.min + (next.min - t.min) * 0.6;
                return (
                  <div key={t.label} style={{ background: T.panel2, border: `1px solid ${T.border}`, borderRadius: 11, padding: "14px 8px 10px", textAlign: "center" }}>
                    <div style={{ display: "flex", justifyContent: "center" }}><CalloutRing mult={sample} size={62} /></div>
                    <div style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, letterSpacing: 1, color: t.color, marginTop: 8 }}>{t.label}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, marginTop: 2 }}>
                      {next ? `${t.min}× — ${next.min}×` : `${t.min}× AND BEYOND`}
                    </div>
                    <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, marginTop: 3 }}>
                      FX {t.fx} · {LB_FXNOTE[t.fx]}{t.bull ? ` · RAGE ${t.rage || 0}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              {/* period picker */}
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
                {LB_PERIODS.map((p) => (
                  <button key={p} onClick={() => setPeriod(p)}
                    style={{ ...chip(period === p), padding: "5px 10px", fontSize: 9.5, fontWeight: 800, color: period === p ? (p === "LIFETIME" ? T.amber : T.text) : T.dim }}>{p}</button>
                ))}
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, marginBottom: 8 }}>
                TOP 250 · HIGHEST CALLOUT MULTIPLIERS {period === "LIFETIME" ? "OF ALL TIME" : `IN THE LAST ${period}`}
              </div>
              {board.map((r, i) => {
                const { tier } = calloutTier(r.mult);
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, marginBottom: 2,
                    background: r.you ? "rgba(125,92,240,0.12)" : i < 3 ? `${rankCol(i)}0d` : i % 2 ? "rgba(255,255,255,0.015)" : "transparent",
                    border: r.you ? `1px solid ${VALO_PURPLE}55` : i < 3 ? `1px solid ${rankCol(i)}33` : "1px solid transparent" }}>
                    <span style={{ fontFamily: T.mono, fontSize: i < 3 ? 12 : 9.5, fontWeight: 900, color: rankCol(i), width: 30, flex: "0 0 auto" }}>
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                    </span>
                    {i < 10 && <CalloutRing mult={r.mult} size={i < 3 ? 30 : 24} />}
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: r.you ? 900 : 700, color: r.you ? VALO_PURPLE : T.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.you ? "YOU" : "@" + r.user}
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 800, color: accent(r.hue), flex: "0 0 auto" }}>${r.sym}</span>
                    {!isMobile && (
                      <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, flex: "0 0 auto" }}>
                        OUT @ {fmt$(r.mcAt)} → {fmt$(r.mcAt * r.mult)}
                      </span>
                    )}
                    <span style={{ fontFamily: T.mono, fontSize: 8, fontWeight: 800, color: tier.color, flex: "0 0 auto", opacity: 0.9 }}>{tier.label}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 900, color: tier.color, width: 52, textAlign: "right", flex: "0 0 auto", textShadow: `0 0 6px ${tier.color}55` }}>
                      {r.mult >= 10 ? Math.floor(r.mult) : r.mult.toFixed(1)}×
                    </span>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- MY CALLOUTS — chronological record, opened from the profile badge ----
function timeAgo(ts) {
  if (!ts) return "—";
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function MyCalloutsModal({ onClose, isMobile, myCallouts = {}, tokens = [], username, onOpenToken }) {
  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  const rows = Object.entries(myCallouts).map(([id, c]) => {
    const tk = tokens.find((t) => String(t.id) === String(id));
    if (!tk) return null;
    const live = mcOf(tk) / c.mcAt;                     // updates every tick — can be under 1×
    return { tk, ...c, live };
  }).filter(Boolean).sort((a, b) => (a.ts || 0) - (b.ts || 0)); // very first → latest
  const bestPeak = rows.reduce((m, r) => Math.max(m, r.peak), 0);
  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 61, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 620, maxHeight: "86vh", display: "flex", flexDirection: "column", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {bestPeak > 0 && <CalloutRing mult={bestPeak} size={40} />}
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 2 }}>📣 CALLOUT HISTORY</div>
              <div style={{ fontWeight: 800, fontSize: 15 }}>@{username || "you"} · {rows.length} callout{rows.length === 1 ? "" : "s"}</div>
            </div>
          </div>
          <button onClick={onClose} style={{ ...chip(false), padding: "6px 11px", fontSize: 12 }}>✕ Close</button>
        </div>
        <div style={{ overflowY: "auto", padding: 12 }}>
          {rows.length === 0 && (
            <div style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, textAlign: "center", padding: 30 }}>
              No callouts yet — hit 📣 CALLOUT on any chart to stamp your entry MC.
            </div>
          )}
          {rows.map((r, i) => {
            const { tier } = calloutTier(r.peak);
            const lp = multParts(r.live);
            return (
              <div key={i} onClick={() => onOpenToken && onOpenToken(r.tk.id)} title={`Open the $${r.tk.sym} chart`}
                style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 9px", borderRadius: 9, marginBottom: 3, cursor: "pointer",
                background: i % 2 ? "rgba(255,255,255,0.015)" : "transparent", border: `1px solid ${T.border}` }}>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, width: 22, flex: "0 0 auto" }}>#{i + 1}</span>
                <TokenAvatar sym={r.tk.sym} hue={r.tk.hue} img={r.tk.img} size={20} />
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.35 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: accent(r.tk.hue), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${r.tk.sym}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>called {timeAgo(r.ts)} @ {fmt$(r.mcAt)} MC</div>
                </div>
                <div style={{ textAlign: "right", lineHeight: 1.3, flex: "0 0 auto" }}>
                  {/* LIVE multiplier — negative when the coin sits below your call */}
                  <div style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 900, color: lp.up ? T.green : T.red, textShadow: `0 0 6px ${lp.up ? T.green : T.red}44` }}>{lp.label}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 7.5, color: tier.color, fontWeight: 800 }}>PEAK {r.peak >= 10 ? Math.floor(r.peak) : r.peak.toFixed(1)}× · {tier.label}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- SOCIAL LAYER — follows, friends, profiles, notifications ------------
// All data here is simulated deterministically; wire at // API: markers.
const HANDLE_A = ["degen", "moon", "sol", "ape", "pump", "alpha", "chart", "snipe", "wagmi", "fomo", "turbo", "giga", "silent", "based", "chad"];
const HANDLE_B = ["mike", "queen", "lord", "boi", "wizard", "cat", "dog", "hunter", "pat", "wes", "dip", "smith", "maverick", "jones", "x"];
function randomHandle(rand) {
  return HANDLE_A[Math.floor(rand() * HANDLE_A.length)] + HANDLE_B[Math.floor(rand() * HANDLE_B.length)] + (rand() < 0.5 ? String(Math.floor(rand() * 999)) : "");
}
function FollowListModal({ kind, list, onClose, isMobile, onOpenUser }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 62, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 400, maxHeight: "80vh", display: "flex", flexDirection: "column", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>{kind === "followers" ? "👥 Followers" : "➡️ Following"} · {list.length}</div>
          <button onClick={onClose} style={{ ...chip(false), padding: "5px 10px", fontSize: 12 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 10 }}>
          {list.length === 0 && <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.faint, textAlign: "center", padding: 24 }}>Nobody here yet.</div>}
          {list.map((u, i) => (
            <div key={i} onClick={() => onOpenUser(u)} title="Open profile"
              style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 10px", borderRadius: 9, marginBottom: 2, cursor: "pointer", background: i % 2 ? "rgba(255,255,255,0.015)" : "transparent" }}>
              <span style={{ width: 26, height: 26, borderRadius: "50%", background: `linear-gradient(135deg, ${accent(symbolHue(u))}, ${T.blue})`, display: "grid", placeItems: "center", fontFamily: T.mono, fontWeight: 800, fontSize: 11, color: "#0a0713" }}>{u[0].toUpperCase()}</span>
              <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: T.text }}>@{u}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function UserProfileModal({ name, onClose, isMobile, tokens = [], isFollowing, onToggleFollow, friendStatus, onFriendAction, onOpenToken, onSendFunds, dmLog = [], onSendDm, solBalance = 0, valoWallet = 0 , incomingReq = false, onAcceptReq, onDeclineReq, onOpenTierList, onOpenLeaderboard }) {
  const [badgeTab, setBadgeTab] = useState(false); // insignia tapped → tier/leaderboard tab
  // API: replace with a real user-profile endpoint — all stats below are seeded fakes
  const rand = seededRand(hashStr("user-" + name));
  const peak = +(1 + rand() * (rand() < 0.12 ? 120 : 24)).toFixed(2);
  const fols = Math.floor(20 + rand() * 900), folg = Math.floor(5 + rand() * 300);
  const calls = Array.from({ length: Math.min(4, tokens.length) }, () => {
    const t = tokens[Math.floor(rand() * tokens.length)];
    const mcAt = 4000 * Math.pow(10, rand() * 2.4);
    const pk = +(1 + rand() * Math.max(1, peak - 1)).toFixed(2);
    const live = +(pk * (0.3 + rand() * 0.9)).toFixed(2);
    return { t, mcAt, pk, live, ago: `${Math.floor(1 + rand() * 72)}h ago` };
  }).filter((c) => c.t);
  const { tier } = calloutTier(peak);
  const [dmDraft, setDmDraft] = useState("");
  const [fundAmt, setFundAmt] = useState("");
  const friends = friendStatus === "friends";
  // ---- current holdings + full tx history (seeded; API: on-chain wallet scan) ----
  const [txFrom, setTxFrom] = useState("");
  const [txTo, setTxTo] = useState("");
  const [txShowAll, setTxShowAll] = useState(true);
  const { holds, txAll } = useMemo(() => {
    const r2 = seededRand(hashStr("acts-" + name));
    const seen = new Set();
    const holds = [];
    const nH = Math.min(2 + Math.floor(r2() * 3), tokens.length);
    while (holds.length < nH && seen.size < tokens.length) {
      const t = tokens[Math.floor(r2() * tokens.length)];
      if (seen.has(t.id)) continue; seen.add(t.id);
      holds.push({ t, qty: Math.floor(1200 + r2() * 900000), entry: t.price * (0.4 + r2() * 1.4) });
    }
    const now = Date.now();
    const txAll = Array.from({ length: 26 }, () => {
      const t = tokens[Math.floor(r2() * tokens.length)];
      return t && { t, isBuy: r2() < 0.55, sol: +(0.1 + r2() * 14).toFixed(2), ts: now - Math.floor(r2() * 30 * 86400e3) };
    }).filter(Boolean).sort((a, b) => b.ts - a.ts);
    return { holds, txAll };
  }, [name, tokens]);
  const txShown = txShowAll ? txAll : txAll.filter((x) => {
    const a = txFrom ? new Date(txFrom + "T00:00:00").getTime() : -Infinity;
    const b = txTo ? new Date(txTo + "T23:59:59").getTime() : Infinity;
    return x.ts >= a && x.ts <= b;                            // inclusive range, e.g. 7/3–7/9
  });
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 78, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: isMobile ? "flex-start" : "center", justifyContent: "center",
      padding: isMobile ? "max(14px, env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom))" : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: isMobile ? "calc(100dvh - max(14px, env(safe-area-inset-top)) - 22px)" : "88vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14 }}>
        {/* profile head */}
        <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ width: 40, height: 40, borderRadius: "50%", background: `linear-gradient(135deg, ${accent(symbolHue(name))}, ${T.blue})`, display: "grid", placeItems: "center", fontFamily: T.mono, fontWeight: 900, fontSize: 17, color: "#0a0713" }}>{name[0].toUpperCase()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 800 }}>@{name}</div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>{fols} followers · {folg} following</div>
            </div>
            <div onClick={() => onOpenTierList && onOpenTierList()} title="Tap: tiers & leaderboards — if they're on the board, we jump straight to their name"
              style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <CalloutRing mult={peak} size={38} />
              <span style={{ fontFamily: T.mono, fontSize: 8, fontWeight: 800, color: tier.color }}>{tier.label}</span>
            </div>
            <button onClick={onClose} style={{ ...chip(false), padding: "5px 9px", fontSize: 12 }}>✕</button>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 11 }}>
            <button onClick={onToggleFollow}
              style={{ flex: 1, border: `1px solid ${isFollowing ? T.green : VALO_PURPLE}66`, background: isFollowing ? "rgba(22,199,132,0.1)" : "rgba(125,92,240,0.12)", color: isFollowing ? T.green : VALO_PURPLE, borderRadius: 9, padding: "8px", fontFamily: T.mono, fontSize: 11, fontWeight: 800, cursor: "pointer" }}>
              {isFollowing ? "✓ Following" : "+ Follow"}
            </button>
            {incomingReq && !friends ? (
              <span style={{ flex: 1, display: "flex", gap: 6 }}>
                <button onClick={onAcceptReq} style={{ flex: 1, border: "none", background: T.green, color: "#07130d", borderRadius: 9, padding: "8px", fontFamily: T.mono, fontSize: 11, fontWeight: 900, cursor: "pointer" }}>✓ Accept</button>
                <button onClick={onDeclineReq} style={{ flex: 1, border: `1px solid ${T.red}55`, background: "rgba(234,57,67,0.1)", color: T.red, borderRadius: 9, padding: "8px", fontFamily: T.mono, fontSize: 11, fontWeight: 900, cursor: "pointer" }}>✕ Deny</button>
              </span>
            ) : (
            <button onClick={onFriendAction}
              style={{ flex: 1, border: `1px solid ${friends ? T.amber : T.border2}`, background: friends ? "rgba(240,185,11,0.1)" : "rgba(255,255,255,0.03)", color: friends ? T.amber : friendStatus === "requested" ? T.faint : T.dim, borderRadius: 9, padding: "8px", fontFamily: T.mono, fontSize: 11, fontWeight: 800, cursor: friends ? "default" : "pointer" }}>
              {friends ? "🤝 Friends" : friendStatus === "requested" ? "⏳ Requested · tap to cancel" : "🤝 Add friend"}
            </button>
            )}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, marginTop: 6 }}>
            Followers get this user's callouts as alerts · friends can also DM & send SOL/$VALO
          </div>

        </div>
        {/* friends-only: DM + send funds */}
        {friends && (
          <div style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.amber, letterSpacing: 1.5, marginBottom: 6 }}>🤝 FRIENDS ONLY</div>
            <div style={{ maxHeight: 110, overflowY: "auto", marginBottom: 7 }}>
              {dmLog.length === 0 && <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.faint }}>No messages yet — say gm.</div>}
              {dmLog.map((m, i) => (
                <div key={i} style={{ fontFamily: T.mono, fontSize: 10, color: m.me ? T.text : T.dim, marginBottom: 3, textAlign: m.me ? "right" : "left" }}>
                  <span style={{ background: m.me ? "rgba(125,92,240,0.16)" : "rgba(255,255,255,0.04)", borderRadius: 8, padding: "4px 8px", display: "inline-block", maxWidth: "85%" }}>{m.text}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              <input value={dmDraft} onChange={(e) => setDmDraft(e.target.value)} placeholder={`Message @${name}…`}
                onKeyDown={(e) => { if (e.key === "Enter" && dmDraft.trim()) { onSendDm(dmDraft.trim()); setDmDraft(""); } }}
                style={{ ...inp, flex: 1, padding: "8px 10px", fontSize: 11 }} />
              <button onClick={() => { if (dmDraft.trim()) { onSendDm(dmDraft.trim()); setDmDraft(""); } }} style={{ ...chip(true), padding: "8px 13px", fontSize: 11, fontWeight: 800 }}>Send</button>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <input value={fundAmt} onChange={(e) => setFundAmt(e.target.value)} placeholder="Amount"
                style={{ ...inp, flex: 1, padding: "8px 10px", fontSize: 11 }} />
              <button onClick={() => { const a = parseFloat(fundAmt) || 0; if (a > 0 && a <= solBalance) { onSendFunds(a, "SOL"); setFundAmt(""); } }}
                style={{ ...chip(false), padding: "8px 10px", fontSize: 10, fontWeight: 800, color: T.blue }}>Send SOL</button>
              <button onClick={() => { const a = parseFloat(fundAmt) || 0; if (a > 0 && a <= valoWallet) { onSendFunds(a, "VALO"); setFundAmt(""); } }}
                style={{ ...chip(false), padding: "8px 10px", fontSize: 10, fontWeight: 800, color: VALO_PURPLE }}>Send $VALO</button>
            </div>
          </div>
        )}
        {/* current holdings — mini token cards; each opens that chart */}
        <div style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
<div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1.5, marginBottom: 6 }}>💼 CURRENT HOLDINGS · {holds.length}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            {holds.map((h, i) => {
              const pnl = (h.t.price - h.entry) * h.qty;
              const up = pnl >= 0;
              return (
                <div key={i} onClick={() => onOpenToken(h.t.id)} title={`Open the $${h.t.sym} chart`}
                  style={{ border: `1px solid ${up ? "rgba(22,199,132,0.3)" : "rgba(234,57,67,0.3)"}`, background: up ? "rgba(22,199,132,0.05)" : "rgba(234,57,67,0.05)", borderRadius: 10, padding: "8px 9px", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <TokenAvatar sym={h.t.sym} hue={h.t.hue} img={h.t.img} size={17} />
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: accent(h.t.hue), flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>${h.t.sym}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>${fmtP(h.t.price)}</span>
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>{h.qty >= 1e6 ? (h.qty / 1e6).toFixed(2) + "M" : h.qty >= 1e3 ? (h.qty / 1e3).toFixed(1) + "K" : h.qty} tokens</div>
                  <div style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 900, color: up ? T.green : T.red }}>{up ? "+" : "−"}${Math.abs(pnl).toLocaleString(undefined, { maximumFractionDigits: 0 })} PnL</div>
                </div>
              );
            })}
          </div>
        </div>
        {/* activity — full tx log with an inclusive date-range filter or show-all */}
        <div style={{ padding: "11px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1.5, marginBottom: 6 }}>⚡ ACTIVITY · {txShown.length} TX</div>
          {/* one uniform line: [from] → [to] [SHOW ALL] */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7, flexWrap: "nowrap" }}>
            <input type="date" value={txFrom} onChange={(e) => { setTxFrom(e.target.value); setTxShowAll(false); }}
              style={{ ...inp, flex: 1, minWidth: 0, padding: "5px 6px", fontSize: 9.5, colorScheme: "dark" }} />
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, flex: "0 0 auto" }}>→</span>
            <input type="date" value={txTo} onChange={(e) => { setTxTo(e.target.value); setTxShowAll(false); }}
              style={{ ...inp, flex: 1, minWidth: 0, padding: "5px 6px", fontSize: 9.5, colorScheme: "dark" }} />
            <button onClick={() => setTxShowAll(true)} style={{ ...chip(txShowAll), flex: "0 0 auto", padding: "5px 9px", fontSize: 8.5, fontWeight: 800, whiteSpace: "nowrap" }}>SHOW ALL</button>
          </div>
          <div style={{ maxHeight: 180, overflowY: "auto" }}>
            {txShown.length === 0 && <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.faint, textAlign: "center", padding: 14 }}>No transactions in that range.</div>}
            {txShown.map((x, i) => (
              <div key={i} onClick={() => onOpenToken(x.t.id)} title={`Open the $${x.t.sym} chart`}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 8, marginBottom: 2, cursor: "pointer", background: i % 2 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, fontWeight: 900, color: x.isBuy ? T.green : T.red, width: 30, flex: "0 0 auto" }}>{x.isBuy ? "BUY" : "SELL"}</span>
                <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 800, color: accent(x.t.hue), flex: 1 }}>${x.t.sym}</span>
                <span style={{ fontFamily: T.mono, fontSize: 9, color: T.text }}>{x.sol} SOL <span style={{ color: T.faint }}>· ${(x.sol * SOL_USD).toFixed(0)}</span></span>
                <span style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, flex: "0 0 auto" }}>{new Date(x.ts).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })} {new Date(x.ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>
        {/* recent callouts */}
        <div style={{ padding: "11px 14px" }}>
          <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1.5, marginBottom: 6 }}>📣 RECENT CALLOUTS</div>
          {calls.map((c, i) => {
            const lp = multParts(c.live);
            return (
              <div key={i} onClick={() => onOpenToken(c.t.id)} title={`Open the $${c.t.sym} chart`}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", borderRadius: 9, marginBottom: 3, cursor: "pointer", border: `1px solid ${T.border}`, background: i % 2 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                <TokenAvatar sym={c.t.sym} hue={c.t.hue} img={c.t.img} size={18} />
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.3 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: accent(c.t.hue) }}>${c.t.sym}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint }}>called {c.ago} @ {fmt$(c.mcAt)} MC</div>
                </div>
                <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 900, color: lp.up ? T.green : T.red }}>{lp.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
function NotificationsModal({ onClose, isMobile, notifs = [], friendReqs = [], onOpenToken, onOpenUser, onAccept, onDecline, notifSetting, setNotifSetting }) {
  const [tab, setTab] = useState("all"); // all | callout | follower | friend
  const shown = notifs.filter((n) => tab === "all" || n.type === tab);
  const icon = (t) => (t === "callout" ? "📣" : t === "follower" ? "👥" : "🤝");
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 62, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, maxHeight: "84vh", display: "flex", flexDirection: "column", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>🔔 Notifications</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* website setting — callout pushes on/off (also gates mobile push · API: push service) */}
            <button onClick={() => setNotifSetting(!notifSetting)} title="Callout notifications from people you follow"
              style={{ ...chip(notifSetting), padding: "4px 9px", fontSize: 8.5, fontWeight: 800, color: notifSetting ? T.green : T.faint }}>
              CALLOUT PUSHES {notifSetting ? "ON" : "OFF"}
            </button>
            <button onClick={onClose} style={{ ...chip(false), padding: "5px 10px", fontSize: 12 }}>✕</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 5, padding: "9px 12px 0" }}>
          {[["all", "ALL"], ["callout", "📣 CALLOUTS"], ["follower", "👥 FOLLOWERS"], ["friend", "🤝 FRIENDS"]].map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ ...chip(tab === k), flex: 1, textAlign: "center", padding: "6px 2px", fontSize: 8.5, fontWeight: 800 }}>{l}</button>
          ))}
        </div>
        <div style={{ overflowY: "auto", padding: 11 }}>
          {/* pending friend requests pinned on the friends/all tabs */}
          {(tab === "all" || tab === "friend") && friendReqs.map((u, i) => (
            <div key={"fr" + i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, marginBottom: 3, border: `1px solid ${T.amber}44`, background: "rgba(240,185,11,0.06)" }}>
              <span style={{ fontSize: 13 }}>🤝</span>
              <span onClick={() => onOpenUser(u)} style={{ flex: 1, fontFamily: T.mono, fontSize: 10.5, color: T.text, cursor: "pointer" }}><b>@{u}</b> wants to be friends</span>
              <button onClick={() => onAccept(u)} style={{ ...chip(false), padding: "4px 9px", fontSize: 9.5, fontWeight: 800, color: T.green, borderColor: `${T.green}55` }}>Accept</button>
              <button onClick={() => onDecline(u)} style={{ ...chip(false), padding: "4px 9px", fontSize: 9.5, fontWeight: 800, color: T.red, borderColor: `${T.red}44` }}>✕</button>
            </div>
          ))}
          {shown.length === 0 && friendReqs.length === 0 && (
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, textAlign: "center", padding: 26 }}>All quiet for now.</div>
          )}
          {shown.map((n) => (
            <div key={n.id} onClick={() => { if (n.tokenId) onOpenToken(n.tokenId); else onOpenUser(n.user); }}
              title={n.tokenId ? "Open the chart" : "Open profile"}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, marginBottom: 3, cursor: "pointer", border: `1px solid ${T.border}`, background: "rgba(255,255,255,0.015)" }}>
              <span style={{ fontSize: 13 }}>{icon(n.type)}</span>
              <span style={{ flex: 1, fontFamily: T.mono, fontSize: 10.5, color: T.text, lineHeight: 1.35 }}>{n.text}</span>
              <span style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, flex: "0 0 auto" }}>{timeAgo(n.ts)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
// PC toast — pops down top-right, out of the way of the ticket & chart; the
// whole card opens the chart; auto-fades after 10s (timer lives in App)
function NotifToast({ notif, isMobile, onClick, onClose }) {
  return (
    <div onClick={onClick} className="co-open"
      style={{ position: "fixed", top: isMobile ? 62 : 36, right: 12, zIndex: 70, maxWidth: 290, cursor: "pointer",
        background: T.panel2, border: `1px solid ${VALO_PURPLE}55`, borderRadius: 11, padding: "9px 12px",
        boxShadow: "0 12px 34px rgba(0,0,0,0.65)", transformOrigin: "90% 0%" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontSize: 14 }}>{notif.type === "callout" ? "📣" : notif.type === "follower" ? "👥" : "🤝"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.text, lineHeight: 1.4 }}>{notif.text}</div>
          <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, marginTop: 2 }}>{notif.tokenId ? "tap to open the chart" : "tap to view"}</div>
        </div>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ border: "none", background: "transparent", color: T.faint, cursor: "pointer", fontSize: 11, padding: 0 }}>✕</button>
      </div>
    </div>
  );
}

// ---- AUTO-TRADING BOTS — shared UI ---------------------------------------
// bar under Live P/L: pending bots for a token, closest-to-trigger on top
function PendingBotsBar({ orders = [], token, onOpen }) {
  if (!token) return null;
  const list = orders
    .filter((o) => String(o.tokenId) === String(token.id))
    .map((o) => ({ ...o, dist: Math.abs(token.price - o.level) / token.price }))
    .sort((a, b) => a.dist - b.dist);
  if (!list.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {list.map((o) => (
        <div key={o.id} onClick={(e) => { e.stopPropagation(); onOpen(o.id); }} title="Tap to edit this bot"
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 8, marginBottom: 3, cursor: "pointer",
            border: `1px solid ${o.side === "buy" ? T.green : T.red}44`, background: o.side === "buy" ? "rgba(22,199,132,0.06)" : "rgba(234,57,67,0.06)" }}>
          <span style={{ fontSize: 10 }}>🤖</span>
          <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 800, color: o.side === "buy" ? T.green : T.red }}>{o.side.toUpperCase()} @ ${fmtP(o.level)}</span>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>{o.amt} {o.pay}</span>
          <span style={{ fontFamily: T.mono, fontSize: 8, color: T.faint, marginLeft: "auto" }}>{(o.dist * 100).toFixed(1)}% away</span>
        </div>
      ))}
    </div>
  );
}
// popup: edit one bot, or list all bots (this-token / site-wide)
// small live chart above the edit form — the yellow line follows your meter
function MiniBotChart({ token, level }) {
  if (!token) return null;
  const W = 380, H = 96, N = 90;
  const cs = token.candles.slice(-N);
  let lo = Infinity, hi = -Infinity;
  cs.forEach((c) => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); });
  if (level > 0) { lo = Math.min(lo, level); hi = Math.max(hi, level); }
  const pad = (hi - lo) * 0.08 || hi * 0.01; lo -= pad; hi += pad;
  const yv = (p) => H - ((p - lo) / (hi - lo)) * H;
  const pts = cs.map((c, i) => `${(i / (cs.length - 1)) * W},${yv(c.c).toFixed(1)}`).join(" ");
  const py = yv(token.price), ly = level > 0 ? yv(level) : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: H, background: "#0c0f16", borderRadius: 10, border: `1px solid ${T.border}` }}>
      <polyline points={pts} fill="none" stroke={T.blue} strokeWidth="1.4" opacity="0.9" />
      <line x1="0" x2={W} y1={py} y2={py} stroke={T.green} strokeWidth="1" strokeDasharray="4 4" opacity="0.8" />
      <text x={W - 4} y={py - 3} textAnchor="end" fontSize="8" fill={T.green} fontFamily={T.mono}>LIVE ${fmtP(token.price)}</text>
      {ly != null && (
        <>
          <line x1="0" x2={W} y1={ly} y2={ly} stroke={T.amber} strokeWidth="1.6" strokeDasharray="6 3" />
          <text x="4" y={ly - 3} fontSize="8" fill={T.amber} fontFamily={T.mono} fontWeight="bold">🤖 ENTRY ${fmtP(level)}</text>
        </>
      )}
    </svg>
  );
}
function BotHubModal({ view, setView, orders = [], tokens = [], selectedId, onSave, onCancelBot, onClose, isMobile, onDraftLevel }) {
  const [scope, setScope] = useState("token"); // token | site
  const editing = view && view.mode === "edit" ? orders.find((o) => o.id === view.id) : null;
  const [draft, setDraft] = useState(null);
  useEffect(() => { setDraft(editing ? { amt: String(editing.amt), level: String(editing.level), stopLoss: editing.stopLoss ? String(editing.stopLoss) : "", tpMult: editing.tpMult ? String(editing.tpMult) : "",
    legs: Array.isArray(editing.legs) && editing.legs.length ? editing.legs.map((l) => ({ ...l })) : editing.tpMult > 1 ? [{ mult: editing.tpMult, trail: 10, alloc: 100 }] : [] } : null); }, [view && view.id]);
  useEffect(() => () => { onDraftLevel && onDraftLevel(null); }, []); // clear the preview line on close
  const tkOf = (o) => tokens.find((x) => String(x.id) === String(o.tokenId));
  const listAll = orders
    .filter((o) => scope === "site" || String(o.tokenId) === String(selectedId))
    .map((o) => { const t = tkOf(o); return t ? { ...o, t, dist: Math.abs(t.price - o.level) / t.price } : null; })
    .filter(Boolean).sort((a, b) => a.dist - b.dist);
  const F = ({ label, k, ph }) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, letterSpacing: 1, marginBottom: 3 }}>{label}</div>
      <input value={draft ? draft[k] : ""} placeholder={ph} onChange={(e) => setDraft((D) => ({ ...D, [k]: e.target.value }))}
        style={{ ...inp, padding: "7px 9px", fontSize: 11 }} />
    </div>
  );
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 70, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 440, maxHeight: "84vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>🤖 {view && view.mode === "edit" ? "Edit bot" : "Pending bots"}</div>
          <div style={{ display: "flex", gap: 7 }}>
            {view && view.mode === "edit" && (
              <button onClick={() => setView({ mode: "list" })} style={{ ...chip(false), padding: "5px 10px", fontSize: 9.5, fontWeight: 800, color: VALO_PURPLE }}>📋 ALL PENDING BOTS</button>
            )}
            <button onClick={onClose} style={{ ...chip(false), padding: "5px 10px", fontSize: 12 }}>✕</button>
          </div>
        </div>
        {view && view.mode === "edit" && editing && draft ? (
          <div style={{ padding: 14 }}>
            {/* live mini chart — entry line tracks the meter in realtime */}
            {(() => { const tk = tkOf(editing); return tk ? <div style={{ marginBottom: 10 }}><MiniBotChart token={tk} level={parseFloat(draft.level) || 0} /></div> : null; })()}
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.dim, marginBottom: 4 }}>
              {(tkOf(editing) || {}).sym || "?"} · <b style={{ color: editing.side === "buy" ? T.green : T.red }}>{editing.side.toUpperCase()}</b> bot — fills when price hits your entry
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.amber, marginBottom: 10 }}>
              ⏸ frozen while editing — this bot cannot trigger until you close this screen
            </div>
            {/* entry price meter — drag left/right; LIVE PRICE snaps to market */}
            {(() => {
              const tk = tkOf(editing); if (!tk) return null;
              const lvl = parseFloat(draft.level) || tk.price;
              const mn = tk.price * 0.25, mx = tk.price * 2.5;
              const pct = ((lvl - tk.price) / tk.price) * 100;
              return (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, letterSpacing: 1 }}>ENTRY PRICE METER</span>
                    <span style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 800, color: pct >= 0 ? T.green : T.red }}>${fmtP(lvl)} <span style={{ fontSize: 8, color: T.faint }}>({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</span></span>
                    <button onClick={() => { setDraft((D) => ({ ...D, level: String(tk.price) })); onDraftLevel && onDraftLevel(tk.price, tk.id); }}
                      style={{ ...chip(false), padding: "3px 8px", fontSize: 8.5, fontWeight: 800, color: T.green, borderColor: `${T.green}55` }}>● LIVE ${fmtP(tk.price)}</button>
                  </div>
                  <input type="range" min={mn} max={mx} step={(mx - mn) / 500} value={Math.min(mx, Math.max(mn, lvl))}
                    onChange={(e) => { setDraft((D) => ({ ...D, level: e.target.value })); onDraftLevel && onDraftLevel(+e.target.value, tk.id); }}
                    style={{ width: "100%" }} />
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <div style={{ flex: 1 }}>
                <F label={`AMOUNT (${editing.pay})`} k="amt" ph="1.0" />
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint, marginTop: 3 }}>≈ ${(((parseFloat(draft.amt) || 0) * (editing.pay === "SOL" ? SOL_USD : 0.0125))).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</div>
              </div>
              <F label="STOP LOSS ($ · optional)" k="stopLoss" ph="none" />
            </div>
            {/* take-profit legs — allocations must total 100% */}
            {(() => {
              const legs = draft.legs || [];
              const sum = legs.reduce((s, l) => s + (+l.alloc || 0), 0);
              const setLeg = (i, k, v) => setDraft((D) => ({ ...D, legs: D.legs.map((l, j) => (j === i ? { ...l, [k]: +v || 0 } : l)) }));
              return (
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, padding: 9, marginBottom: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 8, color: T.faint, letterSpacing: 1 }}>TAKE-PROFIT LEGS</span>
                    <span style={{ fontFamily: T.mono, fontSize: 8.5, fontWeight: 800, color: legs.length === 0 || sum === 100 ? T.green : T.red }}>
                      Σ sell {sum}%{legs.length > 0 && sum !== 100 ? " — must equal 100%" : ""}
                    </span>
                  </div>
                  {legs.map((l, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 24px", gap: 6, marginBottom: 5 }}>
                      <div><div style={{ fontFamily: T.mono, fontSize: 7, color: T.faint, marginBottom: 2 }}>MULT ×</div><input value={l.mult} onChange={(e) => setLeg(i, "mult", e.target.value)} style={{ ...inp, padding: "5px 7px", fontSize: 10.5 }} /></div>
                      <div><div style={{ fontFamily: T.mono, fontSize: 7, color: T.faint, marginBottom: 2 }}>TRAIL %</div><input value={l.trail} onChange={(e) => setLeg(i, "trail", e.target.value)} style={{ ...inp, padding: "5px 7px", fontSize: 10.5 }} /></div>
                      <div><div style={{ fontFamily: T.mono, fontSize: 7, color: T.faint, marginBottom: 2 }}>SELL %</div><input value={l.alloc} onChange={(e) => setLeg(i, "alloc", e.target.value)} style={{ ...inp, padding: "5px 7px", fontSize: 10.5 }} /></div>
                      <button onClick={() => setDraft((D) => ({ ...D, legs: D.legs.filter((_, j) => j !== i) }))}
                        style={{ ...chip(false), alignSelf: "end", padding: "5px 0", textAlign: "center", color: T.red }}>−</button>
                    </div>
                  ))}
                  <button onClick={() => setDraft((D) => ({ ...D, legs: [...(D.legs || []), { mult: 2, trail: 10, alloc: Math.max(0, 100 - sum) }] }))}
                    style={{ ...chip(false), width: "100%", textAlign: "center", padding: "6px", fontSize: 9.5, fontWeight: 800 }}>＋ add take-profit leg</button>
                </div>
              );
            })()}
            <div style={{ display: "flex", gap: 7 }}>
              <button disabled={(draft.legs || []).length > 0 && (draft.legs || []).reduce((s, l) => s + (+l.alloc || 0), 0) !== 100}
                onClick={() => { const bad = (draft.legs || []).length > 0 && (draft.legs || []).reduce((s, l) => s + (+l.alloc || 0), 0) !== 100; if (bad) return; onSave(editing.id, draft); onDraftLevel && onDraftLevel(null); setView({ mode: "list" }); }}
                style={{ flex: 1, border: "none", borderRadius: 9, padding: 10, fontFamily: T.mono, fontSize: 11, fontWeight: 800, background: T.green, color: "#07130d", cursor: "pointer" }}>💾 Save bot</button>
              <button onClick={() => { onCancelBot(editing.id); setView({ mode: "list" }); }}
                style={{ flex: 1, border: `1px solid ${T.red}55`, borderRadius: 9, padding: 10, fontFamily: T.mono, fontSize: 11, fontWeight: 800, background: "rgba(234,57,67,0.1)", color: T.red, cursor: "pointer" }}>✕ Cancel bot</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: 12 }}>
            <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
              <button onClick={() => setScope("token")} style={{ ...chip(scope === "token"), flex: 1, textAlign: "center", padding: "7px", fontSize: 10, fontWeight: 800 }}>THIS TOKEN</button>
              <button onClick={() => setScope("site")} style={{ ...chip(scope === "site"), flex: 1, textAlign: "center", padding: "7px", fontSize: 10, fontWeight: 800 }}>SITE-WIDE</button>
            </div>
            {listAll.length === 0 && <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, textAlign: "center", padding: 22 }}>No bots waiting. Arm one by clicking the chart with buy/sell armed.</div>}
            {listAll.map((o) => (
              <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", borderRadius: 9, marginBottom: 3, border: `1px solid ${T.border}`, background: "rgba(255,255,255,0.015)" }}>
                <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: accent(o.t.hue), width: 68, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${o.t.sym}</span>
                <span style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 800, color: o.side === "buy" ? T.green : T.red }}>{o.side.toUpperCase()} @ ${fmtP(o.level)}</span>
                <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>{o.amt} {o.pay}</span>
                <span style={{ fontFamily: T.mono, fontSize: 8, color: T.faint, marginLeft: "auto" }}>{(o.dist * 100).toFixed(1)}%</span>
                <button onClick={() => setView({ mode: "edit", id: o.id })} style={{ ...chip(false), padding: "3px 8px", fontSize: 9, fontWeight: 800 }}>Edit</button>
                <button onClick={() => onCancelBot(o.id)} style={{ ...chip(false), padding: "3px 8px", fontSize: 9, fontWeight: 800, color: T.red, borderColor: `${T.red}44` }}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// full stats for one sold bot trade — every buy, sell, trail taken
function BotRunStatsModal({ run, onClose, isMobile }) {
  if (!run) return null;
  const pnl = run.exits.reduce((s, e) => s + e.pnlUsd, 0);
  const up = pnl >= 0;
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 71, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, maxHeight: "84vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", borderBottom: `1px solid ${T.border}` }}>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 2 }}>🤖 BOT TRADE · ${run.sym}</div>
            <div style={{ fontFamily: T.mono, fontSize: 17, fontWeight: 900, color: up ? T.green : T.red }}>{up ? "+" : "−"}${Math.abs(pnl).toFixed(2)} total P/L</div>
          </div>
          <button onClick={onClose} style={{ ...chip(false), padding: "5px 10px", fontSize: 12 }}>✕</button>
        </div>
        <div style={{ padding: 13 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.green}44`, background: "rgba(22,199,132,0.05)", marginBottom: 6, fontFamily: T.mono }}>
            <span style={{ fontSize: 9, fontWeight: 900, color: T.green }}>BOUGHT</span>
            <span style={{ fontSize: 10, color: T.text }}>{run.amt} {run.pay} @ ${fmtP(run.entry)}</span>
            <span style={{ fontSize: 7.5, color: T.faint, marginLeft: "auto" }}>{timeAgo(run.filledTs)} · armed @ ${fmtP(run.level)}</span>
          </div>
          {run.exits.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 9, border: `1px solid ${T.red}33`, background: "rgba(234,57,67,0.04)", marginBottom: 4, fontFamily: T.mono }}>
              <span style={{ fontSize: 9, fontWeight: 900, color: e.kind === "SL" ? T.red : e.kind === "MANUAL" ? T.amber : T.blue }}>{e.kind}</span>
              <span style={{ fontSize: 10, color: T.text }}>{e.amt} {run.pay} @ ${fmtP(e.price)}</span>
              {e.trail != null && <span style={{ fontSize: 8, color: T.amber }}>trail {e.trail}%</span>}
              <span style={{ fontSize: 10.5, fontWeight: 900, color: e.pnlUsd >= 0 ? T.green : T.red, marginLeft: "auto" }}>{e.pnlUsd >= 0 ? "+" : "−"}${Math.abs(e.pnlUsd).toFixed(2)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---- PC AUTO TRADER TAB — form on top, bot bars below with sub-tabs -------
function AutoTraderPanel({ wide = false, solBalance = 0, valoWallet = 0, token, tokens = [], amount, setAmount, pay, setPay, onExecute, onDraftLevel, botLock, dragSetOn, onToggleDragSet, onSetDragSet, onLinesChange, onStageSide, onArmPair, onReadyArm,
  pendingOrders = [], botRuns = [], editingBotId, setEditingBotId, onRelaunch, onCancelBot, onSellRun, onOpenBotRun, onOpenTokenAuto }) {
  const [listTab, setListTab] = useState("live");   // live | inactive
  const [scope, setScope] = useState("token");      // token | site
  const editBot = pendingOrders.find((o) => o.id === editingBotId) || null;
  const inScope = (tid) => scope === "site" || String(tid) === String(token.id);
  const tkOf = (tid) => tokens.find((x) => String(x.id) === String(tid));
  const pend = pendingOrders.filter((o) => !o.runId && inScope(o.tokenId));
  const running = botRuns.filter((r) => r.status === "live" && inScope(r.tokenId));
  const sold = botRuns.filter((r) => r.status === "sold" && inScope(r.tokenId));
  const barBase = (hue) => ({ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", borderRadius: 9, marginBottom: 5, border: `1px solid ${accent(hue)}44`, background: "rgba(255,255,255,0.02)", cursor: "pointer", fontFamily: T.mono });
  const [subTab, setSubTab] = useState("trader"); // trader | visual
  // editing a visual pair jumps straight to the visual tab with prices loaded
  useEffect(() => { if (editBot && editBot.vt) setSubTab("visual"); }, [editBot && editBot.id]);
  return (
    <div>
    <div>
      <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
        <button onClick={() => setSubTab("trader")} style={{ ...chip(subTab === "trader"), flex: 1, textAlign: "center", padding: "7px", fontSize: 9.5, fontWeight: 800 }}>🤖 AUTO TRADER</button>
        <button onClick={() => setSubTab("visual")} style={{ ...chip(subTab === "visual"), flex: 1, textAlign: "center", padding: "7px", fontSize: 9.5, fontWeight: 800, color: subTab === "visual" ? T.amber : T.dim, borderColor: subTab === "visual" ? `${T.amber}66` : T.border }}>👁 VISUAL TRADING</button>
      </div>
      {subTab === "visual" ? (
        <VisualTrading token={token} amount={amount} setAmount={setAmount} pay={pay} setPay={setPay} wide={wide}
          botLock={botLock} onStageSide={onStageSide} onArmPair={onArmPair}
          dragSetOn={dragSetOn} onToggleDragSet={onToggleDragSet} onDraftLevel={onDraftLevel}
          onSetDragSet={onSetDragSet} onLinesChange={onLinesChange} onReadyArm={onReadyArm}
          solBalance={solBalance} valoWallet={valoWallet}
          editBot={editBot && editBot.vt ? editBot : null} />
      ) : (
      <TradePanel key={editingBotId || "new"} token={token} amount={amount} setAmount={setAmount} pay={pay} wide={wide}
        onExecute={onExecute} onDraftLevel={onDraftLevel} editBot={editBot} onRelaunch={onRelaunch} botLock={botLock}
        dragSetOn={dragSetOn} onToggleDragSet={onToggleDragSet} setPay={setPay} onReadyArm={onReadyArm}
        solBalance={solBalance} valoWallet={valoWallet} />
      )}
    </div>
    <div style={wide ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" } : undefined}>
      {/* placed orders — only appears once something is actually armed or running */}
      {(pend.length + running.length + sold.length) > 0 && (
      <div style={{ marginTop: wide ? 8 : 12, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 11 }}>
        {listTab === "live" ? (
          <>
            {pend.map((o) => { const t = tkOf(o.tokenId); if (!t) return null; return (
              <div key={o.id} style={barBase(t.hue)}
                onClick={() => { if (String(o.tokenId) === String(token.id)) setEditingBotId(o.id); else onOpenTokenAuto(o.tokenId, o.id); }}
                title="Click to load this bot into the auto trader for editing">
                <span style={{ fontSize: 10 }}>⏳</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue) }}>${t.sym}</span>
                <span style={{ fontSize: 9.5, color: T.text }}>{o.amt} {o.pay} <span style={{ color: T.faint }}>buy-in @</span> ${fmtP(o.level)}</span>
                <span style={{ fontSize: 8, color: T.amber, marginLeft: "auto" }}>{(Math.abs(t.price - o.level) / t.price * 100).toFixed(1)}% away</span>
                <button onClick={(e) => { e.stopPropagation(); onCancelBot(o.id); }} style={{ ...chip(false), padding: "3px 7px", fontSize: 9, color: T.red, borderColor: `${T.red}44` }}>✕</button>
              </div>
            ); })}
            {running.map((r) => { const t = tkOf(r.tokenId); if (!t) return null;
              const pnl = (r.remaining * (t.price / r.entry) - r.remaining) * (r.pay === "SOL" ? SOL_USD : 0.0125);
              const up = pnl >= 0;
              return (
                <div key={r.id} style={{ ...barBase(t.hue), border: `1px solid ${up ? "rgba(22,199,132,0.45)" : "rgba(234,57,67,0.45)"}` }}
                  onClick={() => { if (String(r.tokenId) !== String(token.id)) onOpenTokenAuto(r.tokenId); }}>
                  <span style={{ fontSize: 9, fontWeight: 900, color: up ? T.green : T.red }}>LIVE</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue) }}>${t.sym}</span>
                  <span style={{ fontSize: 9.5, color: T.text }}>{r.remaining} {r.pay} <span style={{ color: T.faint }}>in @</span> ${fmtP(r.entry)}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 900, color: up ? T.green : T.red, marginLeft: "auto" }}>{up ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
                  <button onClick={(e) => { e.stopPropagation(); onSellRun(r.id); }} title="Sell this bot's whole position now"
                    style={{ border: "none", borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 9, fontWeight: 900, background: T.red, color: "#170808", cursor: "pointer" }}>SELL ALL</button>
                </div>
              ); })}
          </>
        ) : (
          <>
            {sold.map((r) => { const pnl = r.exits.reduce((s, e) => s + e.pnlUsd, 0); const up = pnl >= 0; return (
              <div key={r.id} style={{ ...barBase(r.hue), borderLeft: `2px solid ${T.amber}` }} onClick={() => onOpenBotRun(r.id)} title="Full stats">
                <span style={{ fontSize: 10 }}>🤖</span>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(r.hue) }}>${r.sym}</span>
                <span style={{ fontSize: 9, color: T.dim }}>in @ ${fmtP(r.entry)} · {r.exits.length} exit{r.exits.length === 1 ? "" : "s"}</span>
                <span style={{ fontSize: 10.5, fontWeight: 900, color: up ? T.green : T.red, marginLeft: "auto" }}>{up ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
              </div>
            ); })}
          </>
        )}
      </div>
      )}
    </div>
    </div>
  );
}

// every bot in one place — overall PnL bar on top, then live & finished bots
// VISUAL TRADING — set a buy-in line, then a sell-all point; the pair trades
// itself with zero interference between bots
function VisualTrading({ token, amount, setAmount, pay, setPay, botLock, onStageSide, onArmPair, dragSetOn, onToggleDragSet, onDraftLevel, onSetDragSet, onLinesChange, editBot = null, compactArm = false, onReadyArm, wide = false, solBalance = 0, valoWallet = 0 }) {
  const [buyLvl, setBuyLvl] = useState(null);
  const [sellLvl, setSellLvl] = useState(null);
  const [trail, setTrail] = useState(0);
  const [flash, setFlash] = useState(0);
  const [vtQuick, setVtQuick] = useState([0.5, 1, 2, 5]);   // dbl-tap a chip to retype it
  const [vtPcts, setVtPcts] = useState([25, 50, 75, 100]);
  // EDIT: clicking a visual pair loads its prices right back into the boxes
  useEffect(() => {
    if (!editBot || !editBot.vt) return;
    setBuyLvl(editBot.level);
    setSellLvl(editBot.vtSell || null);
    setTrail(editBot.vtTrail || 0);
    setAmount && setAmount(String(editBot.amt));
  }, [editBot && editBot.id]);
  const stage = buyLvl == null ? "buy" : sellLvl == null ? "sell" : "done";
  useEffect(() => { onStageSide && onStageSide(stage === "sell" ? "sell" : "buy"); }, [stage]);
  // the set lines stay painted on the chart — green buy in, red exit point
  useEffect(() => { onLinesChange && onLinesChange(buyLvl || sellLvl ? { tokenId: token.id, buy: buyLvl, sell: sellLvl } : null); }, [buyLvl, sellLvl, token.id]);
  useEffect(() => () => { onLinesChange && onLinesChange(null); }, []);
  // setting the buy in automatically moves you on to the exit point
  useEffect(() => { if (stage === "sell") onSetDragSet && onSetDragSet(true); }, [stage]);
  // chart locks land on the current stage, then the flow advances automatically
  useEffect(() => {
    if (!botLock || !(botLock.level > 0)) return;
    if (stage === "buy") setBuyLvl(botLock.level);
    else if (stage === "sell") setSellLvl(botLock.level);
  }, [botLock && botLock.n]);
  const amt = parseFloat(amount) || 0;
  const roi = buyLvl && sellLvl ? ((sellLvl / buyLvl - 1) * 100) : null;
  const canArm = buyLvl > 0 && sellLvl > 0 && amt > 0;
  const armPairRef = useRef(null);
  const armPair = () => {
    if (!canArm) return;
    onArmPair({ buy: buyLvl, sell: sellLvl, amt, trail, editId: editBot && editBot.vt ? editBot.id : null });
    setFlash(Date.now()); setTimeout(() => setFlash(0), 900);
    setBuyLvl(null); setSellLvl(null); // boxes go back to blank "tap to set"
  };
  armPairRef.current = armPair;
  // both prices set → the ⚡ARM bubble rides the mouse for a one-click arm (PC)
  useEffect(() => {
    onReadyArm && onReadyArm(canArm ? () => armPairRef.current && armPairRef.current() : null);
    return () => { onReadyArm && onReadyArm(null); };
  }, [canArm]);
  // click a box to activate it — it highlights and the chart is ready to drag
  const step = (n, label, val, col, active, onActivate, onClear) => (
    <div onClick={onActivate} title={`Click to set your ${label.toLowerCase()} on the chart`}
      style={{ flex: 1, border: `1.5px solid ${active ? col : val != null ? `${col}66` : T.border}`, background: active ? `${col}1c` : val != null ? `${col}10` : "rgba(255,255,255,0.02)", borderRadius: 10, padding: wide ? "6px 8px" : "8px 9px", boxShadow: active ? `0 0 12px ${col}55` : "none", cursor: "pointer", transition: "border-color .15s, box-shadow .15s, background .15s" }}>
      <div style={{ fontFamily: T.mono, fontSize: 7.5, letterSpacing: 1, color: active || val != null ? col : T.faint, marginBottom: 3 }}>{n} · {label}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 900, color: val != null ? T.text : T.faint, flex: 1 }}>{val != null ? `$${fmtP(val)}` : active ? "drag the chart…" : "tap to set"}</span>
        {val != null && <button onClick={(e) => { e.stopPropagation(); onClear(); }} style={{ ...chip(false), padding: "2px 7px", fontSize: 9 }}>↺</button>}
      </div>
    </div>
  );
  return (
    <div data-botui="1" style={{ background: wide ? "transparent" : T.panel, border: wide ? "none" : `1px solid ${T.border2}`, borderRadius: 12, padding: wide ? 0 : 14,
      ...(wide ? { display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" } : {}) }}>
      {!wide && (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.dim, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          👁 VISUAL TRADING · <b style={{ color: accent(token.hue) }}>{token.sym}</b>{editBot && editBot.vt ? <span style={{ color: T.amber }}> · EDITING</span> : null}
        </div>
        {compactArm && (
          <button disabled={!canArm} onClick={armPair}
            style={{ flex: "0 0 auto", border: "none", borderRadius: 8, padding: "7px 13px", fontFamily: T.mono, fontSize: 10.5, letterSpacing: 1, fontWeight: 900,
              background: !canArm ? "#1a2030" : flash ? T.green : editBot && editBot.vt ? T.amber : T.blue,
              color: !canArm ? T.faint : flash ? "#07130d" : editBot && editBot.vt ? "#1d1503" : "#07101d",
              cursor: canArm ? "pointer" : "not-allowed",
              transform: flash ? "scale(1.08)" : "scale(1)", transition: "transform .18s, box-shadow .18s, background .18s",
              boxShadow: !canArm ? "none" : flash ? `0 0 22px ${T.green}` : `0 0 10px rgba(46,112,204,0.45)` }}>
            {flash ? "✓ ARMED" : editBot && editBot.vt ? "🔁 RE-ARM" : "👁 ARM PAIR"}
          </button>
        )}
      </div>
      )}
      <div style={wide ? { border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.015)", flex: "1 1 220px", minWidth: 210 } : undefined}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
        <label style={{ ...lbl, marginBottom: 0 }}>Buy-in amount</label>
        {setPay && (
          <span style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setPay("SOL")} style={{ ...chip(pay === "SOL"), padding: "3px 9px", fontSize: 8.5, fontWeight: 800, color: pay === "SOL" ? T.blue : T.faint }}>SOL</button>
            <button onClick={() => setPay("VALO")} style={{ ...chip(pay === "VALO"), padding: "3px 9px", fontSize: 8.5, fontWeight: 800, color: pay === "VALO" ? VALO_PURPLE : T.faint }}>$VALO</button>
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <button onClick={() => setAmount && setAmount(Math.max(0, (parseFloat(amount) || 0) - 0.1).toFixed(1))}
          style={{ ...chip(false), flex: "0 0 auto", padding: "8px 11px", fontSize: 13, fontWeight: 900 }}>−</button>
        <input value={amount} onChange={(e) => setAmount && setAmount(e.target.value)} inputMode="decimal"
          style={{ ...inp, flex: 1, minWidth: 0, fontSize: wide ? 12.5 : 14, fontWeight: 800, padding: wide ? "6px 9px" : "9px 11px", textAlign: "center" }} />
        <button onClick={() => setAmount && setAmount(((parseFloat(amount) || 0) + 0.1).toFixed(1))}
          style={{ ...chip(false), flex: "0 0 auto", padding: "8px 11px", fontSize: 13, fontWeight: 900 }}>+</button>
        <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 800, color: pay === "SOL" ? T.blue : VALO_PURPLE }}>{pay}</span>
        <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>≈ ${(amt * (pay === "SOL" ? SOL_USD : 0.0125)).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
        {vtQuick.map((v, ci) => (
          <button key={ci} onClick={() => setAmount && setAmount(String(v))}
            {...chipEditProps(() => { askAmt(v, (nv) => setVtQuick((A) => A.map((x, j) => (j === ci ? nv : x)))); })}
            style={{ ...chip(parseFloat(amount) === v), flex: 1, textAlign: "center", padding: "4px 0", fontSize: 9, fontWeight: 800 }}>{v}</button>
        ))}
      </div>
      {!compactArm && (() => {
        const bal = pay === "SOL" ? solBalance : valoWallet;
        const unit$ = pay === "SOL" ? SOL_USD : 0.0125;
        return (
          <>
            <div style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 900, color: T.blue,
              background: "rgba(76,154,255,0.10)", border: `1px solid ${T.blue}55`, borderRadius: 8,
              padding: "6px 10px", margin: "4px 0 6px", display: "flex", justifyContent: "space-between", alignItems: "baseline",
              boxShadow: "0 0 12px rgba(76,154,255,0.18)" }}>
              <span>💼 {bal.toFixed(2)} {pay}</span>
              <span style={{ fontSize: 9.5, opacity: 0.85 }}>≈ ${(bal * unit$).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {vtPcts.map((pc, ci) => (
                <button key={ci} onClick={() => setAmount && setAmount(String(feeSafe((bal * pc) / 100, pay)))}
                  {...chipEditProps(() => { askPct(pc, (nv) => setVtPcts((A) => A.map((x, j) => (j === ci ? nv : x)))); })}
                  style={{ ...chip(false), flex: 1, textAlign: "center", padding: "3px 0", fontSize: 8.5, fontWeight: 800 }}>{pc === 100 ? "MAX" : `${pc}%`}</button>
              ))}
            </div>
          </>
        );
      })()}
      </div>
      <div style={wide ? { border: `1px solid ${T.border}`, borderRadius: 10, padding: "8px 10px", background: "rgba(255,255,255,0.015)", flex: "1.5 1 300px", minWidth: 290 } : undefined}>
      <div style={{ display: "flex", gap: 7, marginBottom: wide ? 6 : 9 }}>
        {step("1", "BUY IN", buyLvl, T.green, stage === "buy" && dragSetOn,
          () => {
            if (stage === "buy" && dragSetOn) { onSetDragSet && onSetDragSet(false); onDraftLevel && onDraftLevel(null); return; } // re-tap = cancel
            setBuyLvl(null); setSellLvl(null); onSetDragSet && onSetDragSet(true);
          },
          () => { setBuyLvl(null); setSellLvl(null); })}
        {step("2", "EXIT POINT", sellLvl, T.red, stage === "sell" && dragSetOn,
          () => {
            if (stage === "sell" && dragSetOn) { onSetDragSet && onSetDragSet(false); onDraftLevel && onDraftLevel(null); return; } // re-tap = cancel
            if (buyLvl != null) { setSellLvl(null); onSetDragSet && onSetDragSet(true); }
          },
          () => setSellLvl(null))}
      </div>
      <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, marginBottom: 9 }}>
        buy in hits → buys automatically → exit point hits → sells all. Lines stay on the chart until hit.
      </div>
      {roi != null && (
        <div style={{ fontFamily: T.mono, fontSize: 9.5, fontWeight: 800, color: roi >= 0 ? T.green : T.red, marginBottom: 8 }}>
          target ROI {roi >= 0 ? "+" : ""}{roi.toFixed(1)}% — sells 100% of this bot when hit
        </div>
      )}
      <label style={{ ...lbl }}>Trailing loss on the sell hit — {trail > 0 ? `${trail}%` : "off"}</label>
      <input type="range" min={0} max={50} value={trail} onChange={(e) => setTrail(+e.target.value)} style={{ width: "100%", accentColor: T.red }} />
      <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, margin: "2px 0 10px" }}>
        {trail > 0 ? `after your sell point hits, it rides the peak and sells all when price drops ${trail}% from it` : "0% = sell the instant your sell point is hit"}
      </div>
      </div>
      {!(compactArm || wide) && !onReadyArm && (
        <button disabled={!canArm} onClick={armPair}
          style={{ gridColumn: wide ? "1 / -1" : undefined, width: "100%", border: "none", borderRadius: 9, padding: wide ? "9px" : "12px", fontFamily: T.mono, fontSize: wide ? 11.5 : 12, letterSpacing: 1.5, fontWeight: 900,
            background: !canArm ? "#1a2030" : flash ? T.green : editBot && editBot.vt ? T.amber : T.blue,
            color: !canArm ? T.faint : flash ? "#07130d" : editBot && editBot.vt ? "#1d1503" : "#07101d", cursor: canArm ? "pointer" : "not-allowed",
            transform: flash ? "scale(1.02)" : "scale(1)", transition: "transform .18s, background .18s",
            boxShadow: flash ? `0 0 22px ${T.green}` : "none" }}>
          {flash ? "✓ PAIR ARMED" : editBot && editBot.vt ? "🔁 RE-ARM VISUAL PAIR" : "👁 ARM VISUAL PAIR"}
        </button>
      )}
    </div>
  );
}

// PC MY POSITIONS — bots and order tickets under one collapsible roof
function MyPositionsHub({ tokens = [], positions = {}, botRuns = [], pendingOrders = [], pay = "SOL",
  onOpenToken, onSellPos, onCloseTickets, onSellRun, onSellAllBots, onCancelBot }) {
  const [open, setOpen] = useState(true);
  const [tab, setTab] = useState("both"); // bots | both | tickets
  const unit$ = (p) => (p === "SOL" ? SOL_USD : 0.0125);
  const tickets = Object.entries(positions).map(([id, p]) => {
    const t = tokens.find((x) => String(x.id) === String(id));
    if (!t || !(p.amt > 0)) return null;
    const pnl = (p.amt * (t.price / (p.entry || t.price)) - p.amt) * unit$(p.pay || pay);
    return { t, p, pnl };
  }).filter(Boolean);
  const runsLive = botRuns.filter((r) => r.status === "live").map((r) => {
    const t = tokens.find((x) => String(x.id) === String(r.tokenId));
    return t ? { r, t, pnl: (r.remaining * (t.price / r.entry) - r.remaining) * unit$(r.pay) } : null;
  }).filter(Boolean);
  const pend = pendingOrders.filter((o) => !o.runId);
  const ticketPnl = tickets.reduce((s, x) => s + x.pnl, 0);
  const botPnl = runsLive.reduce((s, x) => s + x.pnl, 0);
  const tabPnl = tab === "tickets" ? ticketPnl : tab === "bots" ? botPnl : ticketPnl + botPnl;
  const up = tabPnl >= 0;
  const showBots = tab !== "tickets", showTickets = tab !== "bots";
  const rowStyle = (good) => ({ display: "flex", alignItems: "center", gap: 7, padding: "7px 9px", borderRadius: 9, marginBottom: 4, border: `1px solid ${good == null ? T.border : good ? "rgba(22,199,132,0.4)" : "rgba(234,57,67,0.4)"}`, background: "rgba(255,255,255,0.02)", fontFamily: T.mono });
  const sellBtn = (onClick) => (
    <button onClick={onClick} style={{ border: "none", borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 8.5, fontWeight: 900, background: T.red, color: "#170808", cursor: "pointer", flex: "0 0 auto" }}>SELL ALL</button>
  );
  return (
    <div style={{ marginTop: 10, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 11 }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", border: "none", background: "transparent", cursor: "pointer", padding: 0, fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: T.text }}>
        <span>{open ? "▾" : "▸"} MY POSITIONS · {tickets.length + runsLive.length}</span>
        <span style={{ color: ticketPnl + botPnl >= 0 ? T.green : T.red, fontWeight: 900 }}>{ticketPnl + botPnl >= 0 ? "+" : "−"}${Math.abs(ticketPnl + botPnl).toFixed(2)}</span>
      </button>
      {open && (
        <div style={{ marginTop: 9 }}>
          <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
            <button onClick={() => setTab("bots")} style={{ ...chip(tab === "bots"), flex: 1, textAlign: "center", padding: "6px", fontSize: 8.5, fontWeight: 800 }}>🤖 TRADING BOTS</button>
            <button onClick={() => setTab("both")} style={{ ...chip(tab === "both"), flex: 1, textAlign: "center", padding: "6px", fontSize: 8.5, fontWeight: 800 }}>BOTH</button>
            <button onClick={() => setTab("tickets")} style={{ ...chip(tab === "tickets"), flex: 1, textAlign: "center", padding: "6px", fontSize: 8.5, fontWeight: 800 }}>🧾 ORDER TICKETS</button>
          </div>
          {(tab === "tickets" ? tickets.length : tab === "bots" ? runsLive.length : tickets.length + runsLive.length) > 0 && (
            <button onClick={() => { if (showTickets) onCloseTickets(); if (showBots) onSellAllBots(); }}
              style={{ width: "100%", boxSizing: "border-box", border: "none", borderRadius: 9, padding: "9px", marginBottom: 8, fontFamily: T.mono, fontSize: 11, fontWeight: 900, letterSpacing: 1,
                background: up ? T.green : T.red, color: up ? "#07130d" : "#170808", cursor: "pointer" }}>
              ✕ SELL ALL · {up ? "+" : "−"}${Math.abs(tabPnl).toFixed(2)}
            </button>
          )}
          {showBots && runsLive.map(({ r, t, pnl }) => (
            <div key={r.id} style={rowStyle(pnl >= 0)}>
              <span style={{ fontSize: 8, fontWeight: 900, color: pnl >= 0 ? T.green : T.red }}>LIVE</span>
              <span onClick={() => onOpenToken(t.id)} style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue), cursor: "pointer" }}>${t.sym}</span>
              <span style={{ fontSize: 8.5, color: T.dim }}>{r.remaining} {r.pay}</span>
              <span style={{ fontSize: 10.5, fontWeight: 900, color: pnl >= 0 ? T.green : T.red, marginLeft: "auto" }}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
              {sellBtn(() => onSellRun(r.id))}
            </div>
          ))}
          {showBots && pend.map((o) => {
            const t = tokens.find((x) => String(x.id) === String(o.tokenId)); if (!t) return null;
            return (
              <div key={o.id} style={rowStyle(null)}>
                <span style={{ fontSize: 9 }}>⏳</span>
                <span onClick={() => onOpenToken(t.id)} style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue), cursor: "pointer" }}>${t.sym}</span>
                <span style={{ fontSize: 8.5, color: T.dim }}>{o.side.toUpperCase()} {o.amt} {o.pay} @ ${fmtP(o.level)}</span>
                <button onClick={() => onCancelBot(o.id)} style={{ ...chip(false), padding: "3px 8px", fontSize: 8.5, fontWeight: 800, color: T.red, borderColor: `${T.red}44`, marginLeft: "auto" }}>✕</button>
              </div>
            );
          })}
          {showTickets && tickets.map(({ t, p, pnl }) => (
            <div key={t.id} style={rowStyle(pnl >= 0)}>
              <span style={{ fontSize: 9 }}>🧾</span>
              <span onClick={() => onOpenToken(t.id)} style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue), cursor: "pointer" }}>${t.sym}</span>
              <span style={{ fontSize: 8.5, color: T.dim }}>{fmtQty(posTokenQty(t, p))} tokens</span>
              <span style={{ fontSize: 10.5, fontWeight: 900, color: pnl >= 0 ? T.green : T.red, marginLeft: "auto" }}>{pnl >= 0 ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
              {sellBtn(() => onSellPos(t))}
            </div>
          ))}
          {tickets.length + runsLive.length + pend.length === 0 && (
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.faint, textAlign: "center", padding: 12 }}>Nothing open yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

// PRO LAYOUT order ticket — one wide bar under the chart, buy & sell side by side
function ProOrderBar({ token, amount, setAmount, pay, setPay, solBalance = 0, valoBalance = 0, position, onExecute, onPosTrade, clickMode, setClickMode, realized24 = 0 }) {
  const [poPcts, setPoPcts] = useState([25, 50, 75, 100]);      // dbl-click / right-click to retype
  const [poFixed, setPoFixed] = useState([0.5, 1, 2, 5]);
  const [poSellPcts, setPoSellPcts] = useState([10, 25, 50, 75]);
  const amt = parseFloat(amount) || 0;
  const bal = pay === "SOL" ? solBalance : valoBalance;
  const unit$ = pay === "SOL" ? SOL_USD : 0.0125;
  const held = position && position.amt > 0 ? position.amt : 0;
  const livePct = held ? ((token.price / (position.entry || token.price)) - 1) * 100 : 0;
  const livePnlUsd = held ? (held * (token.price / (position.entry || token.price)) - held) * (position.pay === "SOL" ? SOL_USD : 0.0125) : 0;
  const gain = livePnlUsd >= 0;
  const fire = (side, a) => onExecute({ side, pay: side === "sell" ? (position && position.pay) || pay : pay, amt: a, mode: "instant", tax: taxFor(pay), burn: splitFee(a, pay).total, legs: [] });
  const seg = { border: `1px solid ${T.border}`, borderRadius: 10, padding: "9px 11px", background: "rgba(255,255,255,0.015)" };
  return (
    <div data-botui="1" style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, padding: 12, display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
      {/* amount */}
      <div style={{ ...seg, flex: "1 1 230px", minWidth: 220 }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
          <span style={{ ...lbl, marginBottom: 0 }}>Amount</span>
          <span style={{ display: "flex", gap: 4 }}>
            <button onClick={() => setPay("SOL")} style={{ ...chip(pay === "SOL"), padding: "2px 8px", fontSize: 8.5, fontWeight: 800, color: pay === "SOL" ? T.blue : T.faint }}>SOL</button>
            <button onClick={() => setPay("VALO")} style={{ ...chip(pay === "VALO"), padding: "2px 8px", fontSize: 8.5, fontWeight: 800, color: pay === "VALO" ? VALO_PURPLE : T.faint }}>$VALO</button>
          </span>
        </div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          <button onClick={() => setAmount(Math.max(0, amt - 0.1).toFixed(1))} style={{ ...chip(false), padding: "7px 10px", fontWeight: 900 }}>−</button>
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
            style={{ ...inp, flex: 1, minWidth: 0, fontSize: 14, fontWeight: 800, padding: "8px", textAlign: "center" }} />
          <button onClick={() => setAmount((amt + 0.1).toFixed(1))} style={{ ...chip(false), padding: "7px 10px", fontWeight: 900 }}>+</button>
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
          {poPcts.map((pc, ci) => (
            <button key={ci} onClick={() => setAmount(String(feeSafe((bal * pc) / 100, pay)))}
              {...chipEditProps(() => askPct(pc, (nv) => setPoPcts((A) => A.map((x, j) => (j === ci ? nv : x)))))}
              title="Double-click or right-click to set your own %"
              style={{ ...chip(false), flex: 1, textAlign: "center", padding: "3px 0", fontSize: 8.5, fontWeight: 800 }}>{pc === 100 ? "MAX" : `${pc}%`}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 5 }}>
          {poFixed.map((v, ci) => (
            <button key={ci} onClick={() => setAmount(String(v))}
              {...chipEditProps(() => askAmt(v, (nv) => setPoFixed((A) => A.map((x, j) => (j === ci ? nv : x)))))}
              title="Double-click or right-click to set your own amount"
              style={{ ...chip(parseFloat(amount) === v), flex: 1, textAlign: "center", padding: "3px 0", fontSize: 8.5, fontWeight: 800, color: T.green }}>{v}</button>
          ))}
        </div>
        <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint, marginTop: 5 }}>≈ ${(amt * unit$).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD buy</div>
        <div style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 900, color: T.blue,
          background: "rgba(76,154,255,0.10)", border: `1px solid ${T.blue}55`, borderRadius: 8,
          padding: "6px 10px", marginTop: 5, display: "flex", justifyContent: "space-between", alignItems: "baseline",
          boxShadow: "0 0 12px rgba(76,154,255,0.18)" }}>
          <span>💼 {bal.toFixed(2)} {pay}</span>
          <span style={{ fontSize: 9.5, opacity: 0.85 }}>≈ ${(bal * unit$).toLocaleString(undefined, { maximumFractionDigits: 0 })} USD</span>
        </div>
      </div>
      {/* BUY | SELL side by side */}
      <div style={{ flex: "2 1 340px", minWidth: 300, display: "flex", gap: 8 }}>
        <button disabled={!(amt > 0) || bal < amt} onClick={() => fire("buy", amt)}
          style={{ flex: 1, border: "none", borderRadius: 11, fontFamily: T.mono, fontWeight: 900, fontSize: 14, letterSpacing: 1.2,
            background: amt > 0 && bal >= amt ? T.green : "#1a2030", color: amt > 0 && bal >= amt ? "#07130d" : T.faint, cursor: amt > 0 && bal >= amt ? "pointer" : "not-allowed",
            boxShadow: amt > 0 && bal >= amt ? "0 0 16px rgba(22,199,132,0.35)" : "none" }}>
          🔥 BUY<div style={{ fontSize: 9, fontWeight: 800, opacity: 0.85 }}>{amt.toFixed(2)} {pay} · ${Math.round(amt * unit$)}</div>
        </button>
        <button disabled={!held} onClick={() => fire("sell", held)}
          style={{ flex: 1, border: "none", borderRadius: 11, fontFamily: T.mono, fontWeight: 900, fontSize: 14, letterSpacing: 1.2,
            background: held ? T.red : "#1a2030", color: held ? "#170808" : T.faint, cursor: held ? "pointer" : "not-allowed",
            boxShadow: held ? "0 0 16px rgba(234,57,67,0.3)" : "none" }}>
          SELL ALL<div style={{ fontSize: 9, fontWeight: 800, opacity: 0.85 }}>{held ? `${held.toFixed(2)} ${((position && position.pay) || pay)}` : "no position"}</div>
        </button>
      </div>
      {/* partial sells + arm */}
      <div style={{ ...seg, flex: "1 1 190px", minWidth: 180 }}>
        <div style={{ ...lbl }}>Sell % of held</div>
        <div style={{ display: "flex", gap: 4 }}>
          {poSellPcts.map((pc, ci) => (
            <button key={ci} disabled={!held} onClick={() => fire("sell", +(held * pc / 100).toFixed(4))}
              {...chipEditProps(() => askPct(pc, (nv) => setPoSellPcts((A) => A.map((x, j) => (j === ci ? nv : x)))))}
              title="Double-click or right-click to set your own %"
              style={{ ...chip(false), flex: 1, textAlign: "center", padding: "6px 0", fontSize: 9, fontWeight: 800, color: held ? T.red : T.faint, borderColor: held ? `${T.red}44` : T.border, cursor: held ? "pointer" : "not-allowed" }}>{pc}%</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, marginTop: 7 }}>
          <button onClick={() => setClickMode(clickMode === "buy" ? null : "buy")} style={{ ...chip(clickMode === "buy"), flex: 1, textAlign: "center", padding: "5px 0", fontSize: 8.5, fontWeight: 800, color: T.green }}>▲ ARM BUY</button>
          <button onClick={() => setClickMode(clickMode === "sell" ? null : "sell")} style={{ ...chip(clickMode === "sell"), flex: 1, textAlign: "center", padding: "5px 0", fontSize: 8.5, fontWeight: 800, color: T.red }}>▼ ARM SELL</button>
        </div>
      </div>
      {/* live position */}
      <div style={{ ...seg, flex: "1 1 200px", minWidth: 190 }}>
        <div style={{ ...lbl }}>Live P/L · {token.sym}</div>
        {held ? (
          <>
            <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 900, color: gain ? T.green : T.red }}>{gain ? "+" : "−"}${Math.abs(livePnlUsd).toFixed(2)} <span style={{ fontSize: 10 }}>({gain ? "+" : ""}{livePct.toFixed(1)}%)</span></div>
            <div style={{ fontFamily: T.mono, fontSize: 8, color: T.dim, marginTop: 3 }}>
              {fmtQty(posTokenQty(token, position))} tokens · avg ${fmtP(position.entry)}
              <span style={{ color: (realized24 || 0) >= 0 ? T.green : T.red }}> · R24H {(realized24 || 0) >= 0 ? "+" : "−"}${Math.abs(realized24 || 0).toFixed(2)}</span>
            </div>
          </>
        ) : (
          <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.faint, marginTop: 6 }}>No open position — hit BUY.</div>
        )}
      </div>
    </div>
  );
}

function AllBotsPanel({ tokens = [], pendingOrders = [], botRuns = [], curTokenId = null, onEdit, onCancel, onSellRun, onSellAll, onOpenBotRun, onHighlight, onEditLine }) {
  const [view, setView] = useState("live"); // live | inactive | token | site
  const tkOf = (tid) => tokens.find((x) => String(x.id) === String(tid));
  const inView = (tid) => (view === "token" ? String(tid) === String(curTokenId) : true);
  const runsLiveAll = botRuns.filter((r) => r.status === "live");
  const runsSoldAll = botRuns.filter((r) => r.status === "sold");
  const pendAll = pendingOrders.filter((o) => !o.runId);
  const runsLive = (view === "inactive" ? [] : runsLiveAll.filter((r) => inView(r.tokenId)));
  const runsSold = (view === "live" ? [] : runsSoldAll.filter((r) => inView(r.tokenId)));
  const pend = (view === "inactive" ? [] : pendAll.filter((o) => inView(o.tokenId)));
  const livePnl = runsLiveAll.reduce((s, r) => { const t = tkOf(r.tokenId); return t ? s + (r.remaining * (t.price / r.entry) - r.remaining) * (r.pay === "SOL" ? SOL_USD : 0.0125) : s; }, 0);
  const realPnl = runsSoldAll.reduce((s, r) => s + r.exits.reduce((a, e) => a + e.pnlUsd, 0), 0);
  const total = livePnl + realPnl, up = total >= 0;
  const usd = (amt, payU) => amt * (payU === "SOL" ? SOL_USD : 0.0125);
  // bots-only capital: filled buy-ins + armed capital still waiting
  const buyInFilled = botRuns.reduce((s, r) => s + usd(r.amt, r.pay), 0);
  const buyInArmed = pend.filter((o) => o.side === "buy").reduce((s, o) => s + usd(o.amt, o.pay), 0);
  // realized in the last 24h = every exit any bot took in that window
  const realized24 = botRuns.reduce((s, r) => s + r.exits.filter((e) => Date.now() - e.ts < 86400e3).reduce((a, e) => a + e.pnlUsd, 0), 0);
  const bar = (hue, extra = {}) => ({ display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 9, marginBottom: 4, border: `1px solid ${accent(hue)}44`, background: "rgba(255,255,255,0.02)", fontFamily: T.mono, ...extra });
  return (
    <div>
      {/* overall bot PnL — its own bar above the bots */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", border: `1px solid ${up ? "rgba(22,199,132,0.45)" : "rgba(234,57,67,0.45)"}`, background: up ? "rgba(22,199,132,0.06)" : "rgba(234,57,67,0.06)", borderRadius: 10, padding: "10px 12px", marginBottom: 9 }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: 1.5, color: T.faint }}>⚡ OVERALL BOT PNL</span>
        <span style={{ textAlign: "right" }}>
          <span style={{ display: "block", fontFamily: T.mono, fontSize: 16, fontWeight: 900, color: up ? T.green : T.red }}>{up ? "+" : "−"}${Math.abs(total).toFixed(2)}</span>
          <span style={{ display: "block", fontFamily: T.mono, fontSize: 7.5, color: T.faint }}>
            BUY-IN ${buyInFilled.toLocaleString(undefined, { maximumFractionDigits: 0 })}{buyInArmed > 0 ? ` (+$${buyInArmed.toLocaleString(undefined, { maximumFractionDigits: 0 })} armed)` : ""}
          </span>
          <span style={{ display: "block", fontFamily: T.mono, fontSize: 7.5 }}>
            <span style={{ color: realized24 >= 0 ? T.green : T.red }}>REALIZED 24H {realized24 >= 0 ? "+" : "−"}${Math.abs(realized24).toFixed(2)}</span>
            <span style={{ color: T.faint }}> · </span>
            <span style={{ color: livePnl >= 0 ? T.green : T.red }}>UNREALIZED {livePnl >= 0 ? "+" : "−"}${Math.abs(livePnl).toFixed(2)}</span>
          </span>
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {[["live", `LIVE · ${pendAll.length + runsLiveAll.length}`], ["inactive", `INACTIVE · ${runsSoldAll.length}`], ["token", "THIS TOKEN"], ["site", "SITE-WIDE"]].map(([k, lab]) => (
          <button key={k} onClick={() => setView(k)} style={{ ...chip(view === k), flex: 1, textAlign: "center", padding: "6px 2px", fontSize: 8.5, fontWeight: 800 }}>{lab}</button>
        ))}
      </div>
      {runsLive.length > 0 && (
        <button onClick={() => onSellAll && onSellAll()} title="Sell every running bot's whole position right now"
          style={{ width: "100%", border: "none", borderRadius: 10, padding: "10px", marginBottom: 9,
            fontFamily: T.mono, fontSize: 11, fontWeight: 900, letterSpacing: 1,
            background: T.red, color: "#170808", cursor: "pointer", boxShadow: "0 0 14px rgba(234,57,67,0.35)" }}>
          ⛔ SELL ALL BOTS · {runsLive.length} LIVE · {livePnl >= 0 ? "+" : "−"}${Math.abs(livePnl).toFixed(2)}
        </button>
      )}
      {pend.length + runsLive.length + runsSold.length === 0 && (
        <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.faint, textAlign: "center", padding: 16 }}>No bots yet — arm one in the trader.</div>
      )}
      {runsLive.map((r) => { const t = tkOf(r.tokenId); if (!t) return null;
        const pnl = (r.remaining * (t.price / r.entry) - r.remaining) * (r.pay === "SOL" ? SOL_USD : 0.0125); const g = pnl >= 0;
        return (
          <div key={r.id} style={bar(t.hue, { border: `1px solid ${g ? "rgba(22,199,132,0.45)" : "rgba(234,57,67,0.45)"}` })}>
            <span style={{ fontSize: 8.5, fontWeight: 900, color: g ? T.green : T.red }}>LIVE</span>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue) }}>${t.sym}</span>
            <span style={{ fontSize: 9, color: T.text }}>{r.remaining} {r.pay} <span style={{ color: T.faint }}>in @</span> ${fmtP(r.entry)}</span>
            <span style={{ fontSize: 11, fontWeight: 900, color: g ? T.green : T.red, marginLeft: "auto" }}>{g ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
            <button onClick={() => onSellRun(r.id)} style={{ border: "none", borderRadius: 7, padding: "4px 10px", fontFamily: T.mono, fontSize: 9, fontWeight: 900, background: T.red, color: "#170808", cursor: "pointer" }}>SELL ALL</button>
          </div>
        ); })}
      {pend.map((o) => { const t = tkOf(o.tokenId); if (!t) return null;
        const isSellBot = o.side === "sell";
        return (
        <div key={o.id} onClick={() => onHighlight && onHighlight(o.id, o.tokenId)} title="Tap: highlight this bot's lines on the chart"
          style={{ ...bar(t.hue), flexWrap: "wrap" }}>
          <span style={{ fontSize: 10 }}>⏳</span>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue) }}>${t.sym}</span>
          <span style={{ fontSize: 9, color: T.text }}>{(Math.round(o.amt * 10) / 10).toFixed(1)} {o.pay} @ ${fmtP(o.level)}</span>
          <span style={{ fontSize: 8, color: T.amber, marginLeft: "auto" }}>{(Math.abs(t.price - o.level) / t.price * 100).toFixed(1)}% away</span>
          {/* instant line edit — the line jumps onto your cursor/finger, click or release locks it */}
          <button onClick={(e) => { e.stopPropagation(); onEditLine && onEditLine(o.id, o.tokenId); }}
            title="Instantly re-price this line — it follows your cursor until you click"
            style={{ ...chip(false), padding: "4px 8px", fontSize: 9, fontWeight: 900, color: isSellBot ? T.red : o.vt ? T.green : T.amber, borderColor: `${isSellBot ? T.red : o.vt ? T.green : T.amber}55` }}>
            ✎ {isSellBot ? "SELL LINE" : "BUY LINE"}
          </button>
          {o.vt && o.vtSell > 0 && (
            <button onClick={(e) => { e.stopPropagation(); onEditLine && onEditLine(o.id + "::vtSell", o.tokenId); }}
              title="Instantly re-price the exit point"
              style={{ ...chip(false), padding: "4px 8px", fontSize: 9, fontWeight: 900, color: T.red, borderColor: `${T.red}55` }}>✎ EXIT</button>
          )}
          <button onClick={(e) => { e.stopPropagation(); onEdit(o.id, o.tokenId); }} style={{ ...chip(false), padding: "4px 8px", fontSize: 9, fontWeight: 800 }}>Edit</button>
          <button onClick={(e) => { e.stopPropagation(); onCancel(o.id); }} style={{ ...chip(false), padding: "4px 8px", fontSize: 9, fontWeight: 800, color: T.red, borderColor: `${T.red}44` }}>✕</button>
        </div>
      ); })}
      {runsSold.map((r) => { const pnl = r.exits.reduce((s, e) => s + e.pnlUsd, 0); const g = pnl >= 0; return (
        <div key={r.id} onClick={() => onOpenBotRun(r.id)} title="Full stats" style={{ ...bar(r.hue, { cursor: "pointer" }), borderLeft: `2px solid ${T.amber}` }}>
          <span style={{ fontSize: 10 }}>🤖</span>
          <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(r.hue) }}>${r.sym}</span>
          <span style={{ fontSize: 8.5, color: T.dim }}>in @ ${fmtP(r.entry)} · {r.exits.length} exit{r.exits.length === 1 ? "" : "s"}</span>
          <span style={{ fontSize: 11, fontWeight: 900, color: g ? T.green : T.red, marginLeft: "auto" }}>{g ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
        </div>
      ); })}
    </div>
  );
}

function multParts(ratio) {
  const r = ratio || 0;
  if (r >= 1) {
    const stepped = Math.floor(r * 10) / 10;            // 0.1 increments
    return { value: stepped, label: stepped >= 10 ? `${Math.round(stepped)}×` : `${stepped.toFixed(1)}×`, up: true };
  }
  const down = r - 1;                                    // e.g. 0.997 → −0.003
  const digits = Math.abs(down) < 0.01 ? 3 : Math.abs(down) < 0.1 ? 3 : 2;
  return { value: down, label: `−${Math.abs(down).toFixed(digits)}×`, up: false };
}
function MultBadge({ mult, live, record, small }) {
  const { value, label, up } = multParts(mult);
  const hot = !up ? T.red : value >= 2 ? "#f0b90b" : T.green;
  const intensity = Math.min(1, Math.abs((mult || 0) - 1) / 4);
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minWidth: small ? 46 : 62, padding: small ? "3px 7px" : "6px 10px", borderRadius: 10,
      background: `${hot}22`, border: `1.5px solid ${hot}`,
      boxShadow: live ? `0 0 ${8 + intensity * 16}px ${hot}88` : "none",
      animation: live ? `multpulse ${Math.max(0.5, 1.4 - intensity)}s ease-in-out infinite` : "none" }}>
      <span style={{ fontFamily: T.mono, fontSize: small ? 11 : 16, fontWeight: 900, color: hot, lineHeight: 1, whiteSpace: "nowrap" }}>{label}</span>
      {!small && <span style={{ fontFamily: T.mono, fontSize: 7, color: T.faint, letterSpacing: 1 }}>{record ? "RECORD" : live ? "LIVE" : "MULT"}</span>}
    </div>
  );
}

// ---------------- portfolio panel (wallet + performance) ----------------
function pnlSeries(range, seed, unreal, realized) {
  // deterministic pseudo-random cumulative PnL curve for the chosen window
  const N = { "1H": 12, "1D": 24, "1W": 28, "1M": 30, "ALL": 40 }[range] || 24;
  const pts = [];
  let v = 0;
  let s = seed;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  for (let i = 0; i < N; i++) {
    v += (rand() - 0.42) * (range === "1H" ? 12 : range === "1D" ? 40 : 120);
    pts.push(v);
  }
  // normalize so the last point equals current total pnl
  const target = realized + unreal;
  const last = pts[pts.length - 1] || 1;
  const scale = last !== 0 ? target / last : 1;
  return pts.map((p) => p * scale);
}

function PortfolioPanel({ big, solBalance, valoWallet, positions, tokens, realizedPnl, unrealizedPnl, extraEquity = 0,
  tab, setTab, range, setRange, mode, setMode, seed, onDeposit, onWithdraw, onSwap,
  hideBalance, setHideBalance, heldSlot, maxDeposit = 0, maxWithdraw = 0, activity = [], onOpenToken,
  username, setUsername, isNameTaken,
  nameChangedAt = 0, setNameChangedAt,
  myCallouts = {}, onOpenMyCallouts,
  followersCount = 0, followingCount = 0, onOpenFollowList,
  pendingOrders = [], onEditBot, onCancelBot, botTokens = [], botHistory = [], onOpenBotRun,
  botsSlot = null,
  onPosTrade,
  epochLastHour = 0, epochTotalEarned = 0, valoUsdForEpoch = 0.0125, onOpenClaim }) {
  const bestCalloutPeak = Object.values(myCallouts).reduce((m, c) => Math.max(m, c.peak || 0), 0);
  const mask = (s) => (hideBalance ? "••••••" : s);
  // any movement anywhere on the site — manual, bots, exits — flashes the wallet
  const [balFlash, setBalFlash] = useState(0);
  const prevBalRef = useRef({ s: solBalance, v: valoWallet });
  useEffect(() => {
    const pv = prevBalRef.current;
    const dir = solBalance > pv.s + 1e-9 || valoWallet > pv.v + 1e-9 ? 1
      : solBalance < pv.s - 1e-9 || valoWallet < pv.v - 1e-9 ? -1 : 0;
    prevBalRef.current = { s: solBalance, v: valoWallet };
    if (!dir) return;
    setBalFlash(dir);
    const tm = setTimeout(() => setBalFlash(0), 750);
    return () => clearTimeout(tm);
  }, [solBalance, valoWallet]);
  const valoUsd = 0.0125; // API: live $VALO price
  const liveValue = Object.entries(positions).reduce((a, [id, p]) => {
    const t = tokens.find((x) => x.id === +id); if (!t || !p) return a;
    // TRUE USD: settlement units converted at their own rate — no unit mixing
    return a + p.amt * (t.price / p.entry) * (p.pay === "SOL" ? SOL_USD : valoUsd);
  }, 0);
  const walletUsd = solBalance * SOL_USD + valoWallet * valoUsd;
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalEquity = walletUsd + Math.max(0, liveValue) + (extraEquity || 0); // + live bots & escrowed arms
  const [swapAmt, setSwapAmt] = useState("1");
  const [swapDir, setSwapDir] = useState("sol2valo"); // sol2valo | valo2sol
  const [swapArmed, setSwapArmed] = useState(false);
  const [dwAmt, setDwAmt] = useState("");
  const [dwArmed, setDwArmed] = useState(null); // null | "deposit" | "withdraw"
  const [dwWarn, setDwWarn] = useState(""); // "Not Enough" style warnings
  const series = pnlSeries(range, seed, unrealizedPnl, realizedPnl);
  const gain = totalPnl >= 0;
  const [editingName, setEditingName] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false); // AUTO-TRADING collapsible
  const [nameDraft, setNameDraft] = useState(username || "");
  const [nameErr, setNameErr] = useState("");
  // one rename per week, for safety — API: enforce server-side too
  const NAME_LOCK_MS = 7 * 86400e3;
  const nameLocked = nameChangedAt && Date.now() - nameChangedAt < NAME_LOCK_MS;
  const nameLockLeft = () => {
    const ms = NAME_LOCK_MS - (Date.now() - nameChangedAt);
    const d = Math.floor(ms / 86400e3), h = Math.ceil((ms % 86400e3) / 3600e3);
    return d > 0 ? `${d}d ${h}h` : `${h}h`;
  };
  const tryEditName = () => {
    if (nameLocked) { setNameErr(`Once a week only — next change in ${nameLockLeft()}`); return; }
    setNameDraft(username); setNameErr(""); setEditingName(true);
  };
  const saveName = () => {
    const v = (nameDraft || "").trim().replace(/^@+/, "");
    if (v.length < 3) { setNameErr("Too short (3+ chars)"); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(v)) { setNameErr("Letters, numbers, _ only"); return; }
    if (v.toLowerCase() !== (username || "").toLowerCase() && isNameTaken && isNameTaken(v)) { setNameErr("That username is taken"); return; }
    setUsername && setUsername(v);
    if (v !== username) setNameChangedAt && setNameChangedAt(Date.now()); // starts the weekly lock
    setEditingName(false); setNameErr("");
  };

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
      {/* username row */}
      {username && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${VALO_PURPLE}, ${T.blue})`, display: "grid", placeItems: "center", fontFamily: T.mono, fontWeight: 800, fontSize: 12, color: "#0a0713", flexShrink: 0 }}>{(username[0] || "?").toUpperCase()}</span>
          {!editingName ? (
            <>
              <span onClick={tryEditName} title={nameLocked ? `Name changes are limited to once a week — next in ${nameLockLeft()}` : "Tap to change your username (once a week)"}
                style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 800, color: T.text, flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" }}>@{username}</span>
              <span style={{ flex: 1 }} />
              {/* highest callout tier — an insignia chip that sits flush in the
                  profile row, styled like the rest of the panel */}
              {bestCalloutPeak > 0 && (() => {
                const { tier } = calloutTier(bestCalloutPeak);
                return (
                  <button onClick={() => onOpenMyCallouts && onOpenMyCallouts()} title="Your callout history"
                    style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", flex: "0 0 auto",
                      border: "none", background: "transparent", padding: 0 }}>
                    {/* 38px keeps even the bull-tier halos (~+5px) inside the row & panel */}
                    <CalloutRing mult={bestCalloutPeak} size={38} />
                    <span style={{ textAlign: "left", lineHeight: 1.3 }}>
                      <span style={{ display: "block", fontFamily: T.mono, fontSize: 6.5, letterSpacing: 1.5, color: T.faint }}>BEST CALLOUT</span>
                      <span style={{ display: "block", fontFamily: T.mono, fontSize: 9.5, fontWeight: 800, letterSpacing: 0.5, color: tier.color }}>{tier.label}</span>
                    </span>
                  </button>
                );
              })()}
            </>
          ) : (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input autoFocus value={nameDraft} onChange={(e) => { setNameDraft(e.target.value); setNameErr(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setEditingName(false); }}
                  style={{ ...inp, flex: 1, padding: "6px 8px", fontSize: 12 }} />
                <button onClick={saveName} style={{ ...chip(false), padding: "5px 9px", fontSize: 10, background: "rgba(22,199,132,0.14)", color: T.green, borderColor: "rgba(22,199,132,0.4)" }}>save</button>
                <button onClick={() => { setEditingName(false); setNameErr(""); }} style={{ ...chip(false), padding: "5px 9px", fontSize: 10 }}>✕</button>
              </div>
              {nameErr && <div style={{ fontFamily: T.mono, fontSize: 9, color: T.red, marginTop: 4 }}>⚠ {nameErr}</div>}
              {!nameErr && <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, marginTop: 4 }}>shown when you chat · must be unique</div>}
            </div>
          )}
        </div>
      )}

      {/* weekly-lock timer notice — its own line, tap it to dismiss */}
      {nameErr && !editingName && (
        <div onClick={() => setNameErr("")} title="Tap to dismiss"
          style={{ fontFamily: T.mono, fontSize: 8.5, color: T.red, cursor: "pointer", margin: "-4px 0 8px", opacity: 0.9 }}>
          ⏳ {nameErr} · tap to dismiss
        </div>
      )}
      {/* social row — followers / following, both open the lists */}
      <div style={{ display: "flex", gap: 16, marginBottom: 10, fontFamily: T.mono, fontSize: 10.5 }}>
        <span onClick={() => onOpenFollowList && onOpenFollowList("followers")} style={{ cursor: "pointer", color: T.dim }}>
          <b style={{ color: T.text, fontSize: 12 }}>{followersCount}</b> Followers
        </span>
        <span onClick={() => onOpenFollowList && onOpenFollowList("following")} style={{ cursor: "pointer", color: T.dim }}>
          <b style={{ color: T.text, fontSize: 12 }}>{followingCount}</b> Following
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        {[["wallet", "💼 Wallet"], ["performance", "📈 Performance"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ ...chip(tab === k), flex: 1, textAlign: "center", padding: "7px", fontSize: 11 }}>{l}</button>
        ))}
      </div>

      {tab === "wallet" ? (
        <>
          {/* total equity + pnl + privacy eye */}
          <div style={{ textAlign: "center", marginBottom: 12, position: "relative" }}>
            <button onClick={() => setHideBalance && setHideBalance((v) => !v)} title="Hide/show balances"
              style={{ position: "absolute", right: 0, top: 0, ...chip(false), padding: "3px 8px", fontSize: 11 }}>
              {hideBalance ? "🙈" : "👁"}
            </button>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1 }}>TOTAL EQUITY</div>
            <div style={{ fontFamily: T.mono, fontSize: 26, fontWeight: 800,
              color: balFlash > 0 ? T.green : balFlash < 0 ? T.red : T.text,
              textShadow: balFlash ? `0 0 14px ${balFlash > 0 ? "rgba(22,199,132,0.7)" : "rgba(234,57,67,0.7)"}` : "none",
              transition: "color .25s ease, text-shadow .25s ease" }}>{mask(`$${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)}</div>
            <div style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: gain ? T.green : T.red }}>
              {mask(`${gain ? "▲ +" : "▼ −"}$${Math.abs(totalPnl).toFixed(2)} all-time PnL`)}
            </div>
          </div>
          {/* balance breakdown */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
            <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 9, padding: "8px 10px" }}>
              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>SOL BALANCE</div>
              <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700 }}>{mask(solBalance.toFixed(2))}</div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>{mask(`$${(solBalance * SOL_USD).toFixed(0)}`)}</div>
            </div>
            <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 9, padding: "8px 10px" }}>
              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: VALO_PURPLE }}>$VALO BALANCE</div>
              <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700 }}>{mask(Math.round(valoWallet).toLocaleString())}</div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>{mask(`$${(valoWallet * valoUsd).toFixed(0)}`)}</div>
            </div>
          </div>

          {/* epoch rewards banner — last hour + all-time earned + jump to claim */}
          <div style={{ background: "linear-gradient(120deg, rgba(240,185,11,0.08), rgba(125,92,240,0.06))", border: "1px solid rgba(240,185,11,0.3)", borderRadius: 10, padding: "10px 12px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 800, letterSpacing: 1, color: T.amber }}>🎁 EPOCH REWARDS</span>
              <button onClick={() => onOpenClaim && onOpenClaim()}
                style={{ ...chip(false), padding: "4px 10px", fontSize: 9.5, color: T.amber, borderColor: "rgba(240,185,11,0.4)", background: "rgba(240,185,11,0.1)" }}>Claim →</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>LAST HOUR</div>
                <div style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: T.green }}>{mask(`${epochLastHour.toFixed(3)}`)}</div>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>{mask(`$${(epochLastHour * valoUsdForEpoch).toFixed(2)} · $VALO`)}</div>
              </div>
              <div>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>TOTAL EARNED · all-time</div>
                <div style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: VALO_PURPLE }}>{mask(`${epochTotalEarned.toFixed(3)}`)}</div>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>{mask(`$${(epochTotalEarned * valoUsdForEpoch).toFixed(2)} · incl. withdrawn`)}</div>
              </div>
            </div>
          </div>
          <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 9, padding: "8px 10px", marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 10.5 }}>
              <span style={{ color: T.faint }}>IN LIVE TRADES · {fmtQty(Object.entries(positions || {}).reduce((s, [id, p]) => { const t = (tokens || []).find((x) => String(x.id) === String(id)); return t && p.amt > 0 ? s + posTokenQty(t, p) : s; }, 0))} tokens</span>
              <b style={{ color: T.text }}>{mask(`$${Math.max(0, liveValue * SOL_USD).toFixed(0)}`)}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 10.5, marginTop: 4 }}>
              <span style={{ color: T.faint }}>UNREALIZED</span>
              <b style={{ color: unrealizedPnl >= 0 ? T.green : T.red }}>{mask(`${unrealizedPnl >= 0 ? "+" : "−"}$${Math.abs(unrealizedPnl).toFixed(2)}`)}</b>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 10.5, marginTop: 4 }}>
              <span style={{ color: T.faint }}>REALIZED</span>
              <b style={{ color: realizedPnl >= 0 ? T.green : T.red }}>{mask(`${realizedPnl >= 0 ? "+" : "−"}$${Math.abs(realizedPnl).toFixed(2)}`)}</b>
            </div>
          </div>
      {botsSlot}
      {heldSlot}
          {/* deposit / withdraw — clicking fills the max you can do, then confirm */}
          <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 9, padding: 10, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1 }}>DEPOSIT / WITHDRAW</span>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>{mask(`≈ $${((parseFloat(dwAmt) || 0) * SOL_USD).toFixed(0)}`)}</span>
            </div>
            <input value={dwAmt} placeholder="0.00" onChange={(e) => { setDwAmt(e.target.value); setDwArmed(null); setDwWarn(""); }}
              style={{ ...inp, width: "100%", padding: "8px", fontSize: 13, textAlign: "center", marginBottom: 6 }} />
            {/* percentage quick-fills — of deposit max if arming deposit, else of your balance */}
            <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
              {[10, 25, 50, 75, 100].map((p) => (
                <button key={p} onClick={() => {
                  const base = dwArmed === "deposit" ? maxDeposit : maxWithdraw;
                  setDwAmt(String(+(base * p / 100).toFixed(3))); setDwWarn("");
                }}
                  style={{ ...chip(false), flex: 1, textAlign: "center", padding: "5px 0", fontSize: 9.5 }}>{p}%</button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 6, marginBottom: 8 }}>
              <button onClick={() => {
                if (maxDeposit < 0.001) { setDwWarn("Not enough to deposit"); setDwArmed(null); }
                else { setDwAmt(String(+maxDeposit.toFixed(3))); setDwArmed("deposit"); setDwWarn(""); }
              }}
                style={{ flex: 1, ...chip(dwArmed === "deposit"), padding: "5px 6px", fontSize: 8.5, textAlign: "center" }}>
                max deposit {mask(`${maxDeposit.toFixed(2)}`)}
              </button>
              <button onClick={() => {
                if (maxWithdraw < 0.001) { setDwWarn("Not enough to withdraw"); setDwArmed(null); }
                else { setDwAmt(String(+maxWithdraw.toFixed(3))); setDwArmed("withdraw"); setDwWarn(""); }
              }}
                style={{ flex: 1, ...chip(dwArmed === "withdraw"), padding: "5px 6px", fontSize: 8.5, textAlign: "center" }}>
                max withdraw {mask(`${maxWithdraw.toFixed(2)}`)}
              </button>
            </div>
            {dwWarn && <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 800, color: T.red, textAlign: "center", marginBottom: 8 }}>⚠ {dwWarn}</div>}
            {/* cancel appears above the buttons once a confirm is armed */}
            {dwArmed && (
              <button onClick={() => { setDwArmed(null); }}
                style={{ width: "100%", marginBottom: 8, border: `1px solid ${T.border2}`, borderRadius: 9, padding: "7px", fontFamily: T.mono, fontSize: 10, fontWeight: 700, background: "rgba(255,255,255,0.03)", color: T.dim, cursor: "pointer" }}>
                ✕ CANCEL
              </button>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => {
                if (dwArmed === "deposit") { onDeposit(Math.min(parseFloat(dwAmt) || 0, maxDeposit)); setDwArmed(null); setDwAmt(""); }
                else {
                  const want = parseFloat(dwAmt) > 0 ? parseFloat(dwAmt) : maxDeposit;
                  if (want < 0.001 || want > maxDeposit + 1e-9) { setDwWarn("Not enough to deposit"); return; }
                  setDwAmt(String(+want.toFixed(3))); setDwArmed("deposit"); setDwWarn("");
                }
              }}
                style={{ flex: 1, border: `1px solid ${T.green}`, borderRadius: 9, padding: "9px", fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, background: dwArmed === "deposit" ? T.green : "rgba(22,199,132,0.12)", color: dwArmed === "deposit" ? "#07130d" : T.green, cursor: "pointer", transition: "background .15s" }}>
                {dwArmed === "deposit" ? `✓ CONFIRM ${(Math.min(parseFloat(dwAmt) || 0, maxDeposit)).toFixed(2)}` : "↓ DEPOSIT"}
              </button>
              <button onClick={() => {
                if (dwArmed === "withdraw") { onWithdraw(Math.min(parseFloat(dwAmt) || 0, maxWithdraw)); setDwArmed(null); setDwAmt(""); }
                else {
                  const want = parseFloat(dwAmt) > 0 ? parseFloat(dwAmt) : maxWithdraw;
                  if (want < 0.001 || want > maxWithdraw + 1e-9) { setDwWarn("Not enough to withdraw"); return; }
                  setDwAmt(String(+want.toFixed(3))); setDwArmed("withdraw"); setDwWarn("");
                }
              }}
                style={{ flex: 1, border: `1px solid ${dwArmed === "withdraw" ? T.red : T.border2}`, borderRadius: 9, padding: "9px", fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, background: dwArmed === "withdraw" ? T.red : "rgba(255,255,255,0.03)", color: dwArmed === "withdraw" ? "#170808" : T.text, cursor: "pointer", transition: "background .15s" }}>
                {dwArmed === "withdraw" ? `✓ CONFIRM ${(Math.min(parseFloat(dwAmt) || 0, maxWithdraw)).toFixed(2)}` : "↑ WITHDRAW"}
              </button>
            </div>
            {dwArmed && <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, textAlign: "center", marginTop: 6 }}>click again to confirm {dwArmed}</div>}
          </div>
          {/* swap SOL ⇄ VALO, no site tax, flippable direction */}
          <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 9, padding: 10 }}>
            {(() => {
              const s2v = swapDir === "sol2valo";
              const fromUnit = s2v ? "SOL" : "$VALO";
              const toUnit = s2v ? "$VALO" : "SOL";
              const amt = parseFloat(swapAmt) || 0;
              // SOL→VALO: amt*SOL_USD/valoUsd ; VALO→SOL: amt*valoUsd/SOL_USD
              const out = s2v ? (amt * SOL_USD) / valoUsd : (amt * valoUsd) / SOL_USD;
              return (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 7 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1 }}>⇄ SWAP · {fromUnit} → {toUnit} · <span style={{ color: T.green }}>0% tax</span></span>
                    <button onClick={() => { setSwapDir(s2v ? "valo2sol" : "sol2valo"); setSwapArmed(false); }} title="Flip direction"
                      style={{ ...chip(false), padding: "2px 8px", fontSize: 11 }}>⇅ flip</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input value={swapAmt} onChange={(e) => { setSwapAmt(e.target.value); setSwapArmed(false); }}
                      style={{ ...inp, flex: 1, padding: "8px", fontSize: 13, textAlign: "center" }} />
                    <button onClick={() => { setSwapAmt(String(s2v ? +solBalance.toFixed(3) : Math.floor(valoWallet))); setSwapArmed(false); }}
                      style={{ ...chip(false), padding: "6px 8px", fontSize: 9.5 }}>MAX {fromUnit.replace("$", "")}</button>
                    <span style={{ fontFamily: T.mono, fontSize: 11, color: s2v ? T.faint : VALO_PURPLE, minWidth: 40 }}>{fromUnit}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", margin: "6px 0" }}>
                    <button onClick={() => { setSwapDir(s2v ? "valo2sol" : "sol2valo"); setSwapArmed(false); }}
                      title="Tap to swap direction"
                      style={{ border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.05)", borderRadius: 8, color: VALO_PURPLE, cursor: "pointer", fontSize: 15, padding: "3px 10px", fontWeight: 800 }}>⇅</button>
                    <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: s2v ? VALO_PURPLE : T.text }}>
                      {out.toLocaleString(undefined, { maximumFractionDigits: s2v ? 0 : 3 })}
                    </span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{toUnit}</span>
                  </div>
                  <button onClick={() => {
                    if (swapArmed) { onSwap(amt, swapDir); setSwapArmed(false); }
                    else setSwapArmed(true);
                  }}
                    style={{ width: "100%", marginTop: 8, border: "none", borderRadius: 8, padding: "9px", fontFamily: T.mono, fontSize: 11, fontWeight: 800, background: swapArmed ? T.green : VALO_PURPLE, color: swapArmed ? "#07130d" : "#0a0713", cursor: "pointer", transition: "background .15s" }}>
                    {swapArmed ? "✓ CONFIRM SWAP" : "SWAP TAX-FREE"}
                  </button>
                  {swapArmed && <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, textAlign: "center", marginTop: 5 }}>click again to confirm</div>}
                </>
              );
            })()}
          </div>

          {/* bot trades — sold auto-bots live here, not in the Live P/L box */}
          {(botHistory || []).length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1, marginBottom: 7 }}>🤖 BOT TRADES · tap for full stats</div>
              <div style={{ display: "grid", gap: 5, maxHeight: 160, overflowY: "auto" }}>
                {botHistory.map((r) => {
                  const pnl = r.exits.reduce((s, e) => s + e.pnlUsd, 0);
                  const up = pnl >= 0;
                  return (
                    <div key={r.id} onClick={() => onOpenBotRun && onOpenBotRun(r.id)} title="Open bot trade stats"
                      style={{ display: "flex", alignItems: "center", gap: 8, background: "#0c0f16", border: `1px solid ${up ? "rgba(22,199,132,0.35)" : "rgba(234,57,67,0.35)"}`, borderLeft: `2px solid ${T.amber}`, borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}>
                      <span style={{ fontSize: 10 }}>🤖</span>
                      <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: accent(r.hue) }}>${r.sym}</span>
                      <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>in @ ${fmtP(r.entry)} · {r.exits.length} exit{r.exits.length === 1 ? "" : "s"}</span>
                      <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 900, color: up ? T.green : T.red, marginLeft: "auto" }}>{up ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {/* activity feed — token, amount, PnL if sold, all on one bar, solscan link */}
          <div style={{ marginTop: 10 }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1, marginBottom: 7 }}>📜 ACTIVITY</div>
            {activity.length === 0 ? (
              <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, textAlign: "center", padding: "12px 0", border: `1px dashed ${T.border}`, borderRadius: 9 }}>No trades yet — your buys & sells show here.</div>
            ) : (
              <div style={{ display: "grid", gap: 5, maxHeight: 240, overflowY: "auto" }}>
                {activity.map((a) => {
                  const gain = a.pnlMoney != null && a.pnlMoney >= 0;
                  return (
                    <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#0c0f16", border: `1px solid ${T.border}`, borderLeft: `2px solid ${a.side === "buy" ? T.green : T.red}`, borderRadius: 8, padding: "7px 9px" }}>
                      <span onClick={() => onOpenToken && onOpenToken(a.sym)} style={{ cursor: onOpenToken ? "pointer" : "default", flexShrink: 0 }}>
                        <TokenAvatar sym={a.sym} hue={a.hue} img={a.img} size={20} />
                      </span>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: a.side === "buy" ? T.green : T.red }}>
                          {a.side === "buy" ? "BUY" : "SELL"} <span style={{ color: T.text }}>{a.sym}</span>
                        </div>
                        <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>{mask(`${a.amt} ${a.unit}`)} · {new Date(a.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                      {a.mult != null && <MultBadge mult={a.mult} small />}
                      {a.pnlMoney != null && (
                        <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: gain ? T.green : T.red, flexShrink: 0 }}>
                          {mask(`${gain ? "+" : "−"}$${Math.abs(a.pnlMoney * SOL_USD).toFixed(2)}`)}
                        </span>
                      )}
                      <a href={`https://solscan.io/tx/${a.tx}`} target="_blank" rel="noopener noreferrer" title="View on Solscan"
                        style={{ flexShrink: 0, textDecoration: "none", color: T.blue, fontSize: 12 }}>🔗</a>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          {/* performance chart */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>PnL · {range}</div>
              <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 800, color: gain ? T.green : T.red }}>
                {gain ? "+" : "−"}${Math.abs(series[series.length - 1] || 0).toFixed(2)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {["line", "bars"].map((m) => (
                <button key={m} onClick={() => setMode(m)} style={{ ...chip(mode === m), padding: "4px 8px", fontSize: 10 }}>{m === "line" ? "∿" : "▮"}</button>
              ))}
            </div>
          </div>
          <PerfChart series={series} mode={mode} height={big ? 190 : 130} />
          <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
            {["1H", "1D", "1W", "1M", "ALL"].map((r) => (
              <button key={r} onClick={() => setRange(r)} style={{ ...chip(range === r), flex: 1, textAlign: "center", padding: "5px 0", fontSize: 10 }}>{r}</button>
            ))}
          </div>

          {/* period summary — PnL for the selected duration, updates over time */}
          {(() => {
            const first = series[0] || 0;
            const last = series[series.length - 1] || 0;
            const periodPnl = last - first;
            const pg = periodPnl >= 0;
            const winMs = { "1H": 3600e3, "1D": 864e5, "1W": 6048e5, "1M": 2592e6, "ALL": Infinity }[range];
            const since = Date.now() - winMs;
            const inRange = (activity || []).filter((a) => range === "ALL" || a.t >= since);
            const sells = inRange.filter((a) => a.pnlMoney != null);
            const realizedUsd = sells.reduce((s, a) => s + a.pnlMoney * SOL_USD, 0);
            return (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
                  <div style={{ background: "#0c0f16", border: `1px solid ${pg ? "rgba(22,199,132,0.3)" : "rgba(234,57,67,0.3)"}`, borderRadius: 9, padding: "9px 11px" }}>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>PnL · {range}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 17, fontWeight: 800, color: pg ? T.green : T.red }}>{mask(`${pg ? "+" : "−"}$${Math.abs(periodPnl).toFixed(2)}`)}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>gain/loss this period</div>
                  </div>
                  <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 9, padding: "9px 11px" }}>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>REALIZED · {range}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 17, fontWeight: 800, color: realizedUsd >= 0 ? T.green : T.red }}>{mask(`${realizedUsd >= 0 ? "+" : "−"}$${Math.abs(realizedUsd).toFixed(2)}`)}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>{sells.length} closed · {inRange.length} trades</div>
                  </div>
                </div>

                {/* trades in this window — each clickable, opens that coin's chart locked on this marker */}
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1, margin: "12px 0 7px" }}>📊 TRADES · {range}</div>
                {inRange.length === 0 ? (
                  <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, textAlign: "center", padding: "12px 0", border: `1px dashed ${T.border}`, borderRadius: 9 }}>No trades in this window.</div>
                ) : (
                  <div style={{ display: "grid", gap: 5, maxHeight: 260, overflowY: "auto" }}>
                    {inRange.map((a) => {
                      const g = a.pnlMoney != null && a.pnlMoney >= 0;
                      return (
                        <div key={a.id} onClick={() => onOpenToken && onOpenToken(a.sym, a)}
                          style={{ display: "flex", alignItems: "center", gap: 8, background: "#0c0f16", border: `1px solid ${T.border}`, borderLeft: `2px solid ${a.side === "buy" ? T.green : T.red}`, borderRadius: 8, padding: "7px 9px", cursor: "pointer" }}>
                          <TokenAvatar sym={a.sym} hue={a.hue} img={a.img} size={20} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: a.side === "buy" ? T.green : T.red }}>
                              {a.side === "buy" ? "BUY" : "SELL"} <span style={{ color: T.text }}>{a.sym}</span>
                            </div>
                            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>{mask(`${a.amt} ${a.unit}`)} · {new Date(a.t).toLocaleDateString([], { month: "short", day: "numeric" })} {new Date(a.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                          </div>
                          {a.mult != null && <MultBadge mult={a.mult} small />}
                          {a.pnlMoney != null && (
                            <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: g ? T.green : T.red, flexShrink: 0 }}>{mask(`${g ? "+" : "−"}$${Math.abs(a.pnlMoney * SOL_USD).toFixed(2)}`)}</span>
                          )}
                          <span style={{ fontFamily: T.mono, fontSize: 9, color: T.blue, flexShrink: 0 }}>open →</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}
          <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, marginTop: 10, textAlign: "center" }}>
            Your platform profit over the selected window
          </div>
        </>
      )}
    </div>
  );
}

function PerfChart({ series, mode, height = 130 }) {
  const ref = useRef(null);
  const [hover, setHover] = useState(null); // {i, x, y, v}
  const geomRef = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = height;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!series.length) return;
    const lo = Math.min(0, ...series), hi = Math.max(0, ...series);
    const rng = (hi - lo) || 1;
    const x = (i) => (i / (series.length - 1)) * (W - 8) + 4;
    const y = (v) => H - 8 - ((v - lo) / rng) * (H - 16);
    geomRef.current = { x, y, W, H };
    ctx.strokeStyle = "rgba(255,255,255,0.08)"; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(W, y(0)); ctx.stroke(); ctx.setLineDash([]);
    const end = series[series.length - 1];
    const col = end >= 0 ? "#16c784" : "#ea3943";
    if (mode === "bars") {
      const bw = Math.max(2, (W / series.length) * 0.6);
      series.forEach((v, i) => {
        ctx.fillStyle = v >= 0 ? "rgba(22,199,132,0.8)" : "rgba(234,57,67,0.8)";
        const yy = y(v), y0 = y(0);
        ctx.fillRect(x(i) - bw / 2, Math.min(yy, y0), bw, Math.max(1, Math.abs(yy - y0)));
      });
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, end >= 0 ? "rgba(22,199,132,0.28)" : "rgba(234,57,67,0.28)");
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      series.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.lineTo(x(series.length - 1), y(0)); ctx.lineTo(x(0), y(0)); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath();
      series.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
      ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    }
    // crosshair at hovered point
    if (hover) {
      ctx.strokeStyle = "rgba(255,255,255,0.25)"; ctx.beginPath();
      ctx.moveTo(hover.x, 4); ctx.lineTo(hover.x, H - 4); ctx.stroke();
      ctx.fillStyle = hover.v >= 0 ? "#16c784" : "#ea3943";
      ctx.beginPath(); ctx.arc(hover.x, hover.y, 4, 0, 7); ctx.fill();
      ctx.strokeStyle = "#0a0d13"; ctx.lineWidth = 1.5; ctx.stroke();
    }
  }, [series, mode, hover, height]);

  const onMove = (e) => {
    const g = geomRef.current; if (!g) return;
    const rect = ref.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const cx = clientX - rect.left;
    const i = Math.max(0, Math.min(series.length - 1, Math.round(((cx - 4) / (g.W - 8)) * (series.length - 1))));
    setHover({ i, x: g.x(i), y: g.y(series[i]), v: series[i] });
  };
  return (
    <div style={{ position: "relative" }}>
      <canvas ref={ref} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
        onTouchStart={onMove} onTouchMove={(e) => { onMove(e); }} onTouchEnd={() => setHover(null)}
        style={{ width: "100%", height, display: "block", cursor: "crosshair", touchAction: "none" }} />
      {hover && (
        <div style={{ position: "absolute", top: 2, left: Math.min(Math.max(hover.x - 44, 0), (geomRef.current?.W || 200) - 92),
          background: "rgba(10,13,19,0.95)", border: `1px solid ${hover.v >= 0 ? T.green : T.red}`, borderRadius: 7, padding: "3px 7px", pointerEvents: "none", fontFamily: T.mono }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: hover.v >= 0 ? T.green : T.red }}>{hover.v >= 0 ? "+" : "−"}${Math.abs(hover.v).toFixed(2)}</div>
          {hover.i > 0 && (() => { const d = series[hover.i] - series[hover.i - 1]; return (
            <div style={{ fontSize: 8, color: d >= 0 ? T.green : T.red }}>{d >= 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(2)} vs prev</div>
          ); })()}
          <div style={{ fontSize: 8, color: T.faint }}>pt {hover.i + 1}/{series.length}</div>
        </div>
      )}
    </div>
  );
}

// ---------------- scanner card ----------------
// token picture — uses the real token image once metadata resolves,
// falls back to a deterministic gradient identicon until it does.
function TokenAvatar({ sym, hue, img, size = 22 }) {
  const [ok, setOk] = useState(!!img);
  useEffect(() => { setOk(!!img); }, [img]);
  if (img && ok) {
    return (
      <img src={img} alt={sym} onError={() => setOk(false)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0,
          border: `1px solid hsla(${hue},70%,60%,0.6)`, boxShadow: `0 0 8px hsla(${hue},70%,50%,0.5)` }} />
    );
  }
  const h2 = (hue + 40) % 360;
  return (
    <span style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: `conic-gradient(from 140deg, ${accent(hue, 55)}, ${accent(h2, 45)}, ${accent(hue, 60)})`,
      display: "grid", placeItems: "center", color: "#0a0d13", fontWeight: 900,
      fontSize: size * 0.5, fontFamily: T.sans,
      boxShadow: `0 0 8px hsla(${hue},70%,50%,0.5)`, border: `1px solid hsla(${hue},70%,60%,0.6)`,
    }}>
      {sym[0]}
    </span>
  );
}

// semi-transparent chart mirroring the token's real candles, riding the card's
// bottom border. Uses the SAME 15m aggregation + recent window the main chart
// opens with, so what you see on the card is what you get when you tap in.
function CardMiniChart({ candles, hue, mode, tfMin = 15, count = 90, full = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const W = c.clientWidth, H = c.clientHeight;
    c.width = W * dpr; c.height = H * dpr;
    const ctx = c.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // relay the exact live view of the main chart: same timeframe + recent window
    const agg = aggregate(candles, tfMin);
    const data = agg.slice(-count);
    if (data.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const d of data) { lo = Math.min(lo, d.l); hi = Math.max(hi, d.h); }
    const pad = (hi - lo) * 0.12 || hi * 0.02; lo -= pad; hi += pad;
    const rng = (hi - lo) || 1;
    const x = (i) => (i / (data.length - 1)) * W;
    const y = (p) => H - ((p - lo) / rng) * (H - 6) - 3;

    if (mode === "bars") {
      const bw = Math.max(1.4, (W / data.length) * 0.66);
      data.forEach((d, i) => {
        const up = d.c >= d.o;
        ctx.strokeStyle = up ? "rgba(22,199,132,0.5)" : "rgba(234,57,67,0.5)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x(i), y(d.h)); ctx.lineTo(x(i), y(d.l)); ctx.stroke();
        ctx.fillStyle = up ? "rgba(22,199,132,0.9)" : "rgba(234,57,67,0.85)";
        const yo = y(d.o), yc = y(d.c);
        ctx.fillRect(x(i) - bw / 2, Math.min(yo, yc), bw, Math.max(1, Math.abs(yc - yo)));
      });
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsla(${hue},82%,62%,0.35)`);
      g.addColorStop(1, `hsla(${hue},82%,62%,0)`);
      ctx.beginPath();
      data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.c)) : ctx.moveTo(x(i), y(d.c))));
      ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
      ctx.fillStyle = g; ctx.fill();
      ctx.beginPath();
      data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.c)) : ctx.moveTo(x(i), y(d.c))));
      ctx.strokeStyle = `hsla(${hue},82%,64%,0.9)`; ctx.lineWidth = 1.4; ctx.stroke();
      ctx.beginPath();
      data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.h)) : ctx.moveTo(x(i), y(d.h))));
      ctx.strokeStyle = `hsla(${hue},82%,70%,0.18)`; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.beginPath();
      data.forEach((d, i) => (i ? ctx.lineTo(x(i), y(d.l)) : ctx.moveTo(x(i), y(d.l))));
      ctx.stroke();
    }
  }, [candles, hue, mode, tfMin, count, full]);
  return <canvas ref={ref} style={{ width: full ? "100%" : "128%", height: full ? "100%" : 52, display: "block" }} />;
}

function TokenCard({ t, active, onOpen, calloutCount = 0, miniMode = "line", tf = 15 }) {
  const score = scoreToken(t);
  const rc = ratingColor(score);
  const net = t.greenUsd - t.redUsd;
  const cs = calloutStyle(calloutCount);
  return (
    <div onClick={onOpen} className="token-card" style={{
      border: `1px solid ${active ? accent(t.hue, 45) : T.border}`,
      background: cardGrad(t.hue), borderRadius: 18, padding: "14px 18px 0", cursor: "pointer",
      boxShadow: active ? `0 0 0 1px ${accent(t.hue, 45)}` : "none", transition: "border-color .2s",
      position: "relative", overflow: "hidden",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <TokenAvatar sym={t.sym} hue={t.hue} img={t.img} size={20} />
            <span style={{ fontWeight: 800, fontSize: 14 }}>{t.sym}</span>
            {t.isNew && <span style={{ fontSize: 8, background: T.amber, color: "#1a1508", padding: "1px 5px", borderRadius: 4, fontWeight: 800 }}>NEW</span>}
            <span style={{ fontSize: 8, border: `1px solid ${T.border2}`, color: T.dim, padding: "1px 5px", borderRadius: 4, fontFamily: T.mono }}>
              {t.chain === "pump" ? "PUMP" : "RBHD"}
            </span>
            <span title={`${calloutCount} community callouts`} style={{
              fontSize: 8.5, fontFamily: T.mono, fontWeight: 800, padding: "1.5px 7px", borderRadius: 10,
              color: cs.color, background: cs.bg,
              border: `1.4px solid ${cs.border}`,
              boxShadow: cs.gold ? "0 0 10px rgba(231,185,60,0.45), inset 0 0 6px rgba(231,185,60,0.18)" : "none",
            }}>
              📣 {calloutCount}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 5, fontFamily: T.mono, fontSize: 10.5, flexWrap: "wrap" }}>
            <span style={{ color: T.text, fontWeight: 700 }}>${fmtP(t.price)}</span>
            <span style={{ color: T.dim }}>MC {fmt$(mcOf(t))}</span>
            <span style={{ color: T.dim }}>TVL {fmt$(t.tvl)}</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 3, fontFamily: T.mono, fontSize: 9.5 }}>
            <span style={{ color: T.green }}>▲{fmt$(t.greenUsd)}</span>
            <span style={{ color: T.red }}>▼{fmt$(t.redUsd)}</span>
            <span style={{ color: net >= 0 ? T.green : T.red, fontWeight: 700 }}>{net >= 0 ? "+" : "−"}{fmt$(Math.abs(net))}</span>
          </div>
        </div>
        <div style={{ border: `1px solid ${rc}55`, background: `${rc}14`, borderRadius: 8, padding: "5px 9px", textAlign: "center", alignSelf: "center", minWidth: 50 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: rc, fontFamily: T.mono, lineHeight: 1 }}>{score}</div>
          <div style={{ fontSize: 7, letterSpacing: 1.5, color: rc, fontWeight: 800, marginTop: 2 }}>{rating(score)}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 8 }}>
        <Meter label="MOMENTUM" value={Math.round(t.momentum)} color={accent(t.hue)} />
        <Meter label="B/S PRESSURE" value={Math.round(t.buyPressure)} color={t.buyPressure >= 50 ? T.green : T.red} />
      </div>
      {/* mirrored chart riding the bottom border, clipped by the card */}
      <div style={{ marginTop: 8, marginLeft: -14, marginRight: -14, marginBottom: 0, opacity: 0.9, pointerEvents: "none", borderBottomLeftRadius: 12, borderBottomRightRadius: 12, overflow: "hidden" }}>
        <CardMiniChart candles={t.candles} hue={t.hue} mode={miniMode} tfMin={tf} count={90} />
      </div>
    </div>
  );
}

// compact token card (mobile collapsed list) — same info, longer format, with
// a momentum + B/S pressure meter strip squeezed underneath each row
function TokenRow({ t, active, onOpen, calloutCount = 0, tf = 15 }) {
  const score = scoreToken(t);
  const rc = ratingColor(score);
  const cs = calloutStyle(calloutCount);
  const mc = mcOf(t);
  return (
    <div onClick={onOpen} className="token-card" style={{
      border: `1px solid ${active ? accent(t.hue, 45) : T.border}`,
      background: cardGrad(t.hue), borderRadius: 12, padding: "8px 10px", cursor: "pointer",
      boxShadow: active ? `0 0 0 1px ${accent(t.hue, 45)}` : "none", transition: "border-color .2s",
      position: "relative", overflow: "hidden",
    }}>
      {/* live token chart as a faint transparent background */}
      <div style={{ position: "absolute", inset: 0, opacity: 0.42, pointerEvents: "none", zIndex: 0 }}>
        <CardMiniChart candles={t.candles} hue={t.hue} mode="line" tfMin={tf} count={90} full />
      </div>
      {/* readability veil over the chart so text stays crisp */}
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(90deg, rgba(11,14,22,0.6), rgba(11,14,22,0.2))", pointerEvents: "none", zIndex: 0 }} />

      <div style={{ position: "relative", zIndex: 1 }}>
      {/* top line: avatar · name/price · MC/flow · score */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <TokenAvatar sym={t.sym} hue={t.hue} img={t.img} size={28} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 800, color: T.text }}>{t.sym}</span>
            {calloutCount > 0 && <span style={{ fontSize: 8, color: cs.color }}>📣{calloutCount}</span>}
          </div>
          <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.faint }}>${fmtP(t.price)}</div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.dim }}>MC {fmt$(mc)}</div>
          <div style={{ fontFamily: T.mono, fontSize: 9 }}>
            <span style={{ color: T.green }}>▲{fmt$(t.greenUsd)}</span> <span style={{ color: T.red }}>▼{fmt$(t.redUsd)}</span>
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "center", background: `${rc}18`, border: `1px solid ${rc}`, borderRadius: 7, padding: "2px 6px", minWidth: 30 }}>
          <div style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 800, color: rc }}>{score}</div>
        </div>
      </div>

      {/* meters strip squeezed underneath — momentum + B/S pressure moving bars */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 7 }}>
        <Meter label="MOM" value={Math.round(t.momentum)} color={accent(t.hue)} />
        <Meter label="B/S" value={Math.round(t.buyPressure)} color={t.buyPressure >= 50 ? T.green : T.red} />
      </div>
      </div>
    </div>
  );
}

// ================================================================
// APP
// ================================================================
// Full-screen mobile view. Chart fills everything. No pull bars — grab the top
// header area (where the token name/price sits) and drag down to exit. A chat
// button lets you pop the chat drawer open while trading.
function MobileExpanded({ onClose, chartBlock, tradeStrip, ticketBlock, sym, onChat }) {
  const [dragY, setDragY] = useState(0);
  const drag = useRef(null);
  const [chartAdjust, setChartAdjust] = useState(0); // px: + grows chart (drag down), − shrinks (drag up)
  const pullRef = useRef(null);
  const lastTap = useRef(0);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const H = typeof window !== "undefined" ? window.innerHeight : 800;
  const dismissAt = H * 0.22; // very easy escape

  const onDown = (e) => { drag.current = { y0: e.touches ? e.touches[0].clientY : e.clientY, moved: false }; };
  const onMove = (e) => {
    if (!drag.current) return;
    const y = e.touches ? e.touches[0].clientY : e.clientY;
    const dy = Math.max(0, y - drag.current.y0);
    if (dy > 3) drag.current.moved = true;
    setDragY(dy);
  };
  const onUp = () => {
    if (!drag.current) return;
    const close = dragY >= dismissAt || (drag.current.moved && dragY > 45);
    drag.current = null;
    if (close) onClose();
    setDragY(0);
  };

  // ---- generous corner gesture: start anywhere in the top-left region (down to
  // roughly the buy/sell bar) and flick DOWN, RIGHT, or DOWN-RIGHT to go back.
  // Armed from the scroll container itself, so normal taps/scrolls still work.
  const zone = useRef(null);
  const W = typeof window !== "undefined" ? window.innerWidth : 400;
  const inCorner = (x, y) => x < W * 0.55 && y < H * 0.62;
  const zoneStart = (e) => {
    const t = e.touches[0];
    const sc = e.currentTarget;
    zone.current = inCorner(t.clientX, t.clientY)
      ? { x0: t.clientX, y0: t.clientY, t0: Date.now(), top: sc.scrollTop <= 2, fired: false }
      : null;
  };
  const zoneMove = (e) => {
    const z = zone.current; if (!z) return;
    const t = e.touches[0];
    const dx = t.clientX - z.x0, dy = t.clientY - z.y0;
    // rightward always allowed; downward only when already scrolled to the top
    const useX = dx > 0 ? dx : 0;
    const useY = dy > 0 && z.top ? dy : 0;
    if (useX < 6 && useY < 6) return;
    const d = useY + useX * 0.7;
    z.fired = true;
    setDragY(d);
  };
  const zoneEnd = () => {
    const z = zone.current; if (!z) { return; }
    zone.current = null;
    if (!z.fired) return;
    const quick = Date.now() - z.t0 < 320 && dragY > 34;   // flick
    if (quick || dragY >= dismissAt) { onClose(); }
    setDragY(0);
  };

  const progress = Math.min(1, dragY / dismissAt);

  return (
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 44, background: "rgba(4,6,10,0.5)", opacity: 1 - progress, pointerEvents: "none" }} />

      <div style={{
        position: "fixed", inset: 0, zIndex: 45, background: T.bg,
        display: "flex", flexDirection: "column", overscrollBehavior: "contain",
        transform: `translateY(${dragY}px)`,
        transition: drag.current ? "none" : "transform .28s cubic-bezier(.22,.8,.3,1)",
        opacity: 1 - progress * 0.22,
      }}>
        {/* scrollable content fills the whole screen — chart scrolls away so the
            auto-trade options below are fully visible when you scroll down */}
        <div onTouchStart={zoneStart} onTouchMove={zoneMove} onTouchEnd={zoneEnd} onTouchCancel={zoneEnd}
          style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "0 8px", WebkitOverflowScrolling: "touch", position: "relative" }}>
          {/* EXIT + drag-catch are fixed to the viewport so they're always reachable */}
          <div onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onDoubleClick={(e) => {
          const bs = botSetRef.current; if (!bs.on || !bs.arm) return;
          const { cx, cy } = ptOf(e); const g = geom.current;
          if (!g.idxOf || cy < g.padT || cy > g.padT + g.chartH || cx > g.plotW) return;
          bs.arm(priceAtY(cy)); // set as many as you like — no ARM press needed
        }} onMouseLeave={onUp}
            style={{ position: "fixed", top: 0, left: 0, right: 0, height: 44, zIndex: 47, touchAction: "none", cursor: "grab" }} />
          <button onClick={onClose} aria-label="Back to tokens"
            style={{ position: "fixed", top: 6, left: 8, zIndex: 48, width: 24, height: 24, display: "grid", placeItems: "center",
              border: `1px solid rgba(255,255,255,0.14)`, borderRadius: 7, background: "rgba(17,21,29,0.45)", backdropFilter: "blur(3px)",
              color: T.dim, fontFamily: T.mono, fontSize: 11, fontWeight: 700, padding: 0, cursor: "pointer", opacity: 0.6 }}>
            ✕
          </button>
          <div style={{ paddingTop: 4 }}>
            <div style={{ height: chartAdjust !== 0 ? undefined : undefined }}>
              {chartBlock}
            </div>
          </div>

          {/* retractable pull handle — drag DOWN to grow chart / push trades down,
              drag UP to shrink chart / pull trades up. Double-tap to reset. */}
          <div
            onTouchStart={(e) => { pullRef.current = { y0: e.touches[0].clientY, base: chartAdjust, moved: false }; }}
            onTouchMove={(e) => {
              if (!pullRef.current) return;
              const dy = e.touches[0].clientY - pullRef.current.y0;
              if (Math.abs(dy) > 3) pullRef.current.moved = true;
              setChartAdjust(Math.max(-220, Math.min(260, pullRef.current.base + dy)));
            }}
            onTouchEnd={() => {
              const now = Date.now();
              if (pullRef.current && !pullRef.current.moved) {
                if (now - lastTap.current < 350) setChartAdjust(0); // double-tap resets
                lastTap.current = now;
              }
              pullRef.current = null;
            }}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "8px 0", margin: "4px 0", cursor: "grab", touchAction: "none", userSelect: "none" }}>
            <span style={{ height: 4, width: 46, borderRadius: 2, background: T.border2 }} />
            <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1 }}>
              {chartAdjust > 4 ? "▼ chart" : chartAdjust < -4 ? "▲ trades" : "⇕ drag · 2-tap reset"}
            </span>
            <span style={{ height: 4, width: 46, borderRadius: 2, background: T.border2 }} />
          </div>

          {/* chart-height spacer: dragging down adds space (grows chart area feel),
              dragging up removes it (pulls trades up). */}
          {chartAdjust > 0 && <div style={{ height: chartAdjust }} />}
          <div style={{ marginTop: 8, paddingBottom: 12, transform: chartAdjust < 0 ? `translateY(${chartAdjust}px)` : "none" }}>
            {ticketBlock}
          </div>
        </div>

        <div style={{ flexShrink: 0, padding: "8px 10px calc(8px + env(safe-area-inset-bottom))", borderTop: `1px solid ${T.border2}`, background: "rgba(14,18,26,0.98)" }}>
          {tradeStrip}
        </div>
      </div>
    </>
  );
}

// ---------------- interactive whitepaper reader ----------------
const WP_SECTIONS = [
  { id: "abstract", icon: "📄", n: "", title: "Abstract", accent: "#7D5CF0", body: [
    { t: "p", x: "VALO Terminal is a Solana-native trading terminal built around the $VALO token, launched on pump.fun. It brings together four systems that reinforce one another: an on-chain token scanner with live charts and risk scoring, a non-custodial automated trading engine, a fee-funded buy-and-burn program, and an hourly holder airdrop with a loyalty multiplier." },
    { t: "note", x: "This build is a simulated environment. Prices, balances, and payouts are illustrative; interfaces marked for live wiring connect to real Solana data before mainnet. Nothing here is financial advice." },
  ]},
  { id: "intro", icon: "🚀", n: "1", title: "Introduction", accent: "#4C9AFF", body: [
    { t: "p", x: "Meme-coin trading on Solana is fast, social, and scattered across a scanner in one tab, a chart in another, an aggregator in a third, and a spreadsheet to track the book. Rewards, when they exist, are opaque and rarely favor holders." },
    { t: "p", x: "VALO collapses that workflow into one screen and aligns incentives with holders. The platform earns fees, and a fixed share of every fee is programmatically burned or handed back to holders every hour. The longer a holder lets rewards ride, the larger their multiplier." },
    { t: "h", x: "Design principles" },
    { t: "b", x: "Non-custodial — users trade from their own wallets." },
    { t: "b", x: "Transparent — every fee split is fixed, published, and shown live." },
    { t: "b", x: "Holder-first — burns cut supply; the airdrop returns value hourly." },
    { t: "b", x: "Verifiable — burns and airdrop roots are on-chain, claims are proof-gated." },
  ]},
  { id: "token", icon: "🪙", n: "2", title: "The $VALO Token", accent: "#F0B90B", body: [
    { t: "p", x: "$VALO is an SPL token launched via pump.fun's bonding curve. Pump.fun tokens can't self-tax at the mint, so $VALO carries no transfer tax. Economics are enforced at two layers the project controls: the site's on-chain fee router, and a separate creator-fee handler." },
    { t: "p", x: "Value accrues two ways: a deflationary burn that permanently removes supply, and an hourly airdrop that redistributes fee revenue to holders — both funded by real platform activity, not new buyers." },
  ]},
  { id: "fees", icon: "💸", n: "3", title: "Fee Architecture", accent: "#16C784", body: [
    { t: "p", x: "Two independent streams fund the VALO programs, kept strictly separate so airdrop funding is never conflated with creator revenue." },
    { t: "table" },
    { t: "h", x: "Site trading fees" },
    { t: "p", x: "0.3% on $VALO-settled trades, 0.6% on SOL-settled trades. Each fee splits 50% to the burn pool, 50% to the airdrop vault, collected by an on-chain Anchor router that emits a fee event." },
    { t: "h", x: "Creator fees" },
    { t: "p", x: "Claimed hourly and split 25% to the creator/team, 25% to a market buyback of $VALO that is immediately burned, and 50% into the hourly epoch wallet." },
  ]},
  { id: "burn", icon: "🔥", n: "4", title: "Burn Program", accent: "#F97316", body: [
    { t: "p", x: "Two sources feed the burn: the burn-pool half of every site fee, and the 25% creator-fee slice used to buy $VALO on the open market. Both are burned on-chain, permanently cutting supply." },
    { t: "b", x: "Burns are on-chain SPL burns and publicly verifiable." },
    { t: "b", x: "Cumulative burn is shown live in the header — total or your own." },
    { t: "b", x: "The buyback is a real market purchase, adding buy pressure before burning." },
  ]},
  { id: "airdrop", icon: "🎁", n: "5", title: "Hourly Airdrop Epochs", accent: "#7D5CF0", body: [
    { t: "p", x: "An epoch is one hour of platform life, and it is the heartbeat of VALO's economics. All hour long, the airdrop vault fills: half of every single trading fee on the site flows in, trade by trade, in real time — you can watch it grow in the claim panel. Then, on the hour, the entire vault is distributed to the community and the clock starts again. Nothing is held back for later, nothing is discretionary: the payout fires every hour, forever, funded purely by real trading activity." },
    { t: "h", x: "The hourly cycle, step by step" },
    { t: "b", x: "1 · ACCRUE — for 60 minutes, every buy and sell on the site deposits 50% of its fee into the epoch vault. Bigger trading hours mean bigger vaults." },
    { t: "b", x: "2 · SNAPSHOT — at the top of the hour, the indexer freezes two numbers per wallet: your time-weighted $VALO balance across the hour (so a last-second buy can't game a full hour's weight) and your traded volume within the epoch." },
    { t: "b", x: "3 · COMPUTE — every wallet's share of the vault is calculated from those snapshots (formula below), scaled by its loyalty multiplier." },
    { t: "b", x: "4 · PUBLISH — the full payout list is compressed into a Merkle tree and its root is published on-chain. From that moment your allocation is provable by anyone and changeable by no one, including us." },
    { t: "b", x: "5 · RESET — the vault empties into pending claims, volume counters zero out, and the next epoch begins accruing immediately. Only sub-dust amounts too small to distribute roll forward into the next vault." },
    { t: "h", x: "Share formula" },
    { t: "p", x: "Your slice = ( holder weight × 50% + volume weight × 50% ) × loyalty multiplier. Holder weight is your time-weighted balance divided by all held supply; volume weight is your epoch volume divided by everyone's epoch volume. The 50/50 blend is deliberate: pure holder-weighting would pay wallets that never trade, pure volume-weighting would pay wash-traders — splitting it rewards people who both hold $VALO and actually use the terminal." },
    { t: "p", x: "Worked example: the vault holds 1,000 $VALO this epoch. You hold 0.5% of held supply and did 2% of the hour's volume. Your base weight is (0.5% × 0.5) + (2% × 0.5) = 1.25%. At a ×2.0 loyalty multiplier, you receive 1,000 × 1.25% × 2.0 = 25 $VALO — from this one epoch alone, with the next one an hour away." },
    { t: "h", x: "Missed hours cost you nothing" },
    { t: "p", x: "You do not need to be online when an epoch fires. Every unclaimed epoch stacks in your pending list — each with its own amount and published root — and can sit there indefinitely. When you claim, all stacked epochs collect in a single action. Sleeping through twelve epochs simply means twelve payouts waiting when you wake up." },
    { t: "h", x: "Claiming & the loyalty trade-off" },
    { t: "p", x: "Claiming fetches your Merkle proof and submits the claim transaction — you pay your own SOL gas, and tokens land directly in your wallet; the distributor never touches your keys. But claiming is a strategic choice: withdrawing resets your loyalty multiplier to ×1, while letting rewards ride grows it +0.1× per day toward ×2.5 — meaning a patient wallet earns up to 2.5× more from every future epoch. Auto-withdraw can run this strategy for you: collect every epoch, or hold to a target multiplier (×1.5 / ×2 / ×2.5), auto-collect, and repeat." },
    { t: "h", x: "Callout leaderboard bonuses" },
    { t: "p", x: "Your callouts don't just build reputation — they pay. Land anywhere in the top 100 of ANY leaderboard duration (1H, 12H, 1D, 7D, 30D, 180D, 365D, or LIFETIME) and every epoch snapshot adds a bonus to your multiplier: #1 +0.50× · #2 +0.42× · #3 +0.36× · #4 +0.32× · #5 +0.29× · #6 +0.26× · #7 +0.23× · #8 +0.20× · #9 +0.17× · #10 +0.14× · #11–100 +0.10×." },
    { t: "p", x: "Bonuses STACK across every duration you place on. Rank on three boards and you collect all three bonuses, every hour. Hold #1 across all eight durations and you'd stack the maximum +4.0× on top of your loyalty multiplier — the single largest earnings lever on the platform, earned purely by calling great plays." },
    { t: "b", x: "Applied automatically at every hourly snapshot — no claiming, no opting in. Your claim panel shows the exact boards, ranks, and stacked total feeding your effective multiplier." },
    { t: "b", x: "Callouts are limited to one every 4 hours, which keeps boards honest: you can't spray every token and farm rank — every call has to count." },
    { t: "note", x: "Why hourly? Daily or weekly rewards ask you to trust a payout you can't see coming. An hourly epoch is short enough to watch fill, verify, and receive within one trading session — trust is replaced by observation." },
  ]},
  { id: "loyalty", icon: "⭐", n: "6", title: "Loyalty Stack", accent: "#F0B90B", body: [
    { t: "p", x: "Holding rewards without withdrawing grows a multiplier: +0.1× per day, up to ×2.5. Withdrawing at any moment resets it to ×1, then it builds again." },
    { t: "h", x: "Automation" },
    { t: "b", x: "Off — claim manually whenever you choose." },
    { t: "b", x: "Every epoch — auto-collect hourly (stays at the ×1 base)." },
    { t: "b", x: "At multiplier — hold to a target (×1.5/×2/×2.5), auto-withdraw, repeat." },
  ]},
  { id: "terminal", icon: "🖥️", n: "7", title: "The Terminal", accent: "#4C9AFF", body: [
    { t: "h", x: "Scanner & charts" },
    { t: "b", x: "Live candlesticks with zoom, pan, timeframes, clickable trade markers." },
    { t: "b", x: "Risk score (SAFE / CAUTION / RISKY) from momentum, pressure, liquidity, age." },
    { t: "b", x: "Buy-vs-sell counts per timeframe show who's in control." },
    { t: "b", x: "Track any trader: pick a colour or image and their markers paint the chart in it, so you can follow their entries and exits at a glance." },
    { t: "h", x: "Auto Trader bots" },
    { t: "p", x: "Arm a bot instead of clicking buy: set a buy-in amount (SOL or $VALO), a buy-in price via the meter or by dragging straight on the chart (✋ drag-set, double-click to plant as many bots as you like), a stop loss, and trailing take-profit legs that must sum to 100%. Bots wait on the chart as yellow lines, fill automatically when price arrives, then run their exits on their own book — separate from your manual trades." },
    { t: "h", x: "Visual Trading" },
    { t: "p", x: "The two-tap strategy: tap BUY IN and drag the chart to plant a green line, the flow auto-advances to EXIT POINT for a red line, arm the pair and walk away. Buy-in hits → buys automatically. Exit point hits → sells 100% of that bot. Optional trailing loss rides the peak past your exit before selling. Pairs never interfere with each other, lines stay painted until hit, and every armed line can be grabbed and dragged to a new price at any time — fills freeze while you're holding it." },
    { t: "h", x: "Positions & PnL" },
    { t: "b", x: "MY POSITIONS hub: trading bots, order tickets, or both — with per-row and one-tap SELL ALL, coloured by live profit or loss." },
    { t: "b", x: "Overall bot PnL: total buy-in, realized 24h, and unrealized — bots keep their own book, manual trades keep theirs." },
    { t: "b", x: "Every buy pulls from your wallet live; every sell credits principal plus P/L back the instant it fills." },
    { t: "h", x: "Portfolio & wallet" },
    { t: "b", x: "Equity, all-time PnL, SOL / $VALO breakdown, privacy mask." },
    { t: "b", x: "Deposit / withdraw with percentage presets and confirm-to-execute." },
    { t: "b", x: "Tax-free SOL ⇄ $VALO swap, traceable PnL chart, held-positions close-all." },
  ]},
  { id: "community", icon: "🫂", n: "8", title: "Community", accent: "#16C784", body: [
    { t: "p", x: "VALO is not a terminal with a community bolted on — the community IS the product. Nearly every feature in this build exists because someone asked for it, and that is the permanent development model: the people trading here decide what gets built next." },
    { t: "h", x: "What we (the team) are doing for the community" },
    { t: "b", x: "Building in public: features ship from community requests, and the changelog is the conversation. If enough of you want it, it gets built." },
    { t: "b", x: "Funding the community from real revenue: the airdrop vault — half of every site fee — goes back to holders every hour, forever. The community is paid before the team is." },
    { t: "b", x: "Running community trading competitions with vault-funded prize pools: best PnL, best callout, best new-token spot." },
    { t: "b", x: "Spotlighting the community's best: top callers ride the callout banner site-wide, the tier ladder (from JEET all the way to DIAMOND APEX) gives every trader a rank worth grinding for — and top-100 leaderboard spots pay a real, stacking bonus on every hourly epoch (see the Airdrop section)." },
    { t: "b", x: "Staying reachable: the team trades on the same terminal, in the same chat rooms, with the same wallet rules as everyone else." },
    { t: "h", x: "What the community does here" },
    { t: "b", x: "Call your plays: post callouts on coins you believe in — your entry MC is stamped publicly, and when it moons, everyone sees your multiplier. Reputation here is earned on-chain, not claimed." },
    { t: "b", x: "Talk your book: every coin has its own room, plus the global social feed. Coin names are clickable everywhere, so a conversation is always one tap from a chart." },
    { t: "b", x: "Build your circle: add friends, accept or deny requests from their profile, DM privately, send tokens to friends, and follow the traders worth following." },
    { t: "b", x: "Track the best: paint any trader's markers in your own colour or image and learn from how they actually trade — not how they say they trade." },
    { t: "h", x: "Where it goes" },
    { t: "p", x: "As the platform grows, community direction hardens into structure: feature voting for holders, community moderators rewarded from the vault, and a public roadmap the community ranks. The goal is simple — the people who show up every day should shape the place, share in what it earns, and be recognised for what they contribute." },
  ]},
  { id: "arch", icon: "🧩", n: "9", title: "Architecture", accent: "#16C784", body: [
    { t: "b", x: "Fee router (Anchor) — takes the fee, splits burn/vault, emits an event." },
    { t: "b", x: "Indexer (Helius → Postgres) — records trades and fees." },
    { t: "b", x: "Snapshot job (hourly) — time-weighted balances." },
    { t: "b", x: "Epoch job (hourly) — drains wallet, builds Merkle tree, publishes root." },
    { t: "b", x: "Creator-fee handler (hourly) — 25/25/50 split incl. buyback-burn." },
    { t: "b", x: "Distributor (on-chain) — verifies proofs, releases tokens." },
  ]},
  { id: "security", icon: "🛡️", n: "10", title: "Security Model", accent: "#EA3943", body: [
    { t: "b", x: "Privileged wallets held in multisig; no single hot key moves material funds." },
    { t: "b", x: "Automated jobs default to a dry-run guard; live execution is deliberate." },
    { t: "b", x: "On-chain programs audited before mainnet; Merkle logic reproducible off-chain." },
    { t: "b", x: "Claims are proof-gated; the distributor never custodies user wallets." },
  ]},
  { id: "roadmap", icon: "🗺️", n: "11", title: "Roadmap", accent: "#7D5CF0", body: [
    { t: "b", x: "Phase 1 — Terminal + simulated economics (current)." },
    { t: "b", x: "Phase 2 — Live wiring: price feeds, devnet router, indexer, hourly jobs." },
    { t: "b", x: "Phase 3 — Audit + mainnet: multisig custody, distributor live, real burns/epochs." },
    { t: "b", x: "Phase 4 — Expansion: more venues, keeper strategies, deeper analytics." },
  ]},
  { id: "disclaimer", icon: "⚠️", n: "12", title: "Disclaimers", accent: "#EA3943", body: [
    { t: "p", x: "This is a simulated build. Figures are illustrative and are not guaranteed returns. $VALO and meme coins are highly volatile and may lose all value. Nothing here is investment, legal, or tax advice, nor a solicitation." },
    { t: "p", x: "Smart contracts carry risk. Before mainnet, programs must be audited, keys secured in multisig, and automated jobs guarded. Users are responsible for their own decisions, custody, and compliance." },
  ]},
];

function WpFeeTable() {
  const rows = [
    ["Site · $VALO", "0.3%", "50% burn · 50% vault"],
    ["Site · SOL", "0.6%", "50% burn · 50% vault"],
    ["Creator · team", "25%", "Split by share"],
    ["Creator · burn", "25%", "Buyback → burn"],
    ["Creator · epoch", "50%", "Hourly wallet"],
  ];
  return (
    <div style={{ border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden", margin: "10px 0" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.7fr 1.4fr", background: "rgba(125,92,240,0.16)", fontFamily: T.mono, fontSize: 9.5, fontWeight: 800, color: VALO_PURPLE }}>
        {["STREAM", "RATE", "DESTINATION"].map((h) => <div key={h} style={{ padding: "7px 9px" }}>{h}</div>)}
      </div>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.2fr 0.7fr 1.4fr", fontFamily: T.mono, fontSize: 10, color: T.dim, background: i % 2 ? "rgba(255,255,255,0.015)" : "transparent", borderTop: `1px solid ${T.border}` }}>
          {r.map((c, j) => <div key={j} style={{ padding: "7px 9px", color: j === 1 ? T.text : T.dim, fontWeight: j === 1 ? 700 : 400 }}>{c}</div>)}
        </div>
      ))}
    </div>
  );
}

function WhitepaperModal({ onClose, isMobile }) {
  const [active, setActive] = useState(WP_SECTIONS[0].id);
  const [tocOpen, setTocOpen] = useState(!isMobile);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef(null);
  const secRefs = useRef({});

  useEffect(() => {
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const go = (id) => {
    setActive(id);
    if (isMobile) {
      // the mobile TOC hides the article pane (display:none), so scrolling now
      // would target a hidden container whose sections all sit at offset 0.
      // Close the TOC first, then scroll on the next frames once it's visible.
      setTocOpen(false);
      let tries = 0;
      const attempt = () => {
        const el = secRefs.current[id], sc = scrollRef.current;
        if (el && sc && el.offsetTop > 0) sc.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
        else if (++tries < 8) requestAnimationFrame(attempt); // wait out the re-render
      };
      requestAnimationFrame(attempt);
      return;
    }
    const el = secRefs.current[id], sc = scrollRef.current;
    if (el && sc) sc.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
  };

  const onScroll = () => {
    const sc = scrollRef.current; if (!sc) return;
    setProgress(sc.scrollTop / (sc.scrollHeight - sc.clientHeight || 1));
    // active = last section whose top passed the fold
    let cur = WP_SECTIONS[0].id;
    for (const s of WP_SECTIONS) {
      const el = secRefs.current[s.id];
      if (el && el.offsetTop - 60 <= sc.scrollTop) cur = s.id;
    }
    setActive(cur);
  };

  const activeSec = WP_SECTIONS.find((s) => s.id === active) || WP_SECTIONS[0];

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 61, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex",
        alignItems: isMobile ? "flex-start" : "center", justifyContent: "center",
        padding: isMobile ? "max(12px, env(safe-area-inset-top)) 8px calc(8px + env(safe-area-inset-bottom))" : 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(96vw, 900px)",
          height: isMobile ? "calc(100dvh - max(12px, env(safe-area-inset-top)) - 20px)" : "86vh",
          maxHeight: isMobile ? "calc(100dvh - 24px)" : "86vh",
          background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 16, boxShadow: "0 30px 90px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* header with gradient + progress bar */}
        <div style={{ position: "relative", padding: "14px 16px", background: `linear-gradient(120deg, ${activeSec.accent}22, transparent 70%)`, borderBottom: `1px solid ${T.border}`, transition: "background .4s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setTocOpen((v) => !v)} title="Contents"
                style={{ ...chip(tocOpen), padding: isMobile ? "7px 11px" : "5px 9px", fontSize: isMobile ? 13 : 13, fontWeight: 700 }}>☰ {isMobile ? "Contents" : ""}</button>
              <span style={{ fontFamily: T.sans, fontWeight: 900, fontSize: isMobile ? 17 : 20, color: VALO_PURPLE, letterSpacing: -0.5 }}>VALO</span>
              {!isMobile && <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 2, color: T.dim }}>WHITEPAPER v1.0</span>}
            </div>
            <button onClick={onClose} aria-label="Close whitepaper"
              style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                width: isMobile ? 40 : 30, height: isMobile ? 40 : 30, borderRadius: isMobile ? 12 : 8,
                border: `1px solid ${T.border2}`, background: isMobile ? "rgba(234,57,67,0.15)" : "rgba(255,255,255,0.04)",
                color: isMobile ? T.red : T.text, fontSize: isMobile ? 20 : 14, fontWeight: 800, lineHeight: 1 }}>✕</button>
          </div>
          {/* reading progress */}
          <div style={{ position: "absolute", left: 0, bottom: 0, height: 3, width: `${progress * 100}%`, background: `linear-gradient(90deg, ${VALO_PURPLE}, ${T.green})`, transition: "width .1s" }} />
        </div>

        <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
          {/* TOC sidebar */}
          <div style={{
            width: tocOpen ? (isMobile ? "100%" : 250) : 0,
            position: isMobile ? "absolute" : "relative", inset: isMobile ? 0 : "auto", zIndex: 5,
            background: isMobile ? "rgba(12,15,22,0.98)" : "#0c0f16",
            borderRight: tocOpen && !isMobile ? `1px solid ${T.border}` : "none",
            overflowY: "auto", overflowX: "hidden", transition: "width .28s cubic-bezier(.22,.8,.3,1)", flexShrink: 0,
          }}>
            <div style={{ padding: tocOpen ? 12 : 0, minWidth: isMobile ? "auto" : 250 }}>
              <div style={{ fontFamily: T.mono, fontSize: 9, letterSpacing: 2, color: T.faint, marginBottom: 10, padding: "0 4px" }}>CONTENTS</div>
              {WP_SECTIONS.map((s) => {
                const on = active === s.id;
                return (
                  <button key={s.id} onClick={() => go(s.id)}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, textAlign: "left", cursor: "pointer",
                      border: "none", borderLeft: `2px solid ${on ? s.accent : "transparent"}`,
                      background: on ? `${s.accent}18` : "transparent", borderRadius: "0 8px 8px 0",
                      padding: "9px 10px", marginBottom: 2, transition: "background .15s, border-color .15s" }}>
                    <span style={{ fontSize: 15, flexShrink: 0, filter: on ? "none" : "grayscale(0.4)" }}>{s.icon}</span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: "block", fontFamily: T.mono, fontSize: 11.5, fontWeight: on ? 800 : 600, color: on ? T.text : T.dim }}>
                        {s.n ? `${s.n}. ` : ""}{s.title}
                      </span>
                    </span>
                  </button>
                );
              })}
              <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint, marginTop: 12, padding: "0 6px", lineHeight: 1.6 }}>
                $VALO on Solana · pump.fun<br />Tap a section to jump.
              </div>
            </div>
          </div>

          {/* content */}
          <div ref={scrollRef} onScroll={onScroll}
            style={{ flex: 1, overflowY: "auto", padding: isMobile ? "16px 16px 40px" : "20px 30px 60px", minWidth: 0, display: tocOpen && isMobile ? "none" : "block" }}>
            {WP_SECTIONS.map((s) => (
              <div key={s.id} ref={(el) => (secRefs.current[s.id] = el)} style={{ marginBottom: 26, scrollMarginTop: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 34, height: 34, borderRadius: 10, background: `${s.accent}20`, border: `1px solid ${s.accent}66`, fontSize: 17, flexShrink: 0 }}>{s.icon}</span>
                  <span style={{ fontFamily: T.sans, fontWeight: 800, fontSize: 18, color: T.text }}>
                    {s.n && <span style={{ color: s.accent }}>{s.n} · </span>}{s.title}
                  </span>
                </div>
                {s.body.map((b, i) => {
                  if (b.t === "table") return <WpFeeTable key={i} />;
                  if (b.t === "h") return <div key={i} style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: s.accent, letterSpacing: 0.5, margin: "12px 0 5px" }}>{b.x}</div>;
                  if (b.t === "note") return (
                    <div key={i} style={{ borderLeft: `3px solid ${T.amber}`, background: "rgba(240,185,11,0.05)", borderRadius: "0 8px 8px 0", padding: "9px 12px", margin: "8px 0", fontFamily: T.sans, fontSize: 12, fontStyle: "italic", color: T.dim, lineHeight: 1.6 }}>{b.x}</div>
                  );
                  if (b.t === "b") return (
                    <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                      <span style={{ color: s.accent, flexShrink: 0, fontSize: 13 }}>▸</span>
                      <span style={{ fontFamily: T.sans, fontSize: 12.5, color: T.dim, lineHeight: 1.6 }}>{b.x}</span>
                    </div>
                  );
                  return <p key={i} style={{ fontFamily: T.sans, fontSize: 12.5, color: T.dim, lineHeight: 1.72, margin: "0 0 10px" }}>{b.x}</p>;
                })}
              </div>
            ))}
            {/* jump-to-top */}
            <button onClick={() => go(WP_SECTIONS[0].id)}
              style={{ ...chip(false), fontSize: 10, padding: "6px 12px" }}>↑ back to top</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- live on-chain trades feed (collapsible) ----------------
function LiveTrades({ token, isMobile, onPickTrader, traderPrefs = {} }) {
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState([]);
  const [holders, setHolders] = useState(token.traders);
  const shortAddr = () => {
    const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const s = (n) => Array.from({ length: n }, () => c[Math.floor(Math.random() * c.length)]).join("");
    return s(4) + "..." + s(4);
  };
  // seed + stream new trades (API: on-chain trade stream for this mint)
  useEffect(() => {
    const seed = Array.from({ length: 14 }, (_, i) => mkRow(token, i * 1400));
    setRows(seed);
    setHolders(token.traders);
    const iv = setInterval(() => {
      const isBuy = Math.random() > 0.46;
      setRows((R) => [mkRow(token, 0, isBuy), ...R].slice(0, 40));
      setHolders((h) => Math.max(0, h + (isBuy ? 1 : Math.random() > 0.6 ? -1 : 0)));
    }, 1600 + Math.random() * 1400);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token.id]);

  function mkRow(t, agoMs = 0, forceBuy) {
    const isBuy = forceBuy !== undefined ? forceBuy : Math.random() > 0.46;
    const usd = rnd(20, 9000);
    const sol = usd / SOL_USD;
    const mc = mcOf(t) * rnd(0.9, 1.12);
    const pnlPct = isBuy ? null : rnd(-60, 220);
    return {
      id: Math.random().toString(36).slice(2), at: Date.now() - agoMs, isBuy,
      usd, sol, mc, trader: shortAddr(), pnlPct,
      tx: Array.from({ length: 8 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join(""),
    };
  }
  const ago = (ms) => { const s = Math.floor((Date.now() - ms) / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`; };

  return (
    <div style={{ marginTop: 10, background: T.panel, border: `1px solid ${T.border}`, borderRadius: 10, overflow: "hidden" }}>
      <button onClick={() => setOpen((v) => !v)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", border: "none", background: "rgba(255,255,255,0.02)", cursor: "pointer" }}>
        <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: T.text }}>
          <span style={{ color: T.green }}>●</span> LIVE TRADES <span style={{ color: T.faint, fontWeight: 400 }}>· on-chain</span>
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: T.mono, fontSize: 10 }}>
          <span style={{ color: T.dim }}>👥 {holders.toLocaleString()} holders</span>
          <span style={{ color: T.faint }}>{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && (
        <div style={{ maxHeight: isMobile ? 240 : 300, overflowY: "auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "38px 1fr 62px 46px 26px", gap: 6, padding: "6px 12px", position: "sticky", top: 0, background: T.panel, borderBottom: `1px solid ${T.border}`, fontFamily: T.mono, fontSize: 8, color: T.faint, letterSpacing: 0.5 }}>
            <span>AGE</span><span>USD / SOL</span><span style={{ textAlign: "right" }}>MCAP</span><span style={{ textAlign: "right" }}>PNL</span><span></span>
          </div>
          {rows.map((r) => (
            <div key={r.id}
              onClick={() => onPickTrader && onPickTrader(r)}
              onMouseEnter={(e) => { e.currentTarget.style.background = r.isBuy ? "rgba(22,199,132,0.12)" : "rgba(234,57,67,0.12)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              title="Open this transaction — pin the trader, set colour & icon"
              style={{ display: "grid", gridTemplateColumns: "38px 1fr 62px 46px 26px", gap: 6, padding: "6px 12px", alignItems: "center", borderBottom: `1px solid ${T.border}`, borderLeft: `3px solid ${r.isBuy ? T.green : T.red}`, background: "transparent", cursor: "pointer", transition: "background .12s" }}>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>{ago(r.at)}</span>
              <span>
                <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: r.isBuy ? T.green : T.red }}>{r.isBuy ? "↑" : "↓"} ${r.usd.toFixed(2)}</div>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>
                  {r.sol.toFixed(3)} SOL ·{" "}
                  <span
                    style={{ color: (traderPrefs[r.trader] && traderPrefs[r.trader].color) || T.blue,
                      fontWeight: traderPrefs[r.trader] && traderPrefs[r.trader].following ? 800 : 400,
                      textDecoration: "underline dotted" }}>
                    {traderPrefs[r.trader] && traderPrefs[r.trader].following ? "📌 " : ""}{r.trader}
                  </span>
                </div>
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.text, textAlign: "right" }}>{fmt$(r.mc)}</span>
              <span style={{ fontFamily: T.mono, fontSize: 9.5, textAlign: "right", color: r.pnlPct == null ? T.faint : r.pnlPct >= 0 ? T.green : T.red }}>
                {r.pnlPct == null ? "—" : `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(0)}%`}
              </span>
              <a href={`https://solscan.io/tx/${r.tx}`} target="_blank" rel="noopener noreferrer" title="View on Solscan"
                onClick={(e) => e.stopPropagation()}
                style={{ textAlign: "center", textDecoration: "none", color: T.blue, fontSize: 11 }}>🔗</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- search bar (tokens + users) with live suggestions ----------------
function SearchBar({ tokens, onPickToken, onPickUser, username, full = false }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // fake "other users" pool + the current user — API: user directory search
  const users = ["solwhale", "moonboy", "degenlord", "pumpking", "based", "cryptogod", "apehunter", "frostbyte", username].filter(Boolean);
  const ql = q.trim().toLowerCase();
  const tokMatches = ql ? tokens.filter((t) => t.sym.toLowerCase().includes(ql) || (t.name || "").toLowerCase().includes(ql) || (t.ca || "").toLowerCase().includes(ql)).slice(0, 6) : [];
  const userMatches = ql ? users.filter((u) => u.toLowerCase().includes(ql)).slice(0, 4) : [];
  const hasResults = tokMatches.length + userMatches.length > 0;

  return (
    <div ref={ref} style={{ position: "relative", width: full ? "100%" : 240 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.04)", border: `1px solid ${open ? VALO_PURPLE : T.border2}`, borderRadius: 9, padding: "6px 10px", transition: "border-color .15s" }}>
        <span style={{ fontSize: 12, color: T.faint }}>🔍</span>
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder="Search tokens, CA, or users…"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: T.text, fontFamily: T.mono, fontSize: 12 }} />
        {q && <button onClick={() => { setQ(""); setOpen(false); }} style={{ background: "none", border: "none", color: T.faint, cursor: "pointer", fontSize: 12 }}>✕</button>}
      </div>
      {open && ql && (
        <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 40, background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 10, boxShadow: "0 18px 50px rgba(0,0,0,0.6)", overflow: "hidden", maxHeight: 340, overflowY: "auto" }}>
          {!hasResults && <div style={{ padding: "12px", fontFamily: T.mono, fontSize: 10.5, color: T.faint, textAlign: "center" }}>No matches for "{q}"</div>}
          {tokMatches.length > 0 && (
            <>
              <div style={{ padding: "7px 12px 4px", fontFamily: T.mono, fontSize: 8.5, letterSpacing: 1, color: T.faint }}>TOKENS</div>
              {tokMatches.map((t) => (
                <button key={t.id} onClick={() => { onPickToken(t.id); setOpen(false); setQ(""); }}
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <TokenAvatar sym={t.sym} hue={t.hue} img={t.img} size={22} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontFamily: T.mono, fontSize: 11.5, fontWeight: 800, color: T.text }}>{t.sym}</span>
                    <span style={{ display: "block", fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>{t.name} · {fmt$(mcOf(t))} MC</span>
                  </span>
                  <span style={{ fontFamily: T.mono, fontSize: 10, color: T.dim }}>${fmtP(t.price)}</span>
                </button>
              ))}
            </>
          )}
          {userMatches.length > 0 && (
            <>
              <div style={{ padding: "7px 12px 4px", fontFamily: T.mono, fontSize: 8.5, letterSpacing: 1, color: T.faint, borderTop: tokMatches.length ? `1px solid ${T.border}` : "none" }}>USERS</div>
              {userMatches.map((u) => (
                <button key={u} onClick={() => { onPickUser && onPickUser(u); setOpen(false); setQ(""); }} title="Open profile"
                  style={{ width: "100%", display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", border: "none", background: "transparent", cursor: "pointer", textAlign: "left" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: `linear-gradient(135deg, ${VALO_PURPLE}, ${T.blue})`, display: "grid", placeItems: "center", fontFamily: T.mono, fontWeight: 800, fontSize: 10, color: "#0a0713" }}>{u[0].toUpperCase()}</span>
                  <span style={{ flex: 1, fontFamily: T.mono, fontSize: 11.5, fontWeight: 700, color: T.text }}>@{u}{u === username && <span style={{ color: T.green, fontSize: 8 }}> · you</span>}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>view profile →</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------- marker receipt — single trade OR a consolidated badge group ----------------
function MarkerReceipt({ info, isMobile, onClose, onHighlight, traderPrefs = {}, setTraderPref, myName, onOpenUser }) {
  const list = info.list && info.list.length ? info.list : [info];
  const [pg, setPg] = useState(0);
  const i = Math.max(0, Math.min(list.length - 1, pg));
  const tr = list[i];
  const swipe = useRef(null);
  useEffect(() => { if (onHighlight && tr && tr.tx) onHighlight(tr.tx); }, [i]);
  // page-flip animation state: bump `n` to retrigger, `dir` picks the sweep
  const [flip, setFlip] = useState({ n: 0, dir: 1 });
  const go = (d) => setPg((p) => {
    const next = Math.max(0, Math.min(list.length - 1, p + d));
    if (next !== p) setFlip((f) => ({ n: f.n + 1, dir: d > 0 ? 1 : -1 }));
    return next;
  });
  const jumpTo = (k) => setPg((p) => {
    if (k !== p) setFlip((f) => ({ n: f.n + 1, dir: k > p ? 1 : -1 }));
    return k;
  });
  const isBuy = tr.side === "buy";
  const col = isBuy ? T.green : T.red;
  const traderKey = info.trader || tr.trader || (tr.dev ? "__dev__" : "__me__");
  const prefs = traderPrefs[traderKey] || {};
  const following = !!prefs.following;
  const myColor = prefs.color || pickTraderColor(traderKey);
  const myIcon = prefs.icon || null;
  const gain = tr.pnlPct >= 0;
  const pnlSol = tr.unit === "SOL" ? tr.pnlMoney : (tr.pnlMoney * tr.price) / SOL_USD;
  // group totals
  const totAmt = list.reduce((s, t) => s + (t.amt || 0), 0);
  const totPnlUsd = list.reduce((s, t) => {
    if (t.pnlMoney == null) return s;
    const ps = t.unit === "SOL" ? t.pnlMoney : (t.pnlMoney * t.price) / SOL_USD;
    return s + ps * SOL_USD;
  }, 0);

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 62, background: "rgba(4,6,10,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(92vw, 360px)", background: T.panel, border: `1px solid ${col}`, borderRadius: 14, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
        {/* header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: col }}>
            <span style={{ width: 20, height: 20, borderRadius: 5, background: col, color: isBuy ? "#07130d" : "#170808", display: "grid", placeItems: "center", fontSize: 10, fontWeight: 900 }}>{isBuy ? "▲" : "▼"}</span>
            {isBuy ? "BUY" : "SELL"} · {tr.sym}{tr.dev ? " · 👨‍💻DEV" : ""}
          </span>
          <button onClick={onClose} style={{ ...chip(false), padding: "3px 8px" }}>✕</button>
        </div>

        {/* follow this trader — pin, colour, marker icon. Applies site-wide. */}
        {traderKey && traderKey !== "__me__" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,255,255,0.03)", border: `1px solid ${T.border2}`, borderRadius: 10, padding: "8px 10px", marginBottom: 10 }}>
            {/* the whole wallet block (address + label) opens their profile */}
            <span onClick={() => onOpenUser && onOpenUser(traderKey)} title="View this trader's profile"
              style={{ minWidth: 0, flex: 1, cursor: "pointer" }}>
              <span style={{ display: "block", fontFamily: T.mono, fontSize: 8, color: T.faint, letterSpacing: 1 }}>TRADER · tap for profile</span>
              <span style={{ display: "block", fontFamily: T.mono, fontSize: 10.5, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: "underline dotted", textUnderlineOffset: 2 }}>
                {tr.dev ? "👨‍💻 " : ""}{traderKey}
              </span>
            </span>

            {/* pin — highlighted while following, neutral grey when not */}
            <button onClick={() => setTraderPref && setTraderPref(traderKey, { following: !following })}
              title={following ? "Unpin — remove their trades from charts" : "Pin — keep their trades on every chart"}
              style={{ width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center", fontSize: 14,
                border: `1px solid ${following ? myColor : T.border2}`,
                background: following ? `${myColor}2e` : "rgba(255,255,255,0.03)",
                color: following ? myColor : "#7a828f",
                boxShadow: following ? `0 0 10px ${myColor}66` : "none" }}>📌</button>

            {/* colour wheel — native RGB picker, applies everywhere */}
            <label title="Pick this trader's colour"
              style={{ position: "relative", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center",
                border: `1px solid ${T.border2}`, overflow: "hidden",
                background: "conic-gradient(#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)" }}>
              <span style={{ width: 13, height: 13, borderRadius: "50%", background: myColor, border: "1.5px solid rgba(255,255,255,0.9)" }} />
              <input type="color" value={myColor}
                onChange={(e) => setTraderPref && setTraderPref(traderKey, { color: e.target.value })}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
            </label>

            {/* marker icon upload */}
            <label title="Upload a marker icon (jpg/png)"
              style={{ position: "relative", width: 30, height: 30, borderRadius: 8, cursor: "pointer", display: "grid", placeItems: "center",
                border: `1.5px solid ${myColor}`, background: `${col}33`, overflow: "hidden" }}>
              {myIcon
                ? <img src={myIcon} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : <span style={{ fontSize: 13, color: col }}>🖼</span>}
              <input type="file" accept="image/png,image/jpeg" onChange={(e) => {
                const f = e.target.files && e.target.files[0]; if (!f) return;
                const rd = new FileReader();
                rd.onload = () => setTraderPref && setTraderPref(traderKey, { icon: rd.result });
                rd.readAsDataURL(f);
              }} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
            </label>

            {myIcon && (
              <button onClick={() => setTraderPref && setTraderPref(traderKey, { icon: null })} title="Remove icon"
                style={{ ...chip(false), padding: "3px 6px", fontSize: 10 }}>✕</button>
            )}
          </div>
        )}

        {/* group summary bar */}
        {list.length > 1 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: `${col}14`, border: `1px solid ${col}55`, borderRadius: 9, padding: "7px 10px", marginBottom: 10 }}>
            <span style={{ fontFamily: T.mono, fontSize: 9.5, color: T.dim }}>
              <b style={{ color: col }}>{list.length}</b> {isBuy ? "buys" : "sells"} on this bar · {totAmt.toFixed(2)} {tr.unit}
            </span>
            {totPnlUsd !== 0 && (
              <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 800, color: totPnlUsd >= 0 ? T.green : T.red }}>
                {totPnlUsd >= 0 ? "+" : "−"}${Math.abs(totPnlUsd).toFixed(2)}
              </span>
            )}
          </div>
        )}

        {/* the trade card — swipe on mobile, click sides on PC */}
        <div
          onTouchStart={(e) => { swipe.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => {
            if (swipe.current == null) return;
            const dx = e.changedTouches[0].clientX - swipe.current;
            if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
            swipe.current = null;
          }}
          onClick={(e) => {
            if (isMobile || list.length < 2) return;
            const r = e.currentTarget.getBoundingClientRect();
            go(e.clientX - r.left < r.width / 2 ? -1 : 1);
          }}
          style={{ position: "relative", cursor: !isMobile && list.length > 1 ? "pointer" : "default", userSelect: "none", perspective: 950 }}>
          {list.length > 1 && !isMobile && (
            <>
              <span style={{ position: "absolute", left: -4, top: "50%", transform: "translateY(-50%)", fontFamily: T.mono, fontSize: 16, color: i > 0 ? T.dim : T.border2, pointerEvents: "none" }}>‹</span>
              <span style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", fontFamily: T.mono, fontSize: 16, color: i < list.length - 1 ? T.dim : T.border2, pointerEvents: "none" }}>›</span>
            </>
          )}
          <div key={flip.n}
            style={{ display: "grid", gap: 7, padding: list.length > 1 && !isMobile ? "0 10px" : 0,
              transformStyle: "preserve-3d", backfaceVisibility: "hidden",
              animation: flip.n ? `${flip.dir > 0 ? "pageFlipNext" : "pageFlipPrev"} .38s cubic-bezier(.4,.05,.25,1)` : "none" }}>
            {[
              ["TIME", new Date(tr.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })],
              ["AMOUNT", `${tr.amt} ${tr.unit}`],
              ["FILL PRICE", `$${fmtP(tr.price)}`],
              ...(isBuy ? [] : [["EXIT PRICE", `$${fmtP(tr.price)}`]]),
              ["MARKET CAP", fmt$(tr.mc)],
              ...(tr.side === "sell" && tr.pnlPct != null
                ? [["ENTRY", `$${fmtP(tr.entry)}`], ["PNL %", null], ["PNL SOL", null], ["PNL USD", null]]
                : []),
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 11.5, borderBottom: `1px solid ${T.border}`, paddingBottom: 5 }}>
                <span style={{ color: T.faint, letterSpacing: 1 }}>{k}</span>
                {v != null ? <b style={{ color: T.text }}>{v}</b> : (
                  k === "PNL %" ? <b style={{ color: gain ? T.green : T.red }}>{pct(tr.pnlPct)}</b>
                  : k === "PNL SOL" ? <b style={{ color: gain ? T.green : T.red }}>{gain ? "+" : "−"}{Math.abs(pnlSol).toFixed(3)} SOL</b>
                  : <b style={{ color: gain ? T.green : T.red }}>{gain ? "+" : "−"}${Math.abs(pnlSol * SOL_USD).toFixed(2)}</b>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* pager dots + hint */}
        {list.length > 1 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 5, marginTop: 10 }}>
            <div style={{ display: "flex", gap: 5 }}>
              {list.map((_, k) => (
                <span key={k} onClick={() => jumpTo(k)}
                  style={{ width: k === i ? 16 : 6, height: 6, borderRadius: 3, background: k === i ? col : T.border2, cursor: "pointer", transition: "width .2s" }} />
              ))}
            </div>
            <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>
              {isMobile ? "swipe ← → through transactions" : "click left / right of the tx to page"} · {i + 1}/{list.length}
            </span>
          </div>
        )}

        {tr.side === "buy" && !tr.dev && list.length === 1 && (
          <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 9.5, color: T.faint, textAlign: "center" }}>PnL is shown on the matching sell marker.</div>
        )}
        {tr.tx && (
          <a href={`https://solscan.io/tx/${tr.tx}`} target="_blank" rel="noopener noreferrer"
            style={{ display: "block", marginTop: 12, textAlign: "center", textDecoration: "none", border: `1px solid ${T.border2}`, borderRadius: 9, padding: "9px", fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: T.blue, background: "rgba(76,154,255,0.08)" }}>
            🔗 View this transaction on Solscan →
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------- sticky wrapper: follows down-screen, locks back into place ----------------
function StickySearch({ top, children }) {
  const holder = useRef(null);
  const [stuck, setStuck] = useState(false);
  const [box, setBox] = useState({ left: 0, width: 0 });
  useEffect(() => {
    const onScroll = () => {
      const el = holder.current; if (!el) return;
      const r = el.getBoundingClientRect();
      const should = r.top <= top;
      setStuck(should);
      // an ancestor zoom (PC bigger-text) re-scales fixed children's coords —
      // divide by the visual/layout ratio so the bar lands exactly on its column
      const scale = el.offsetWidth ? r.width / el.offsetWidth : 1;
      if (should) setBox({ left: r.left / scale, width: el.offsetWidth, scale });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onScroll); };
  }, [top]);
  return (
    <div ref={holder} style={{ marginBottom: 8 }}>
      {/* placeholder keeps the layout from jumping while the bar is floating */}
      {stuck && <div style={{ height: 50 }} />}
      <div style={stuck
        ? {
            position: "fixed", top: top / (box.scale || 1), left: box.left - 8, width: box.width + 16, zIndex: 30,
            boxSizing: "border-box",
            // solid, not see-through: nothing beneath shows or is clickable here
            background: T.bg,
            padding: "7px 8px",
            borderBottom: `1px solid ${T.border}`,
            boxShadow: "0 10px 22px rgba(0,0,0,0.55)",
          }
        : { position: "relative" }}>
        {children}
      </div>
    </div>
  );
}

export default function App() {
  const [tokens, setTokens] = useState(() => NAMES.slice(0, 8).map((n) => makeToken(n)));
  const [sel, setSel] = useState(null);
  const [chartMode, setChartMode] = useState("candles");
  const [trendOpen, setTrendOpen] = useState(false);     // "why it's trending" popup
  const [devView, setDevView] = useState(false);         // dev wallet sub-view in popup
  const [showDevTrades, setShowDevTrades] = useState(false); // overlay dev buys/sells on chart
  const [createdOpen, setCreatedOpen] = useState(false);     // dev "created tokens" sub-section
  const [tf, setTf] = useState(15);
  const [alerts, setAlerts] = useState([]);     // MARKET ALERTS — rising/falling coins only
  const [socialMsgs, setSocialMsgs] = useState([]); // PUBLIC user chat
  const [username, setUsername] = useState(() => {
    const A = ["swift", "lunar", "based", "degen", "hyper", "solar", "turbo", "cosmic", "vivid", "quantum", "neon", "alpha", "mega", "zen", "frost", "ember", "nova", "pixel", "rogue", "silent"];
    const N = ["trader", "whale", "ape", "fox", "hawk", "wolf", "shark", "raven", "comet", "ninja", "wizard", "pilot", "ranger", "voyager", "phantom", "surfer", "hunter", "drifter", "maverick", "sage"];
    return A[Math.floor(Math.random() * A.length)] + N[Math.floor(Math.random() * N.length)] + Math.floor(rnd(10, 999));
  });
  // simulated registry of names already taken by other users — API: uniqueness check
  const takenNames = useRef(new Set(["valo", "admin", "pumpking", "solwhale", "moonboy", "degenlord", "cryptogod", "based", "trader"]));
  const [privLog, setPrivLog] = useState([]);   // PRIVATE fills & PnL
  const [chatTab, setChatTab] = useState("social");
  const [chatHidden, setChatHidden] = useState(false); // invisible mode
  const [chatOn, setChatOn] = useState(true);          // receive/post social messages
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("all");
  const [burned, setBurned] = useState(0);
  const [tradesByToken, setTradesByToken] = useState({});
  // manual realized P/L in the last 24h (bot flows never enter this feed)
  const realized24For = (sym) => (myActivity || [])
    .filter((x) => x.sym === sym && x.side === "sell" && x.pnlMoney != null && Date.now() - (x.t || 0) < 86400e3)
    .reduce((s, x) => s + x.pnlMoney, 0);
  const [bestMultByToken, setBestMultByToken] = useState({}); // highest (or lowest) multiplier record per token
  const [myActivity, setMyActivity] = useState([]); // portfolio activity feed
  const [positions, setPositions] = useState({});
  const [realizedPnl, setRealizedPnl] = useState(0); // sum of closed-trade PnL (24h)
  const [flash, setFlash] = useState(null);
  const [tape, setTape] = useState([]);
  const [clickMode, setClickMode] = useState(null);
  const [amount, setAmount] = useState("1.0");
  const [pay, setPay] = useState("SOL");
  // which % preset (buy/sell) is currently applied — stays highlighted until
  // the user types a custom amount, flips settlement, switches token, or trades.
  // pending chart orders — armed at a price level, filled only when hit
  const [pendingOrders, setPendingOrders] = useState([]); // {id, tokenId, side, level, dir, amt, pay, tax}
  const [botHub, setBotHub] = useState(null); // { mode: "edit", id } | { mode: "list" } | null
  const botHubRef = useRef(null); botHubRef.current = botHub;      // freeze fills while editing
  const [botDraftLevel, setBotDraftLevel] = useState(null);        // { tokenId, level } — live preview line
  const [mobileBotScreen, setMobileBotScreen] = useState(false);   // mobile: chart + bot metrics fullscreen
  const [botRuns, setBotRuns] = useState([]);                      // filled bot positions — never touch the Live P/L book
  const [botRunOpen, setBotRunOpen] = useState(null);              // run id → full stats popup
  const [ticketTab, setTicketTab] = useState("ticket");            // PC right column: ticket | auto
  const [layoutPro, setLayoutPro] = useState(false);               // PC layout B: panels under the chart, feeds on the right
  const [pcCrunch, setPcCrunch] = useState(0);                     // PC: chart pulled up over the stats (0..1)
  const pcPullRef = useRef(null);
  const [chartInsetL, setChartInsetL] = useState(0);               // PC: chart pulled in from the left → token strip
  const [chartInsetR, setChartInsetR] = useState(0);               // PC: chart pulled in from the right → panels widen
  const edgeRef = useRef(null);
  useEffect(() => {
    const mv = (e) => {
      if (pcPullRef.current) {
        const dy = pcPullRef.current.y0 - e.clientY;
        setPcCrunch(Math.max(0, Math.min(1, pcPullRef.current.base + dy / 120)));
      }
      const ed = edgeRef.current;
      if (ed) {
        if (ed.side === "L") setChartInsetL(Math.max(0, Math.min(250, ed.base + (e.clientX - ed.x0))));
        else setChartInsetR(Math.max(0, Math.min(240, ed.base - (e.clientX - ed.x0))));
      }
    };
    const up = () => { pcPullRef.current = null; edgeRef.current = null; };
    window.addEventListener("mousemove", mv); window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", mv); window.removeEventListener("mouseup", up); };
  }, []);
  const [quickArmOn, setQuickArmOn] = useState(false);             // an armable strategy is ready
  const [armPop, setArmPop] = useState(null);                      // {x,y} — ARM popup pinned where the line was set
  const quickArmRef = useRef(null);
  const [ltMin, setLtMin] = useState(false);                       // PC: live trades panel minimized
  const [chatMin, setChatMin] = useState(false);                   // PC: chat panel minimized
  const [editingBotId, setEditingBotId] = useState(null);          // PC: bot loaded into the auto trader form
  const [botLock, setBotLock] = useState(null);                    // { level, n, side } — chart-drag locked price
  const [exitAmt, setExitAmt] = useState("1.0");                   // sell-out trader amount
  const [botSide, setBotSide] = useState("buy");                   // which side the drag-set / draft belongs to
  const [vtLines, setVtLines] = useState(null);                    // { tokenId, buy, sell } — visual-trading lines that stay painted
  const lineEditRef = useRef(false);                               // a bot line is being dragged — ALL fills freeze
  const [selLineId, setSelLineId] = useState(null);                // clicked line — its whole pair stays highlighted
  useEffect(() => {
    if (selLineId == null) return;
    const off = (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-chart], [data-botui]')) return;
      setSelLineId(null); // tapped away — de-highlight
    };
    window.addEventListener("pointerdown", off, true);
    return () => window.removeEventListener("pointerdown", off, true);
  }, [selLineId != null]);
  const [editLineReq, setEditLineReq] = useState(null);            // {id, n} — line snaps to the cursor for instant re-pricing
  const [botDragSet, setBotDragSet] = useState(false);             // toggle: chart drag sets buy-in vs normal pan
  // OFF-CHART CLICK CANCELS THE LINE SETTER — tapping anything that isn't the
  // chart or the bot panels switches drag-set off and clears the moving line
  useEffect(() => {
    if (!botDragSet) return;
    const cancel = (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-chart], [data-botui]')) return;
      setBotDragSet(false); setBotDraftLevel(null);
    };
    window.addEventListener("pointerdown", cancel, true);
    return () => window.removeEventListener("pointerdown", cancel, true);
  }, [botDragSet]);
  const [mobPageTab, setMobPageTab] = useState("trader");          // mobile bot page: trader | bots
  // manual SELL on a running bot — dumps its whole remaining position at market
  const sellRun = (runId) => {
    const r = botRuns.find((x) => x.id === runId && x.status === "live"); if (!r) return;
    const t = tokens.find((x) => String(x.id) === String(r.tokenId)); if (!t) return;
    const proceeds = r.remaining * (t.price / r.entry);
    if (r.pay === "SOL") setSolBalance((b) => b + proceeds); else setValoWallet((v) => v + proceeds);
    const pnlUsd = (proceeds - r.remaining) * (r.pay === "SOL" ? SOL_USD : 0.0125);
    setRealizedPnl((r2) => r2 + pnlUsd); // manual bot sell-outs land in realized too
    setBotRuns((R) => R.map((x) => x.id === runId ? { ...x, exits: [...x.exits, { ts: Date.now(), price: t.price, amt: x.remaining, pnlUsd, trail: null, kind: "MANUAL" }], remaining: 0, status: "sold" } : x));
    setPendingOrders((P) => P.filter((o) => o.runId !== runId)); // its exit bots die with it
    sayPrivate({ type: "note", text: `🤖 bot sold out of ${r.sym} @ $${fmtP(t.price)} · PnL ${pnlUsd >= 0 ? "+" : "−"}$${Math.abs(pnlUsd).toFixed(2)}` });
  };
  // grab-and-drag any armed bot line on the chart: live re-price, frozen fills,
  // 1.5s re-arm grace on release so it can't trigger the instant you let go
  const dragBotLine = (id, price, done) => {
    lineEditRef.current = !done;
    setSelLineId(id); // touching a line keeps its pair highlighted
    if (!(price > 0)) return;
    // grabbing a pending visual pair's EXIT line re-prices its sell-all point
    if (typeof id === "string" && id.endsWith("::vtSell")) {
      const baseId = +id.slice(0, -8) || id.slice(0, -8);
      setPendingOrders((P) => P.map((o) => (String(o.id) === String(baseId) ? { ...o, vtSell: price, ...(done ? { ts: Date.now() } : {}) } : o)));
      return;
    }
    setPendingOrders((P) => P.map((o) => {
      if (o.id !== id) return o;
      const t = tokens.find((x) => String(x.id) === String(o.tokenId));
      const live = t ? t.price : price;
      const upd = { ...o, level: price, dir: price <= live ? -1 : 1, trailArmed: false, peak: undefined };
      if (done) upd.ts = Date.now(); // fresh arm grace — "won't trigger until set again"
      // dragging a visual pair's BUY line keeps its exit point untouched
      return upd;
    }));
  };
  const sellAllRuns = () => botRuns.filter((r) => r.status === "live").forEach((r) => sellRun(r.id));
  const sellPos = (t) => { const p0 = positions[t.id]; if (p0 && p0.amt > 0) execute(t, { side: "sell", pay: p0.pay || pay, amt: p0.amt, mode: "instant", tax: taxFor(p0.pay || pay), burn: splitFee(p0.amt, p0.pay || pay).total, legs: [] }, {}); };
  const closeAllTickets = () => Object.keys(positions).forEach((id) => { const t = tokens.find((x) => String(x.id) === String(id)); if (t) sellPos(t); });
  // VISUAL TRADING pair — buy line + sell-all point, armed as one bot
  const armVisualPair = ({ buy, sell, amt: a, trail, editId = null }) => {
    if (!selected || !(buy > 0) || !(sell > 0) || !(a > 0)) return;
    const oldB = editId ? pendingOrders.find((x) => x.id === editId) : null;
    const credit = oldB && oldB.side === "buy" && oldB.pay === pay ? oldB.amt : 0;
    if (!takeEscrow(a, pay, credit)) return; // funds leave the wallet the moment the pair arms
    if (oldB && oldB.side === "buy") refundEscrow(oldB.amt, oldB.pay);
    const dir = buy <= selected.price ? -1 : 1;
    setPendingOrders((P) => [...P.filter((o) => o.id !== editId), { id: Date.now() + Math.random(), tokenId: selected.id, side: "buy", level: buy, dir, amt: a, pay, tax: taxFor(pay), stopLoss: null, tpMult: null, legs: [], vt: true, vtSell: sell, vtTrail: trail > 0 ? trail : null, ts: Date.now() }]);
    if (editId) setEditingBotId(null);
    setBotDraftLevel(null); setBotDragSet(false); setVtLines(null);
    sayPrivate({ type: "note", text: `👁 visual pair armed — BUY ${a} ${pay} @ $${fmtP(buy)} → SELL ALL @ $${fmtP(sell)}${trail > 0 ? ` (trail ${trail}%)` : ""}` });
  };
  // PC drag-set double-click: arms a bot at that level instantly — no ARM press,
  // and as many as you like
  // wallet escrow: arming a BUY takes the funds instantly; cancelling refunds.
  // No phantom balances — you can never arm more than the wallet holds.
  const refundEscrow = (amt, payK) => { if (amt > 0) { if (payK === "SOL") setSolBalance((b) => b + amt); else setValoWallet((v) => v + amt); } };
  const takeEscrow = (amt, payK, extraCredit = 0) => {
    const bal = (payK === "SOL" ? solBalance : valoWallet) + extraCredit;
    if (bal < amt - 1e-9) {
      sayPrivate({ type: "note", text: `⛔ can't arm — needs ${amt} ${payK}, wallet holds ${(bal - extraCredit).toFixed(3)}` });
      return false;
    }
    if (payK === "SOL") setSolBalance((b) => Math.max(0, b - amt)); else setValoWallet((v) => Math.max(0, v - amt));
    return true;
  };
  const armAtLevel = (lvl) => {
    if (!selected || !(lvl > 0)) return;
    const side = botSide;
    const a = parseFloat(side === "sell" ? exitAmt : amount) || 0;
    if (a <= 0) return;
    if (side === "buy" && !takeEscrow(a, pay)) return; // funds leave the wallet NOW
    const dir = lvl <= selected.price ? -1 : 1;
    setPendingOrders((P) => [...P, { id: Date.now() + Math.random(), tokenId: selected.id, side, level: lvl, dir, amt: a, pay, tax: taxFor(pay), stopLoss: null, tpMult: null, legs: [], ts: Date.now() }]);
    sayPrivate({ type: "note", text: `${side === "sell" ? "🔻" : "🤖"} dbl-click armed — ${side.toUpperCase()} ${a} ${pay} @ $${fmtP(lvl)}` });
  };
  // relaunch an edited bot from the PC auto-trader form
  const relaunchBot = (id, o, t) => {
    const oldB = pendingOrders.find((x) => x.id === id);
    if (oldB && oldB.side === "buy") {
      const credit = oldB.pay === pay ? oldB.amt : 0;
      if (!takeEscrow(o.amt, pay, credit)) return; // can't cover the new size — old bot stays
      refundEscrow(oldB.amt, oldB.pay);
    }
    setPendingOrders((P) => P.map((x) => {
      if (x.id !== id) return x;
      const level = o.limitBuyPrice > 0 ? o.limitBuyPrice : t.price;
      return { ...x, amt: o.amt, level, dir: level <= t.price ? -1 : 1,
        stopLoss: o.stopLoss > 0 ? level * (1 - o.stopLoss / 100) : null,
        legs: (o.legs || []).filter((l) => l.mult > 1 && l.alloc > 0), ts: Date.now() };
    }));
    setEditingBotId(null); setBotDraftLevel(null);
    sayPrivate({ type: "note", text: `🔁 bot relaunched — waits @ $${fmtP(o.limitBuyPrice > 0 ? o.limitBuyPrice : t.price)}` });
  };
  const saveBot = (id, d) => {
    const oldB = pendingOrders.find((x) => x.id === id);
    const newAmt = parseFloat(d.amt) || (oldB ? oldB.amt : 0);
    if (oldB && oldB.side === "buy" && !oldB.runId && Math.abs(newAmt - oldB.amt) > 1e-9) {
      if (!takeEscrow(newAmt, oldB.pay, oldB.amt)) return; // delta not coverable
      refundEscrow(oldB.amt, oldB.pay);
    }
    setPendingOrders((P) => P.map((o) => {
    if (o.id !== id) return o;
    const t = tokens.find((x) => String(x.id) === String(o.tokenId));
    const level = parseFloat(d.level) || o.level;
    return { ...o, amt: parseFloat(d.amt) || o.amt, level,
      dir: t ? (level <= t.price ? -1 : 1) : o.dir,
      stopLoss: parseFloat(d.stopLoss) > 0 ? parseFloat(d.stopLoss) : null,
      tpMult: parseFloat(d.tpMult) > 1 ? parseFloat(d.tpMult) : null,
      legs: Array.isArray(d.legs) ? d.legs.filter((l) => l.mult > 1 && l.alloc > 0) : o.legs };
  }));
  };
  const cancelBot = (id) => {
    const o = pendingOrders.find((x) => x.id === id);
    if (o && o.side === "buy" && !o.runId) refundEscrow(o.amt, o.pay); // escrow back
    setPendingOrders((P) => P.filter((x) => x.id !== id));
  };
  // instant partial buy/sell straight from a position card
  const onPosTrade = (t, side, amt) => {
    const payU = positions[t.id]?.pay || pay;
    execute(t, { side, pay: payU, amt, mode: "instant", tax: taxFor(payU), burn: splitFee(amt, payU).total, legs: [] }, {});
  };
  const [pctSel, setPctSel] = useState(null);
  const [buyChipMode, setBuyChipMode] = useState("pct");           // hotbar buy chips: % of wallet ⇄ fixed amounts
  const [buyPcts, setBuyPcts] = useState([10, 25, 50, 75, 100]);   // hold a chip to retype its number
  const [buyFixed, setBuyFixed] = useState([0.5, 1, 2, 5]);
  const [chipEditCfg, setChipEditCfg] = useState(null);            // in-app chip editor (prompt is blocked in iframes)
  const [chipEditVal, setChipEditVal] = useState("");
  const [chipEditErr, setChipEditErr] = useState(false);
  useEffect(() => {
    __openChipEditor = (cfg) => { setChipEditCfg(cfg); setChipEditVal(cfg.value); setChipEditErr(false); };
    return () => { __openChipEditor = null; };
  }, []);
  const [sellPcts, setSellPcts] = useState([10, 25, 50, 75, 100]);
  const [hbConfirm, setHbConfirm] = useState(null);                // hotbar two-tap: "buy" | "sell" | "sellall"
  const hbConfirmRef = useRef(null);
  const holdRef = useRef(null);
  // press-and-hold (~500ms) any chip to change its number to whatever you want
  const holdEdit = (fn) => ({
    onTouchStart: () => { holdRef.current = setTimeout(() => { holdRef.current = null; fn(); }, 500); },
    onTouchEnd: () => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } },
    onTouchMove: () => { if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; } },
    onContextMenu: (e) => { e.preventDefault(); fn(); }, // long-press also fires this on many phones; right-click on PC
  }); // { side: "buy" | "sell", p: number }
  useEffect(() => { setPctSel(null); }, [sel, pay]);
  // ---- MY MC CALLOUTS — "📣 CALLOUT" on the chart stamps the current market
  // cap; the ring then tracks your best multiplier since. Peak only ratchets UP.
  const [myMcCallouts, setMyMcCallouts] = useState({}); // { [tokenId]: { mcAt, peak } }
  const [lastCalloutTs, setLastCalloutTs] = useState(0);   // one callout every 3h — no spamming every token
  const [calloutHubOpen, setCalloutHubOpen] = useState(false); // tier list + leaderboards popup
  const [myCalloutsOpen, setMyCalloutsOpen] = useState(false); // your callout history popup
  const [tierListOpen, setTierListOpen] = useState(false);     // full tier-ladder popup
  const [lbOpen, setLbOpen] = useState(false);                 // compact leaderboard popup
  const [ranksOpen, setRanksOpen] = useState(null);            // badge page: {focus} — tiers + leaderboard tabs
  const [nameChangedAt, setNameChangedAt] = useState(0);      // weekly username-change lock
  // ---- social graph + notifications (API: wire real social service) ----
  const [followersList, setFollowersList] = useState(() => { const r = seededRand(4242); return Array.from({ length: 7 }, () => randomHandle(r)); });
  const [followingList, setFollowingList] = useState(() => { const r = seededRand(7777); return Array.from({ length: 5 }, () => randomHandle(r)); });
  const [friendsList, setFriendsList] = useState(() => ["degenmike"]);
  const [sentFriendReqs, setSentFriendReqs] = useState([]);
  const [friendReqs, setFriendReqs] = useState([]);          // incoming
  const [notifs, setNotifs] = useState([]);
  const [notifToast, setNotifToast] = useState(null);
  const notifTimer = useRef(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifSetting, setNotifSetting] = useState(true);    // website setting: callout pushes
  const [profileUser, setProfileUser] = useState(null);      // open user profile popup
  const [followListOpen, setFollowListOpen] = useState(null);// "followers" | "following"
  const [dmLogs, setDmLogs] = useState({});                  // { name: [{me, text}] }
  const unreadCount = notifs.filter((n) => !n.read).length + friendReqs.length;
  const pushNotif = (n) => {
    const notif = { id: Date.now() + Math.random(), ts: Date.now(), read: false, ...n };
    setNotifs((N) => [notif, ...N].slice(0, 200));           // history log
    setNotifToast(notif);
    clearTimeout(notifTimer.current);
    notifTimer.current = setTimeout(() => setNotifToast(null), 10000); // text fades after 10s
  };
  const navigateToToken = (tokenId) => {
    const tk = tokens.find((t) => String(t.id) === String(tokenId));
    if (!tk) return;
    setSel(tk.id); setClickMode(null);
    // close every tab/popup so the chart is front and center
    setNotifOpen(false); setProfileUser(null); setFollowListOpen(null);
    setMyCalloutsOpen(false); setCalloutHubOpen(false); setNotifToast(null);
    setPortfolioDrawer(false);
  };
  // simulated inbound social events — followed callers call out, new followers, friend requests
  useEffect(() => {
    const iv = setInterval(() => {
      const roll = Math.random();
      if (roll < 0.45) {
        if (!notifSetting) return;                            // gated by the website setting
        const t = tokens[Math.floor(Math.random() * tokens.length)]; if (!t) return;
        const from = followingList[Math.floor(Math.random() * followingList.length)] || CALLERS[0];
        pushNotif({ type: "callout", user: from, tokenId: t.id, sym: t.sym, text: `@${from} called out $${t.sym} @ ${fmt$(mcOf(t))} MC` });
      } else if (roll < 0.75) {
        const who = randomHandle(seededRand(Math.floor(Math.random() * 1e9)));
        setFollowersList((L) => (L.includes(who) ? L : [...L, who]));
        pushNotif({ type: "follower", user: who, text: `@${who} started following you — they now get your callouts` });
      } else {
        const who = randomHandle(seededRand(Math.floor(Math.random() * 1e9)));
        setFriendReqs((L) => (L.includes(who) ? L : [...L, who]));
        pushNotif({ type: "friend", user: who, text: `@${who} sent you a friend request` });
      }
    }, 26000);
    return () => clearInterval(iv);
  }, [tokens, followingList, notifSetting]);
  useEffect(() => {
    setMyMcCallouts((M) => {
      let changed = false; const N = { ...M };
      for (const id in M) {
        const tk = tokens.find((t) => String(t.id) === String(id));
        if (!tk) continue;
        const mult = mcOf(tk) / M[id].mcAt;
        if (mult > M[id].peak) { N[id] = { ...M[id], peak: mult }; changed = true; }
      }
      return changed ? N : M;
    });
  }, [tokens]);
  const [callouts, setCallouts] = useState([]); // [{id, tokenId, user, mcAt, ts}]
  const [bannerPaused, setBannerPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  // the popup clears itself when you tap anywhere that isn't the popup
  useEffect(() => {
    if (!armPop) return;
    const off = (e) => { if (e.target && e.target.closest && e.target.closest("[data-armpop]")) return; setArmPop(null); };
    window.addEventListener("pointerdown", off, true);
    return () => window.removeEventListener("pointerdown", off, true);
  }, [armPop != null]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [portfolioDrawer, setPortfolioDrawer] = useState(false); // mobile portfolio drawer
  // right-edge tab positions — draggable up/down so users park them where comfy
  const [chatTabTop, setChatTabTop] = useState(42);    // % of viewport height
  const [walletTabTop, setWalletTabTop] = useState(60);
  const tabDrag = useRef(null);
  const tabJustDragged = useRef(false);
  const tabTouchStart = (which, cur) => (e) => { tabDrag.current = { which, y0: e.touches[0].clientY, top0: cur, moved: false }; };
  // MOBILE chart gestures — top handle crunches the metrics above the chart,
  // bottom handle resizes chart height (content below follows in flow)
  const [mobChartH, setMobChartH] = useState(300);
  const [metricsCrunch, setMetricsCrunch] = useState(0); // 0 = full metrics, 1 = hidden
  const chartDrag = useRef(null);
  const chartRaf = useRef(0);
  const chartDragStart = (which) => (e) => {
    e.stopPropagation(); // never arm the sheet's swipe-to-close from a resize handle
    chartDrag.current = { which, y0: e.touches[0].clientY, h0: mobChartH, c0: metricsCrunch };
  };
  useEffect(() => {
    const mv = (e) => {
      const d = chartDrag.current; if (!d) return;
      e.preventDefault(); // page never scrolls during a chart resize drag
      const dy = e.touches[0].clientY - d.y0;
      // stash the target and flush once per frame — per-event setState made the
      // heavy chart re-render mid-gesture and the drag felt rough/sticky
      if (d.which === "bottom") d.nextH = Math.round(Math.min(560, Math.max(150, d.h0 + dy)) / 2) * 2;
      else d.nextC = Math.round(Math.min(1, Math.max(0, d.c0 - dy / 110)) * 100) / 100; // pull up → crunch away
      if (!chartRaf.current) chartRaf.current = requestAnimationFrame(() => {
        chartRaf.current = 0;
        const d2 = chartDrag.current; if (!d2) return;
        if (d2.nextH != null) setMobChartH(d2.nextH);
        if (d2.nextC != null) setMetricsCrunch(d2.nextC);
      });
    };
    const end = () => { chartDrag.current = null; };
    window.addEventListener("touchmove", mv, { passive: false });
    window.addEventListener("touchend", end); window.addEventListener("touchcancel", end);
    return () => { window.removeEventListener("touchmove", mv); window.removeEventListener("touchend", end); window.removeEventListener("touchcancel", end); };
  }, []);
  // native window listeners with passive:false — React synthetic touch events
  // are passive, so preventDefault there cannot stop the page from scrolling.
  useEffect(() => {
    const mv = (e) => {
      const d = tabDrag.current; if (!d) return;
      e.preventDefault(); // page is locked while a tab is being dragged
      const dy = e.touches[0].clientY - d.y0;
      if (Math.abs(dy) > 4) d.moved = true;
      const pct = Math.min(86, Math.max(5, d.top0 + (dy / window.innerHeight) * 100));
      (d.which === "chat" ? setChatTabTop : setWalletTabTop)(pct);
    };
    const end = () => {
      const d = tabDrag.current; if (!d) return;
      tabDrag.current = null;
      tabJustDragged.current = !!d.moved;
      setTimeout(() => { tabJustDragged.current = false; }, 120);
    };
    window.addEventListener("touchmove", mv, { passive: false });
    window.addEventListener("touchend", end);
    window.addEventListener("touchcancel", end);
    return () => { window.removeEventListener("touchmove", mv); window.removeEventListener("touchend", end); window.removeEventListener("touchcancel", end); };
  }, []);
  const [hideBalance, setHideBalance] = useState(false); // privacy mask for balances
  const [coinChats, setCoinChats] = useState({}); // tokenId -> [msgs]
  const [burnMine, setBurnMine] = useState(false); // header burn: total ⇄ yours
  const [markerInfo, setMarkerInfo] = useState(null); // clicked $ marker receipt
  const [highlightTx, setHighlightTx] = useState(null); // tx of the marker to highlight on chart
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [caCopied, setCaCopied] = useState(null); // token id whose CA was just copied
  // Followed traders. Keyed by wallet/handle so a colour + icon follows that
  // person onto every chart, past or future, until you change it.
  // { [trader]: { following: bool, color: "#rrggbb", icon: dataURL|null } }
  const [traderPrefs, setTraderPrefs] = useState({});
  const setTraderPref = (trader, patch) => setTraderPrefs((M) => ({
    ...M,
    [trader]: { following: false, color: pickTraderColor(trader), icon: null, ...(M[trader] || {}), ...patch },
  }));
  const [histMarker, setHistMarker] = useState(null); // a trade opened from history, shown as marker
  const [wallOpen, setWallOpen] = useState(true); // left ticker panel expand/collapse
  // background mode easter egg — tapping the VALO wordmark cycles the palette.
  // T is mutated in place so every component (and the canvas) picks it up.
  const [themeIdx, setThemeIdx] = useState(0);
  const [themeFlash, setThemeFlash] = useState(null);
  Object.assign(T, THEMES[themeIdx].vars);
  const [themeWave, setThemeWave] = useState(null); // full-screen colour wash on switch
  const cycleTheme = () => {
    const next = (themeIdx + 1) % THEMES.length;
    Object.assign(T, THEMES[next].vars);
    setThemeIdx(next);
    setThemeFlash(THEMES[next].label);
    setThemeWave({ k: Date.now() });
    setTimeout(() => setThemeFlash(null), 1100);
    setTimeout(() => setThemeWave(null), 1250);
  };
  useEffect(() => {
    if (typeof document !== "undefined") document.body.style.background = T.bg;
  }, [themeIdx]);
  // Mobile: stop the browser auto-zooming when an input (search, amount, chat)
  // gains focus. Safari zooms into any focused field with font-size < 16px;
  // maximum-scale=1 disables that auto-zoom while manual pinch-zoom still
  // works (iOS ignores the cap for user gestures). Keyboard opens as normal.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let meta = document.querySelector('meta[name="viewport"]');
    if (!meta) { meta = document.createElement("meta"); meta.name = "viewport"; document.head.appendChild(meta); }
    const prev = meta.getAttribute("content");
    meta.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1");
    return () => { if (prev != null) meta.setAttribute("content", prev); };
  }, []);
  // colours for the wordmark: current theme, plus the one we just came from so
  // the sweep can carry the old colour into the new one.
  const prevThemeIdx = (themeIdx - 1 + THEMES.length) % THEMES.length;
  const letterVars = {
    "--vl-a": THEMES[themeIdx].word[0], "--vl-b": THEMES[themeIdx].word[1],
    "--vl-pa": THEMES[prevThemeIdx].word[0], "--vl-pb": THEMES[prevThemeIdx].word[1],
  };
  const [cardMini, setCardMini] = useState("line"); // card mini-chart: line ⇄ bars
  const [compactList, setCompactList] = useState(false); // mobile: collapse cards into rows
  // ---- airdrop / merkle epoch state ----
  const [vaultTotal, setVaultTotal] = useState(0);        // this epoch's vault (all users)
  const [myEpochVol, setMyEpochVol] = useState(0);        // your traded volume this epoch
  const [poolVol, setPoolVol] = useState(1);              // all users' volume this epoch
  const [myHoldings, setMyHoldings] = useState(() => rnd(180000, 900000)); // $VALO held
  const [solBalance, setSolBalance] = useState(() => rnd(2, 40)); // trading-wallet SOL
  const [externalSol, setExternalSol] = useState(() => rnd(5, 60)); // connected wallet, depositable
  const [valoWallet, setValoWallet] = useState(() => rnd(50000, 400000)); // wallet $VALO
  const [portfolioTab, setPortfolioTab] = useState("wallet"); // wallet | performance
  const [perfRange, setPerfRange] = useState("1D"); // 1H 1D 1W 1M ALL
  const [perfMode, setPerfMode] = useState("line"); // line | bars
  const [pnlSeed] = useState(() => Math.random() * 1000); // deterministic perf curve
  const [pullX, setPullX] = useState(0);   // px chart extends left over the scanner
  const [pullR, setPullR] = useState(0);   // px the grid extends right (ticket+wallet slide right, keep their size)
  const [walletCollapsed, setWalletCollapsed] = useState(false); // PC: fold wallet into a side rail
  const gridRef = useRef(null);
  // sticky header height — the search bar docks right under the callout banner
  const headerRef = useRef(null);
  const [headerH, setHeaderH] = useState(0);
  useEffect(() => {
    const measure = () => { if (headerRef.current) setHeaderH(headerRef.current.getBoundingClientRect().height); };
    measure();
    window.addEventListener("resize", measure);
    const id = setInterval(measure, 800); // banner can change height as callouts cycle
    return () => { window.removeEventListener("resize", measure); clearInterval(id); };
  }, []);
  // how far right the grid may extend before the wallet column would leave the screen
  const computeMaxRight = () => {
    const g = gridRef.current; if (!g) return 0;
    const r = g.getBoundingClientRect();
    return Math.max(0, Math.round(window.innerWidth - (r.right + pullR) - 8));
  };
  const [extraH, setExtraH] = useState(70); // px extra chart height (starts a touch taller)
  const resizeRef = useRef(null);
  const scannerRef = useRef(null);
  const wallRef = useRef(null);
  // how far the chart may pull = distance from the cards' base-left to the wall's
  // right edge, minus a gap so they never rub. Measured live, so it's correct for
  // both wall-open (wide wall → less room) and wall-closed (thin rail → more room).
  const computeMaxPull = () => {
    const sc = scannerRef.current; if (!sc) return wallOpen ? 90 : 400;
    const baseLeft = sc.getBoundingClientRect().left + pullX; // undo current translate
    const wlRight = wallRef.current ? wallRef.current.getBoundingClientRect().right : 0;
    return Math.max(0, Math.round(baseLeft - wlRight - 16)); // 16px breathing gap
  };
  // opening the wall shrinks available room — re-clamp so cards clear the wall
  useEffect(() => {
    const id = setTimeout(() => { const mp = computeMaxPull(); setPullX((p) => Math.min(p, mp)); }, 60);
    return () => clearTimeout(id);
  }, [wallOpen]);
  // On desktop, open with the chart already pulled as far left as it will go, so
  // the first thing you see is a wide chart rather than an empty gutter.
  const didInitPull = useRef(false);
  useEffect(() => {
    if (didInitPull.current) return;
    if (typeof window !== "undefined" && window.innerWidth < 900) return;
    const id = setTimeout(() => {
      const mp = computeMaxPull();
      const mr = computeMaxRight();
      if (mp > 0 || mr > 0) {
        if (mp > 0) setPullX(mp);   // hug the left wall
        if (mr > 0) setPullR(mr);   // and take up the right-hand slack
        didInitPull.current = true;
      }
    }, 260);
    return () => clearTimeout(id);
  });
  // chart resize drag (left / bottom / corner handles)
  useEffect(() => {
    const move = (e) => {
      const r = resizeRef.current; if (!r) return;
      const dx = r.sx - e.clientX; // dragging left = positive
      const dxR = e.clientX - r.sx; // dragging right = positive
      const dy = e.clientY - r.sy; // dragging down = positive
      if (r.mode === "x" || r.mode === "xy") setPullX(Math.max(0, Math.min(r.maxPull, r.px0 + dx)));
      if (r.mode === "r" || r.mode === "ry") setPullR(Math.max(0, Math.min(r.maxRight, r.r0 + dxR)));
      if (r.mode === "y" || r.mode === "xy" || r.mode === "ry") setExtraH(Math.max(0, Math.min(420, r.h0 + dy)));
    };
    const up = () => { resizeRef.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);
  const startResize = (mode, e) => { resizeRef.current = { mode, sx: e.clientX, sy: e.clientY, px0: pullX, r0: pullR, h0: extraH, maxPull: computeMaxPull(), maxRight: pullR + computeMaxRight() }; e.preventDefault(); };
  const [supplyHeld] = useState(() => rnd(4e7, 9e7));     // circulating held by all claimants
  const [pendingEpochs, setPendingEpochs] = useState([]); // [{epoch, amount, root, weightPct, holdPct, volPct}]
  const [claimOpen, setClaimOpen] = useState(false);
  const [wpOpen, setWpOpen] = useState(false); // whitepaper modal
  const [claiming, setClaiming] = useState(false);
  const [heldEpochs, setHeldEpochs] = useState(0);        // consecutive epochs held → stacking bonus
  const [loyaltyDays, setLoyaltyDays] = useState(0);      // days held without withdrawing → +0.1x/day
  const [epochLastHour, setEpochLastHour] = useState(0);  // earned in the most recent epoch
  const [epochTotalEarned, setEpochTotalEarned] = useState(0); // all-time earned, incl. withdrawn
  const [autoClaim, setAutoClaim] = useState("off");      // off | hourly | atMult
  const [autoMult, setAutoMult] = useState(2);            // target multiplier for atMult mode
  const [loyaltyOpen, setLoyaltyOpen] = useState(false);  // expandable explainer
  const [autoFire, setAutoFire] = useState(0);            // bumped each epoch to run auto-claim
  const [now, setNow] = useState(Date.now());
  const epochRef = useRef(epochOf(Date.now()));
  const [myBurned, setMyBurned] = useState(0);
  const [burnOpen, setBurnOpen] = useState(false); // 🔥 burn tracker popup
  // the SITE burn keeps climbing with everyone else's trades, live
  useEffect(() => {
    const iv = setInterval(() => setBurned((b) => b + 40 + Math.random() * 140), 2600);
    return () => clearInterval(iv);
  }, []);
  useEffect(() => {
    const on = () => setIsMobile(window.innerWidth < 900);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const poolRef = useRef(NAMES.slice(8));
  const alertCooldown = useRef({});
  const socialRef = useRef(null);
  const privRef = useRef(null);
  const alertRef = useRef(null);
  const coinRef = useRef(null);

  // structured alert: {tone: 'up'|'down'|'launch', pre, sym, tokenId, hot}
  const sayAlert = useCallback((m) =>
    setAlerts((C) => [...C, { ...m, ts: new Date().toLocaleTimeString(), id: Math.random() }].slice(-80)), []);
  const saySocial = useCallback((m) =>
    setSocialMsgs((C) => [...C, { ...m, ts: new Date().toLocaleTimeString(), id: Math.random() }].slice(-120)), []);
  const sayCoin = useCallback((tokenId, m) =>
    setCoinChats((C) => ({
      ...C,
      [tokenId]: [...(C[tokenId] || []), { ...m, ts: new Date().toLocaleTimeString(), id: Math.random() }].slice(-120),
    })), []);

  const sayPrivate = useCallback((m) =>
    setPrivLog((C) => [...C, { ...m, ts: new Date().toLocaleTimeString(), id: Math.random() }].slice(-80)), []);
  useEffect(() => { socialRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [socialMsgs, chatTab]);
  useEffect(() => { alertRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [alerts, chatTab]);
  useEffect(() => { coinRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [coinChats, chatTab, sel]);
  useEffect(() => { privRef.current?.scrollTo({ top: 1e9, behavior: "smooth" }); }, [privLog, chatTab]);

  // live tick — API: websocket price stream
  useEffect(() => {
    const iv = setInterval(() => {
      setTokens((Ts) => Ts.map((t) => {
        const candles = tickCandles(t.candles, t.momentum, t.buyPressure);
        const price = candles[candles.length - 1].c;
        const drift = (price - t.price) / t.price;
        return {
          ...t, candles, price,
          momentum: Math.max(1, Math.min(99, t.momentum + rnd(-2.5, 2.5))),
          buyPressure: Math.max(1, Math.min(99, t.buyPressure + rnd(-3.5, 3.5))),
          greenUsd: Math.max(0, t.greenUsd * (1 + drift * 2)),
          redUsd: Math.max(1, t.redUsd * (1 - drift * 1.2)),
          ageMin: t.ageMin + 0.04,
        };
      }));
    }, 2200);
    return () => clearInterval(iv);
  }, []);

  // surge + hard-drop detector → BIG announcements in public feed
  useEffect(() => {
    const iv = setInterval(() => {
      setTokens((Ts) => {
        const now = Date.now();
        for (const t of Ts) {
          const last = t.candles[t.candles.length - 1];
          const gain = ((last.c - last.o) / last.o) * 100;
          const cd = alertCooldown.current[t.id] || 0;
          if (now - cd < 60000) continue;
          if (gain > 1.6 || t.momentum > 88) {
            alertCooldown.current[t.id] = now;
            sayAlert({ tone: "up", pre: "🔥 CATCHING ATTENTION —", sym: t.sym, tokenId: t.id, hot: `UPDRIFT ${pct(Math.max(gain, 1.6))} · MOM ${Math.round(t.momentum)}` });
            break;
          }
          if (gain < -1.8 || (t.buyPressure < 18 && gain < -0.8)) {
            alertCooldown.current[t.id] = now;
            sayAlert({ tone: "down", pre: "⚠️ HARD DROP —", sym: t.sym, tokenId: t.id, hot: `DUMP CANDLE ${pct(gain)} · SELL PRESSURE ${Math.round(100 - t.buyPressure)}` });
            break;
          }
        }
        return Ts;
      });
    }, 9000);
    return () => clearInterval(iv);
  }, [sayAlert]);

  // new launches — API: pump.fun mint stream
  useEffect(() => {
    const iv = setInterval(() => {
      if (poolRef.current.length) {
        const t = makeToken(poolRef.current.shift(), true);
        setTokens((Ts) => [t, ...Ts]);
        sayAlert({ tone: "launch", pre: "🚀 NEW TOKEN LAUNCHED —", sym: t.sym, tokenId: t.id, hot: `${t.chain === "pump" ? "PUMP.FUN" : "ROBINHOOD CHAIN"} · SYNTH CHART LIVE` });
        // API: fetch token metadata (image) for the new mint. In production:
        //   const meta = await fetch(`https://api.dexscreener.com/…/${mint}`)
        //   resolve meta.info.imageUrl and setTokens to attach t.img.
        // Here we simulate the picture resolving a moment after launch.
        resolveImage(t);
      }
    }, 16000);
    return () => clearInterval(iv);
  }, [sayAlert]);

  // metadata image resolver — attaches a real picture once it "loads"
  const resolveImage = useCallback((t) => {
    const url = `https://api.dicebear.com/9.x/shapes/svg?seed=${encodeURIComponent(t.sym)}&backgroundType=gradientLinear`;
    setTimeout(() => {
      setTokens((Ts) => Ts.map((x) => (x.id === t.id ? { ...x, img: url } : x)));
    }, rnd(1500, 4000));
  }, []);

  // resolve pictures for the tokens present at first load
  useEffect(() => {
    tokens.forEach((t) => { if (!t.img) resolveImage(t); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // simulated public chatter — API: real chat websocket
  useEffect(() => {
    if (!chatOn) return;
    const LINES = [
      "anyone watching this one?", "chart looks clean rn", "volume picking up 👀",
      "i'm holding since launch", "who else caught the dip", "this cooks fr",
      "careful, liquidity is thin", "gm legends", "dev is active, good sign",
      "sold too early again 💀", "we eating good tonight", "what's the play here",
    ];
    const iv = setInterval(() => {
      setTokens((Ts) => {
        const withToken = Math.random() > 0.45 && Ts.length;
        const t = withToken ? Ts[Math.floor(Math.random() * Ts.length)] : null;
        saySocial({
          user: CALLERS[Math.floor(Math.random() * CALLERS.length)],
          text: LINES[Math.floor(Math.random() * LINES.length)],
          sym: t?.sym ?? null, tokenId: t?.id ?? null,
        });
        return Ts;
      });
    }, 5200);
    return () => clearInterval(iv);
  }, [saySocial, chatOn]);

  // community callouts — API: social/telegram callout feed
  useEffect(() => {
    const iv = setInterval(() => {
      setTokens((Ts) => {
        if (!Ts.length) return Ts;
        // bias toward high-momentum coins
        const weighted = Ts.flatMap((t) => Array(Math.max(1, Math.round(t.momentum / 18))).fill(t));
        const t = weighted[Math.floor(Math.random() * weighted.length)];
        const mcNow = mcOf(t);
        // entry MC sampled from the past — some will be deep 2x+ calls
        const mcAt = mcNow * rnd(0.18, 0.98);
        setCallouts((C) => [...C.slice(-34), {
          id: Math.random(), tokenId: t.id, user: CALLERS[Math.floor(Math.random() * CALLERS.length)],
          mcAt, ts: Date.now(),
        }]);
        return Ts;
      });
    }, 4200);
    return () => clearInterval(iv);
  }, []);

  const calloutCountFor = useCallback((id) => callouts.filter((c) => c.tokenId === id).length, [callouts]);

  // epoch clock — API: replace with on-chain epoch from the distributor contract
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const e = epochOf(t);
      if (e !== epochRef.current) {
        // ===== rolling hourly cron: snapshot, compute shares, publish new root =====
        const prev = epochRef.current;
        epochRef.current = e;
        setVaultTotal((vault) => {
          setPoolVol((pv) => {
            setMyEpochVol((mv) => {
              const holdPct = myHoldings / supplyHeld;              // holder weight
              const volPct = pv > 0 ? mv / pv : 0;                  // volume weight
              const weightPct = holdPct * 0.5 + volPct * 0.5;       // 50/50 blend
              const stackBonus = Math.min(2.5, 1 + loyaltyDays * 0.1); // loyalty stack: +0.1x/day, cap 2.5x
              const amount = vault * weightPct * stackBonus;
              if (amount > 0) {
                setPendingEpochs((P) => [...P, {
                  epoch: prev, amount, root: fakeRoot(prev),
                  weightPct, holdPct, volPct, stackBonus,
                  ts: Date.now(),
                }]);
                setEpochLastHour(amount);
                setEpochTotalEarned((t) => t + amount);
              } else {
                setEpochLastHour(0);
              }
              setHeldEpochs((h) => h + 1);
              return 0;
            });
            return 1;
          });
          return 0;
        });
        // loyalty grows one "day" each epoch held without withdrawing
        setLoyaltyDays((d) => Math.min(15, d + 1));
        setAutoFire((n) => n + 1); // trigger auto-claim check post-epoch
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [myHoldings, supplyHeld, heldEpochs, loyaltyDays]);

  // background: other users trading into the vault — API: on-chain fee events
  useEffect(() => {
    const iv = setInterval(() => {
      const otherVol = rnd(200, 9000);
      setPoolVol((v) => v + otherVol);
      setVaultTotal((v) => v + otherVol * (TAX.VALO / 100) / 2);
    }, 3000);
    return () => clearInterval(iv);
  }, []);

  // per-coin room chatter — API: coin room websocket
  useEffect(() => {
    if (!chatOn || sel == null) return;
    const LINES = [
      "holding this one to 5x", "chart's tightening up", "liq looks decent here",
      "who's in at the bottom?", "dev just posted an update", "this is the one",
      "watching for a retest", "loaded a bit more", "careful up here",
      "callouts stacking on this fast", "clean bounce off support",
    ];
    const iv = setInterval(() => {
      sayCoin(sel, { user: CALLERS[Math.floor(Math.random() * CALLERS.length)], text: LINES[Math.floor(Math.random() * LINES.length)] });
    }, 6500);
    return () => clearInterval(iv);
  }, [sel, chatOn, sayCoin]);

  // floating market flow — API: live trade stream
  useEffect(() => {
    const iv = setInterval(() => {
      if (sel == null) return;
      const isBuy = Math.random() > 0.44;
      const id = Math.random();
      setTape((L) => [...L.slice(-14), { id, isBuy, text: `${isBuy ? "▲" : "▼"} ${fmt$(rnd(15, 4000))}`, left: rnd(6, 120) }]);
      setTimeout(() => setTape((L) => L.filter((x) => x.id !== id)), 3400);
    }, 850);
    return () => clearInterval(iv);
  }, [sel]);

  const selected = tokens.find((t) => t.id === sel) || null;

  // core execute — marker always lands on the live candle at fill price
  const execute = (t, o, spot) => {
    // AUTO STRATEGY = a bot, full stop. It arms at the user's buy-in price and
    // fills only when the market reaches it — never an instant market buy.
    if (o.mode === "auto") {
      const lvl = o.limitBuyPrice > 0 ? o.limitBuyPrice : t.price;
      const dir = lvl <= t.price ? -1 : 1;
      if (o.side === "sell") {
        // SELL-OUT TRADER — red line, sells o.amt when price reaches the level
        setPendingOrders((P) => [...P, { id: Date.now() + Math.random(), tokenId: t.id, side: "sell", level: lvl, dir, amt: o.amt, pay: o.pay, tax: o.tax, stopLoss: null, tpMult: null, legs: [], ts: Date.now() }]);
        sayPrivate({ type: "note", text: `🔻 sell-out trader armed — SELL ${o.amt} ${o.pay} on ${t.sym} waits @ $${fmtP(lvl)}` });
        return;
      }
      if (!takeEscrow(o.amt, o.pay)) return; // armed buys take the money instantly
      const legs = (o.legs || []).filter((l) => l.mult > 1 && l.alloc > 0);
      const tp = !legs.length && o.legs && o.legs[0] && o.legs[0].mult > 1 ? o.legs[0].mult : null;
      setPendingOrders((P) => [...P, { id: Date.now() + Math.random(), tokenId: t.id, side: "buy", level: lvl, dir, amt: o.amt, pay: o.pay, tax: o.tax, stopLoss: parseFloat(o.stopLoss) > 0 ? lvl * (1 - parseFloat(o.stopLoss) / 100) : null, tpMult: tp, legs, ts: Date.now() }]);
      sayPrivate({ type: "note", text: `🤖 auto strategy armed — BUY ${o.amt} ${o.pay} on ${t.sym} waits @ $${fmtP(lvl)}${o.stopLoss > 0 ? ` · SL $${fmtP(o.stopLoss)}` : ""}${tp ? ` · TP ${tp}×` : ""}` });
      return;
    }
    setPctSel(null); // balance changes on trade — the applied % no longer holds
    // buys pull straight out of the wallet, live — and can NEVER take it below 0
    if (o.side === "buy" && o.amt > 0) {
      const bal = o.pay === "SOL" ? solBalance : valoWallet;
      if (bal < o.amt - 1e-9) {
        sayPrivate({ type: "note", text: `⛔ insufficient ${o.pay} — tried to buy ${o.amt}, wallet holds ${bal.toFixed(3)}` });
        return;
      }
      if (o.pay === "SOL") setSolBalance((b) => Math.max(0, b - o.amt)); else setValoWallet((v) => Math.max(0, v - o.amt));
    }
    const fee = splitFee(o.amt, o.pay);
    setBurned((b) => b + fee.burn);        // burn pool only
    setMyBurned((b) => b + fee.burn);
    setVaultTotal((v) => v + fee.vault);   // airdrop vault half
    setMyEpochVol((v) => v + o.amt);       // your volume this epoch
    setPoolVol((v) => v + o.amt);
    const unit = o.pay === "SOL" ? "SOL" : "$VALO";
    const mcAtFill = mcOf(t);
    // compute PnL $ for sells against average entry
    const posEntry = positions[t.id]?.entry ?? t.price;
    const sellPnlPct = o.side === "sell" ? ((t.price - posEntry) / posEntry) * 100 : 0;
    const sellPnlMoney = o.side === "sell" ? (o.amt * sellPnlPct) / 100 : 0;
    if (o.side === "sell") setRealizedPnl((r) => r + sellPnlMoney);
    // sells credit proceeds back — principal plus the P/L, live
    if (o.side === "sell" && o.amt > 0) {
      const proceedsPay = o.amt * (1 + sellPnlPct / 100);
      if (o.pay === "SOL") setSolBalance((b) => b + proceedsPay); else setValoWallet((v) => v + proceedsPay);
    }
    // multiplier on this exit (price / avg entry). Record the most extreme ever on this token.
    const exitMult = o.side === "sell" && posEntry > 0 ? t.price / posEntry : null;
    if (exitMult != null) {
      setBestMultByToken((M) => {
        const prev = M[t.id];
        // keep the furthest-from-1 record (biggest win OR biggest loss stays as the standout)
        const better = prev == null || Math.abs(exitMult - 1) > Math.abs(prev - 1) ? exitMult : prev;
        return { ...M, [t.id]: better };
      });
    }
    // portfolio activity feed — one bar per trade
    setMyActivity((A) => [{
      id: Math.random().toString(36).slice(2), t: Date.now(),
      sym: t.sym, hue: t.hue, img: t.img, side: o.side, amt: o.amt, unit,
      price: t.price, pnlMoney: o.side === "sell" ? sellPnlMoney : null, pnlPct: o.side === "sell" ? sellPnlPct : null,
      mult: exitMult,
      tx: Array.from({ length: 8 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join(""),
    }, ...A].slice(0, 60));

    // marker always stamps the LATEST candle at the executed price, and carries
    // its full receipt so it can be clicked open later
    setTradesByToken((M) => ({
      ...M,
      [t.id]: [...(M[t.id] || []), {
        t: Date.now(), side: o.side, p: t.price,
        amt: o.amt, unit, price: t.price, mc: mcAtFill,
        pnlPct: o.side === "sell" ? sellPnlPct : null,
        pnlMoney: o.side === "sell" ? sellPnlMoney : null,
        entry: o.side === "sell" ? posEntry : t.price,
        sym: t.sym,
      }],
    }));
    setFlash({ side: o.side, key: Math.random() });
    setTimeout(() => setFlash(null), 1300);

    if (o.side === "buy") {
      setPositions((P) => {
        const p = P[t.id];
        const totalAmt = (p?.amt || 0) + o.amt;
        const entry = p ? (p.entry * p.amt + t.price * o.amt) / totalAmt : t.price;
        return { ...P, [t.id]: { entry, amt: totalAmt, pay: o.pay } };
      });
      sayPrivate({ type: "fill", side: "buy", text: `⚡ BOUGHT ${t.sym} — ${o.amt} ${unit} @ ${fmtP(t.price)}${spot ? " · chart-click" : ""} · 🔥 ${o.burn.toFixed(5)} burned (${o.tax}%)` });
    } else {
      const p = positions[t.id];
      const entry = p?.entry ?? t.price;
      const pnlPct = ((t.price - entry) / entry) * 100;
      const money = (o.amt * pnlPct) / 100;
      sayPrivate({ type: "fill", side: "sell", text: `⚡ SOLD ${t.sym} — ${o.amt} ${unit} @ ${fmtP(t.price)}${spot ? " · chart-click" : ""} · 🔥 ${o.burn.toFixed(5)} burned` });
      sayPrivate({ type: "pnl", gain: pnlPct >= 0, text: `${pnlPct >= 0 ? "📈 PROFIT" : "📉 LOSS"} ${pct(pnlPct)} · ${money >= 0 ? "+" : "−"}${Math.abs(money).toFixed(4)} ${unit}` });
      setPositions((P) => {
        const cur = P[t.id]; if (!cur) return P;
        const rem = Math.max(0, cur.amt - o.amt);
        return rem <= 0 ? Object.fromEntries(Object.entries(P).filter(([k]) => +k !== t.id)) : { ...P, [t.id]: { ...cur, amt: rem } };
      });
    }

    if (o.mode === "auto" && o.side === "buy") {
      sayPrivate({ type: "bot", text: `🤖 STRATEGY ARMED · ${t.sym} — ${o.limitBuy ? `limit @ ${o.limitBuy} · ` : ""}SL ${o.stopLoss}% · legs ${o.legs.map((l) => `×${l.mult}/${l.trail}%/${l.alloc}%`).join(" ")}` });
      o.legs.forEach((l, i) =>
        setTimeout(() => {
          const gain = (l.mult - 1) * 100 * rnd(0.85, 1);
          const money = (o.amt * l.alloc / 100) * (gain / 100);
          const legAmt = o.amt * l.alloc / 100;
          setTradesByToken((M) => ({ ...M, [t.id]: [...(M[t.id] || []), {
            t: Date.now(), side: "sell", p: null,
            amt: legAmt, unit, price: t.price, mc: mcOf(t),
            pnlPct: gain, pnlMoney: money, entry: o.limitBuy || t.price, sym: t.sym, bot: true,
          }] }));
          sayPrivate({ type: "bot", text: `🤖 ${t.sym} leg ${i + 1} trailing exit — sold ${l.alloc}% near ×${l.mult} · 🔥 burn applied` });
          sayPrivate({ type: "pnl", gain: true, text: `📈 BOT PROFIT ${pct(gain)} · +${money.toFixed(4)} ${unit}` });
        }, 8000 + i * 9000));
    }
  };

  const chartTrade = ({ side, level }) => {
    if (!selected) return;
    const amt = parseFloat(amount) || 0;
    const tax = taxFor(pay);
    // an armed chart click ALWAYS creates a pending bot at the tapped level —
    // it fills only when price actually reaches that marker, above or below.
    // (Instant trades stay on the BUY/SELL buttons.)
    const lvl = level != null && isFinite(level) && level > 0 ? level : selected.price;
    const dir = lvl <= selected.price ? -1 : 1; // -1 fills when price falls to level, +1 when it rises
    setPendingOrders((P) => [...P, { id: Date.now() + Math.random(), tokenId: selected.id, side, level: lvl, dir, amt, pay, tax, stopLoss: null, tpMult: null, ts: Date.now() }]);
    sayPrivate({ type: "note", text: `🤖 bot armed — ${side.toUpperCase()} ${amt} ${pay} on ${selected.sym} @ $${fmtP(lvl)} · fills only when price hits the marker` });
  };

  // fill watcher — every price tick, fill pending orders whose level was hit
  useEffect(() => {
    if (!pendingOrders.length) return;
    if (lineEditRef.current) return; // a line is being dragged — nothing fires
    const now = Date.now();
    // trailing sells: reaching the target ARMS them; they ride the peak and
    // only fire once price gives back trail% from that peak
    const trailUpd = [];
    pendingOrders.forEach((o) => {
      if (o.side !== "sell" || !(o.trail > 0)) return;
      const t = tokens.find((x) => String(x.id) === String(o.tokenId)); if (!t) return;
      if (!o.trailArmed) {
        if ((o.dir > 0 && t.price >= o.level) || (o.dir < 0 && t.price <= o.level)) trailUpd.push({ id: o.id, patch: { trailArmed: true, peak: t.price } });
      } else if (t.price > o.peak) trailUpd.push({ id: o.id, patch: { peak: t.price } });
    });
    if (trailUpd.length) setPendingOrders((P) => P.map((o) => { const u = trailUpd.find((x) => x.id === o.id); return u ? { ...o, ...u.patch } : o; }));
    const hits = pendingOrders.filter((o) => {
      if (o.ts && now - o.ts < 1500) return false; // arm grace — a bot can never fire the instant it's placed
      const bh = botHubRef.current;
      if (bh && bh.mode === "edit" && bh.id === o.id) return false; // stationary while being edited
      const t = tokens.find((x) => String(x.id) === String(o.tokenId));
      if (!t) return false;
      if (o.side === "sell" && o.trail > 0) return o.trailArmed && t.price <= o.peak * (1 - o.trail / 100);
      return (o.dir < 0 && t.price <= o.level) || (o.dir > 0 && t.price >= o.level);
    });
    if (!hits.length) return;
    setPendingOrders((P) => P.filter((o) => !hits.includes(o)));
    hits.forEach((o) => {
      const t = tokens.find((x) => String(x.id) === String(o.tokenId));
      if (!t) return;
      if (o.side === "buy") {
        // fill → a RUNNING BOT with its own book, kept out of the Live P/L box
        // funds already escrowed at arm time — the fill just converts them
        const runId = "run" + Date.now() + Math.random();
        setBotRuns((R) => [...R, { id: runId, tokenId: o.tokenId, sym: t.sym, hue: t.hue, entry: t.price, level: o.level, amt: o.amt, remaining: o.amt, pay: o.pay, legs: o.legs || [], stopLossPrice: o.stopLoss || null, filledTs: Date.now(), exits: [], status: "live" }]);
        sayPrivate({ type: "note", text: `🎯 bot filled — BOUGHT ${o.amt} ${o.pay} of ${t.sym} @ $${fmtP(t.price)} (armed @ $${fmtP(o.level)})` });
        const follow = [];
        if (o.vtSell > 0) {
          // visual pair: one sell-all bot at the chosen point — nothing else
          follow.push({ id: Date.now() + Math.random(), tokenId: o.tokenId, side: "sell", level: o.vtSell, dir: o.vtSell <= t.price ? -1 : 1, amt: o.amt, pay: o.pay, tax: o.tax, runId, vt: true, trail: o.vtTrail || null, exitKind: "VT", ts: Date.now() });
          setPendingOrders((P) => [...P, ...follow]);
          return;
        }
        if (o.stopLoss > 0) follow.push({ id: Date.now() + Math.random(), tokenId: o.tokenId, side: "sell", level: o.stopLoss, dir: -1, amt: o.amt, pay: o.pay, tax: o.tax, runId, exitKind: "SL", ts: Date.now() });
        if (Array.isArray(o.legs) && o.legs.length) {
          o.legs.forEach((l, i) => { if (l.mult > 1 && l.alloc > 0) follow.push({ id: Date.now() + Math.random() + i, tokenId: o.tokenId, side: "sell", level: t.price * l.mult, dir: 1, amt: +((o.amt * l.alloc) / 100).toFixed(4), pay: o.pay, tax: o.tax, runId, trail: l.trail, exitKind: "TP", ts: Date.now() }); });
        } else if (o.tpMult > 1) {
          follow.push({ id: Date.now() + Math.random() + 1, tokenId: o.tokenId, side: "sell", level: t.price * o.tpMult, dir: 1, amt: o.amt, pay: o.pay, tax: o.tax, runId, exitKind: "TP", ts: Date.now() });
        }
        if (follow.length) setPendingOrders((P) => [...P, ...follow]);
      } else if (o.runId) {
        // exit leg of a running bot — settle against the run's own book
        const r = botRuns.find((x) => x.id === o.runId && x.status === "live"); if (!r) return;
        const portion = Math.min(o.amt, r.remaining); if (portion <= 0) return;
        const proceeds = portion * (t.price / r.entry);
        if (r.pay === "SOL") setSolBalance((b) => b + proceeds); else setValoWallet((v) => v + proceeds);
        const pnlUsd = (proceeds - portion) * (r.pay === "SOL" ? SOL_USD : 0.0125);
        setRealizedPnl((r2) => r2 + pnlUsd); // bot exits count in your realized, always
        const remaining = +(r.remaining - portion).toFixed(6);
        const done = remaining <= r.amt * 0.001;
        setBotRuns((R) => R.map((x) => x.id === r.id ? { ...x, exits: [...x.exits, { ts: Date.now(), price: t.price, amt: portion, pnlUsd, trail: o.trail || null, kind: o.exitKind || "TP" }], remaining, status: done ? "sold" : "live" } : x));
        if (done) setPendingOrders((P) => P.filter((x) => x.runId !== r.id));
        sayPrivate({ type: "note", text: `🤖 ${o.exitKind || "TP"} hit — sold ${portion} ${r.pay} of ${r.sym} @ $${fmtP(t.price)} · ${pnlUsd >= 0 ? "+" : "−"}$${Math.abs(pnlUsd).toFixed(2)}` });
      } else {
        // manually armed sell — normal market path
        execute(t, { side: o.side, pay: o.pay, amt: o.amt, mode: "instant", tax: o.tax, burn: splitFee(o.amt, o.pay).total, legs: [] }, { chartClick: true });
        sayPrivate({ type: "note", text: `🎯 marker hit — SELL ${o.amt} ${o.pay} filled on ${t.sym} @ $${fmtP(t.price)} (armed @ $${fmtP(o.level)})` });
      }
    });
  }, [tokens]);

  const shown = tokens.filter((t) =>
    filter === "all" ? true : filter === "new" ? t.isNew :
    filter === "safe" ? scoreToken(t) >= 66 : filter === "risky" ? scoreToken(t) < 40 : t.chain === filter);

  const gTvl = tokens.reduce((a, t) => a + t.tvl, 0);
  const gNet = tokens.reduce((a, t) => a + t.greenUsd - t.redUsd, 0);
  const unrealizedPnl = Object.entries(positions).reduce((a, [id, p]) => {
    const tk = tokens.find((x) => x.id === +id);
    if (!tk || !p) return a;
    return a + p.amt * ((tk.price - p.entry) / p.entry);
  }, 0);
  const botUnrealized = botRuns.reduce((a, r) => {
    if (r.status !== "live") return a;
    const t = tokens.find((x) => String(x.id) === String(r.tokenId)); if (!t) return a;
    return a + (r.remaining * (t.price / r.entry) - r.remaining) * (r.pay === "SOL" ? SOL_USD : 0.0125);
  }, 0);
  const unrealizedAll = unrealizedPnl + botUnrealized; // every open exposure, one number
  // money that's committed but not idle: live bot positions at current value
  // plus escrow sitting inside armed-but-unfilled buys — equity never "loses" it
  const strategyEquityUsd = botRuns.reduce((a, r) => {
    if (r.status !== "live") return a;
    const t = tokens.find((x) => String(x.id) === String(r.tokenId)); if (!t) return a;
    return a + r.remaining * (t.price / r.entry) * (r.pay === "SOL" ? SOL_USD : 0.0125);
  }, 0) + pendingOrders.reduce((a, o) => (o.side === "buy" && !o.runId ? a + o.amt * (o.pay === "SOL" ? SOL_USD : 0.0125) : a), 0);
  const platformPnl = realizedPnl + unrealizedAll;
  const valoUsdPrice = 0.0125; // API: live $VALO price
  const walletUsd = solBalance * SOL_USD + valoWallet * valoUsdPrice;
  const liveValueUsd = Object.entries(positions).reduce((a, [id, p]) => {
    const t = tokens.find((x) => x.id === +id); if (!t || !p) return a;
    const sizeSol = p.pay === "SOL" ? p.amt : (p.amt * t.price) / SOL_USD;
    return a + Math.max(0, sizeSol * (t.price / p.entry)) * SOL_USD;
  }, 0);
  const totalEquity = walletUsd + liveValueUsd;

  // clickable coin name — light yellow, jumps to the chart
  const CoinLink = ({ sym, tokenId }) => (
    <span onClick={() => { if (tokenId != null) { setSel(tokenId); setClickMode(null); } }}
      style={{ color: "#f2e394", fontWeight: 800, cursor: "pointer", textDecoration: "underline dotted rgba(242,227,148,0.4)", textUnderlineOffset: 3 }}>
      ${sym}
    </span>
  );

  // MARKET ALERTS — only the important part is green/red
  const renderAlert = (m) => {
    const hotCol = m.tone === "down" ? T.red : T.green;
    return (
      <div key={m.id} className="announce" style={{ margin: "9px 0", fontFamily: T.mono, fontSize: 12.5, lineHeight: 1.5 }}>
        <span style={{ fontSize: 9, color: T.faint, display: "block" }}>{m.ts}</span>
        <span style={{ color: T.dim }}>{m.pre} </span>
        <CoinLink sym={m.sym} tokenId={m.tokenId} />
        <span style={{ color: hotCol, fontWeight: 900, textShadow: `0 0 10px ${m.tone === "down" ? "rgba(234,57,67,0.45)" : "rgba(22,199,132,0.45)"}` }}> {m.hot}</span>
      </div>
    );
  };

  // SOCIAL — plain user chat, coin refs yellow & clickable
  const renderSocial = (m) => (
    <div key={m.id} style={{ margin: "6px 0", fontFamily: T.mono, fontSize: 11, lineHeight: 1.55 }}>
      <span style={{ color: T.faint, fontSize: 9.5 }}>{m.ts} </span>
      <span style={{ color: m.me ? accent(258, 68) : T.blue }}>@{m.user}</span>
      <span style={{ color: T.text }}> {m.text} </span>
      {m.sym && <CoinLink sym={m.sym} tokenId={m.tokenId} />}
    </div>
  );

  // PRIVATE log renderer
  const renderMsg = (m) => {
    if (m.type === "pnl") return (
      <div key={m.id} style={{ margin: "6px 0", fontFamily: T.mono, fontWeight: 800, fontSize: 12.5, color: m.gain ? T.green : T.red }}>
        <span style={{ color: T.faint, fontWeight: 400, fontSize: 9.5 }}>{m.ts} </span>{m.text}
      </div>
    );
    const col = m.type === "bot" ? T.blue : m.side === "buy" ? T.green : m.side === "sell" ? T.red : T.dim;
    return (
      <div key={m.id} style={{ margin: "6px 0", fontFamily: T.mono, fontSize: 10.5, lineHeight: 1.5, color: col }}>
        <span style={{ color: T.faint, fontSize: 9.5 }}>{m.ts} </span>{m.text}
      </div>
    );
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text || !chatOn) return;
    if (chatTab === "coin" && selected) sayCoin(selected.id, { user: username, text, me: true });
    else saySocial({ user: username, text, sym: null, tokenId: null, me: true });
    setDraft("");
  };


  // Markers on the chart = your trades + (optionally) the dev's + any trader you
  // are following. Followed traders stay pinned while you trade until unpinned.
  const chartTrades = useMemo(() => {
    if (!selected) return [];
    const mine = (tradesByToken[selected.id] || []).map((t) => ({ ...t, trader: t.trader || "__me__" }));
    const dev = showDevTrades ? (selected.dev.trades || []) : [];
    const hist = histMarker && histMarker.sym === selected.sym ? [histMarker] : [];
    const followed = Object.entries(traderPrefs)
      .filter(([, p]) => p && p.following)
      .flatMap(([trader]) => {
        if (trader === "__me__") return [];
        if (trader === selected.dev.wallet) return showDevTrades ? [] : (selected.dev.trades || []);
        return traderTradesFor(selected, trader);
      });
    const all = [...mine, ...dev, ...hist, ...followed];
    // de-dupe by tx so a followed dev doesn't double-draw
    const seen = new Set();
    return all.filter((t) => {
      if (!t.tx) return true;
      if (seen.has(t.tx)) return false;
      seen.add(t.tx); return true;
    });
  }, [selected, tradesByToken, showDevTrades, histMarker, traderPrefs]);

  // trending button + callout widget — shared between the desktop header row
  // and the mobile chart-tools row (noBox drops the frame on mobile)
  const trendingBtn = selected && (
    <button onClick={() => { setDevView(false); setTrendOpen(true); }} title="Why it's trending"
      style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid rgba(240,185,11,0.4)", background: "rgba(240,185,11,0.10)", color: T.amber, borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 10, fontWeight: 800, cursor: "pointer" }}>🔥 Trending</button>
  );
  const calloutWidget = (noBox, ringSize = 34, horizontal = false) => {
    if (!selected) return null;
    const co = myMcCallouts[selected.id];
    if (!co) {
      const cdLeft = 4 * 3600e3 - (Date.now() - lastCalloutTs);
      if (cdLeft > 0) {
        const h = Math.floor(cdLeft / 3600e3), m = Math.ceil((cdLeft % 3600e3) / 60000);
        return (
          <button disabled title="One callout every 4 hours — make it count"
            style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.03)", color: T.faint, borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 10, fontWeight: 800, cursor: "not-allowed" }}>
            📣 NEXT CALLOUT {h > 0 ? `${h}h ` : ""}{m}m
          </button>
        );
      }
      return (
      <button onClick={() => { setMyMcCallouts((M) => ({ ...M, [selected.id]: { mcAt: mcOf(selected), peak: 1, ts: Date.now() } })); setLastCalloutTs(Date.now()); }}
        title="Call this coin out at the current market cap — one callout every 4 hours, so make it count"
        style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", border: `1px solid ${VALO_PURPLE}66`, background: "rgba(125,92,240,0.10)", color: VALO_PURPLE, borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 10, fontWeight: 800, cursor: "pointer" }}>
        📣 CALLOUT · {fmt$(mcOf(selected))}
      </button>
      );
    }
    const { tier } = calloutTier(co.peak);
    if (horizontal) {
      // compact row form — same height as the buttons beside it, so opening
      // a callout changes nothing around it
      return (
        <div onClick={() => setCalloutHubOpen(true)} title="Open the tier list & callout leaderboards"
          className="co-open"
          style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", transformOrigin: "70% 50%" }}>
          <CalloutRing mult={co.peak} size={ringSize} />
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.25 }}>
            <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 800, color: tier.color, letterSpacing: 1 }}>{tier.label}</span>
            <span style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint, whiteSpace: "nowrap" }}>OUT @ {fmt$(co.mcAt)}</span>
          </div>
        </div>
      );
    }
    // desktop: a larger insignia framed to match the header bar's own chips —
    // neutral border, subtle tier-tinted inner glow, no loud colored box
    return (
      <div onClick={() => setCalloutHubOpen(true)} title="Open the tier list & callout leaderboards"
        className="co-open"
        style={{ display: "flex", alignItems: "center", gap: 9, cursor: "pointer", transformOrigin: "50% 50%", marginLeft: 4,
          border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.03)", borderRadius: 9, padding: "4px 12px 4px 6px",
          boxShadow: `inset 0 0 18px ${tier.color}0f` }}>
        <CalloutRing mult={co.peak} size={46} />
        <span style={{ textAlign: "left", lineHeight: 1.35 }}>
          <span style={{ display: "block", fontFamily: T.mono, fontSize: 7, letterSpacing: 1.5, color: T.faint }}>CALLOUT · OUT @ {fmt$(co.mcAt)}</span>
          <span style={{ display: "block", fontFamily: T.mono, fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: tier.color, textShadow: `0 0 8px ${tier.color}44` }}>{tier.label}</span>
        </span>
      </div>
    );
  };

  const chartBlock = (
            !selected ? (
              <div style={{ border: `1px dashed ${T.border2}`, borderRadius: 12, padding: 70, textAlign: "center", color: T.faint, fontFamily: T.mono, fontSize: 12 }}>
                Select a pair to open its chart
              </div>
            ) : (
              <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                    <TokenAvatar sym={selected.sym} hue={selected.hue} img={selected.img} size={22} />
                    <span style={{ fontWeight: 800, fontSize: 16 }}>{selected.sym}<span style={{ color: T.faint, fontWeight: 400 }}>/SOL</span></span>
                    <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 700 }}>${fmtP(selected.price)}</span>
                    <span style={{ fontSize: 8.5, border: `1px solid ${ratingColor(scoreToken(selected))}66`, background: `${ratingColor(scoreToken(selected))}14`, color: ratingColor(scoreToken(selected)), padding: "2px 7px", borderRadius: 5, fontFamily: T.mono, fontWeight: 800 }}>
                      {scoreToken(selected)} {rating(scoreToken(selected))}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                    {/* socials */}
                    {/* CA — tap to copy the contract address */}
                    <button onClick={() => { try { navigator.clipboard.writeText(selected.ca); } catch (e) {} setCaCopied(selected.id); setTimeout(() => setCaCopied(null), 1400); }}
                      title={`Copy contract address\n${selected.ca}`}
                      style={{ display: "flex", alignItems: "center", gap: 4, height: 26, borderRadius: 7, border: `1px solid ${caCopied === selected.id ? T.green : T.border2}`, background: caCopied === selected.id ? "rgba(22,199,132,0.15)" : "rgba(255,255,255,0.03)", color: caCopied === selected.id ? T.green : T.dim, fontFamily: T.mono, fontSize: 9.5, fontWeight: 700, padding: "0 8px", cursor: "pointer" }}>
                      {caCopied === selected.id ? "✓ copied" : <>📋 CA <span style={{ color: T.faint }}>{selected.ca.slice(0, 4)}…{selected.ca.slice(-4)}</span></>}
                    </button>
                    {[["𝕏", selected.socials.x, "#e6e9ef"], ["✈", selected.socials.tg, "#4c9aff"], ["🌐", selected.socials.site, "#a98fff"], ["💊", selected.socials.pump, "#16c784"]].filter(([, url]) => url).map(([ic, url, col], i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" title="Open social"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: 7, border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.03)", color: col, fontSize: 12, textDecoration: "none", cursor: "pointer" }}>{ic}</a>
                    ))}
                    {/* why it's trending — desktop; on mobile it moves to the chart-tools row */}
                    {!isMobile && trendingBtn}
                    <button onClick={() => setShowDevTrades((v) => !v)} title="Show developer buys & sells on the chart"
                      style={{ display: "flex", alignItems: "center", gap: 4, border: `1px solid ${showDevTrades ? accent(selected.hue) : T.border2}`, background: showDevTrades ? `${accent(selected.hue)}22` : "rgba(255,255,255,0.03)", color: showDevTrades ? accent(selected.hue) : T.dim, borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 10, fontWeight: 800, cursor: "pointer" }}>👨‍💻 Dev trades</button>
                    {/* chart mode + MC callout — desktop keeps them in this row;
                        mobile gets a dedicated chart-tools row above the metrics */}
                    {!isMobile && (
                      <>
                        <div style={{ width: 1, height: 18, background: T.border, margin: "0 2px" }} />
                        <button onClick={() => setChartMode("candles")} style={chip(chartMode === "candles")}>▮ Candles</button>
                        <button onClick={() => setChartMode("line")} style={chip(chartMode === "line")}>∿ Line</button>
                        <div style={{ width: 1, height: 18, background: T.border, margin: "0 2px" }} />
                        {calloutWidget(false)}
                      </>
                    )}
                  </div>
                </div>
                {/* MOBILE chart-tools row — candles/line/trending left, callout tier
                    pinned to the right with no frame around it */}
                {isMobile && (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 8, flexWrap: "wrap", minWidth: 0 }}>
                    <button onClick={() => setChartMode("candles")} style={{ ...chip(chartMode === "candles"), padding: "4px 7px", fontSize: 9.5 }}>▮</button>
                    <button onClick={() => setChartMode("line")} style={{ ...chip(chartMode === "line"), padding: "4px 7px", fontSize: 9.5 }}>∿</button>
                    {trendingBtn}
                    <button onClick={() => setMetricsCrunch((c) => (c > 0.5 ? 0 : 1))}
                      title={metricsCrunch > 0.5 ? "Expand the metrics" : "Collapse the metrics"}
                      style={{ ...chip(metricsCrunch > 0.5), padding: "4px 7px", fontSize: 9.5, fontWeight: 900, color: metricsCrunch > 0.5 ? VALO_PURPLE : T.dim, borderColor: metricsCrunch > 0.5 ? `${VALO_PURPLE}66` : T.border }}>
                      {metricsCrunch > 0.5 ? "▸" : "▾"} STATS
                    </button>
                    <div style={{ marginLeft: "auto", flex: "0 0 auto", minWidth: 0, display: "flex", justifyContent: "flex-end" }}>{calloutWidget(true, 34, true)}</div>
                  </div>
                )}
                {/* metrics under price — on mobile this whole block crunches away
                    as the chart is pulled up; durations below always stay */}
                <div style={isMobile
                  ? { maxHeight: Math.round((1 - metricsCrunch) * 130), opacity: 1 - metricsCrunch, overflow: "hidden", pointerEvents: metricsCrunch > 0.85 ? "none" : "auto", transition: "max-height .28s ease, opacity .28s ease" }
                  : layoutPro
                  ? { display: "none" } /* pro layout: the skinny strip below replaces this block */
                  : { maxHeight: Math.round((1 - pcCrunch) * 160), opacity: 1 - pcCrunch, overflow: "hidden", pointerEvents: pcCrunch > 0.85 ? "none" : "auto", transition: pcPullRef.current ? "none" : "max-height .2s ease, opacity .2s ease" }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 10, flexWrap: "wrap", fontFamily: T.mono, fontSize: 10.5 }}>
                  <span style={{ color: T.faint }}>MOM <b style={{ color: accent(selected.hue) }}>{Math.round(selected.momentum)}</b></span>
                  <span style={{ color: T.faint }}>B/S <b style={{ color: selected.buyPressure >= 50 ? T.green : T.red }}>{Math.round(selected.buyPressure)}</b></span>
                  <span style={{ color: T.faint }}>▲ <b style={{ color: T.green }}>{fmt$(selected.greenUsd)}</b></span>
                  <span style={{ color: T.faint }}>▼ <b style={{ color: T.red }}>{fmt$(selected.redUsd)}</b></span>
                  {(() => { const net = selected.greenUsd - selected.redUsd; return (
                    <span style={{ color: T.faint }}>NET <b style={{ color: net >= 0 ? T.green : T.red }}>{net >= 0 ? "+" : "−"}{fmt$(Math.abs(net))}</b></span>
                  ); })()}
                </div>
                {/* buys vs sells for the selected timeframe — side by side */}
                {(() => {
                  const { buys, sells } = buysSellsFor(selected, tf, 90);
                  const tot = buys + sells || 1;
                  const bpct = (buys / tot) * 100;
                  return (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 10.5, marginBottom: 4 }}>
                        <span style={{ color: T.green, fontWeight: 700 }}>▲ {buys} BUYS</span>
                        <span style={{ color: T.faint, fontSize: 9 }}>last {TIMEFRAMES.find((f) => f.m === tf)?.k || tf + "m"} × window</span>
                        <span style={{ color: T.red, fontWeight: 700 }}>{sells} SELLS ▼</span>
                      </div>
                      <div style={{ display: "flex", height: 6, borderRadius: 4, overflow: "hidden", background: "#1a1f2a" }}>
                        <div style={{ width: `${bpct}%`, background: T.green }} />
                        <div style={{ width: `${100 - bpct}%`, background: T.red }} />
                      </div>
                    </div>
                  );
                })()}
                </div>
                {/* PRO: one skinny metrics strip above the durations — smooth, out of the way */}
                {!isMobile && layoutPro && (() => {
                  const { buys, sells } = buysSellsFor(selected, tf, 90);
                  const net = selected.greenUsd - selected.redUsd;
                  const tot = buys + sells || 1;
                  return (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontFamily: T.mono, fontSize: 9,
                      border: `1px solid ${T.border}`, background: "rgba(255,255,255,0.015)", borderRadius: 8, padding: "4px 10px", marginBottom: 7 }}>
                      <span style={{ color: T.faint }}>MOM <b style={{ color: accent(selected.hue) }}>{Math.round(selected.momentum)}</b></span>
                      <span style={{ color: T.faint }}>B/S <b style={{ color: selected.buyPressure >= 50 ? T.green : T.red }}>{Math.round(selected.buyPressure)}</b></span>
                      <span style={{ color: T.faint }}>▲ <b style={{ color: T.green }}>{fmt$(selected.greenUsd)}</b></span>
                      <span style={{ color: T.faint }}>▼ <b style={{ color: T.red }}>{fmt$(selected.redUsd)}</b></span>
                      <span style={{ color: T.faint }}>NET <b style={{ color: net >= 0 ? T.green : T.red }}>{net >= 0 ? "+" : "−"}{fmt$(Math.abs(net))}</b></span>
                      <span style={{ color: T.faint }}>{buys}▲/{sells}▼</span>
                      <span style={{ flex: 1, minWidth: 40, height: 4, borderRadius: 2, overflow: "hidden", background: "#1a1f2a", display: "flex" }}>
                        <span style={{ width: `${(buys / tot) * 100}%`, background: T.green }} />
                        <span style={{ width: `${100 - (buys / tot) * 100}%`, background: T.red }} />
                      </span>
                    </div>
                  );
                })()}
                {/* durations — always visible above the chart */}
                <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
                  {TIMEFRAMES.map((f) => (
                    <button key={f.k} onClick={() => setTf(f.m)} style={{ ...chip(tf === f.m), padding: "3px 8px" }}>{f.k}</button>
                  ))}
                </div>

                {/* pinned traders — their markers ride along on every chart */}
                {Object.entries(traderPrefs).filter(([, p]) => p && p.following).length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1 }}>📌 FOLLOWING</span>
                    {Object.entries(traderPrefs).filter(([, p]) => p && p.following).map(([k, p]) => (
                      <span key={k} style={{ display: "flex", alignItems: "center", gap: 5, border: `1px solid ${p.color}`, background: `${p.color}22`, borderRadius: 20, padding: "2px 5px 2px 3px" }}>
                        {p.icon
                          ? <img src={p.icon} alt="" style={{ width: 14, height: 14, borderRadius: 4, objectFit: "cover" }} />
                          : <span style={{ width: 10, height: 10, borderRadius: "50%", background: p.color }} />}
                        <span style={{ fontFamily: T.mono, fontSize: 9, color: T.text, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k === "__dev__" ? "developer" : k}</span>
                        <button onClick={() => setTraderPref(k, { following: false })} title="Unpin"
                          style={{ border: "none", background: "none", color: T.faint, cursor: "pointer", fontSize: 10, padding: 0, lineHeight: 1 }}>✕</button>
                      </span>
                    ))}
                  </div>
                )}
                {isMobile && (
                  <div onTouchStart={chartDragStart("top")} onClick={() => setMetricsCrunch((c) => (c > 0.5 ? 0 : 1))}
                    aria-label="Tap to collapse/expand the metrics — or drag"
                    style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "5px 0 8px", touchAction: "none", cursor: "pointer" }}>
                    <div style={{ width: 68, height: 5, borderRadius: 3, background: metricsCrunch > 0 ? VALO_PURPLE : T.border2, boxShadow: metricsCrunch > 0 ? `0 0 8px ${VALO_PURPLE}` : "none" }} />
                  </div>
                )}
                {!isMobile && (
                  <div onMouseDown={(e) => { e.preventDefault(); pcPullRef.current = { y0: e.clientY, base: pcCrunch }; }}
                    title="Drag up — the chart rises and the stats fold away (callout row and CA stay put)"
                    style={{ display: "flex", justifyContent: "center", alignItems: "center", padding: "2px 0 6px", cursor: "ns-resize" }}>
                    <div style={{ width: 76, height: 5, borderRadius: 3, background: pcCrunch > 0 ? VALO_PURPLE : T.border2, boxShadow: pcCrunch > 0 ? `0 0 8px ${VALO_PURPLE}` : "none" }} />
                  </div>
                )}
                <div style={{ position: "relative", paddingLeft: !isMobile && chartInsetL > 90 ? chartInsetL + 8 : 0 }}>
                  {/* pull the chart in from the LEFT → a compact token strip fills the space */}
                  {!isMobile && chartInsetL > 90 && (
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: chartInsetL, overflowY: "auto",
                      display: "grid", gridTemplateColumns: chartInsetL > 180 ? "1fr 1fr" : "1fr", gap: 6, alignContent: "start", paddingRight: 2 }}>
                      {tokens.map((tk) => {
                        const up = tk.change24 >= 0;
                        return (
                          <div key={tk.id} onClick={() => { setSel(tk.id); setClickMode(null); }}
                            style={{ border: `1px solid ${String(tk.id) === String(selected.id) ? accent(tk.hue) : T.border}`, background: String(tk.id) === String(selected.id) ? `${accent(tk.hue)}14` : T.panel,
                              borderRadius: 9, padding: "6px 7px", cursor: "pointer", fontFamily: T.mono }}>
                            <div style={{ fontSize: 9.5, fontWeight: 900, color: accent(tk.hue), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${tk.sym}</div>
                            <div style={{ fontSize: 8.5, color: T.text }}>${fmtP(tk.price)}</div>
                            <div style={{ fontSize: 8, fontWeight: 800, color: up ? T.green : T.red }}>{up ? "+" : ""}{(tk.change24 || 0).toFixed(1)}%</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* edge grips: drag the chart in from either side */}
                  {!isMobile && (
                    <>
                      <div onMouseDown={(e) => { e.preventDefault(); edgeRef.current = { side: "L", x0: e.clientX, base: chartInsetL }; }}
                        title="Drag right — tuck the chart in and reveal the token strip"
                        style={{ position: "absolute", left: (!isMobile && chartInsetL > 90 ? chartInsetL + 8 : 0) - 4, top: 0, bottom: 0, width: 9, cursor: "col-resize", zIndex: 6 }} />
                      <div onMouseDown={(e) => { e.preventDefault(); edgeRef.current = { side: "R", x0: e.clientX, base: chartInsetR }; }}
                        title="Drag left — the panels and wallet widen as the chart tucks in"
                        style={{ position: "absolute", right: -4, top: 0, bottom: 0, width: 9, cursor: "col-resize", zIndex: 6 }} />
                    </>
                  )}
                  <ProChart candles={selected.candles} hue={selected.hue} synthetic={!selected.hasDex}
                    mode={chartMode} tfMin={tf} trades={chartTrades} traderPrefs={traderPrefs} theme={themeIdx}
                    clickMode={clickMode} onChartTrade={chartTrade} onMarkerClick={(tr) => { setMarkerInfo(tr); if (tr && tr.tx) setHighlightTx(tr.tx); }}
                    highlightTx={highlightTx}
                    position={positions[selected.id]} price={selected.price} sym={selected.sym}
                    pendingLevels={[
                      ...pendingOrders.filter((o) => String(o.tokenId) === String(selected.id)),
                      ...pendingOrders.filter((o) => String(o.tokenId) === String(selected.id) && o.vt && o.side === "buy" && o.vtSell > 0)
                        .map((o) => ({ id: o.id + "::vtSell", level: o.vtSell, side: "sell", vt: true, amt: o.amt, pay: o.pay })),
                      ...(vtLines && String(vtLines.tokenId) === String(selected.id) ? [
                        ...(vtLines.buy > 0 ? [{ level: vtLines.buy, side: "buy", vt: true }] : []),
                        ...(vtLines.sell > 0 ? [{ level: vtLines.sell, side: "sell", vt: true }] : []),
                      ] : []),
                      ...(botDraftLevel && String(botDraftLevel.tokenId) === String(selected.id) ? [{ level: botDraftLevel.level, side: botDraftLevel.side || "buy", draft: true, vt: !!vtLines }] : []),
                    ]}
                    botRuns={botRuns.filter((r) => r.status === "live" && String(r.tokenId) === String(selected.id))}
                    botSetMode={!isMobile && ticketTab === "auto" && botDragSet}
                    onBotDraft={(lvl) => setBotDraftLevel({ tokenId: selected.id, level: lvl, side: botSide })}
                    onBotSet={(lvl, at) => { setBotDraftLevel({ tokenId: selected.id, level: lvl, side: botSide }); setBotLock({ level: lvl, n: Date.now(), side: botSide }); setBotDragSet(false); if (at && !isMobile) setArmPop(at); }}
                    onBotArm={(lvl) => armAtLevel(lvl)}
                    onBotLineDrag={dragBotLine} selectedLineId={selLineId} editLineReq={editLineReq}
                    onLineSelect={(id) => setSelLineId(id)}
                    isMobile={isMobile} height={isMobile ? mobChartH : 480 + extraH + Math.round(pcCrunch * 150)} />

                  {/* MOBILE bottom handle — pull up for a skinnier chart, down for taller;
                      everything below follows in flow so it stays right under the chart */}
                  {isMobile && (
                    <div onTouchStart={chartDragStart("bottom")} aria-label="Drag to resize chart height"
                      style={{ position: "absolute", left: 24, right: 24, bottom: -11, height: 30, zIndex: 8, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "none" }}>
                      <div style={{ width: 56, height: 5, borderRadius: 3, background: mobChartH !== 300 ? VALO_PURPLE : T.border2, boxShadow: mobChartH !== 300 ? `0 0 8px ${VALO_PURPLE}` : "none" }} />
                    </div>
                  )}
                  {/* PC chart resize handles — sit right on the chart edges */}
                  {!isMobile && (
                    <>
                      {/* BOTTOM — drag down to grow chart height */}
                      <div onMouseDown={(e) => startResize("y", e)} title="Drag to change chart height"
                        style={{ position: "absolute", left: 40, right: 90, bottom: -5, height: 14, cursor: "ns-resize", zIndex: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 60, height: 5, borderRadius: 3, background: extraH > 0 ? VALO_PURPLE : T.border2, boxShadow: extraH > 0 ? `0 0 8px ${VALO_PURPLE}` : "none" }} />
                      </div>
                      {/* LEFT — pull chart over the scanner */}
                      <div onMouseDown={(e) => startResize("x", e)} title="Drag to widen chart over the scanner"
                        style={{ position: "absolute", left: -5, top: 40, bottom: 40, width: 14, cursor: "ew-resize", zIndex: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 5, height: 60, borderRadius: 3, background: pullX > 0 ? VALO_PURPLE : T.border2, boxShadow: pullX > 0 ? `0 0 8px ${VALO_PURPLE}` : "none" }} />
                      </div>
                      {/* CORNER (bottom-left) — both at once */}
                      <div onMouseDown={(e) => startResize("xy", e)} title="Drag to resize chart"
                        style={{ position: "absolute", left: -6, bottom: -6, width: 22, height: 22, cursor: "nesw-resize", zIndex: 9, borderLeft: `3px solid ${VALO_PURPLE}`, borderBottom: `3px solid ${VALO_PURPLE}`, borderBottomLeftRadius: 6 }} />
                      {/* RIGHT — pull the chart right, shrinking trade + portfolio toward the wall */}
                      <div onMouseDown={(e) => startResize("r", e)} title="Drag right for a near-fullscreen chart"
                        style={{ position: "absolute", right: -5, top: 40, bottom: 40, width: 14, cursor: "ew-resize", zIndex: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <div style={{ width: 5, height: 60, borderRadius: 3, background: pullR > 0 ? VALO_PURPLE : T.border2, boxShadow: pullR > 0 ? `0 0 8px ${VALO_PURPLE}` : "none" }} />
                      </div>
                      {/* CORNER (bottom-right) — right + height */}
                      <div onMouseDown={(e) => startResize("ry", e)} title="Drag to resize chart"
                        style={{ position: "absolute", right: -6, bottom: -6, width: 22, height: 22, cursor: "nwse-resize", zIndex: 9, borderRight: `3px solid ${VALO_PURPLE}`, borderBottom: `3px solid ${VALO_PURPLE}`, borderBottomRightRadius: 6 }} />
                      {(pullX > 0 || pullR > 0 || extraH > 0) && (
                        <button onClick={() => { setPullX(0); setPullR(0); setExtraH(0); }}
                          style={{ position: "absolute", right: 92, bottom: 6, zIndex: 9, ...chip(false), fontSize: 9, padding: "3px 8px" }}>⤢ reset</button>
                      )}
                    </>
                  )}

                  {flash && (
                    <div key={flash.key} style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 5 }}>
                      <div className="fill-ring" style={{ borderColor: flash.side === "buy" ? T.green : T.red }} />
                      <div className="fill-text" style={{ color: flash.side === "buy" ? T.green : T.red }}>
                        {flash.side === "buy" ? "▲ BOUGHT" : "▼ SOLD"}
                      </div>
                    </div>
                  )}

                  <div style={{ position: "absolute", left: 0, bottom: 30, width: 180, height: "100%", overflow: "hidden", pointerEvents: "none", zIndex: 4 }}>
                    {tape.map((x) => (
                      <div key={x.id} className="tape-item" style={{ left: x.left, color: x.isBuy ? T.green : T.red, textShadow: `0 0 8px ${x.isBuy ? "rgba(22,199,132,0.7)" : "rgba(234,57,67,0.7)"}` }}>
                        {x.text}
                      </div>
                    ))}
                  </div>
                </div>

                {/* metrics — single line, short tags; folds away in pro layout */}
                <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", whiteSpace: "nowrap", paddingBottom: 2,
                  ...((!isMobile && layoutPro) ? { maxHeight: 0, marginTop: 0, opacity: 0, overflow: "hidden", paddingBottom: 0, transition: "max-height .2s ease, opacity .2s ease" } : {}) }}>
                  {[
                    ["LIQ", fmt$(selected.liq)],
                    ["V", fmt$(selected.vol24)],
                    ["TVL", fmt$(selected.tvl)],
                    ["MC", fmt$(mcOf(selected))],
                    ["HOLD", selected.traders.toLocaleString()],
                    ["AGE", selected.ageMin < 60 ? `${Math.floor(selected.ageMin)}m` : `${(selected.ageMin / 60).toFixed(0)}h`],
                  ].map(([k, v]) => (
                    <div key={k} style={{ flex: "1 0 auto", background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 7, padding: "5px 9px", textAlign: "center" }}>
                      <span style={{ fontSize: 8, letterSpacing: 1, color: T.faint, fontFamily: T.mono }}>{k} </span>
                      <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 700 }}>{v}</span>
                    </div>
                  ))}
                </div>

                {/* live on-chain trades — mobile keeps it here; PC moves it beside chat */}
                {isMobile && <LiveTrades token={selected} isMobile={isMobile} traderPrefs={traderPrefs}
                  onPickTrader={(row) => setMarkerInfo({ trader: row.trader, side: row.isBuy ? "buy" : "sell", sym: selected.sym,
                    t: row.at, amt: +row.sol.toFixed(3), unit: "SOL", price: selected.price, mc: row.mc,
                    pnlPct: row.pnlPct != null ? row.pnlPct : null, pnlMoney: null, tx: row.tx })} />}
                {/* auto-trader entry now lives in the hotbar (🤖 button) */}
              </div>
            )


  );

  const chatBlock = (
            <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: 12, padding: 12 }}>
              <div style={{ display: "flex", gap: 6, marginBottom: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button onClick={() => setChatTab("social")} style={chip(chatTab === "social")}>
                  🌐 SOCIAL <span style={{ color: T.faint }}>· public</span>
                </button>
                {selected && (
                  <button onClick={() => setChatTab("coin")}
                    style={{ ...chip(chatTab === "coin"), color: chatTab === "coin" ? "#f2e394" : T.dim, borderColor: chatTab === "coin" ? "rgba(242,227,148,0.45)" : T.border }}>
                    💬 ${selected.sym} ROOM
                  </button>
                )}
                <button onClick={() => setChatTab("alerts")} style={chip(chatTab === "alerts")}>
                  📊 MARKET ALERTS <span style={{ color: T.faint }}>· rising / falling</span>
                </button>
                <button onClick={() => setChatTab("private")} style={{ ...chip(chatTab === "private"), borderColor: chatTab === "private" ? accent(258, 55) : T.border }}>
                  🔒 MY TRADES
                </button>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button onClick={() => setChatOn((v) => !v)} title="Turn social chat on/off"
                    style={{ ...chip(false), color: chatOn ? T.green : T.red, borderColor: chatOn ? "rgba(22,199,132,0.4)" : "rgba(234,57,67,0.4)" }}>
                    {chatOn ? "CHAT ON" : "CHAT OFF"}
                  </button>
                  <button onClick={() => setChatHidden((v) => !v)} title="Instantly hide/show all chat"
                    style={{ ...chip(false), color: chatHidden ? T.amber : T.dim, borderColor: chatHidden ? "rgba(240,185,11,0.45)" : T.border }}>
                    {chatHidden ? "👁 SHOW" : "🙈 HIDE"}
                  </button>
                </div>
              </div>

              {chatHidden ? (
                <div style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontSize: 10.5, color: T.faint }}>
                  Chat hidden — tap 👁 SHOW to bring it back.
                </div>
              ) : chatTab === "social" ? (
                <>
                  <div ref={socialRef} style={{ height: 200, overflowY: "auto", opacity: chatOn ? 1 : 0.35 }}>
                    {socialMsgs.length === 0 && <div style={{ fontSize: 11, color: T.faint }}>Public chat — say anything to other traders. Coin names are clickable.</div>}
                    {socialMsgs.map(renderSocial)}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                    <input value={draft} onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && sendDraft()}
                      placeholder={chatOn ? "Message the room…" : "Chat is off — turn it on to talk"}
                      disabled={!chatOn}
                      style={{ ...inp, flex: 1, opacity: chatOn ? 1 : 0.4 }} />
                    <button onClick={sendDraft} disabled={!chatOn}
                      style={{ ...chip(true), padding: "0 16px", opacity: chatOn ? 1 : 0.4, cursor: chatOn ? "pointer" : "not-allowed" }}>SEND</button>
                  </div>
                </>
              ) : chatTab === "coin" ? (
                selected ? (
                  <>
                    <div ref={coinRef} style={{ height: 200, overflowY: "auto", opacity: chatOn ? 1 : 0.35 }}>
                      <div style={{ fontSize: 9.5, color: T.faint, fontFamily: T.mono, marginBottom: 8 }}>
                        💬 Room for <span style={{ color: "#f2e394", fontWeight: 800 }}>${selected.sym}</span> only — no cross-coin clutter.
                      </div>
                      {(coinChats[selected.id] || []).length === 0 && <div style={{ fontSize: 11, color: T.faint }}>Be the first to say something about ${selected.sym}.</div>}
                      {(coinChats[selected.id] || []).map((m) => (
                        <div key={m.id} style={{ margin: "6px 0", fontFamily: T.mono, fontSize: 11, lineHeight: 1.55 }}>
                          <span style={{ color: T.faint, fontSize: 9.5 }}>{m.ts} </span>
                          <span onClick={() => !m.me && setProfileUser(m.user)}
                            style={{ color: m.me ? accent(258, 68) : T.blue, cursor: m.me ? "default" : "pointer", textDecoration: m.me ? "none" : "underline dotted", textUnderlineOffset: 2 }}>@{m.user}</span>
                          <span style={{ color: T.text }}> {m.text}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <input value={draft} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && sendDraft()}
                        placeholder={chatOn ? `Talk about $${selected.sym}…` : "Chat is off"}
                        disabled={!chatOn} style={{ ...inp, flex: 1, opacity: chatOn ? 1 : 0.4 }} />
                      <button onClick={sendDraft} disabled={!chatOn}
                        style={{ ...chip(true), padding: "0 16px", opacity: chatOn ? 1 : 0.4 }}>SEND</button>
                    </div>
                  </>
                ) : (
                  <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.mono, fontSize: 11, color: T.faint }}>
                    Open a coin to join its room.
                  </div>
                )
              ) : chatTab === "alerts" ? (
                <div ref={alertRef} style={{ height: 240, overflowY: "auto" }}>
                  <div style={{ fontSize: 9.5, color: T.faint, fontFamily: T.mono, marginBottom: 8 }}>
                    Only rising & falling coins live here — click any coin name to open its chart.
                  </div>
                  {alerts.length === 0 && <div style={{ fontSize: 11, color: T.faint }}>Updrift surges, hard drops and launches will land here.</div>}
                  {alerts.map(renderAlert)}
                </div>
              ) : (
                <div ref={privRef} style={{ height: 240, overflowY: "auto" }}>
                  <div style={{ fontSize: 9.5, color: T.faint, fontFamily: T.mono, marginBottom: 8 }}>
                    🔒 Your fills, bot activity and PnL — never posted publicly.
                  </div>
                  {privLog.length === 0 && <div style={{ fontSize: 11, color: T.faint }}>Your buys, sells and PnL will appear here.</div>}
                  {privLog.map(renderMsg)}
                </div>
              )}
            </div>
  );

  // mobile: the auto trader lives ONLY on its own page (bar under holders)
  const ticketBlock = null;

  // compact hotbar — the only trade controls; MAX & SELL ALL included
  const mobileTradeStrip = selected && (() => {
    const a = parseFloat(amount) || 0;
    const usdOf = (amtSol) => amtSol * SOL_USD;
    const pos = positions[selected.id];
    const held = pos?.amt || 0;
    const pnlPct = pos ? ((selected.price - pos.entry) / pos.entry) * 100 : 0;
    const posPay = (pos && pos.pay) || "SOL";
    const heldSol = posPay === "SOL" ? held : (held * 0.0125) / SOL_USD; // held value expressed in SOL
    const livePnlUsd = pos ? (held * (selected.price / pos.entry) - held) * (posPay === "SOL" ? SOL_USD : 0.0125) : 0;
    const liveMult = pos ? selected.price / pos.entry : 0;
    const gain = livePnlUsd >= 0;
    const sellCol = !pos ? T.red : pnlPct > 0.05 ? T.green : pnlPct < -0.05 ? T.red : "#4a5266";
    const bidSol = pay === "SOL" ? a : (a * selected.price) / SOL_USD;
    const sellAllSol = pay === "SOL" ? held : (held * selected.price) / SOL_USD;
    const bestMult = bestMultByToken[selected.id];
    const confirmTap = (side, fire) => {
      if (hbConfirmRef.current && hbConfirmRef.current.side === side) {
        clearTimeout(hbConfirmRef.current.t); hbConfirmRef.current = null; setHbConfirm(null);
        fire();
      } else {
        if (hbConfirmRef.current) clearTimeout(hbConfirmRef.current.t);
        const t = setTimeout(() => { hbConfirmRef.current = null; setHbConfirm(null); }, 2600);
        hbConfirmRef.current = { side, t }; setHbConfirm(side);
      }
    };
    const setPct = (p, ofHoldings) => {
      if (ofHoldings) setAmount(pay === "SOL" ? (held * p / 100).toFixed(4) : Math.floor(held * p / 100).toString());
      else { const bal = pay === "SOL" ? solBalance : myHoldings; setAmount(String(feeSafe(bal * p / 100, pay))); }
    };
    return (
    <div>
      {/* LIVE PnL + animated multiplier popup — appears while holding */}
      {pos ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 10, padding: "7px 11px", marginBottom: 7, background: gain ? "rgba(22,199,132,0.12)" : "rgba(234,57,67,0.12)", border: `1px solid ${gain ? "rgba(22,199,132,0.4)" : "rgba(234,57,67,0.4)"}`, transition: "background .3s" }}>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.faint }}>LIVE P/L · avg ${fmtP(pos.entry)}</div>
            <div style={{ fontFamily: T.mono, fontSize: 17, fontWeight: 900, color: gain ? T.green : T.red }}>{gain ? "+" : "−"}${Math.abs(livePnlUsd).toFixed(2)}</div>
            <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: T.text, opacity: 0.9 }}>{fmtQty(posTokenQty(selected, pos))} tokens</div>
            <div style={{ fontFamily: T.mono, fontSize: 7.5, color: T.dim, lineHeight: 1.5 }}>
              BUY-IN ${((pos.amt || 0) * (pay === "SOL" ? SOL_USD : 0.0125)).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              <span style={{ color: realized24For(selected.sym) >= 0 ? T.green : T.red }}> · R24H {realized24For(selected.sym) >= 0 ? "+" : "−"}${Math.abs(realized24For(selected.sym)).toFixed(2)}</span>
              <span style={{ color: gain ? T.green : T.red }}> · UNRLZ {gain ? "+" : "−"}${Math.abs(livePnlUsd).toFixed(2)}</span>
            </div>
          </div>
          <MultBadge mult={liveMult} live />
        </div>
      ) : bestMult ? (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 10, padding: "5px 11px", marginBottom: 7, background: "rgba(255,255,255,0.02)", border: `1px solid ${T.border}` }}>
          <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>YOUR BEST ON {selected.sym}</span>
          <MultBadge mult={bestMult} record small />
        </div>
      ) : null}

      {/* settlement flip (shows your live balance of each) + amount */}
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <button onClick={() => setPay(pay === "SOL" ? "VALO" : "SOL")}
          title="Tap to swap settlement — the label is your live balance"
          style={{ ...chip(true), padding: "6px 8px", fontSize: 9, minWidth: 62, lineHeight: 1.3 }}>
          {pay === "SOL" ? `${solBalance.toFixed(1)} SOL` : `${fmtQty(valoWallet)} $VALO`}
        </button>
        <input value={amount} onChange={(e) => { setAmount(e.target.value); setPctSel(null); }}
          style={{ ...inp, flex: 1, minWidth: 0, padding: "6px 6px", fontSize: 12.5, textAlign: "center" }} />
        <button onClick={() => setMobileBotScreen(true)}
          style={{ flex: "0 0 auto", border: `1px solid ${pendingOrders.length ? `${T.amber}88` : T.border2}`, background: pendingOrders.length ? "rgba(240,185,11,0.12)" : "rgba(255,255,255,0.03)",
            color: pendingOrders.length ? T.amber : T.dim, borderRadius: 8, padding: "8px 10px", fontFamily: T.mono, fontSize: 10, fontWeight: 900, cursor: "pointer",
            boxShadow: pendingOrders.length ? `0 0 8px ${T.amber}44` : "none" }}>
          🤖{pendingOrders.length > 0 ? ` ${pendingOrders.length}` : ""}
        </button>
      </div>

      {/* split hotbar — BUY side (% of wallet) | SELL side (% of holdings) */}
      <div style={{ display: "flex", gap: 6 }}>
        {/* BUY side */}
        <div style={{ flex: 1, background: "rgba(22,199,132,0.06)", border: "1px solid rgba(22,199,132,0.28)", borderRadius: 10, padding: 6 }}>
          <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
            <button onClick={() => setBuyChipMode((m) => (m === "pct" ? "fix" : "pct"))}
              title="Switch between % of wallet and fixed amounts"
              style={{ flex: "0 0 auto", ...chip(false), padding: "5px 5px", fontSize: 7.5, fontWeight: 900, color: T.green, borderColor: "rgba(22,199,132,0.4)" }}>
              {buyChipMode === "pct" ? "%" : pay === "SOL" ? "◎" : "$V"}
            </button>
            {buyChipMode === "pct" ? buyPcts.map((p, ci) => {
              const on = pctSel && pctSel.side === "buy" && pctSel.p === p;
              return (
                <button key={ci} onClick={() => { setPct(p, false); setPctSel({ side: "buy", p }); }}
                  {...chipEditProps(() => { askPct(p, (nv) => setBuyPcts((A) => A.map((x, j) => (j === ci ? nv : x)))); })}
                  style={{ flex: 1, ...chip(false), padding: "5px 0", fontSize: 8, textAlign: "center",
                    fontWeight: on ? 900 : 400,
                    color: on ? "#07130d" : p === 100 ? T.amber : T.dim,
                    background: on ? T.green : "transparent",
                    borderColor: on ? T.green : p === 100 ? "rgba(240,185,11,0.4)" : T.border,
                    boxShadow: on ? "0 0 8px rgba(22,199,132,0.4)" : "none" }}>{p === 100 ? "MAX" : p}</button>
              );
            }) : buyFixed.map((v, ci) => (
              <button key={"f" + ci} onClick={() => { setAmount(String(v)); setPctSel(null); }}
                {...chipEditProps(() => { askAmt(v, (nv) => setBuyFixed((A) => A.map((x, j) => (j === ci ? nv : x)))); })}
                style={{ flex: 1, ...chip(parseFloat(amount) === v), padding: "5px 0", fontSize: 8, textAlign: "center", fontWeight: 800, color: T.green }}>{v}</button>
            ))}
          </div>
          <button onClick={() => confirmTap("buy", () => execute(selected, { side: "buy", pay, amt: a, mode: "instant", tax: taxFor(pay), burn: splitFee(a, pay).total, legs: [] }))}
            style={{ width: "100%", border: "none", borderRadius: 8, padding: "10px 4px", fontFamily: T.mono, fontWeight: 900,
              background: hbConfirm === "buy" ? T.amber : T.green, color: hbConfirm === "buy" ? "#1d1503" : "#07130d", cursor: "pointer",
              boxShadow: hbConfirm === "buy" ? "0 0 16px rgba(240,185,11,0.55)" : "0 0 12px rgba(22,199,132,0.28)", lineHeight: 1.15, transition: "background .15s, box-shadow .15s" }}>
            <div style={{ fontSize: hbConfirm === "buy" ? 11.5 : 13 }}>{hbConfirm === "buy" ? "⚠ CONFIRM BUY" : "⚡ BUY"}</div>
            <div style={{ fontSize: 8, opacity: 0.9 }}>{hbConfirm === "buy" ? "tap again to fire" : `${bidSol.toFixed(2)} SOL`}</div>
          </button>
        </div>
        {/* SELL side */}
        <div style={{ flex: 1, background: "rgba(234,57,67,0.06)", border: "1px solid rgba(234,57,67,0.28)", borderRadius: 10, padding: 6 }}>
          <div style={{ display: "flex", gap: 3, marginBottom: 5 }}>
            {sellPcts.map((p, ci) => {
              const on = pctSel && pctSel.side === "sell" && pctSel.p === p;
              return (
                <button key={ci} onClick={() => { setPct(p, true); setPctSel({ side: "sell", p }); }} disabled={held <= 0}
                  {...chipEditProps(() => { askPct(p, (nv) => setSellPcts((A) => A.map((x, j) => (j === ci ? nv : x)))); })}
                  style={{ flex: 1, ...chip(false), padding: "5px 0", fontSize: 8, textAlign: "center",
                    fontWeight: on ? 900 : 400,
                    color: on ? "#170808" : held <= 0 ? T.faint : p === 100 ? T.amber : T.dim,
                    background: on ? T.red : "transparent",
                    borderColor: on ? T.red : p === 100 ? "rgba(240,185,11,0.4)" : T.border,
                    boxShadow: on ? "0 0 8px rgba(234,57,67,0.4)" : "none",
                    opacity: held <= 0 ? 0.5 : 1 }}>{p === 100 ? "ALL" : p}</button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={() => confirmTap("sell", () => execute(selected, { side: "sell", pay, amt: a, mode: "instant", tax: taxFor(pay), burn: splitFee(a, pay).total, legs: [] }))}
              style={{ flex: 1.5, border: "none", borderRadius: 8, padding: "10px 2px", fontFamily: T.mono, fontWeight: 900,
                background: hbConfirm === "sell" ? T.amber : sellCol, color: hbConfirm === "sell" ? "#1d1503" : "#170808", cursor: "pointer", lineHeight: 1.15,
                boxShadow: hbConfirm === "sell" ? "0 0 16px rgba(240,185,11,0.55)" : "none", transition: "background .15s, box-shadow .15s" }}>
              <div style={{ fontSize: hbConfirm === "sell" ? 10.5 : 12 }}>{hbConfirm === "sell" ? "⚠ CONFIRM SELL" : "⚡ SELL"}</div>
              <div style={{ fontSize: 7.5, opacity: 0.9 }}>{hbConfirm === "sell" ? "tap again to fire" : `${bidSol.toFixed(2)} SOL`}</div>
            </button>
            <button onClick={() => { if (held > 0) confirmTap("sellall", () => execute(selected, { side: "sell", pay, amt: held, mode: "instant", tax: taxFor(pay), burn: splitFee(held, pay).total, legs: [] })); }}
              disabled={held <= 0}
              style={{ flex: 1, border: `1px solid ${hbConfirm === "sellall" ? T.amber : sellCol}`, borderRadius: 8, padding: "10px 2px", fontFamily: T.mono, fontWeight: 800,
                background: hbConfirm === "sellall" ? "rgba(240,185,11,0.25)" : `${sellCol}22`, color: hbConfirm === "sellall" ? T.amber : sellCol, cursor: held > 0 ? "pointer" : "not-allowed", opacity: held > 0 ? 1 : 0.5, lineHeight: 1.1 }}>
              <div style={{ fontSize: 9 }}>{hbConfirm === "sellall" ? "⚠2×" : "ALL"}</div>
              <div style={{ fontSize: 7, opacity: 0.85 }}>{held > 0 ? `${sellAllSol.toFixed(1)}◎` : "—"}</div>
            </button>
          </div>
        </div>
      </div>
    </div>
    );
  })();

  // ---- airdrop derived values ----
  const msToEpoch = (epochRef.current + 1) * EPOCH_MS - now;
  const holdPctNow = myHoldings / supplyHeld;
  const volPctNow = poolVol > 0 ? myEpochVol / poolVol : 0;
  const weightNow = holdPctNow * 0.5 + volPctNow * 0.5;
  const loyaltyMult = Math.min(2.5, 1 + loyaltyDays * 0.1); // +0.1x/day, resets to 1x on withdraw
  // CALLOUT LEADERBOARD BONUS — land top-100 on any duration board and every
  // epoch snapshot adds it: 11th–100th +0.10 · 10th +0.14 · 9th +0.17 · 8th +0.20
  // 7th +0.23 · 6th +0.26 · 5th +0.29 · 4th +0.32 · 3rd +0.36 · 2nd +0.42 · 1st +0.50
  // — and bonuses STACK across every duration you place on (up to +4.0 total)
  const lbBonusFor = (r) => r < 1 ? 0 : r === 1 ? 0.5 : r === 2 ? 0.42 : r === 3 ? 0.36 : r === 4 ? 0.32 : r === 5 ? 0.29 : r === 6 ? 0.26 : r === 7 ? 0.23 : r === 8 ? 0.20 : r === 9 ? 0.17 : r === 10 ? 0.14 : r <= 100 ? 0.10 : 0;
  const calloutBonus = useMemo(() => {
    const mine = Object.entries(myMcCallouts).map(([id, c]) => ({ you: true, mult: c.peak || 1 }));
    if (!mine.length) return { total: 0, hits: [] };
    const hits = [];
    Object.keys(LB_MAX).forEach((p) => {
      const board = [...genLeaderboard(p), ...mine].sort((a, b) => b.mult - a.mult);
      const rank = board.findIndex((e) => e.you) + 1;
      const b = lbBonusFor(rank);
      if (b > 0) hits.push({ p, rank, b });
    });
    return { total: hits.reduce((s, h) => s + h.b, 0), hits };
  }, [myMcCallouts]);
  const stackNow = loyaltyMult + calloutBonus.total; // every snapshot pays loyalty + stacked board bonuses
  const accruingNow = vaultTotal * weightNow * stackNow;
  const claimable = pendingEpochs.reduce((a, e) => a + e.amount, 0);

  const doClaim = (auto = false) => {
    if (!pendingEpochs.length) return;
    if (!auto && claiming) return;
    setClaiming(true);
    // API: GET /api/merkle/proof?wallet=…&epoch=… → submit claim tx (user pays SOL gas)
    setTimeout(() => {
      const total = pendingEpochs.reduce((a, e) => a + e.amount, 0);
      const n = pendingEpochs.length;
      setMyHoldings((h) => h + total);
      setPendingEpochs([]);
      setLoyaltyDays(0); // withdrawing resets the loyalty multiplier to 1x
      setClaiming(false);
      if (!auto) setClaimOpen(false);
      sayPrivate({ type: "pnl", gain: true, text: `🎁 ${auto ? "AUTO-" : ""}CLAIMED ${total.toFixed(4)} $VALO from ${n} epoch${n > 1 ? "s" : ""} — loyalty reset to 1×` });
    }, auto ? 400 : 1600);
  };

  // auto-claim: fire after each epoch depending on the user's setting
  useEffect(() => {
    if (autoFire === 0) return;
    if (autoClaim === "hourly" && pendingEpochs.length > 0) doClaim(true);
    else if (autoClaim === "atMult" && loyaltyMult >= autoMult - 1e-9 && pendingEpochs.length > 0) doClaim(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFire]);

  // banner items — every callout renders; ≥2x calls get green MC trail
  const bannerItems = callouts.map((c) => {
    const t = tokens.find((x) => x.id === c.tokenId);
    if (!t) return null;
    const mcNow = mcOf(t);
    const mult = mcNow / c.mcAt;
    return { ...c, t, mcNow, mult };
  }).filter(Boolean);

  return (
    <div style={{
      minHeight: "100vh", color: T.text, fontFamily: T.sans,
      background: `
        radial-gradient(1100px 500px at 12% -8%, rgba(96,78,204,0.055), transparent 60%),
        radial-gradient(900px 460px at 88% 4%, rgba(46,112,204,0.045), transparent 60%),
        radial-gradient(1200px 700px at 50% 110%, rgba(22,199,132,0.03), transparent 65%),
        linear-gradient(180deg, #0b0e15 0%, ${T.bg} 34%, #090c12 100%)
      `,
      backgroundAttachment: "fixed",
    }}>
      {/* GIANT TOP-LEFT LOGO + 3D DIAMOND (desktop) */}
      {!isMobile && (
        <div style={{ position: "fixed", left: 14, top: 6, zIndex: 30, display: "flex", alignItems: "center", gap: 10, pointerEvents: "none" }}>
          <button onClick={cycleTheme} className="valo-logo"
            title="Tap to change background mode"
            style={{ border: "none", background: "transparent", cursor: "pointer", pointerEvents: "auto", padding: 0,
              fontFamily: T.sans, fontWeight: 900, fontSize: 96, lineHeight: 0.9, letterSpacing: -4 }}>
            <span style={{ position: "relative", display: "inline-block" }}>
              <span key={themeWave ? themeWave.k : "idle"}
                className={`valo-letters${themeWave ? " vl-sweep" : ""}`}
                style={letterVars}>VALO</span>
            </span>
          </button>
          {/* simple rounded diamond (matches the icon) with a glow */}
          <div style={{ position: "relative", width: 64, height: 64, pointerEvents: "none" }}>
            <div style={{ position: "absolute", inset: -14, borderRadius: 24, background: "radial-gradient(circle, rgba(125,92,240,0.45), rgba(91,147,236,0.12) 60%, transparent 75%)" }} />
            <div style={{ position: "absolute", inset: 0, transform: "rotate(45deg)", borderRadius: 18,
              background: "linear-gradient(135deg, #a07ff2, #5b93ec)", boxShadow: "0 0 22px rgba(125,92,240,0.6)" }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "46%", transform: "rotate(45deg)", transformOrigin: "center", borderRadius: 18, background: "rgba(255,255,255,0.18)" }} />
            {/* gleam sweep on theme change — the diamond's own colours never change */}
            {themeWave && (
              <div key={themeWave.k} style={{ position: "absolute", inset: 0, borderRadius: 18, overflow: "hidden", transform: "rotate(45deg)" }}>
                <div style={{ position: "absolute", top: 0, bottom: 0, width: "45%",
                  background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.92), transparent)",
                  animation: "diamondGleam .85s ease-out forwards" }} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* PROFESSIONAL TOP RAIL — light pulses travel along circuit paths, fading at random */}
      {!isMobile && (
        <div style={{ height: 26, borderBottom: `1px solid ${T.border}`, background: "linear-gradient(180deg, #0b0e16, #0a0d13)", overflow: "hidden", position: "relative" }}>
          <svg width="100%" height="26" preserveAspectRatio="none" style={{ position: "absolute", inset: 0 }}>
            <defs>
              <linearGradient id="pulseG" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="hsl(258 80% 70%)" stopOpacity="0"/>
                <stop offset="50%" stopColor="hsl(258 90% 78%)" stopOpacity="1"/>
                <stop offset="100%" stopColor="hsl(210 80% 70%)" stopOpacity="0"/>
              </linearGradient>
            </defs>
            {/* base circuit lines */}
            <path id="pth1" d="M0,13 L360,13 L380,4 L680,4 L700,20 L1100,20 L1120,13 L2000,13" fill="none" stroke="rgba(120,110,200,0.10)" strokeWidth="1"/>
            <path id="pth2" d="M0,20 L240,20 L260,8 L560,8 L580,20 L900,20 L920,6 L2000,6" fill="none" stroke="rgba(90,140,220,0.08)" strokeWidth="1"/>
            {/* travelling light pulses */}
            <rect width="60" height="2" y="12" fill="url(#pulseG)" className="pulse pulse-a" rx="1"/>
            <rect width="46" height="2" y="19" fill="url(#pulseG)" className="pulse pulse-b" rx="1"/>
            <rect width="70" height="2" y="5" fill="url(#pulseG)" className="pulse pulse-c" rx="1"/>
            {/* node dots that blink */}
            {[380, 700, 1120, 260, 580, 920].map((x, i) => (
              <circle key={i} cx={x} cy={i < 3 ? 13 : 8} r="1.6" fill="hsl(258 80% 72%)" className={`node node-${i}`} />
            ))}
          </svg>
        </div>
      )}

      {/* header */}
      <div ref={headerRef} style={{ borderBottom: `1px solid ${T.border}`, background: "rgba(10,13,19,0.92)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 20 }}>
        {isMobile ? (
          /* MOBILE HEADER — clean, organized brand + stats */
          <div style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
              <button onClick={cycleTheme}
                title="Tap to change background mode"
                style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ position: "relative", display: "inline-block" }}>
                  <span key={themeWave ? themeWave.k : "idle"}
                    className={`valo-letters${themeWave ? " vl-sweep" : ""}`}
                    style={{ ...letterVars, fontFamily: T.sans, fontWeight: 900, fontSize: 30, lineHeight: 1, letterSpacing: -1 }}>VALO</span>
                </span>
                <span style={{ position: "relative", width: 20, height: 20, display: "inline-block" }}>
                  <span style={{ position: "absolute", inset: 0, borderRadius: 4, background: "linear-gradient(135deg, hsla(258,90%,72%,0.95), hsla(200,90%,65%,0.9))", transform: "rotate(45deg)", boxShadow: "0 0 10px hsla(258,90%,65%,0.7)", animation: "diamondPulse 3s ease-in-out infinite" }} />
                  {themeWave && (
                    <span key={themeWave.k} style={{ position: "absolute", inset: 0, borderRadius: 4, overflow: "hidden", transform: "rotate(45deg)" }}>
                      <span style={{ position: "absolute", top: 0, bottom: 0, width: "45%", display: "block",
                        background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.95), transparent)",
                        animation: "diamondGleam .85s ease-out forwards" }} />
                    </span>
                  )}
                </span>
              </button>
              {/* whitepaper + claim */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => { setNotifOpen(true); setNotifs((N) => N.map((n) => ({ ...n, read: true }))); }} title="Notifications"
                  style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    border: `1px solid ${T.border2}`, background: "rgba(125,92,240,0.08)", borderRadius: 9, padding: "7px 9px" }}>
                  <span style={{ fontSize: 15 }}>🔔</span>
                  {unreadCount > 0 && <span style={{ position: "absolute", top: -5, right: -5, minWidth: 15, height: 15, borderRadius: 8, background: T.red, color: "#fff", fontFamily: T.mono, fontSize: 8.5, fontWeight: 900, display: "grid", placeItems: "center", padding: "0 3px" }}>{unreadCount}</span>}
                </button>
                <button onClick={() => setWpOpen(true)} title="Read the whitepaper"
                  style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
                    border: `1px solid ${T.border2}`, background: "rgba(76,154,255,0.08)", borderRadius: 9, padding: "7px 9px" }}>
                  <span style={{ fontSize: 15 }}>📄</span>
                </button>
                {/* claim pill */}
                <button onClick={() => setClaimOpen(true)}
                  style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                    border: `1px solid ${claimable > 0 ? "rgba(22,199,132,0.5)" : T.border}`,
                    background: claimable > 0 ? "rgba(22,199,132,0.10)" : "rgba(255,255,255,0.02)",
                    borderRadius: 9, padding: "5px 10px", lineHeight: 1.1,
                    animation: claimable > 0 ? "claimPulse 2.4s ease-in-out infinite" : "none" }}>
                <span style={{ fontSize: 13 }}>🎁</span>
                <span style={{ textAlign: "left" }}>
                  <span style={{ display: "block", fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: claimable > 0 ? T.green : T.dim }}>
                    {claimable.toFixed(3)} <span style={{ color: VALO_PURPLE }}>$VALO</span>
                  </span>
                  <span style={{ display: "block", fontFamily: T.mono, fontSize: 7.5, color: T.faint, letterSpacing: 0.5 }}>
                    {autoClaim !== "off" ? "AUTO " : "CLAIM"}{pendingEpochs.length > 0 ? ` · ${pendingEpochs.length}×` : ""} · {fmtDur(msToEpoch).slice(0, 5)}
                  </span>
                </span>
              </button>
              </div>
            </div>
            {/* tidy stats strip */}
            <div style={{ display: "flex", gap: 0, fontFamily: T.mono, fontSize: 10, background: "rgba(255,255,255,0.02)", border: `1px solid ${T.border}`, borderRadius: 9, overflow: "hidden" }}>
              {[
                ["PRICE", <b style={{ color: VALO_PURPLE }}>${valoUsdPrice.toFixed(4)}</b>],
                ["TVL", <b>{fmt$(gTvl)}</b>],
                ["NET", <b style={{ color: gNet >= 0 ? T.green : T.red }}>{gNet >= 0 ? "+" : "−"}{fmt$(Math.abs(gNet))}</b>],
                ["24H PnL", <b style={{ color: platformPnl >= 0 ? T.green : T.red }}>{platformPnl >= 0 ? "+" : "−"}${Math.abs(platformPnl).toFixed(0)}</b>],
                ["🔥 BURN", <b onClick={() => setBurnOpen(true)} style={{ color: "#f97316", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}>{fmtQty(burned)}</b>],
              ].map(([k, v], i) => (
                <div key={k} style={{ flex: 1, textAlign: "center", padding: "6px 2px", borderLeft: i ? `1px solid ${T.border}` : "none" }}>
                  <div style={{ color: T.faint, fontSize: 7.5, letterSpacing: 0.8, marginBottom: 2 }}>{k}</div>
                  {v}
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div style={{ maxWidth: 1830, margin: "0 auto", padding: "12px 16px", paddingLeft: wallOpen ? 470 : 180, transition: "padding-left .28s", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: VALO_PURPLE, letterSpacing: 1.5, fontWeight: 700 }}>
              $VALO · LIVE ON PUMP.FUN
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 0.5, marginTop: 2 }}>
              Metrics below track the $VALO token · simulated feed · not financial advice
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "stretch", flexWrap: "wrap" }}>
            {[
              ["PRICE", `$${valoUsdPrice.toFixed(4)}`, VALO_PURPLE, "Current $VALO price"],
              ["TVL", fmt$(gTvl), T.text, null],
              ["NET FLOW", `${gNet >= 0 ? "+" : "−"}${fmt$(Math.abs(gNet))}`, gNet >= 0 ? T.green : T.red, null],
              ["24H PnL", `${platformPnl >= 0 ? "+" : "−"}$${Math.abs(platformPnl).toFixed(0)}`, platformPnl >= 0 ? T.green : T.red, "Your realized + unrealized PnL across all coins"],
            ].map(([k, v, col, tip]) => (
              <div key={k} title={tip || ""} style={{ background: "rgba(255,255,255,0.02)", border: `1px solid ${T.border}`, borderRadius: 9, padding: "6px 13px", minWidth: 78 }}>
                <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1, marginBottom: 2 }}>{k}</div>
                <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 800, color: col }}>{v}</div>
              </div>
            ))}
            <div onClick={() => setBurnOpen(true)} title="Burn tracker — your burn, site burn, circulating supply, live"
              style={{ cursor: "pointer", userSelect: "none", background: "rgba(249,115,22,0.05)", border: "1px solid rgba(249,115,22,0.25)", borderRadius: 9, padding: "6px 13px" }}>
              <div className="burn-swap" style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1, marginBottom: 2 }}>
                🔥 {burnMine ? "YOUR" : "TOTAL"} $VALO BURNED
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 800, color: "#f97316" }}>{(burnMine ? myBurned : burned).toFixed(4)}</div>
            </div>

            {/* NOTIFICATIONS */}
            <button onClick={() => { setNotifOpen(true); setNotifs((N) => N.map((n) => ({ ...n, read: true }))); }} title="Notifications — followed callouts, followers, friend requests"
              style={{ position: "relative", display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                border: `1px solid ${T.border2}`, background: "rgba(125,92,240,0.06)", borderRadius: 9, padding: "6px 12px" }}>
              <span style={{ fontSize: 15 }}>🔔</span>
              <span style={{ textAlign: "left", lineHeight: 1.15 }}>
                <span style={{ display: "block", fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: VALO_PURPLE }}>ALERTS</span>
                <span style={{ display: "block", fontFamily: T.mono, fontSize: 8, color: T.faint, letterSpacing: 0.3 }}>callouts · social</span>
              </span>
              {unreadCount > 0 && <span style={{ position: "absolute", top: -6, right: -6, minWidth: 16, height: 16, borderRadius: 8, background: T.red, color: "#fff", fontFamily: T.mono, fontSize: 9, fontWeight: 900, display: "grid", placeItems: "center", padding: "0 4px" }}>{unreadCount}</span>}
            </button>
            {/* WHITEPAPER */}
            <button onClick={() => setWpOpen(true)} title="Read the VALO whitepaper"
              style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer",
                border: `1px solid ${T.border2}`, background: "rgba(76,154,255,0.06)", borderRadius: 9, padding: "6px 12px" }}>
              <span style={{ fontSize: 15 }}>📄</span>
              <span style={{ textAlign: "left", lineHeight: 1.15 }}>
                <span style={{ display: "block", fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: T.blue }}>WHITEPAPER</span>
                <span style={{ display: "block", fontFamily: T.mono, fontSize: 8, color: T.faint, letterSpacing: 0.3 }}>how VALO works</span>
              </span>
            </button>

            {/* CLAIM REWARDS */}
            <button onClick={() => setClaimOpen(true)} title="Claim your rolling hourly airdrop"
              style={{
                display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                border: `1px solid ${claimable > 0 ? "rgba(22,199,132,0.5)" : T.border}`,
                background: claimable > 0 ? "rgba(22,199,132,0.10)" : "rgba(255,255,255,0.02)",
                borderRadius: 9, padding: "6px 12px", lineHeight: 1.2,
                animation: claimable > 0 ? "claimPulse 2.4s ease-in-out infinite" : "none",
              }}>
              <span style={{ fontSize: 15 }}>🎁</span>
              <span style={{ textAlign: "left" }}>
                <span style={{ display: "block", fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: claimable > 0 ? T.green : T.dim }}>
                  {claimable.toFixed(3)} <span style={{ color: VALO_PURPLE }}>$VALO</span>
                </span>
                <span style={{ display: "block", fontFamily: T.mono, fontSize: 8, color: T.faint, letterSpacing: 0.3 }}>
                  {autoClaim !== "off" ? "AUTO " : "CLAIM"}{pendingEpochs.length > 0 ? ` · ${pendingEpochs.length}×` : ""} · {fmtDur(msToEpoch).slice(0, 5)}
                </span>
              </span>
            </button>
          </div>
        </div>
        )}

        {/* CALLOUT NEWS BANNER — right→left, pauses on hover/touch, click → chart */}
        <div
          className={`ticker ${bannerPaused ? "paused" : ""}`}
          onMouseEnter={() => setBannerPaused(true)}
          onMouseLeave={() => setBannerPaused(false)}
          onTouchStart={() => setBannerPaused(true)}
          onTouchEnd={() => setBannerPaused(false)}
          style={{ borderTop: `1px solid ${T.border}`, background: "rgba(13,16,24,0.85)", overflow: "hidden", position: "relative",
            WebkitMaskImage: isMobile ? "none" : "linear-gradient(90deg, transparent 0, transparent 300px, #000 380px)",
            maskImage: isMobile ? "none" : "linear-gradient(90deg, transparent 0, transparent 300px, #000 380px)" }}
        >
          <div style={{ position: "absolute", left: isMobile ? 0 : 300, top: 0, bottom: 0, zIndex: 2, display: "flex", alignItems: "center", padding: "0 10px", background: "linear-gradient(90deg, #0d1018 55%, transparent)", fontFamily: T.mono, fontSize: 9, letterSpacing: 2, color: T.faint }}>
            📣 CALLOUTS
          </div>
          <div className="ticker-track">
            {[0, 1].map((dup) => (
              <div key={dup} className="ticker-half" aria-hidden={dup === 1}>
                {bannerItems.length === 0 && (
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.faint, padding: "0 40px" }}>
                    Waiting for community callouts…
                  </span>
                )}
                {bannerItems.map((c) => (
                  <button key={`${dup}-${c.id}`} onClick={() => { setSel(c.t.id); setClickMode(null); }}
                    style={{ background: "transparent", border: "none", cursor: "pointer", padding: "8px 0", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: T.mono, fontSize: 11, whiteSpace: "nowrap" }}>
                    <span style={{ color: T.dim }}>@{c.user}</span>
                    <span style={{ color: accent(c.t.hue), fontWeight: 800 }}>${c.t.sym}</span>
                    {c.mult >= 2 ? (
                      <span style={{ color: T.green, fontWeight: 800, textShadow: "0 0 8px rgba(22,199,132,0.5)" }}>
                        ▲ {c.mult.toFixed(1)}x · in @ {fmt$(c.mcAt)} MC → now {fmt$(c.mcNow)} MC
                      </span>
                    ) : (
                      <span style={{ color: T.faint }}>called @ {fmt$(c.mcAt)} MC</span>
                    )}
                    <span style={{ color: T.border2, padding: "0 14px" }}>◆</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1830, margin: "0 auto", padding: "14px 16px", paddingRight: isMobile ? 26 : 16, paddingLeft: isMobile ? 16 : (wallOpen ? 350 : 58), transition: "padding-left .28s" }}>
        {!isMobile && <div style={{ height: 8 }} />}
        <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
          {[["all", "All"], ["new", "🆕 New"], ["pump", "Pump.fun"], ["robinhood", "Robinhood"], ["safe", "🟢 Safe"], ["risky", "🔴 Risky"]].map(([k, l]) => (
            <button key={k} onClick={() => setFilter(k)} style={chip(filter === k)}>{l}</button>
          ))}
          <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>CARD CHART</span>
            <button onClick={() => setCardMini("line")} style={{ ...chip(cardMini === "line"), padding: "3px 8px" }}>∿</button>
            <button onClick={() => setCardMini("bars")} style={{ ...chip(cardMini === "bars"), padding: "3px 8px" }}>▮</button>
          </div>
        </div>

        {isMobile ? (
          /* MOBILE — tap a token to expand it full-screen; scroll up to exit */
          <>
            {/* search — tokens, CA & users. Follows down-screen under the banner. */}
            <StickySearch top={headerH}>
              <SearchBar tokens={tokens} username={username} full onPickToken={(id) => { setSel(id); setClickMode(null); }} onPickUser={(u) => setProfileUser(u)} />
            </StickySearch>
            {/* collapse toggle — sits under the platform selector */}
            <button onClick={() => setCompactList((v) => !v)}
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10, border: `1px solid ${T.border2}`, borderRadius: 9, padding: "8px", background: "rgba(255,255,255,0.02)", cursor: "pointer", fontFamily: T.mono, fontSize: 10.5, fontWeight: 700, letterSpacing: 1, color: compactList ? VALO_PURPLE : T.dim }}>
              {compactList ? "▤ COMPACT LIST · tap to expand cards" : "▦ EXPANDED CARDS · tap to collapse"}
            </button>

            <div style={{ display: "grid", gap: compactList ? 6 : 10, paddingRight: 6 }}>
              {shown.map((t) => (
                compactList
                  ? <TokenRow key={t.id} t={t} active={sel === t.id} calloutCount={calloutCountFor(t.id)} tf={tf}
                      onOpen={() => { setSel(sel === t.id ? null : t.id); setClickMode(null); }} />
                  : <TokenCard key={t.id} t={t} active={sel === t.id} calloutCount={calloutCountFor(t.id)} miniMode={cardMini} tf={tf}
                      onOpen={() => { setSel(sel === t.id ? null : t.id); setClickMode(null); }} />
              ))}
            </div>

            {selected && (
              <MobileExpanded
                onClose={() => setSel(null)}
                chartBlock={chartBlock}
                tradeStrip={mobileTradeStrip}
                ticketBlock={ticketBlock}
                sym={selected.sym}
                onChat={() => setDrawerOpen(true)}
              />
            )}
          </>
        ) : (
        <div className="pt-grid" ref={gridRef} style={{ display: "grid", gridTemplateColumns: `300px minmax(320px,1fr) ${(layoutPro ? 330 : 304) + Math.round(chartInsetR * 0.5)}px ${walletCollapsed ? 40 : 322 + Math.round(chartInsetR * 0.5)}px`, gap: 14, alignItems: "start", marginRight: -pullR, zoom: 1.06 }}>
          {/* scanner — slides left as the chart is pulled over, stays same width */}
          <div ref={scannerRef} style={{ transform: `translateX(${-pullX}px)`, transition: resizeRef.current ? "none" : "transform .2s", display: "grid", gap: 10, maxHeight: "calc(100vh - 185px)", overflowY: "auto", padding: "2px 10px 2px 2px" }}>
            {shown.map((t) => (
              <TokenCard key={t.id} t={t} active={sel === t.id} calloutCount={calloutCountFor(t.id)} miniMode={cardMini} tf={tf}
                onOpen={() => { setSel(sel === t.id ? null : t.id); setClickMode(null); }} />
            ))}
          </div>

          {/* center: chart (resizable) + chat below */}
          <div style={{ display: "grid", gap: 12, position: "relative", marginLeft: -pullX, width: `calc(100% + ${pullX}px)`, transition: resizeRef.current ? "none" : "margin-left .2s, width .2s" }}>
            <div style={{ position: "relative" }}>
              {!isMobile && selected && (
                <StickySearch top={headerH}>
                  <SearchBar tokens={tokens} username={username} full onPickToken={(id) => { setSel(id); setClickMode(null); }} onPickUser={(u) => setProfileUser(u)} />
                </StickySearch>
              )}
              <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 0 6px" }}>
                <button onClick={() => setLayoutPro((v) => !v)}
                  title={layoutPro ? "Back to the side-panel layout" : "Pro layout — trading desk under the chart, feeds on the right"}
                  style={{ ...chip(layoutPro), padding: "4px 11px", fontSize: 9.5, fontWeight: 900, letterSpacing: 1, color: layoutPro ? T.blue : T.dim, borderColor: layoutPro ? `${T.blue}66` : T.border }}>
                  {layoutPro ? "◧ SIDE LAYOUT" : "⿲ PRO LAYOUT"}
                </button>
              </div>
              {chartBlock}
            </div>
            {/* PRO LAYOUT: the full trading desk sits under the chart */}
            {layoutPro && selected ? (
              <div style={{ marginTop: 4, border: `1px solid ${T.border2}`, borderRadius: 12, overflow: "hidden", background: T.panel }}>
                {/* tabs fused to the desk — the border wraps buttons and content as one */}
                <div style={{ display: "flex", borderBottom: `1px solid ${T.border}` }}>
                  {[["ticket", "🧾 ORDER TICKET", T.blue], ["auto", "🤖 TRADER", T.amber], ["bots", `📊 MY BOTS · ${pendingOrders.filter((o) => !o.runId).length + botRuns.filter((r) => r.status === "live").length}`, T.amber]].map(([k, lab, col], i) => (
                    <button key={k} onClick={() => setTicketTab(k)}
                      style={{ flex: 1, border: "none", borderRight: i < 2 ? `1px solid ${T.border}` : "none",
                        borderBottom: ticketTab === k ? `2px solid ${col}` : "2px solid transparent",
                        background: ticketTab === k ? "rgba(255,255,255,0.035)" : "transparent",
                        color: ticketTab === k ? col : T.dim, padding: "8px 8px", fontFamily: T.mono, fontSize: 10, fontWeight: 900, letterSpacing: 1, cursor: "pointer" }}>
                      {lab}
                    </button>
                  ))}
                </div>
                <div style={{ padding: 6 }}>
                  <div>
                    {ticketTab === "bots" ? (
                      <AllBotsPanel tokens={tokens} curTokenId={selected && selected.id} pendingOrders={pendingOrders} botRuns={botRuns}
                        onEdit={(id, tid) => { setSel(tid); setClickMode(null); setTicketTab("auto"); setEditingBotId(id); }}
                        onCancel={cancelBot} onSellRun={sellRun} onSellAll={sellAllRuns} onOpenBotRun={(id) => setBotRunOpen(id)}
                        onHighlight={(id, tid) => { setSel(tid); setSelLineId(id); }}
                        onEditLine={(id, tid) => {
                  setSel(tid); setSelLineId(id);
                  const isExit = typeof id === "string" && id.endsWith("::vtSell");
                  const base = pendingOrders.find((o) => String(o.id) === String(isExit ? id.slice(0, -8) : id));
                  setEditLineReq({ id, level: base ? (isExit ? base.vtSell : base.level) : null, n: Date.now() });
                }} />
                    ) : ticketTab === "auto" ? (
                      <AutoTraderPanel solBalance={solBalance} valoWallet={valoWallet} token={selected} tokens={tokens} amount={amount} setAmount={setAmount} pay={pay} setPay={setPay} botLock={botLock}
                        wide
                        dragSetOn={botDragSet} onToggleDragSet={() => setBotDragSet((v) => !v)}
                        onStageSide={(m) => setBotSide(m)} onArmPair={armVisualPair}
                        onSetDragSet={(v) => setBotDragSet(!!v)} onLinesChange={(l) => setVtLines(l)}
                        onReadyArm={(fn) => { quickArmRef.current = fn; setQuickArmOn(!!fn); }}
                        onExecute={(o) => execute(selected, o)}
                        onDraftLevel={(lvl, tid, side) => setBotDraftLevel(lvl ? { tokenId: tid != null ? tid : selected.id, level: lvl, side: side || botSide } : null)}
                        pendingOrders={pendingOrders} botRuns={botRuns}
                        editingBotId={editingBotId} setEditingBotId={setEditingBotId}
                        onRelaunch={(id, o) => relaunchBot(id, o, selected)}
                        onCancelBot={cancelBot} onSellRun={sellRun} onOpenBotRun={(id) => setBotRunOpen(id)}
                        onOpenTokenAuto={(tid, botId) => { setSel(tid); setClickMode(null); setTicketTab("auto"); setEditingBotId(botId || null); }} />
                    ) : (
                      <ProOrderBar token={selected} amount={amount} setAmount={setAmount} pay={pay} setPay={setPay}
                        solBalance={solBalance} valoBalance={valoWallet} position={positions[selected.id]}
                        clickMode={clickMode} setClickMode={setClickMode}
                        realized24={realized24For(selected.sym)}
                        onExecute={(o) => execute(selected, o)} onPosTrade={onPosTrade} />
                    )}
                  </div>
                </div>
              </div>
            ) : !layoutPro && selected ? (
              <div style={{ display: "flex", gap: 8, alignItems: "stretch", marginTop: 10, minWidth: 0 }}>
                {ltMin ? (
                  <button onClick={() => setLtMin(false)} title="Expand live trades"
                    style={{ width: 28, border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.02)", borderRadius: 9, cursor: "pointer", color: T.dim, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 0" }}>
                    <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: T.mono, fontSize: 9, fontWeight: 800, letterSpacing: 2 }}>▸ LIVE TRADES</span>
                  </button>
                ) : (
                  <div style={{ flex: 1.15, minWidth: 0, display: "flex", gap: 5 }}>
                    <button onClick={() => setLtMin(true)} title="Minimize live trades"
                      style={{ width: 22, flex: "0 0 auto", border: `1px solid ${T.border}`, background: "transparent", borderRadius: 8, cursor: "pointer", color: T.faint, fontSize: 10 }}>◂</button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <LiveTrades token={selected} isMobile={false} traderPrefs={traderPrefs}
                        onPickTrader={(row) => setMarkerInfo({ trader: row.trader, side: row.isBuy ? "buy" : "sell", sym: selected.sym,
                          t: row.at, amt: +row.sol.toFixed(3), unit: "SOL", price: selected.price, mc: row.mc,
                          pnlPct: row.pnlPct != null ? row.pnlPct : null, pnlMoney: null, tx: row.tx })} />
                    </div>
                  </div>
                )}
                {chatMin ? (
                  <button onClick={() => setChatMin(false)} title="Expand chat"
                    style={{ width: 28, border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.02)", borderRadius: 9, cursor: "pointer", color: T.dim, display: "flex", alignItems: "center", justifyContent: "center", padding: "14px 0" }}>
                    <span style={{ writingMode: "vertical-rl", fontFamily: T.mono, fontSize: 9, fontWeight: 800, letterSpacing: 2 }}>CHAT ◂</span>
                  </button>
                ) : (
                  <div style={{ flex: 1, minWidth: 0, display: "flex", gap: 5 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>{chatBlock}</div>
                    <button onClick={() => setChatMin(true)} title="Minimize chat"
                      style={{ width: 22, flex: "0 0 auto", border: `1px solid ${T.border}`, background: "transparent", borderRadius: 8, cursor: "pointer", color: T.faint, fontSize: 10 }}>▸</button>
                  </div>
                )}
              </div>
            ) : layoutPro ? null : chatBlock}
          </div>

          {/* trade options — ORDER TICKET ⇄ AUTO TRADER · pro layout swaps this
              column for the LIVE TRADES + CHAT rail, both collapsible */}
          {layoutPro ? (
          <div style={{ position: "sticky", top: 70, maxHeight: "calc(100vh - 90px)", overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, overflow: "hidden" }}>
              <button onClick={() => setLtMin((v) => !v)}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", border: "none", background: "rgba(255,255,255,0.02)", padding: "10px 13px", cursor: "pointer", fontFamily: T.mono, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, color: T.dim }}>
                <span>⚡ LIVE TRADES</span><span>{ltMin ? "▸" : "▾"}</span>
              </button>
              {!ltMin && selected && (
                <div style={{ padding: 8 }}>
                  <LiveTrades token={selected} isMobile={false} traderPrefs={traderPrefs}
                    onPickTrader={(row) => setMarkerInfo({ trader: row.trader, side: row.isBuy ? "buy" : "sell", sym: selected.sym,
                      t: row.at, amt: +row.sol.toFixed(3), unit: "SOL", price: selected.price, mc: row.mc,
                      pnlPct: row.pnlPct != null ? row.pnlPct : null, pnlMoney: null, tx: row.tx })} />
                </div>
              )}
            </div>
            {selected && (
              <div style={{ marginTop: -10 }}>
                <MyPositionsHub tokens={tokens} positions={positions} botRuns={botRuns} pendingOrders={pendingOrders} pay={pay}
                  onOpenToken={(id) => { setSel(id); setClickMode(null); }} onSellPos={sellPos} onCloseTickets={closeAllTickets}
                  onSellRun={sellRun} onSellAllBots={sellAllRuns} onCancelBot={cancelBot} />
              </div>
            )}
            <div style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, overflow: "hidden" }}>
              <button onClick={() => setChatMin((v) => !v)}
                style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", border: "none", background: "rgba(255,255,255,0.02)", padding: "10px 13px", cursor: "pointer", fontFamily: T.mono, fontSize: 10, fontWeight: 900, letterSpacing: 1.5, color: T.dim }}>
                <span>💬 CHAT</span><span>{chatMin ? "▸" : "▾"}</span>
              </button>
              {!chatMin && <div style={{ padding: 8 }}>{chatBlock}</div>}
            </div>
          </div>
          ) : (
          <div style={{ position: "sticky", top: 70, maxHeight: "calc(100vh - 90px)", overflowY: "auto" }}>
            {selected && (
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <button onClick={() => setTicketTab("ticket")} style={{ ...chip(ticketTab === "ticket"), flex: 1, textAlign: "center", padding: "8px", fontSize: 10.5, fontWeight: 800 }}>🧾 ORDER TICKET</button>
                <button onClick={() => setTicketTab("auto")} style={{ ...chip(ticketTab === "auto"), flex: 1, textAlign: "center", padding: "8px", fontSize: 10, fontWeight: 800, color: ticketTab === "auto" ? T.amber : T.dim, borderColor: ticketTab === "auto" ? `${T.amber}66` : T.border }}>🤖 TRADER</button>
                <button onClick={() => setTicketTab("bots")} style={{ ...chip(ticketTab === "bots"), flex: 1, textAlign: "center", padding: "8px", fontSize: 10, fontWeight: 800, color: ticketTab === "bots" ? T.amber : T.dim, borderColor: ticketTab === "bots" ? `${T.amber}66` : T.border }}>📊 MY BOTS · {pendingOrders.filter((o) => !o.runId).length + botRuns.filter((r) => r.status === "live").length}</button>
              </div>
            )}
            {selected && ticketTab === "bots" ? (
              <AllBotsPanel tokens={tokens} curTokenId={selected && selected.id} pendingOrders={pendingOrders} botRuns={botRuns}
                onEdit={(id, tid) => { setSel(tid); setClickMode(null); setTicketTab("auto"); setEditingBotId(id); }}
                onCancel={cancelBot} onSellRun={sellRun} onSellAll={sellAllRuns} onOpenBotRun={(id) => setBotRunOpen(id)}
                onHighlight={(id, tid) => { setSel(tid); setSelLineId(id); }}
                onEditLine={(id, tid) => {
                  setSel(tid); setSelLineId(id);
                  const isExit = typeof id === "string" && id.endsWith("::vtSell");
                  const base = pendingOrders.find((o) => String(o.id) === String(isExit ? id.slice(0, -8) : id));
                  setEditLineReq({ id, level: base ? (isExit ? base.vtSell : base.level) : null, n: Date.now() });
                }} />
            ) : selected && ticketTab === "auto" ? (
              <AutoTraderPanel solBalance={solBalance} valoWallet={valoWallet} token={selected} tokens={tokens} amount={amount} setAmount={setAmount} pay={pay} setPay={setPay} botLock={botLock}
                dragSetOn={botDragSet} onToggleDragSet={() => setBotDragSet((v) => !v)}
                onStageSide={(m) => setBotSide(m)} onArmPair={armVisualPair}
                onSetDragSet={(v) => setBotDragSet(!!v)} onLinesChange={(l) => setVtLines(l)}
                onReadyArm={(fn) => { quickArmRef.current = fn; setQuickArmOn(!!fn); }}
                onExecute={(o) => execute(selected, o)}
                onDraftLevel={(lvl, tid, side) => setBotDraftLevel(lvl ? { tokenId: tid != null ? tid : selected.id, level: lvl, side: side || botSide } : null)}
                pendingOrders={pendingOrders} botRuns={botRuns}
                editingBotId={editingBotId} setEditingBotId={setEditingBotId}
                onRelaunch={(id, o) => relaunchBot(id, o, selected)}
                onCancelBot={cancelBot} onSellRun={sellRun} onOpenBotRun={(id) => setBotRunOpen(id)}
                onOpenTokenAuto={(tid, botId) => { setSel(tid); setClickMode(null); setTicketTab("auto"); setEditingBotId(botId || null); }} />
            ) : selected ? (
              <DesktopTradePanel token={selected} onExecute={(o, tok) => execute(tok || selected, o)}
                clickMode={clickMode} setClickMode={setClickMode}
                amount={amount} setAmount={setAmount} pay={pay} setPay={setPay}
                pctSel={pctSel} setPctSel={setPctSel}
                pendingOrders={pendingOrders} onOpenBot={(id) => { setTicketTab("auto"); setEditingBotId(id); }} onCancelBot={cancelBot} onPosTrade={onPosTrade}
                onDraftLevel={(lvl, tid, side) => setBotDraftLevel(lvl ? { tokenId: tid, level: lvl, side: side || botSide } : null)}
                realized24={realized24For(selected.sym)}
                position={positions[selected.id]} solBalance={solBalance} valoBalance={valoWallet}
                positions={positions} tokens={tokens} bestMult={bestMultByToken[selected.id]}
                onOpenToken={(id) => { setSel(id); setClickMode(null); }}
                onCloseAll={() => {
                  Object.entries(positions).forEach(([id, p]) => {
                    const tok = tokens.find((x) => x.id === +id);
                    if (tok && p && p.amt > 0) execute(tok, { side: "sell", pay: p.pay, amt: p.amt, mode: "instant", tax: taxFor(p.pay), burn: splitFee(p.amt, p.pay).total, legs: [] });
                  });
                }} />
            ) : (
              <div style={{ background: T.panel, border: `1px dashed ${T.border2}`, borderRadius: 12, padding: 24, textAlign: "center", color: T.faint, fontFamily: T.mono, fontSize: 11 }}>
                Select a pair to trade
              </div>
            )}
            {/* MY POSITIONS — bots + tickets, visible on every tab */}
            {selected && (
              <MyPositionsHub tokens={tokens} positions={positions} botRuns={botRuns} pendingOrders={pendingOrders} pay={pay}
                onOpenToken={(id) => { setSel(id); setClickMode(null); }} onSellPos={sellPos} onCloseTickets={closeAllTickets}
                onSellRun={sellRun} onSellAllBots={sellAllRuns} onCancelBot={cancelBot} />
            )}
          </div>
          )}

          {/* portfolio — its own column to the right of trade options.
              Collapses into a slim vertical rail to free width for the chart. */}
          {walletCollapsed ? (
            <div style={{ position: "sticky", top: 70 }}>
              <button onClick={() => setWalletCollapsed(false)} title="Expand wallet"
                style={{ width: 40, height: 250, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10,
                  background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, cursor: "pointer", color: T.dim, padding: 0 }}>
                <span style={{ fontSize: 14 }}>‹</span>
                <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: T.mono, fontSize: 10, fontWeight: 800, letterSpacing: 2, color: VALO_PURPLE }}>WALLET</span>
                <span style={{ fontSize: 14 }}>💼</span>
              </button>
            </div>
          ) : (
          <div style={{ position: "sticky", top: 70, maxHeight: "calc(100vh - 90px)", overflowY: "auto" }}>
            <button onClick={() => setWalletCollapsed(true)} title="Collapse wallet to free chart space"
              style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginBottom: 8,
                border: `1px solid ${T.border2}`, borderRadius: 9, padding: "6px", background: "rgba(255,255,255,0.02)", cursor: "pointer",
                fontFamily: T.mono, fontSize: 9.5, fontWeight: 700, letterSpacing: 1, color: T.dim }}>
              › COLLAPSE WALLET
            </button>
            <PortfolioPanel big
              solBalance={solBalance} valoWallet={valoWallet} positions={positions} tokens={tokens}
              realizedPnl={realizedPnl} unrealizedPnl={unrealizedAll} extraEquity={strategyEquityUsd}
              tab={portfolioTab} setTab={setPortfolioTab}
              range={perfRange} setRange={setPerfRange}
              mode={perfMode} setMode={setPerfMode} seed={pnlSeed}
              hideBalance={hideBalance} setHideBalance={setHideBalance}
              activity={myActivity} onOpenToken={(sym, act) => { const tk = tokens.find((x) => x.sym === sym); if (tk) { setSel(tk.id); setClickMode(null); if (typeof setPortfolioDrawer === 'function') setPortfolioDrawer(false); if (act) { setHistMarker({ t: act.t, side: act.side, p: act.price, price: act.price, amt: act.amt, unit: act.unit, mc: mcOf(tk), pnlPct: act.pnlPct, pnlMoney: act.pnlMoney, sym: act.sym, tx: act.tx }); setHighlightTx(act.tx); } } }}
              username={username} setUsername={(v) => { takenNames.current.add(v.toLowerCase()); setUsername(v); }} isNameTaken={(v) => takenNames.current.has(v.toLowerCase())}
              myCallouts={myMcCallouts} onOpenMyCallouts={() => setMyCalloutsOpen(true)}
              followersCount={followersList.length} followingCount={followingList.length} onOpenFollowList={(k) => setFollowListOpen(k)}
              nameChangedAt={nameChangedAt} setNameChangedAt={setNameChangedAt}
              pendingOrders={pendingOrders} onEditBot={(id) => setBotHub({ mode: "edit", id })} onCancelBot={cancelBot} onPosTrade={onPosTrade}
              botHistory={botRuns.filter((r) => r.status === "sold")} onOpenBotRun={(id) => setBotRunOpen(id)}
              epochLastHour={epochLastHour} epochTotalEarned={epochTotalEarned} valoUsdForEpoch={valoUsdPrice} onOpenClaim={() => { setClaimOpen(true); if (typeof setPortfolioDrawer === 'function') setPortfolioDrawer(false); }}
              maxDeposit={externalSol} maxWithdraw={solBalance}
              onDeposit={(amt) => { const a = Math.min(Math.max(0, amt), externalSol); if (a > 0) { setExternalSol((e) => e - a); setSolBalance((b) => b + a); } }}
              onWithdraw={(amt) => { const a = Math.min(Math.max(0, amt), solBalance); if (a > 0) { setSolBalance((b) => b - a); setExternalSol((e) => e + a); } }}
              onSwap={(amt, dir) => {
                if (!(amt > 0)) return;
                if (dir === "valo2sol") {
                  const need = amt; if (need <= valoWallet) { setValoWallet((v) => v - need); setSolBalance((b) => b + (need * 0.0125) / SOL_USD); }
                } else {
                  if (amt <= solBalance) { setSolBalance((b) => b - amt); setValoWallet((v) => v + (amt * SOL_USD) / 0.0125); }
                }
              }}
            />
          </div>
          )}
        </div>
        )}
      </div>

      {/* LEFT-WALL TOKEN PANEL — bordered, collapsible, spans down the screen */}
      {!isMobile && (
        <div ref={wallRef} style={{ position: "fixed", left: 0, top: 158, bottom: 14, zIndex: 45, display: "flex", alignItems: "stretch" }}>
          <div style={{
            width: wallOpen ? 340 : 44, transition: "width .28s cubic-bezier(.22,.8,.3,1)",
            background: "rgba(14,18,26,0.96)", border: `1px solid ${T.border2}`, borderLeft: "none",
            borderRadius: "0 14px 14px 0", boxShadow: "4px 0 24px rgba(0,0,0,0.45)",
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: wallOpen ? "space-between" : "center", padding: wallOpen ? "8px 10px" : "8px 0", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
              {wallOpen && <span style={{ fontFamily: T.mono, fontSize: 9.5, letterSpacing: 1.5, color: T.faint }}>◂ LIVE TICKERS</span>}
              <button onClick={() => setWallOpen((v) => !v)}
                style={{ ...chip(false), padding: "3px 8px", fontSize: 12 }}>{wallOpen ? "‹" : "›"}</button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: wallOpen ? "6px" : "6px 0" }}>
              {tokens.slice(4).map((t, i) => {
                const score = scoreToken(t);
                const rc = ratingColor(score);
                const ch = ((t.price - t.candles[Math.max(0, t.candles.length - 96)].c) / t.candles[Math.max(0, t.candles.length - 96)].c) * 100;
                if (!wallOpen) {
                  // collapsed: just a colored score dot per token
                  return (
                    <button key={t.id} onClick={() => { setSel(t.id); setClickMode(null); }}
                      className="wall-bar" title={`${t.sym} · ${score}`}
                      style={{ pointerEvents: "auto", cursor: "pointer", border: "none", background: "transparent", width: "100%", display: "flex", justifyContent: "center", padding: "5px 0" }}>
                      <span style={{ width: 20, height: 20, borderRadius: "50%", background: `${rc}22`, border: `1px solid ${rc}`, color: rc, fontFamily: T.mono, fontSize: 9, fontWeight: 800, display: "grid", placeItems: "center" }}>{score}</span>
                    </button>
                  );
                }
                return (
                  <button key={t.id} onClick={() => { setSel(t.id); setClickMode(null); }}
                    className="wall-bar"
                    style={{
                      pointerEvents: "auto", cursor: "pointer", border: `1px solid ${sel === t.id ? accent(t.hue, 45) : T.border}`, textAlign: "left", width: "100%",
                      background: "linear-gradient(90deg, rgba(22,27,37,0.9), rgba(17,21,29,0.8))",
                      borderRadius: 8, padding: "7px 9px", marginBottom: 5,
                      display: "flex", alignItems: "center", gap: 8,
                    }}>
                    <TokenAvatar sym={t.sym} hue={t.hue} img={t.img} size={16} />
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: T.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{t.sym}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 9, color: T.dim }}>{fmt$(mcOf(t))}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 9, color: ch >= 0 ? T.green : T.red, minWidth: 42, textAlign: "right" }}>{pct(ch)}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, color: rc, borderLeft: `1px solid ${T.border}`, paddingLeft: 7 }}>{score}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* background-mode toast (easter egg feedback) */}
      {themeFlash && (
        <div style={{ position: "fixed", left: "50%", transform: "translateX(-50%)", bottom: 90, zIndex: 80, pointerEvents: "none",
          display: "flex", alignItems: "center", gap: 9, background: T.panel, border: `1px solid ${T.border2}`,
          borderRadius: 999, padding: "8px 15px", boxShadow: "0 14px 40px rgba(0,0,0,0.5)" }}>
          <span style={{ width: 13, height: 13, borderRadius: "50%", background: THEMES[themeIdx].swatch, border: `1px solid ${T.border2}` }} />
          <span style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 800, letterSpacing: 2, color: T.text }}>{themeFlash}</span>
        </div>
      )}

      {/* TRADE MARKER RECEIPT */}
      {markerInfo && (
        <MarkerReceipt info={markerInfo} isMobile={isMobile} onClose={() => setMarkerInfo(null)}
          onOpenUser={(u) => setProfileUser(u)}
          onHighlight={(tx) => setHighlightTx(tx)}
          traderPrefs={traderPrefs} setTraderPref={setTraderPref} myName={username} />
      )}

      {/* WHITEPAPER MODAL — interactive reader with expandable TOC sidebar */}
      {wpOpen && <WhitepaperModal onClose={() => setWpOpen(false)} isMobile={isMobile} />}
      {calloutHubOpen && <CalloutHubModal onClose={() => setCalloutHubOpen(false)} isMobile={isMobile} myCallouts={myMcCallouts} tokens={tokens} />}
      {!isMobile && quickArmOn && armPop && (
        <button data-armpop="1" onClick={() => { const fn = quickArmRef.current; fn && fn(); setArmPop(null); }}
          title="Arm this strategy at the line you just set"
          style={{ position: "fixed", left: armPop.x + 14, top: Math.max(8, armPop.y - 48), zIndex: 92,
            border: "none", borderRadius: 9, padding: "7px 14px", fontFamily: T.mono, fontWeight: 900, letterSpacing: 1.2,
            background: T.blue, color: "#07101d", cursor: "pointer", boxShadow: `0 4px 18px rgba(46,112,204,0.55), 0 0 10px ${T.blue}66`,
            animation: "coPop .18s ease", textAlign: "left", lineHeight: 1.25 }}>
          <span style={{ fontSize: 11.5 }}>⚡ ARM · {(parseFloat(amount) || 0).toFixed(1)} {pay}</span>
          <span style={{ display: "block", fontSize: 8, fontWeight: 800, opacity: 0.8 }}>
            ≈ ${((parseFloat(amount) || 0) * (pay === "SOL" ? SOL_USD : 0.0125)).toLocaleString(undefined, { maximumFractionDigits: 0 })} buy-in
          </span>
        </button>
      )}
      {chipEditCfg && (
        <div onClick={() => setChipEditCfg(null)} style={{ position: "fixed", inset: 0, zIndex: 95, background: "rgba(4,6,10,0.7)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 300, background: T.panel, border: `1px solid ${chipEditErr ? T.red : T.border2}`, borderRadius: 14, padding: 15, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ fontFamily: T.mono, fontSize: 10.5, fontWeight: 900, letterSpacing: 1.5, marginBottom: 3 }}>{chipEditCfg.title}</div>
            <div style={{ fontFamily: T.mono, fontSize: 8, color: chipEditErr ? T.red : T.faint, marginBottom: 9 }}>{chipEditErr ? "that number's outside the range" : chipEditCfg.hint}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 11 }}>
              <input autoFocus value={chipEditVal} onChange={(e) => { setChipEditVal(e.target.value); setChipEditErr(false); }} inputMode="decimal"
                onKeyDown={(e) => { if (e.key === "Enter") { const v = chipEditCfg.validate(chipEditVal); if (v == null) setChipEditErr(true); else { chipEditCfg.cb(v); setChipEditCfg(null); } } }}
                style={{ ...inp, flex: 1, minWidth: 0, fontSize: 17, fontWeight: 900, padding: "10px 12px", textAlign: "center" }} />
              {chipEditCfg.unit && <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 900, color: VALO_PURPLE }}>{chipEditCfg.unit}</span>}
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              <button onClick={() => setChipEditCfg(null)} style={{ ...chip(false), flex: 1, textAlign: "center", padding: "10px", fontSize: 10.5, fontWeight: 800 }}>CANCEL</button>
              <button onClick={() => { const v = chipEditCfg.validate(chipEditVal); if (v == null) setChipEditErr(true); else { chipEditCfg.cb(v); setChipEditCfg(null); } }}
                style={{ flex: 1, border: "none", borderRadius: 8, padding: "10px", fontFamily: T.mono, fontSize: 10.5, fontWeight: 900, background: VALO_PURPLE, color: "#120b26", cursor: "pointer", boxShadow: `0 0 12px ${VALO_PURPLE}55` }}>SET</button>
            </div>
          </div>
        </div>
      )}
      {burnOpen && <BurnModal onClose={() => setBurnOpen(false)} isMobile={isMobile} myBurned={myBurned} siteBurned={burned} />}
      {ranksOpen && <RanksModal onClose={() => setRanksOpen(null)} isMobile={isMobile} myCallouts={myMcCallouts} tokens={tokens}
        myBest={Object.values(myMcCallouts).reduce((m, c) => Math.max(m, c.peak || 0), 0)}
        focusUser={ranksOpen.focus || null} onOpenUser={(u) => { setRanksOpen(null); setProfileUser(u); }} />}
      {lbOpen && <LeaderboardModal onClose={() => setLbOpen(false)} isMobile={isMobile} myCallouts={myMcCallouts} tokens={tokens}
        onOpenUser={(u) => setProfileUser(u)} />}
      {tierListOpen && <TierListModal onClose={() => setTierListOpen(false)} isMobile={isMobile}
        myBest={Object.values(myMcCallouts).reduce((m, c) => Math.max(m, c.peak || 0), 0)} />}
      {myCalloutsOpen && <MyCalloutsModal onClose={() => setMyCalloutsOpen(false)} isMobile={isMobile} myCallouts={myMcCallouts} tokens={tokens} username={username} onOpenToken={navigateToToken} />}
      {notifOpen && <NotificationsModal onClose={() => setNotifOpen(false)} isMobile={isMobile} notifs={notifs} friendReqs={friendReqs}
        onOpenToken={navigateToToken} onOpenUser={(u) => setProfileUser(u)}
        onAccept={(u) => { setFriendReqs((L) => L.filter((x) => x !== u)); setFriendsList((L) => [...L, u]); }}
        onDecline={(u) => setFriendReqs((L) => L.filter((x) => x !== u))}
        notifSetting={notifSetting} setNotifSetting={setNotifSetting} />}
      {followListOpen && <FollowListModal kind={followListOpen} list={followListOpen === "followers" ? followersList : followingList}
        onClose={() => setFollowListOpen(null)} isMobile={isMobile} onOpenUser={(u) => setProfileUser(u)} />}
      {profileUser && <UserProfileModal name={profileUser} onClose={() => setProfileUser(null)} isMobile={isMobile} tokens={tokens}
        isFollowing={followingList.includes(profileUser)}
        onToggleFollow={() => setFollowingList((L) => (L.includes(profileUser) ? L.filter((x) => x !== profileUser) : [...L, profileUser]))}
        friendStatus={friendsList.includes(profileUser) ? "friends" : sentFriendReqs.includes(profileUser) ? "requested" : "none"}
        onFriendAction={() => {
          if (friendsList.includes(profileUser)) return;
          setSentFriendReqs((L) => (L.includes(profileUser) ? L.filter((x) => x !== profileUser) : [...L, profileUser])); // tap again cancels
        }}
        onOpenTierList={() => setRanksOpen({ focus: profileUser })} onOpenLeaderboard={() => setRanksOpen({ focus: profileUser })}
        incomingReq={friendReqs.includes(profileUser)}
        onAcceptReq={() => { setFriendsList((F) => (F.includes(profileUser) ? F : [...F, profileUser])); setFriendReqs((R) => R.filter((x) => x !== profileUser)); }}
        onDeclineReq={() => setFriendReqs((R) => R.filter((x) => x !== profileUser))}
        onOpenToken={navigateToToken} solBalance={solBalance} valoWallet={valoWallet}
        onSendFunds={(a, unit) => {
          if (unit === "SOL") setSolBalance((b) => b - a); else setValoWallet((v) => v - a);
          setDmLogs((D) => ({ ...D, [profileUser]: [...(D[profileUser] || []), { me: true, text: `💸 sent ${a} ${unit === "SOL" ? "SOL" : "$VALO"}` }] }));
        }}
        dmLog={dmLogs[profileUser] || []}
        onSendDm={(text) => setDmLogs((D) => ({ ...D, [profileUser]: [...(D[profileUser] || []), { me: true, text }] }))} />}
      {botHub && <BotHubModal view={botHub} setView={setBotHub} orders={pendingOrders} tokens={tokens} selectedId={selected && selected.id}
        onSave={saveBot} onCancelBot={cancelBot} onClose={() => { setBotHub(null); setBotDraftLevel(null); }} isMobile={isMobile}
        onDraftLevel={(lvl, tid, side) => setBotDraftLevel(lvl ? { tokenId: tid, level: lvl, side: side || botSide } : null)}
                realized24={realized24For(selected.sym)} />}
      {/* MOBILE AUTO-TRADER PAGE — chart + bot metrics on one screen */}
      {isMobile && mobileBotScreen && selected && (
        <div style={{ position: "fixed", inset: 0, zIndex: 66, background: T.bg, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800 }}>🤖 AUTO-TRADER · <span style={{ color: accent(selected.hue) }}>${selected.sym}</span></div>
            <button onClick={() => { setMobileBotScreen(false); setEditingBotId(null); setBotDraftLevel(null); }} style={{ ...chip(false), padding: "5px 11px", fontSize: 12 }}>✕ Close</button>
          </div>
          <ProChart candles={selected.candles} hue={selected.hue} synthetic={!selected.hasDex}
            mode="candles" tfMin={tf} trades={chartTrades} traderPrefs={traderPrefs} theme={themeIdx}
            onMarkerClick={(tr) => { setMarkerInfo(tr); if (tr && tr.tx) setHighlightTx(tr.tx); }} highlightTx={highlightTx}
            price={selected.price} sym={selected.sym} isMobile height={Math.round((typeof window !== "undefined" ? window.innerHeight : 800) * 0.38)}
            pendingLevels={[
              ...pendingOrders.filter((o) => String(o.tokenId) === String(selected.id)),
              ...pendingOrders.filter((o) => String(o.tokenId) === String(selected.id) && o.vt && o.side === "buy" && o.vtSell > 0)
                .map((o) => ({ id: o.id + "::vtSell", level: o.vtSell, side: "sell", vt: true, amt: o.amt, pay: o.pay })),
              ...(vtLines && String(vtLines.tokenId) === String(selected.id) ? [
                ...(vtLines.buy > 0 ? [{ level: vtLines.buy, side: "buy", vt: true }] : []),
                ...(vtLines.sell > 0 ? [{ level: vtLines.sell, side: "sell", vt: true }] : []),
              ] : []),
              ...(botDraftLevel && String(botDraftLevel.tokenId) === String(selected.id) ? [{ level: botDraftLevel.level, side: botDraftLevel.side || "buy", draft: true, vt: !!vtLines }] : []),
            ]}
            botRuns={botRuns.filter((r) => r.status === "live" && String(r.tokenId) === String(selected.id))}
            botSetMode={botDragSet} onBotLineDrag={dragBotLine} selectedLineId={selLineId} editLineReq={editLineReq}
            onLineSelect={(id) => setSelLineId(id)}
            onBotDraft={(lvl) => setBotDraftLevel({ tokenId: selected.id, level: lvl, side: botSide })}
            onBotSet={(lvl, at) => { setBotDraftLevel({ tokenId: selected.id, level: lvl, side: botSide }); setBotLock({ level: lvl, n: Date.now(), side: botSide }); setBotDragSet(false); if (at && !isMobile) setArmPop(at); }} />
          {/* drag-set toggle + page tabs — chart above stays in view for both */}
          <div style={{ display: "flex", gap: 5, padding: "7px 10px 0" }}>
            <button onClick={() => setBotDragSet((v) => !v)} style={{ ...chip(botDragSet), flex: 1.2, textAlign: "center", padding: "7px 2px", fontFamily: T.mono, fontSize: 8, fontWeight: 800, color: botDragSet ? T.amber : T.dim, borderColor: botDragSet ? `${T.amber}66` : T.border }}>✋ DRAG-SET {botDragSet ? "ON" : "OFF"}</button>
            <button onClick={() => setMobPageTab("trader")} style={{ ...chip(mobPageTab === "trader"), flex: 1, textAlign: "center", padding: "7px 2px", fontFamily: T.mono, fontSize: 8.5, fontWeight: 800 }}>🤖 TRADER</button>
            <button onClick={() => setMobPageTab("visual")} style={{ ...chip(mobPageTab === "visual"), flex: 1, textAlign: "center", padding: "7px 2px", fontFamily: T.mono, fontSize: 8.5, fontWeight: 800, color: mobPageTab === "visual" ? T.amber : T.dim, borderColor: mobPageTab === "visual" ? `${T.amber}66` : T.border }}>👁 VISUAL</button>
            <button onClick={() => setMobPageTab("bots")} style={{ ...chip(mobPageTab === "bots"), flex: 1, textAlign: "center", padding: "7px 2px", fontFamily: T.mono, fontSize: 8.5, fontWeight: 800 }}>📊 ALL BOTS</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
            {mobPageTab === "bots" ? (
              <AllBotsPanel tokens={tokens} curTokenId={selected && selected.id} pendingOrders={pendingOrders} botRuns={botRuns}
                onEdit={(id, tid) => { setSel(tid); setClickMode(null); setEditingBotId(id);
                  const ord = pendingOrders.find((o) => o.id === id);
                  setMobPageTab(ord && ord.vt ? "visual" : "trader"); }}
                onCancel={cancelBot} onSellRun={sellRun} onSellAll={sellAllRuns} onOpenBotRun={(id) => setBotRunOpen(id)}
                onHighlight={(id, tid) => { setSel(tid); setSelLineId(id); }}
                onEditLine={(id, tid) => {
                  setSel(tid); setSelLineId(id);
                  const isExit = typeof id === "string" && id.endsWith("::vtSell");
                  const base = pendingOrders.find((o) => String(o.id) === String(isExit ? id.slice(0, -8) : id));
                  setEditLineReq({ id, level: base ? (isExit ? base.vtSell : base.level) : null, n: Date.now() });
                }} />
            ) : mobPageTab === "visual" ? (
              <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "8px 11px", marginBottom: 8, fontFamily: T.mono }}>
                <span style={{ fontSize: 7.5, letterSpacing: 1.5, color: T.faint }}>💼 WALLET</span>
                <span onClick={() => { setPay("SOL"); setAmount(String(feeSafe(solBalance, "SOL"))); }}
                  title="tap a balance to load it as your buy-in (a hair under, to cover tax + tx fees)"
                  style={{ fontSize: 10, fontWeight: 800, color: T.blue, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}>{solBalance.toFixed(2)} SOL</span>
                <span onClick={() => { setPay("VALO"); setAmount(String(feeSafe(valoWallet, "VALO"))); }}
                  title="tap a balance to load it as your buy-in (a hair under, to cover tax + tx fees)"
                  style={{ fontSize: 10, fontWeight: 800, color: VALO_PURPLE, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}>{fmtQty(valoWallet)} $VALO</span>
                <span style={{ fontSize: 10.5, fontWeight: 900, color: T.text }}>${(solBalance * SOL_USD + valoWallet * valoUsdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
              <VisualTrading token={selected} amount={amount} setAmount={setAmount} pay={pay} setPay={setPay} compactArm
                editBot={pendingOrders.find((o) => o.id === editingBotId && o.vt) || null}
                botLock={botLock} onStageSide={(m) => setBotSide(m)} onArmPair={armVisualPair}
                dragSetOn={botDragSet} onToggleDragSet={() => setBotDragSet((v) => !v)}
                onSetDragSet={(v) => setBotDragSet(!!v)} onLinesChange={(l) => setVtLines(l)}
                onDraftLevel={(lvl, tid, side) => setBotDraftLevel(lvl ? { tokenId: tid != null ? tid : selected.id, level: lvl, side: side || botSide } : null)} />
              </>
            ) : (
            <>
            {/* live wallet — state-driven, so it moves the instant any bot or trade does */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: `1px solid ${T.border2}`, background: "rgba(255,255,255,0.02)", borderRadius: 10, padding: "8px 11px", marginBottom: 8, fontFamily: T.mono }}>
              <span style={{ fontSize: 7.5, letterSpacing: 1.5, color: T.faint }}>💼 WALLET</span>
              <span onClick={() => { setPay("SOL"); setAmount(String(feeSafe(solBalance, "SOL"))); }}
                title="tap a balance to load it as your buy-in (a hair under, to cover tax + tx fees)"
                style={{ fontSize: 10, fontWeight: 800, color: T.blue, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}>{solBalance.toFixed(2)} SOL</span>
              <span onClick={() => { setPay("VALO"); setAmount(String(feeSafe(valoWallet, "VALO"))); }}
                title="tap a balance to load it as your buy-in (a hair under, to cover tax + tx fees)"
                style={{ fontSize: 10, fontWeight: 800, color: VALO_PURPLE, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 2 }}>{fmtQty(valoWallet)} $VALO</span>
              <span style={{ fontSize: 10.5, fontWeight: 900, color: T.text }}>${(solBalance * SOL_USD + valoWallet * valoUsdPrice).toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
            {/* live auto trader — arm or relaunch right here under the chart */}
            <TradePanel key={editingBotId || "mnew"} token={selected} amount={amount} setAmount={setAmount} pay={pay} setPay={setPay} compactArm
              onExecute={(o) => execute(selected, o)}
              editBot={pendingOrders.find((o) => o.id === editingBotId) || null}
              onRelaunch={(id, o) => relaunchBot(id, o, selected)} botLock={botLock}
              onDraftLevel={(lvl, tid, side) => setBotDraftLevel(lvl ? { tokenId: tid != null ? tid : selected.id, level: lvl, side: side || botSide } : null)} />
            <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1.5, margin: "12px 0 7px" }}>BOT METRICS · CLOSEST TRIGGER FIRST</div>
            {pendingOrders.length === 0 && <div style={{ fontFamily: T.mono, fontSize: 10, color: T.faint, textAlign: "center", padding: 24 }}>No bots armed yet — arm buy/sell and tap the chart, or use the auto strategy.</div>}
            {pendingOrders
              .map((o) => { const t = tokens.find((x) => String(x.id) === String(o.tokenId)); return t ? { ...o, t, dist: Math.abs(t.price - o.level) / t.price } : null; })
              .filter(Boolean).sort((a, b) => a.dist - b.dist)
              .map((o) => (
                <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 9, marginBottom: 4, border: `1px solid ${T.border}`, background: "rgba(255,255,255,0.015)" }}>
                  <span style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 800, color: accent(o.t.hue), width: 58, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>${o.t.sym}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 800, color: o.side === "buy" ? T.green : T.red }}>{o.side.toUpperCase()} @ ${fmtP(o.level)}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 8.5, color: T.dim }}>{o.amt} {o.pay}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 8, color: T.amber, marginLeft: "auto" }}>{(o.dist * 100).toFixed(1)}%</span>
                  {!o.runId && <button onClick={() => setEditingBotId(o.id)} style={{ ...chip(false), padding: "4px 8px", fontSize: 9, fontWeight: 800 }}>Edit</button>}
                  <button onClick={() => cancelBot(o.id)} style={{ ...chip(false), padding: "4px 8px", fontSize: 9, fontWeight: 800, color: T.red, borderColor: `${T.red}44` }}>✕</button>
                </div>
              ))}
            </>
            )}
          </div>
        </div>
      )}
      {botRunOpen && <BotRunStatsModal run={botRuns.find((r) => r.id === botRunOpen)} onClose={() => setBotRunOpen(null)} isMobile={isMobile} />}
      {notifToast && <NotifToast notif={notifToast} isMobile={isMobile}
        onClick={() => { if (notifToast.tokenId) navigateToToken(notifToast.tokenId); else { setProfileUser(notifToast.user); setNotifToast(null); } }}
        onClose={() => setNotifToast(null)} />}

      {/* WHY IT'S TRENDING / DEV WALLET POPUP (fills the screen) */}
      {trendOpen && selected && (
        <div onClick={() => setTrendOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 62, background: "rgba(4,6,10,0.8)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 20 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(96vw, 720px)", height: isMobile ? "94vh" : "88vh", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 16, boxShadow: "0 30px 90px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
            {/* header */}
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${T.border}`, background: `linear-gradient(120deg, ${accent(selected.hue)}22, transparent 70%)`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <TokenAvatar sym={selected.sym} hue={selected.hue} img={selected.img} size={30} />
                <div>
                  <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 800, color: T.text }}>{selected.sym} <span style={{ color: T.faint, fontWeight: 400 }}>/SOL</span></div>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>{devView ? "DEVELOPER WALLET" : "WHY IT'S TRENDING"}</div>
                </div>
              </div>
              <button onClick={() => setTrendOpen(false)} style={{ ...chip(false), padding: "5px 11px" }}>✕</button>
            </div>

            {/* tab switch */}
            <div style={{ display: "flex", gap: 6, padding: "10px 16px 0" }}>
              <button onClick={() => setDevView(false)} style={{ ...chip(!devView), flex: 1, textAlign: "center", padding: "8px", fontSize: 11 }}>🔥 Why it's trending</button>
              <button onClick={() => setDevView(true)} style={{ ...chip(devView), flex: 1, textAlign: "center", padding: "8px", fontSize: 11 }}>👨‍💻 Developer wallet</button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
              {!devView ? (
                <>
                  {/* trending reason */}
                  <div style={{ background: "rgba(240,185,11,0.06)", border: "1px solid rgba(240,185,11,0.3)", borderRadius: 12, padding: 14, marginBottom: 12 }}>
                    <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 800, color: T.amber, letterSpacing: 1, marginBottom: 7 }}>🔥 WHY IT'S TRENDING</div>
                    <div style={{ fontFamily: T.sans, fontSize: 13, color: T.dim, lineHeight: 1.7 }}>{selected.trending.reason}</div>
                  </div>
                  {/* social tweet */}
                  <div style={{ background: "#0c0f16", border: `1px solid ${T.border2}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: accent(selected.hue), color: "#0a0713", fontFamily: T.mono, fontWeight: 800, fontSize: 12 }}>{selected.sym[0]}</span>
                      <div>
                        <div style={{ fontFamily: T.sans, fontSize: 12.5, fontWeight: 700, color: T.text }}>{selected.trending.tweet.user}</div>
                        <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>𝕏 · trending now</div>
                      </div>
                    </div>
                    <div style={{ fontFamily: T.sans, fontSize: 13.5, color: T.text, lineHeight: 1.6, marginBottom: 8 }}>{selected.trending.tweet.text}</div>
                    <div style={{ display: "flex", gap: 16, fontFamily: T.mono, fontSize: 10, color: T.faint }}>
                      <span>♡ {selected.trending.tweet.likes.toLocaleString()}</span>
                      <span>↻ {selected.trending.tweet.rts.toLocaleString()}</span>
                      {selected.socials.x && <a href={selected.socials.x} target="_blank" rel="noopener noreferrer" style={{ color: T.blue, textDecoration: "none", marginLeft: "auto" }}>open on 𝕏 →</a>}
                    </div>
                  </div>
                  {/* description */}
                  <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 800, color: VALO_PURPLE, letterSpacing: 1, marginBottom: 7 }}>DESCRIPTION</div>
                    <div style={{ fontFamily: T.sans, fontSize: 13, color: T.dim, lineHeight: 1.7 }}>{selected.trending.desc}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                      {[["𝕏", selected.socials.x], ["✈ TG", selected.socials.tg], ["🌐 Site", selected.socials.site], ["💊 pump", selected.socials.pump]].filter(([, u]) => u).map(([l, u], i) => (
                        <a key={i} href={u} target="_blank" rel="noopener noreferrer" style={{ ...chip(false), textDecoration: "none", fontSize: 10, padding: "5px 9px" }}>{l}</a>
                      ))}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  {/* dev wallet header */}
                  <div style={{ background: "#0c0f16", border: `1px solid ${T.border2}`, borderRadius: 12, padding: 14, marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>CREATOR WALLET</div>
                        <div style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 700, color: T.text }}>{selected.dev.wallet}</div>
                      </div>
                      <a href={"https://solscan.io/"} target="_blank" rel="noopener noreferrer" style={{ ...chip(false), textDecoration: "none", fontSize: 10, padding: "5px 9px" }}>solscan →</a>
                    </div>
                  </div>
                  {/* launched tokens / trust */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    <button onClick={() => setCreatedOpen((v) => !v)}
                      style={{ textAlign: "left", background: "#0c0f16", border: `1px solid ${createdOpen ? accent(selected.hue) : T.border2}`, borderRadius: 10, padding: "10px 12px", cursor: "pointer" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>CREATED TOKENS {createdOpen ? "▲" : "▼"}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 18, fontWeight: 800, color: accent(selected.hue) }}>{selected.dev.tokensLaunched}</div>
                      <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>tap to view all</div>
                    </button>
                    <div style={{ background: "#0c0f16", border: `1px solid ${selected.dev.rugged > 0 ? "rgba(234,57,67,0.4)" : T.border}`, borderRadius: 10, padding: "10px 12px" }}>
                      <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>PRIOR RUGS / DEAD</div>
                      <div style={{ fontFamily: T.mono, fontSize: 18, fontWeight: 800, color: selected.dev.rugged > 0 ? T.red : T.green }}>{selected.dev.rugged}</div>
                    </div>
                  </div>

                  {/* created-tokens sub-section — each clickable to open its chart */}
                  {createdOpen && (
                    <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 10, padding: 10, marginBottom: 12 }}>
                      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1, marginBottom: 8 }}>TOKENS THIS DEV LAUNCHED · tap to open chart</div>
                      {/* current token first */}
                      <div onClick={() => setTrendOpen(false)}
                        style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px", borderRadius: 9, marginBottom: 5, cursor: "pointer", border: `1px solid ${accent(selected.hue)}66`, background: `${accent(selected.hue)}12` }}>
                        <TokenAvatar sym={selected.sym} hue={selected.hue} img={selected.img} size={22} />
                        <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 800, color: T.text, flex: 1 }}>{selected.sym} <span style={{ color: T.green, fontSize: 8 }}>● THIS TOKEN</span></span>
                        <span style={{ textAlign: "right" }}>
                          <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.text }}>${fmtP(selected.price)}</div>
                          <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>MC {fmt$(mcOf(selected))}</div>
                        </span>
                      </div>
                      {selected.dev.launches.map((l, i) => {
                        const existing = tokens.find((x) => x.sym === l.sym);
                        return (
                          <div key={i} onClick={() => { if (existing) { setSel(existing.id); setClickMode(null); setTrendOpen(false); } }}
                            style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px", borderRadius: 9, marginBottom: 5, cursor: existing ? "pointer" : "default", border: `1px solid ${T.border}`, background: "transparent", opacity: l.dead ? 0.55 : 1 }}>
                            <span style={{ width: 22, height: 22, borderRadius: "50%", background: `hsl(${l.hue},60%,45%)`, display: "grid", placeItems: "center", fontFamily: T.mono, fontSize: 9, fontWeight: 800, color: "#0a0713", flexShrink: 0 }}>{l.sym[0]}</span>
                            <span style={{ fontFamily: T.mono, fontSize: 11.5, fontWeight: 700, color: T.text, flex: 1 }}>
                              {l.sym} {l.dead && <span style={{ color: T.red, fontSize: 8 }}>● DEAD</span>}
                            </span>
                            <span style={{ textAlign: "right" }}>
                              <div style={{ fontFamily: T.mono, fontSize: 10.5, color: T.text }}>${fmtP(l.price)}</div>
                              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>MC {fmt$(l.mc)}</div>
                            </span>
                            <span style={{ fontFamily: T.mono, fontSize: 9, color: existing ? T.blue : T.faint, flexShrink: 0 }}>{existing ? "open →" : "—"}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {/* creator rewards + fees */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                    {[
                      ["CREATOR REWARDS", `${selected.dev.creatorRewardsSol.toFixed(1)} SOL`, T.green],
                      ["FEES · 24H", `${selected.dev.feesDay.toFixed(2)} SOL`, T.text],
                      ["FEES · 30D", `${selected.dev.feesMonth.toFixed(0)} SOL`, T.text],
                      ["FEES · 1Y", `${selected.dev.feesYear.toFixed(0)} SOL`, T.text],
                    ].map(([k, v, c]) => (
                      <div key={k} style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 10, padding: "9px 12px" }}>
                        <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint }}>{k}</div>
                        <div style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 800, color: c }}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {/* traceable fee chart */}
                  <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1, marginBottom: 8 }}>FEES COLLECTED · LAST 30 DAYS</div>
                    <PerfChart series={selected.dev.feeHistory.map((v, i) => selected.dev.feeHistory.slice(0, i + 1).reduce((a, b) => a + b, 0))} mode="line" height={140} />
                  </div>
                  {/* withdrawals */}
                  <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 10, padding: 12 }}>
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1, marginBottom: 8 }}>DEV WITHDRAWALS · how much & when</div>
                    {selected.dev.withdrawals.map((w, i) => (
                      <a key={i} href={`https://solscan.io/tx/${w.tx}`} target="_blank" rel="noopener noreferrer"
                        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: T.mono, fontSize: 11, padding: "8px 0", borderBottom: i < selected.dev.withdrawals.length - 1 ? `1px solid ${T.border}` : "none", textDecoration: "none" }}>
                        <span style={{ color: T.faint }}>{w.when} <span style={{ color: T.blue, fontSize: 9 }}>🔗 solscan</span></span>
                        <span style={{ color: T.amber, fontWeight: 700 }}>− {w.amt.toFixed(1)} SOL</span>
                      </a>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CLAIM MODAL */}
      {claimOpen && (
        <div onClick={() => !claiming && setClaimOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(4,6,10,0.72)", backdropFilter: "blur(3px)",
            display: "flex", alignItems: "flex-start", justifyContent: "center",
            overflowY: "auto", WebkitOverflowScrolling: "touch",
            padding: "max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom))" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(94vw, 520px)", margin: "auto 0", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18, boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <span style={{ fontFamily: T.mono, fontSize: 12, letterSpacing: 2, color: T.dim }}>🎁 AIRDROP VAULT · ROLLING HOURLY</span>
              <button onClick={() => !claiming && setClaimOpen(false)} style={{ ...chip(false), padding: "3px 9px" }}>✕</button>
            </div>

            <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 10, padding: 14, textAlign: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 9, letterSpacing: 2, color: T.faint, fontFamily: T.mono }}>CLAIMABLE NOW</div>
              <div style={{ fontFamily: T.mono, fontSize: 28, fontWeight: 900, color: claimable > 0 ? T.green : T.dim, textShadow: claimable > 0 ? "0 0 18px rgba(22,199,132,0.4)" : "none" }}>
                {claimable.toFixed(4)} <span style={{ fontSize: 13, color: VALO_PURPLE }}>$VALO</span>
              </div>
              <div style={{ fontSize: 11, color: T.faint, fontFamily: T.mono }}>≈ ${(claimable * valoUsdPrice).toFixed(2)} USD · from {pendingEpochs.length} unclaimed epoch{pendingEpochs.length === 1 ? "" : "s"}</div>
            </div>

            {/* clickable loyalty stack explainer */}
            <button onClick={() => setLoyaltyOpen((v) => !v)}
              style={{ width: "100%", textAlign: "left", background: "rgba(240,185,11,0.06)", border: "1px solid rgba(240,185,11,0.3)", borderRadius: 10, padding: "10px 12px", marginBottom: 12, cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: T.amber }}>⭐ EPOCH LOYALTY STACK · ×{loyaltyMult.toFixed(1)}</span>
                <span style={{ fontFamily: T.mono, fontSize: 10, color: T.faint }}>{loyaltyOpen ? "▲" : "▼"}</span>
              </div>
              {/* progress to 2.5x */}
              <div style={{ height: 6, borderRadius: 3, background: "#1a1f2a", marginTop: 8, overflow: "hidden" }}>
                <div style={{ width: `${((loyaltyMult - 1) / 1.5) * 100}%`, height: "100%", background: "linear-gradient(90deg,#f0b90b,#16c784)" }} />
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, marginTop: 4 }}>
                {loyaltyMult >= 2.5 ? "MAXED at ×2.5" : `${loyaltyDays}d held · +0.1× tomorrow → ×${Math.min(2.5, loyaltyMult + 0.1).toFixed(1)}`}
              </div>
              {calloutBonus.total > 0 && (
                <div style={{ fontFamily: T.mono, fontSize: 9, color: VALO_PURPLE, marginTop: 5 }}>
                  🏆 CALLOUT BOARDS +{calloutBonus.total.toFixed(2)}× · {calloutBonus.hits.length} board{calloutBonus.hits.length === 1 ? "" : "s"} ({calloutBonus.hits.map((h) => `${h.p} #${h.rank}`).join(" · ")}) → EFFECTIVE ×{stackNow.toFixed(2)}
                </div>
              )}
              {loyaltyOpen && (
                <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.dim, lineHeight: 1.7, marginTop: 8, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
                  The longer you hold your epoch rewards <b style={{ color: T.text }}>without withdrawing</b>, the bigger your multiplier on the pool.
                  It climbs <b style={{ color: T.amber }}>+0.1× every day</b>, up to a <b style={{ color: T.green }}>max of ×2.5</b>.
                  The moment you withdraw — at any time — it <b style={{ color: T.red }}>resets to ×1</b> and starts building again.
                </div>
              )}
            </button>

            {/* auto-claim settings */}
            <div style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 1, color: T.dim, marginBottom: 8 }}>⚙ AUTO-WITHDRAW · so you don't have to come back</div>
              <div style={{ display: "flex", gap: 6, marginBottom: autoClaim === "atMult" ? 10 : 0 }}>
                {[["off", "Off"], ["hourly", "Every epoch"], ["atMult", "At multiplier"]].map(([k, l]) => (
                  <button key={k} onClick={() => setAutoClaim(k)} style={{ ...chip(autoClaim === k), flex: 1, textAlign: "center", padding: "7px 4px", fontSize: 10 }}>{l}</button>
                ))}
              </div>
              {autoClaim === "hourly" && (
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
                  Every hour the epoch fires, your rewards auto-collect to your wallet. Note: each withdraw resets loyalty to ×1, so this keeps you at the base multiplier.
                </div>
              )}
              {autoClaim === "atMult" && (
                <>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, marginBottom: 6 }}>Auto-withdraw everything once loyalty reaches:</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[1.5, 2, 2.5].map((m) => (
                      <button key={m} onClick={() => setAutoMult(m)} style={{ ...chip(autoMult === m), flex: 1, textAlign: "center", padding: "7px 4px", fontSize: 11 }}>×{m}</button>
                    ))}
                  </div>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, marginTop: 8, lineHeight: 1.6 }}>
                    Holds and lets the stack build to <b style={{ color: T.amber }}>×{autoMult}</b>, auto-withdraws the whole pool, then repeats — until you turn it off.
                  </div>
                </>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
              {[
                ["ACCRUING THIS EPOCH", `${accruingNow.toFixed(4)} $VALO`, `≈ $${(accruingNow * valoUsdPrice).toFixed(2)}`, T.text],
                ["NEXT SNAPSHOT", fmtDur(msToEpoch), "on the hour", T.blue],
                ["HOLDER WEIGHT", `${(holdPctNow * 100).toFixed(3)}%`, "of pool", T.text],
                ["VOLUME WEIGHT", `${(volPctNow * 100).toFixed(3)}%`, "of pool", T.text],
                ["LOYALTY STACK", `×${loyaltyMult.toFixed(1)}`, `${loyaltyDays}d held`, T.amber],
                ["CALLOUT BONUS", `+${calloutBonus.total.toFixed(2)}×`, calloutBonus.hits.length ? `${calloutBonus.hits.length} boards` : "top-100 any board", VALO_PURPLE],
                ["VAULT THIS EPOCH", `${vaultTotal.toFixed(3)} SOL`, `≈ $${(vaultTotal * SOL_USD).toFixed(0)}`, T.green],
              ].map(([k, v, sub, c]) => (
                <div key={k} style={{ background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 8, letterSpacing: 1.1, color: T.faint, fontFamily: T.mono }}>{k}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, marginTop: 2, color: c }}>{v}</div>
                  <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>{sub}</div>
                </div>
              ))}
            </div>

            {pendingEpochs.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ ...lbl, marginBottom: 6 }}>Unclaimed epochs · each with its published root</div>
                {pendingEpochs.map((e) => (
                  <div key={e.epoch} style={{ display: "flex", justifyContent: "space-between", gap: 8, background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 8, padding: "7px 10px", marginBottom: 6, fontFamily: T.mono, fontSize: 10 }}>
                    <span style={{ color: T.dim }}>epoch #{e.epoch} · root {e.root.slice(0, 10)}…</span>
                    <span style={{ textAlign: "right" }}>
                      <b style={{ color: T.green }}>{e.amount.toFixed(4)}</b>
                      <span style={{ color: T.faint }}> · ${(e.amount * valoUsdPrice).toFixed(2)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ fontFamily: T.mono, fontSize: 9.5, color: T.faint, lineHeight: 1.7, background: "#0c0f16", border: `1px solid ${T.border}`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
              Every trade splits its fee <b style={{ color: T.text }}>50% → burn pool</b>, <b style={{ color: T.text }}>50% → airdrop vault</b>.
              Every hour the indexer snapshots holder balances and period volume, computes each wallet's share,
              and publishes a new Merkle root on-chain. Claiming fetches your proof and submits the tx —
              <b style={{ color: T.text }}> you pay your own SOL gas</b>, tokens land directly in your wallet.
            </div>

            <button onClick={() => doClaim(false)} disabled={claimable <= 0 || claiming}
              style={{
                width: "100%", border: "none", borderRadius: 10, padding: "14px", fontFamily: T.mono,
                fontSize: 13, fontWeight: 900, letterSpacing: 1.5,
                background: claimable > 0 && !claiming ? "linear-gradient(135deg,#16c784,#0e9c68)" : "#1a2030",
                color: claimable > 0 && !claiming ? "#06130c" : T.faint,
                cursor: claimable > 0 && !claiming ? "pointer" : "not-allowed",
              }}>
              {claiming ? "FETCHING PROOF · SUBMITTING TX…" : claimable > 0 ? "CLAIM TO MY WALLET" : "NOTHING TO CLAIM YET"}
            </button>
          </div>
        </div>
      )}

      {/* MOBILE CHAT DRAWER — tab handle on the right edge, wheels out on tap */}
      {isMobile && (
        <>
          <button onClick={() => { if (tabJustDragged.current) return; setDrawerOpen((v) => !v); }} aria-label="Open chat — drag to reposition"
            onTouchStart={tabTouchStart("chat", chatTabTop)}
            style={{
              position: "fixed", right: 0, top: `${chatTabTop}%`, zIndex: 52, touchAction: "none",
              background: "rgba(17,21,29,0.96)", color: drawerOpen ? "#f2e394" : T.dim,
              border: `1px solid ${T.border2}`, borderRight: "none",
              borderRadius: "12px 0 0 12px", padding: "14px 7px", cursor: "pointer",
              writingMode: "vertical-rl", fontFamily: T.mono, fontSize: 10, letterSpacing: 2,
              boxShadow: "-4px 0 18px rgba(0,0,0,0.45)",
            }}>
            {drawerOpen ? "CLOSE ›" : "‹ CHAT"}
          </button>

          <div onClick={() => setDrawerOpen(false)}
            style={{
              position: "fixed", inset: 0, zIndex: 50,
              background: "rgba(4,6,10,0.55)", backdropFilter: "blur(2px)",
              opacity: drawerOpen ? 1 : 0, pointerEvents: drawerOpen ? "auto" : "none",
              transition: "opacity .28s ease",
            }} />

          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 51,
            width: "min(90vw, 400px)", background: "rgba(12,15,22,0.98)",
            borderLeft: `1px solid ${T.border2}`, boxShadow: "-12px 0 40px rgba(0,0,0,0.6)",
            transform: drawerOpen ? "translateX(0)" : "translateX(102%)",
            transition: "transform .32s cubic-bezier(.22,.8,.3,1)",
            overflowY: "auto", padding: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.dim }}>CHAT ROOMS</span>
              <button onClick={() => setDrawerOpen(false)} style={{ ...chip(false), padding: "3px 9px" }}>✕</button>
            </div>
            {chatBlock}
          </div>
        </>
      )}

      {/* MOBILE PORTFOLIO DRAWER — right-edge tab below chat, full PortfolioPanel */}
      {isMobile && (
        <>
          <button onClick={() => { if (tabJustDragged.current) return; setPortfolioDrawer((v) => !v); }} aria-label="Open portfolio — drag to reposition"
            onTouchStart={tabTouchStart("wallet", walletTabTop)}
            style={{
              position: "fixed", right: 0, top: `${walletTabTop}%`, zIndex: 52, touchAction: "none",
              background: portfolioDrawer ? "rgba(17,21,29,0.96)" : (totalEquity > 0 ? (platformPnl >= 0 ? "rgba(22,199,132,0.16)" : "rgba(234,57,67,0.16)") : "rgba(17,21,29,0.96)"),
              color: portfolioDrawer ? VALO_PURPLE : (totalEquity > 0 ? (platformPnl >= 0 ? T.green : T.red) : T.dim),
              border: `1px solid ${portfolioDrawer ? T.border2 : (totalEquity > 0 ? (platformPnl >= 0 ? "rgba(22,199,132,0.5)" : "rgba(234,57,67,0.5)") : T.border2)}`, borderRight: "none",
              borderRadius: "12px 0 0 12px", padding: "14px 7px", cursor: "pointer",
              writingMode: "vertical-rl", fontFamily: T.mono, fontSize: 10, letterSpacing: 1.5, fontWeight: 700,
              boxShadow: "-4px 0 18px rgba(0,0,0,0.45)",
            }}>
            {portfolioDrawer ? "CLOSE ›" : (totalEquity > 0 ? (hideBalance ? "•••••" : `$${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`) : "‹ WALLET")}
          </button>

          <div onClick={() => setPortfolioDrawer(false)}
            style={{ position: "fixed", inset: 0, zIndex: 50, background: "rgba(4,6,10,0.55)", backdropFilter: "blur(2px)",
              opacity: portfolioDrawer ? 1 : 0, pointerEvents: portfolioDrawer ? "auto" : "none", transition: "opacity .28s ease" }} />

          <div style={{
            position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 51,
            width: "100vw", background: "rgba(12,15,22,0.98)",
            boxShadow: "-12px 0 40px rgba(0,0,0,0.6)",
            transform: portfolioDrawer ? "translateX(0)" : "translateX(102%)",
            transition: "transform .32s cubic-bezier(.22,.8,.3,1)",
            overflowY: "auto", padding: 12,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.dim }}>PORTFOLIO</span>
              <button onClick={() => setPortfolioDrawer(false)} style={{ ...chip(false), padding: "3px 9px" }}>✕</button>
            </div>
            <PortfolioPanel big
              solBalance={solBalance} valoWallet={valoWallet} positions={positions} tokens={tokens}
              realizedPnl={realizedPnl} unrealizedPnl={unrealizedAll} extraEquity={strategyEquityUsd}
              tab={portfolioTab} setTab={setPortfolioTab}
              range={perfRange} setRange={setPerfRange}
              mode={perfMode} setMode={setPerfMode} seed={pnlSeed}
              hideBalance={hideBalance} setHideBalance={setHideBalance}
              activity={myActivity} onOpenToken={(sym, act) => { const tk = tokens.find((x) => x.sym === sym); if (tk) { setSel(tk.id); setClickMode(null); if (typeof setPortfolioDrawer === 'function') setPortfolioDrawer(false); if (act) { setHistMarker({ t: act.t, side: act.side, p: act.price, price: act.price, amt: act.amt, unit: act.unit, mc: mcOf(tk), pnlPct: act.pnlPct, pnlMoney: act.pnlMoney, sym: act.sym, tx: act.tx }); setHighlightTx(act.tx); } } }}
              username={username} setUsername={(v) => { takenNames.current.add(v.toLowerCase()); setUsername(v); }} isNameTaken={(v) => takenNames.current.has(v.toLowerCase())}
              myCallouts={myMcCallouts} onOpenMyCallouts={() => setMyCalloutsOpen(true)}
              followersCount={followersList.length} followingCount={followingList.length} onOpenFollowList={(k) => setFollowListOpen(k)}
              nameChangedAt={nameChangedAt} setNameChangedAt={setNameChangedAt}
              pendingOrders={pendingOrders} onEditBot={(id) => setBotHub({ mode: "edit", id })} onCancelBot={cancelBot} onPosTrade={onPosTrade}
              botHistory={botRuns.filter((r) => r.status === "sold")} onOpenBotRun={(id) => setBotRunOpen(id)}
              epochLastHour={epochLastHour} epochTotalEarned={epochTotalEarned} valoUsdForEpoch={valoUsdPrice} onOpenClaim={() => { setClaimOpen(true); if (typeof setPortfolioDrawer === 'function') setPortfolioDrawer(false); }}
              botsSlot={isMobile && (pendingOrders.length + botRuns.filter((r) => r.status === "live").length) > 0 ? (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, letterSpacing: 1, marginBottom: 7 }}>🤖 AUTO-TRADING BOTS</div>
                  {pendingOrders.filter((o) => !o.runId).map((o) => {
                    const t = tokens.find((x) => String(x.id) === String(o.tokenId)); if (!t) return null;
                    return (
                      <div key={o.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 9, marginBottom: 4, border: `1px solid ${accent(t.hue)}44`, background: "rgba(255,255,255,0.02)", fontFamily: T.mono }}>
                        <span style={{ fontSize: 10 }}>⏳</span>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue) }}>${t.sym}</span>
                        <span style={{ fontSize: 9, color: T.text }}>{o.amt} {o.pay} @ ${fmtP(o.level)}</span>
                        <button onClick={() => { setSel(t.id); setClickMode(null); setEditingBotId(o.id); setMobileBotScreen(true); setPortfolioDrawer(false); }}
                          style={{ ...chip(false), padding: "4px 9px", fontSize: 9, fontWeight: 800, marginLeft: "auto" }}>Edit</button>
                        <button onClick={() => cancelBot(o.id)} style={{ ...chip(false), padding: "4px 8px", fontSize: 9, fontWeight: 800, color: T.red, borderColor: `${T.red}44` }}>✕</button>
                      </div>
                    );
                  })}
                  {botRuns.filter((r) => r.status === "live").map((r) => {
                    const t = tokens.find((x) => String(x.id) === String(r.tokenId)); if (!t) return null;
                    const pnl = (r.remaining * (t.price / r.entry) - r.remaining) * (r.pay === "SOL" ? SOL_USD : 0.0125);
                    const up = pnl >= 0;
                    return (
                      <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 9px", borderRadius: 9, marginBottom: 4, border: `1px solid ${up ? "rgba(22,199,132,0.45)" : "rgba(234,57,67,0.45)"}`, background: "rgba(255,255,255,0.02)", fontFamily: T.mono }}>
                        <span style={{ fontSize: 8.5, fontWeight: 900, color: up ? T.green : T.red }}>LIVE</span>
                        <span style={{ fontSize: 10.5, fontWeight: 800, color: accent(t.hue) }}>${t.sym}</span>
                        <span style={{ fontSize: 10, fontWeight: 900, color: up ? T.green : T.red }}>{up ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
                        <button onClick={() => { setSel(t.id); setClickMode(null); setMobileBotScreen(true); setPortfolioDrawer(false); }}
                          style={{ ...chip(false), padding: "4px 9px", fontSize: 9, fontWeight: 800, marginLeft: "auto" }}>View</button>
                        <button onClick={() => sellRun(r.id)} style={{ border: "none", borderRadius: 7, padding: "4px 10px", fontFamily: T.mono, fontSize: 9, fontWeight: 900, background: T.red, color: "#170808", cursor: "pointer" }}>SELL NOW</button>
                      </div>
                    );
                  })}
                </div>
              ) : null}
              heldSlot={
                <HeldPositions positions={positions} tokens={tokens} pay={pay} onTrade={onPosTrade} solBalance={solBalance} valoWallet={valoWallet}
                  onOpenToken={(id) => { setSel(id); setClickMode(null); setPortfolioDrawer(false); }}
                  onSellAll={(t) => { const p = positions[t.id]; if (p && p.amt > 0) execute(t, { side: "sell", pay: p.pay, amt: p.amt, mode: "instant", tax: taxFor(p.pay), burn: splitFee(p.amt, p.pay).total, legs: [] }); }}
                  onCloseAll={() => { Object.entries(positions).forEach(([id, p]) => { const tok = tokens.find((x) => x.id === +id); if (tok && p && p.amt > 0) execute(tok, { side: "sell", pay: p.pay, amt: p.amt, mode: "instant", tax: taxFor(p.pay), burn: splitFee(p.amt, p.pay).total, legs: [] }); }); }} />
              }
              maxDeposit={externalSol} maxWithdraw={solBalance}
              onDeposit={(amt) => { const a = Math.min(Math.max(0, amt), externalSol); if (a > 0) { setExternalSol((e) => e - a); setSolBalance((b) => b + a); } }}
              onWithdraw={(amt) => { const a = Math.min(Math.max(0, amt), solBalance); if (a > 0) { setSolBalance((b) => b - a); setExternalSol((e) => e + a); } }}
              onSwap={(amt, dir) => {
                if (!(amt > 0)) return;
                if (dir === "valo2sol") {
                  const need = amt; if (need <= valoWallet) { setValoWallet((v) => v - need); setSolBalance((b) => b + (need * 0.0125) / SOL_USD); }
                } else {
                  if (amt <= solBalance) { setSolBalance((b) => b - amt); setValoWallet((v) => v + (amt * SOL_USD) / 0.0125); }
                }
              }}
            />
          </div>
        </>
      )}

      <style>{`
        ::-webkit-scrollbar{width:8px;height:8px} ::-webkit-scrollbar-thumb{background:#232a38;border-radius:4px}
        /* no double-tap / focus zoom surprises on touch — taps act instantly */
        input, textarea, select, button{ touch-action: manipulation; }
        @media(max-width:1150px){ .pt-grid{grid-template-columns:1fr !important;} }
        button:focus-visible{outline:2px solid ${T.blue};outline-offset:2px}
        .tape-item{ position:absolute; bottom:0; font-family:${T.mono}; font-size:11px; font-weight:800; animation: floatUp 3.3s ease-out forwards; }
        @keyframes floatUp{
          0%{ transform:translateY(0); opacity:1; filter:brightness(1.9); }
          12%{ filter:brightness(1); } 55%{ opacity:.28; }
          100%{ transform:translateY(-190px); opacity:0; }
        }
        .fill-ring{ position:absolute; width:70px; height:70px; border:3px solid; border-radius:50%; animation: ringPop 1.2s ease-out forwards; }
        .fill-text{ font-family:${T.mono}; font-weight:900; font-size:20px; letter-spacing:2px; animation: textPop 1.2s ease-out forwards; }
        @keyframes ringPop{ 0%{ transform:scale(.3); opacity:1; } 70%{ opacity:.5; } 100%{ transform:scale(3.2); opacity:0; } }
        @keyframes textPop{ 0%{ transform:scale(.6); opacity:0; } 15%{ transform:scale(1.15); opacity:1; } 60%{ transform:scale(1); opacity:1; } 100%{ transform:scale(1); opacity:0; } }
        .valo-letters{
          --vl-a: hsl(258 80% 68%); --vl-b: hsl(230 75% 55%);
          --vl-pa: hsl(258 80% 68%); --vl-pb: hsl(230 75% 55%);
          background: linear-gradient(100deg,
            var(--vl-b) 0%, var(--vl-a) 30%,
            #ffffff 46%, var(--vl-a) 54%, var(--vl-b) 80%, var(--vl-a) 100%);
          background-size: 260% 100%;
          -webkit-background-clip: text; background-clip: text; color: transparent;
          -webkit-text-fill-color: transparent;
          filter: drop-shadow(0 4px 22px hsla(258,80%,55%,0.4));
          animation: valoShine 6s ease-in-out infinite;
          transition: filter .6s ease;
        }
        /* callout apex diamond — rotating shiny diamond past 100x */
        @keyframes coSpin{
          0%   { transform: rotate(45deg);  box-shadow: 0 0 8px #7de3ff, 0 0 18px rgba(125,227,255,0.45); }
          50%  { transform: rotate(225deg); box-shadow: 0 0 14px #b7f0ff, 0 0 30px rgba(125,227,255,0.8); }
          100% { transform: rotate(405deg); box-shadow: 0 0 8px #7de3ff, 0 0 18px rgba(125,227,255,0.45); }
        }
        /* callout ring tier effects — halos orbit, sparkles twinkle, arc pulses */
        @keyframes coOrbit{ from{ transform: rotate(0deg); } to{ transform: rotate(360deg); } }
        @keyframes coOrbitR{ from{ transform: rotate(360deg); } to{ transform: rotate(0deg); } }
        @keyframes coTwinkle{ 0%,100%{ opacity: 0.15; } 50%{ opacity: 1; } }
        @keyframes coPulse{ 0%,100%{ opacity: 0.8; } 50%{ opacity: 1; } }
        .co-pulse{ animation: coPulse 2.2s ease-in-out infinite; }
        /* callout opening — the ring pops in; layout space is pre-reserved so
           surrounding buttons never move */
        @keyframes coPop{ 0%{ transform: scale(0.25); opacity: 0; } 60%{ transform: scale(1.12); opacity: 1; } 100%{ transform: scale(1); opacity: 1; } }
        .co-open{ animation: coPop .55s cubic-bezier(.34,1.56,.64,1); }
        @keyframes valoShine{ 0%,100%{ background-position: 0% 0; } 50%{ background-position: 100% 0; } }

        /* mode change: the old colour eases into the new one — no flash at all.
           A tracer line draws around the letterforms while it settles. */
        .valo-letters.vl-sweep{
          background: linear-gradient(100deg,
            var(--vl-pb) 0%, var(--vl-pa) 26%,
            var(--vl-a) 62%, var(--vl-b) 86%, var(--vl-a) 100%);
          background-size: 300% 100%;
          /* the "background" shorthand above resets background-clip to border-box,
             which painted the gradient as a square over the transparent text —
             re-clip it to the glyphs here. */
          -webkit-background-clip: text; background-clip: text;
          color: transparent; -webkit-text-fill-color: transparent;
          animation: valoSweep 1.25s cubic-bezier(.4,0,.15,1) forwards;
        }
        @keyframes valoSweep{
          0%   { background-position: 0% 0; }
          100% { background-position: 100% 0; }
        }
        /* the tracer: a glowing outline that hugs the glyphs while the sweep
           settles. Rendered as a ::after twin of the SAME element, so it
           inherits the exact font, size, weight and letter-spacing — it can
           never drift out of alignment with the letters underneath. */
        .valo-letters{ position: relative; display: inline-block; }
        .valo-letters.vl-sweep::after{
          content: "VALO";
          position: absolute; left: 0; top: 0;
          pointer-events: none;
          background: none;
          color: transparent; -webkit-text-fill-color: transparent;
          -webkit-text-stroke: 0.016em var(--vl-a);
          filter: drop-shadow(0 0 0.07em var(--vl-a));
          opacity: 0;
          animation: traceGlow 1.25s cubic-bezier(.4,0,.15,1) forwards;
        }
        @keyframes traceGlow{
          0%   { opacity: 0; }
          14%  { opacity: 1; }
          72%  { opacity: 1; }
          100% { opacity: 0; }
        }
        .valo-logo{ transition: transform .1s; }
        .valo-logo:active{ transform: scale(0.97); }

        /* 3D diamond rig — ~1/3 the logo height */
        .diamond-rig{ position:relative; width:56px; height:56px; perspective:220px; transform-style:preserve-3d; }
        .diamond{
          position:absolute; left:50%; top:50%; width:26px; height:26px; margin:-13px 0 0 -13px;
          transform-style:preserve-3d; animation: dSpin 7s linear infinite;
        }
        .diamond span{
          position:absolute; left:0; top:0; width:100%; height:100%;
          background: linear-gradient(135deg, hsla(258,90%,72%,0.95), hsla(200,90%,65%,0.85), hsla(300,80%,70%,0.9));
          clip-path: polygon(50% 0, 100% 38%, 50% 100%, 0 38%);
          box-shadow: 0 0 18px hsla(258,90%,65%,0.7);
        }
        .diamond span:nth-child(1){ transform: rotateY(0deg) translateZ(7px); }
        .diamond span:nth-child(2){ transform: rotateY(90deg) translateZ(7px); }
        .diamond span:nth-child(3){ transform: rotateY(180deg) translateZ(7px); }
        .diamond span:nth-child(4){ transform: rotateY(270deg) translateZ(7px); }
        @keyframes dSpin{ from{ transform: rotateY(0) rotateX(12deg); } to{ transform: rotateY(360deg) rotateX(12deg); } }

        /* orbiting rings — hidden behind the diamond via a mask gradient, so the
           back half fades out and the front half shows */
        .ring{
          position:absolute; left:50%; top:50%; border-radius:50%;
          transform-style:preserve-3d;
          -webkit-mask: linear-gradient(#000 0 0);
        }
        .ring-a{ width:52px; height:52px; margin:-26px 0 0 -26px; border:1px solid hsla(258,80%,70%,0.35);
          animation: ringSpinA 9s linear infinite; }
        .ring-b{ width:44px; height:44px; margin:-22px 0 0 -22px; border:1px solid hsla(200,80%,68%,0.3);
          animation: ringSpinB 12s linear infinite; }
        @keyframes ringSpinA{ from{ transform: rotateX(72deg) rotateZ(0); } to{ transform: rotateX(72deg) rotateZ(360deg); } }
        @keyframes ringSpinB{ from{ transform: rotateX(66deg) rotateY(30deg) rotateZ(0); } to{ transform: rotateX(66deg) rotateY(30deg) rotateZ(-360deg); } }
        /* tiny floating rocks riding the rings */
        .ring i{
          position:absolute; width:3px; height:3px; border-radius:50%;
          background: hsla(258,60%,85%,0.9); box-shadow:0 0 5px hsla(258,80%,70%,0.9);
          top:-1.5px; left:50%; margin-left:-1.5px;
        }
        .ring-a i:nth-child(1){ transform: rotateZ(0deg) translateY(-26px); }
        .ring-a i:nth-child(2){ transform: rotateZ(140deg) translateY(-26px); }
        .ring-a i:nth-child(3){ transform: rotateZ(255deg) translateY(-26px); }
        .ring-b i:nth-child(1){ transform: rotateZ(60deg) translateY(-22px); }
        .ring-b i:nth-child(2){ transform: rotateZ(210deg) translateY(-22px); }
        /* fade the back of each ring so it "disappears behind" the diamond */
        .diamond-rig::after{
          content:""; position:absolute; left:50%; top:50%; width:30px; height:60px;
          margin:-30px 0 0 -15px; border-radius:0;
          background: radial-gradient(ellipse at center, transparent 40%, rgba(10,13,19,0.0) 100%);
          pointer-events:none;
        }

        .wall-bar{ transition: transform .18s, box-shadow .18s, border-color .18s, background .18s; }
        .wall-bar:hover{ transform: translateX(2px); border-color: rgba(120,140,180,0.5) !important; background: rgba(30,38,52,0.95) !important; }
        .token-card{ transition: border-color .2s, box-shadow .2s, transform .12s; }
        @media (hover:hover){
          .token-card:hover{ border-color: rgba(120,140,180,0.55) !important; box-shadow: 0 0 0 1px rgba(120,140,180,0.25), 0 6px 20px rgba(0,0,0,0.4) !important; transform: translateY(-1px); }
        }
        @keyframes wallSlide{ from{ transform: translateX(-100%); opacity:0; } to{ transform: translateX(0); opacity:1; } }
        .ticker-track{ display:flex; width:max-content; animation: tickerScroll 130s linear infinite; }
        button{ -webkit-user-select:none; user-select:none; -webkit-touch-callout:none; -webkit-tap-highlight-color: transparent; }
        .lb-row{ transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; }
        .lb-row:hover{ transform: translateX(5px); box-shadow: 0 0 14px rgba(125,92,240,0.3); border-color: rgba(125,92,240,0.55) !important; }
        .lb-pod{ transition: transform .16s ease, box-shadow .16s ease; }
        .lb-pod:hover{ transform: translateY(-6px) scale(1.03); }
        .ticker-half{ display:flex; align-items:center; padding-left: 96px; }
        .ticker.paused .ticker-track{ animation-play-state: paused; }
        @keyframes tickerScroll{ from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
        .burn-swap{ display:inline-block; animation: burnFade .45s ease; }
        @keyframes claimPulse{ 0%,100%{ box-shadow:0 0 14px rgba(22,199,132,0.28); } 50%{ box-shadow:0 0 24px rgba(22,199,132,0.5); } }
        @keyframes multpulse{ 0%,100%{ transform:scale(1); } 50%{ transform:scale(1.09); } }
        /* diamond keeps its colours — just a gleam sweeping across it */
        @keyframes diamondGleam{
          0%   { transform: translateX(-140%) rotate(18deg); opacity:0; }
          18%  { opacity:.95; }
          100% { transform: translateX(240%) rotate(18deg); opacity:0; }
        }
        /* transaction page-flip when swiping/paging through a stacked marker */
        @keyframes pageFlipNext{
          0%   { transform: rotateY(0deg)   translateX(0);     opacity:1;   filter:brightness(1); }
          40%  { transform: rotateY(-72deg) translateX(-16px); opacity:.28; filter:brightness(1.5); }
          41%  { transform: rotateY(72deg)  translateX(16px);  opacity:.28; filter:brightness(1.5); }
          100% { transform: rotateY(0deg)   translateX(0);     opacity:1;   filter:brightness(1); }
        }
        @keyframes pageFlipPrev{
          0%   { transform: rotateY(0deg)   translateX(0);     opacity:1;   filter:brightness(1); }
          40%  { transform: rotateY(72deg)  translateX(16px);  opacity:.28; filter:brightness(1.5); }
          41%  { transform: rotateY(-72deg) translateX(-16px); opacity:.28; filter:brightness(1.5); }
          100% { transform: rotateY(0deg)   translateX(0);     opacity:1;   filter:brightness(1); }
        }
        .pulse{ opacity:0; }
        .pulse-a{ animation: travel 5.5s linear infinite; animation-delay:0s; }
        .pulse-b{ animation: travel 7s linear infinite; animation-delay:2.2s; }
        .pulse-c{ animation: travel 6.2s linear infinite; animation-delay:3.9s; }
        @keyframes travel{
          0%{ transform: translateX(-80px); opacity:0; }
          8%{ opacity:1; }
          46%{ opacity:1; }
          60%{ opacity:0; }
          100%{ transform: translateX(1600px); opacity:0; }
        }
        .node{ opacity:0.25; }
        .node-0{ animation: blink 3.1s ease-in-out infinite; }
        .node-1{ animation: blink 4.3s ease-in-out infinite 0.6s; }
        .node-2{ animation: blink 3.7s ease-in-out infinite 1.4s; }
        .node-3{ animation: blink 5.0s ease-in-out infinite 0.9s; }
        .node-4{ animation: blink 4.1s ease-in-out infinite 2.1s; }
        .node-5{ animation: blink 3.4s ease-in-out infinite 1.7s; }
        @keyframes blink{ 0%,100%{ opacity:0.2; } 50%{ opacity:1; filter:drop-shadow(0 0 4px hsl(258 80% 70%)); } }
        @keyframes diamondPulse{ 0%,100%{ box-shadow:0 0 8px hsla(258,90%,65%,0.6); transform:rotate(45deg) scale(1); } 50%{ box-shadow:0 0 16px hsla(258,90%,70%,0.9); transform:rotate(45deg) scale(1.08); } }
        .pull-hint{ display:flex; flex-direction:column; align-items:center; gap:2px; }
        .pull-hint span{ display:block; width:22px; height:2px; border-radius:2px; background:#2e3648; transition:background .3s; }
        .pull-hint.on span{ animation: pullSeq 1.3s ease-in-out infinite; }
        .pull-hint.on span:nth-child(1){ width:22px; }
        .pull-hint.on span:nth-child(2){ width:16px; animation-delay:.15s; }
        .pull-hint.on span:nth-child(3){ width:10px; animation-delay:.3s; }
        @keyframes pullSeq{ 0%,60%,100%{ background:#2e3648; } 25%{ background:#4c9aff; box-shadow:0 0 6px rgba(76,154,255,0.6); } }
        .ticket-reveal{ animation: ticketIn .28s ease-out; }
        @keyframes ticketIn{ from{ opacity:0; transform:translateY(-6px); } to{ opacity:1; transform:none; } }
        @keyframes burnFade{ from{ opacity:0; transform:translateY(-3px); } to{ opacity:1; transform:none; } }
        details summary::-webkit-details-marker{ display:none; }
        .announce{ animation: annIn .5s ease-out; }
        @keyframes annIn{ from{ transform:translateX(14px); opacity:0; } to{ transform:none; opacity:1; } }
        @media (prefers-reduced-motion: reduce){
          .tape-item,.fill-ring,.fill-text,.announce{ animation:none; } .fill-ring{ opacity:0; }
          .ticker-track{ animation-duration: 120s; }
        }
      `}</style>
    </div>
  );
}
