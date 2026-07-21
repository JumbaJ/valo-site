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
const fmt$ = (n) =>
  n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K` : `$${n.toFixed(2)}`;
function subZeros(p) {
  const s = p.toFixed(12).replace("0.", "");
  let z = 0; while (s[z] === "0") z++;
  const subs = "₀₁₂₃₄₅₆₇₈₉";
  return String(z).split("").map((d) => subs[+d]).join("") + s.slice(z, z + 4);
}
const fmtP = (p) => (p >= 1 ? p.toFixed(4) : p >= 0.001 ? p.toFixed(6) : p > 0 ? "0.0" + subZeros(p) : "0");
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
      const trades = Array.from({ length: nTrades }, () => {
        const at = now - Math.floor(rnd(0.05, 0.95) * span);
        const side = Math.random() > 0.45 ? "buy" : "sell";
        const p = price * rnd(0.4, 1.8);
        const amt = rnd(0.5, 25);
        const entry = p * rnd(0.5, 0.95);
        const pnlPct = side === "sell" ? (p - entry) / entry : null;
        return { t: at, side, p, price: p, amt: +amt.toFixed(2), unit: "SOL", mc: p * rnd(2e8, 9e8),
          entry, pnlPct, pnlMoney: pnlPct != null ? amt * pnlPct : null, dev: true, sym,
          tx: Array.from({ length: 8 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("") };
      }).sort((a, b) => a.t - b.t);
      const launches = Array.from({ length: Math.floor(rnd(1, 6)) }, () => {
        const s = ["MOON", "DEGEN", "FROG", "TURBO", "WOJAK", "BONK2", "SNIPE", "GIGA", "APEX", "FOMO"][Math.floor(Math.random() * 10)] + Math.floor(rnd(1, 99));
        const pr = rnd(1e-6, 0.02);
        return { sym: s, price: pr, mc: pr * rnd(2e8, 9e8), hue: symbolHue(s), dead: Math.random() > 0.7 };
      });
      return {
        wallet: "7v" + Array.from({ length: 6 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join("") + "…" + Array.from({ length: 4 }, () => "abcdef0123456789"[Math.floor(Math.random() * 16)]).join(""),
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
function ProChart({ candles, hue, synthetic, mode, tfMin, trades, clickMode, onChartTrade, onSelToken, onMarkerClick, position, price, sym, height = 380, isMobile = false, highlightTx = null }) {
  const wrapRef = useRef(null);
  const cvsRef = useRef(null);
  const [cross, setCross] = useState(null);
  const [hover, setHover] = useState(null);
  const [pulseTick, setPulseTick] = useState(0);
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

    // trade markers — small $ pucks, stack per bar, clickable
    markerHitsRef.current = [];
    if (trades && trades.length) {
      const byIdx = new Map();
      for (const tr of trades) {
        const bucket = Math.floor(tr.t / tfMs) * tfMs;
        const i = Math.round((bucket - agg[0].t) / tfMs);
        if (!inData(i)) continue;
        const s = slotOf(i);
        if (s < 0 || s >= count) continue;
        if (!byIdx.has(s)) byIdx.set(s, []);
        byIdx.get(s).push(tr);
      }
      byIdx.forEach((list, s) => {
        const c = agg[idxOf(s)];
        list.forEach((tr, k) => {
          const isBuy = tr.side === "buy";
          const anchorY = tr.p != null && tr.p >= lo && tr.p <= hi
            ? y(tr.p)
            : isBuy ? y(c.l) + 12 : y(c.h) - 12;
          const yy = anchorY + (isBuy ? k * 14 : -k * 14);
          const px = x(s);
          const isHi = highlightTx && tr.tx && tr.tx === highlightTx;
          const r = isHi ? 9 : 6;
          const col = isBuy ? T.green : T.red;
          // pulsing highlight ring for the marker the user clicked from their history
          if (isHi) {
            const pulse = 4 + 3 * (0.5 + 0.5 * Math.sin(Date.now() / 260));
            ctx.beginPath(); ctx.arc(px, yy, r + pulse, 0, 7);
            ctx.strokeStyle = "#f0b90b"; ctx.lineWidth = 2; ctx.stroke();
            ctx.beginPath(); ctx.arc(px, yy, r + pulse + 5, 0, 7);
            ctx.strokeStyle = "rgba(240,185,11,0.35)"; ctx.lineWidth = 1; ctx.stroke();
          }
          ctx.beginPath(); ctx.arc(px, yy, r, 0, 7);
          ctx.fillStyle = isHi ? "rgba(240,185,11,0.3)" : tr.dev ? "rgba(167,139,255,0.28)" : isBuy ? "rgba(22,199,132,0.22)" : "rgba(234,57,67,0.22)";
          ctx.fill();
          ctx.strokeStyle = isHi ? "#f0b90b" : tr.dev ? "#a98fff" : col; ctx.lineWidth = isHi ? 2 : tr.dev ? 1.5 : 1; ctx.stroke();
          ctx.fillStyle = isHi ? "#f0b90b" : tr.dev ? "#c9b8ff" : col; ctx.font = `bold ${isHi ? 9 : 8}px ${T.mono}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(tr.dev ? "D" : "$", px, yy + 0.5);
          ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.font = `10px ${T.mono}`;
          markerHitsRef.current.push({ x: px, y: yy, r: r + 3, tr });
        });
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
      lastPxRef.current = { y: ly, plotW, visible: true };
    } else {
      lastPxRef.current = { visible: false };
    }

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
          ctx.fillText(clickMode === "buy" ? "CLICK = INSTANT BUY ▲" : "CLICK = INSTANT SELL ▼", Math.min(sx + 12, plotW - 150), Math.max(cy - 14, padT + 10));
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
  }, [agg, total, count, offset, winStart, hue, mode, cross, height, tfMin, trades, clickMode, view.priceOff, highlightTx, pulseTick]);

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
  useEffect(() => {
    const cvs = cvsRef.current; if (!cvs) return;
    const block = (e) => { e.preventDefault(); };
    cvs.addEventListener("touchstart", block, { passive: false });
    cvs.addEventListener("touchmove", block, { passive: false });
    // Native touchend hit-test for $ markers. Doing it here (not via React's
    // synthetic onTouchEnd) guarantees the tap registers on mobile.
    const onTouchEndNative = (e) => {
      const d = dragRef.current;
      if (!d || d.moved) return;
      const r = cvs.getBoundingClientRect();
      const p = e.changedTouches && e.changedTouches[0];
      if (!p) return;
      const cx = p.clientX - r.left, cy = p.clientY - r.top;
      const hit = markerHitsRef.current.find((m) => Math.hypot(m.x - cx, m.y - cy) <= m.r + 12);
      if (hit && onMarkerClick) { e.preventDefault(); onMarkerClick(hit.tr); dragRef.current = null; }
    };
    cvs.addEventListener("touchend", onTouchEndNative, { passive: false });
    return () => {
      cvs.removeEventListener("touchstart", block);
      cvs.removeEventListener("touchmove", block);
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
    dragRef.current = { sx: cx, sy: cy, startOffset: offset, startPriceOff: view.priceOff || 0, moved: false, t0: Date.now(), touch: !!e.touches };
    setCross({ cx, cy });
  };
  const onMove = (e) => {
    const { cx, cy } = ptOf(e);
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
    if (axisRef.current) { axisRef.current = null; return; }
    const d = dragRef.current;
    dragRef.current = null;
    // a clean tap on a $ marker opens its receipt — takes priority over trading
    if (d && !d.moved) {
      const { cx, cy } = ptOf(e);
      const pad = d.touch ? 10 : 0; // fatter target for fingers
      const hit = markerHitsRef.current.find((m) => Math.hypot(m.x - cx, m.y - cy) <= m.r + pad);
      if (hit && onMarkerClick) { onMarkerClick(hit.tr); return; }
    }
    if (d && !d.moved && clickMode && onChartTrade) {
      const { cx, cy } = ptOf(e);
      const g = geom.current;
      if (!g.idxOf) return;
      if (cy < g.padT || cy > g.padT + g.chartH || cx > g.plotW) return;
      if (d.touch && Date.now() - d.t0 < 90) return; // ignore accidental brushes
      onChartTrade({ side: clickMode });
    }
  };

  const ohlc = hover || agg[total - 1];
  const chg = ohlc ? ((ohlc.c - ohlc.o) / ohlc.o) * 100 : 0;

  return (
    <div ref={wrapRef} style={{ position: "relative", background: "#0c0f16", border: `1px solid ${clickMode ? (clickMode === "buy" ? T.green : T.red) : T.border}`, borderRadius: 10, overflow: "hidden", transition: "border-color .2s", touchAction: "none", overscrollBehavior: "contain" }}>
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
        style={{ width: "100%", height, display: "block", cursor: clickMode ? "pointer" : "crosshair", touchAction: "none", overscrollBehavior: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
        onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}
        onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
        onMouseLeave={() => { setCross(null); setHover(null); dragRef.current = null; }}
      />
      {/* live PnL box riding the latest price on the right side */}
      {position && position.amt > 0 && lastPxRef.current.visible && (() => {
        const entry = position.entry;
        const pnlPct = ((price - entry) / entry) * 100;
        const pnlMoney = position.amt * (pnlPct / 100);
        const col = pnlPct > 0.001 ? T.green : pnlPct < -0.001 ? T.red : T.dim;
        const top = Math.max(14, Math.min(height - 46, lastPxRef.current.y - 22));
        return (
          <div style={{ position: "absolute", right: 78, top, zIndex: 4, pointerEvents: "none",
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
function TradePanel({ token, onExecute, amount, pay }) {
  const [stopLoss, setStopLoss] = useState(25);
  // buy-in price slider: follows the live price until the user touches it,
  // then holds their chosen price (adjustable above/below live)
  const [buyTouched, setBuyTouched] = useState(false);
  const [buyInPrice, setBuyInPrice] = useState(token.price);
  // keep tracking the live price until the user grabs the slider
  useEffect(() => { if (!buyTouched) setBuyInPrice(token.price); }, [token.price, buyTouched]);
  // slider spans ±40% around the live price
  const buyMin = token.price * 0.6, buyMax = token.price * 1.4;
  const buyPct = ((buyInPrice - token.price) / token.price) * 100;
  const [legs, setLegs] = useState([{ mult: 2, trail: 10, alloc: 50 }, { mult: 4, trail: 15, alloc: 50 }]);
  const allocTotal = legs.reduce((a, l) => a + Number(l.alloc || 0), 0);
  const tax = taxFor(pay);
  const amt = parseFloat(amount) || 0;
  const fee = splitFee(amt, pay);
  const setLeg = (i, k, v) => setLegs((L) => L.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const invalid = allocTotal !== 100;

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, padding: 14 }}>
      <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: 2, color: T.dim, marginBottom: 10 }}>
        🤖 AUTO TRADER · <b style={{ color: accent(token.hue) }}>{token.sym}</b>
      </div>

      {/* buy-in price slider — tracks live price, drag to set a higher/lower entry */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <label style={{ ...lbl, marginBottom: 0 }}>Buy-in price {buyTouched ? "" : "· tracking live"}</label>
        {buyTouched && (
          <button onClick={() => { setBuyTouched(false); setBuyInPrice(token.price); }}
            style={{ ...chip(false), padding: "2px 7px", fontSize: 9 }}>↻ live</button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "3px 0 2px" }}>
        <span style={{ fontFamily: T.mono, fontSize: 15, fontWeight: 800, color: buyTouched ? (buyPct >= 0 ? T.green : T.red) : T.text }}>${fmtP(buyInPrice)}</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: buyPct >= 0 ? T.green : T.red }}>{buyPct >= 0 ? "+" : ""}{buyPct.toFixed(1)}% vs live</span>
      </div>
      <input type="range" min={buyMin} max={buyMax} step={(buyMax - buyMin) / 400} value={Math.min(buyMax, Math.max(buyMin, buyInPrice))}
        onChange={(e) => { setBuyTouched(true); setBuyInPrice(+e.target.value); }}
        style={{ width: "100%", accentColor: accent(token.hue) }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 8, color: T.faint, marginTop: -2 }}>
        <span>−40%</span><span>live ${fmtP(token.price)}</span><span>+40%</span>
      </div>

      <label style={{ ...lbl, marginTop: 12 }}>Stop loss — {stopLoss}% below entry</label>
      <input type="range" min={1} max={100} value={stopLoss} onChange={(e) => setStopLoss(+e.target.value)} style={{ width: "100%", accentColor: T.red }} />

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, marginBottom: 6 }}>
        <span style={{ ...lbl, marginBottom: 0 }}>Trailing take-profit legs</span>
        <span style={{ fontFamily: T.mono, fontSize: 10, color: allocTotal === 100 ? T.green : T.red }}>Σ {allocTotal}% {allocTotal === 100 ? "✓" : "must=100"}</span>
      </div>
      {legs.map((l, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 28px", gap: 6, marginBottom: 6 }}>
          <div><span style={{ ...lbl, fontSize: 9, marginBottom: 2 }}>at ×</span><input value={l.mult} onChange={(e) => setLeg(i, "mult", e.target.value)} style={inpS} /></div>
          <div><span style={{ ...lbl, fontSize: 9, marginBottom: 2 }}>trail%</span><input value={l.trail} onChange={(e) => setLeg(i, "trail", e.target.value)} style={inpS} /></div>
          <div><span style={{ ...lbl, fontSize: 9, marginBottom: 2 }}>sell%</span><input value={l.alloc} onChange={(e) => setLeg(i, "alloc", +e.target.value)} style={inpS} /></div>
          <button onClick={() => setLegs((L) => L.filter((_, j) => j !== i))} style={{ ...chip(false), alignSelf: "end", padding: "5px 0", textAlign: "center" }}>−</button>
        </div>
      ))}
      <button onClick={() => setLegs((L) => [...L, { mult: 3, trail: 12, alloc: 0 }])} style={{ ...chip(false), width: "100%", textAlign: "center" }}>+ add leg</button>

      <button disabled={invalid} onClick={() => onExecute({ side: "buy", pay, amt, mode: "auto", limitBuy: buyTouched ? fmtP(buyInPrice) : "", stopLoss, legs, tax, burn: fee.total })}
        style={{
          width: "100%", marginTop: 10, border: "none", borderRadius: 9, padding: "12px", fontFamily: T.mono, fontSize: 12.5, letterSpacing: 1.5, fontWeight: 800,
          background: invalid ? "#1a2030" : T.blue, color: invalid ? T.faint : "#07101d", cursor: invalid ? "not-allowed" : "pointer",
        }}>🤖 ARM AUTO STRATEGY</button>

      <div style={{ fontFamily: T.mono, fontSize: 9, color: T.faint, marginTop: 9, lineHeight: 1.6, borderTop: `1px solid ${T.border}`, paddingTop: 8 }}>
        <div>🔥 {fee.burn.toFixed(5)} → burn pool · 🎁 {fee.vault.toFixed(5)} → airdrop vault ({pay === "SOL" ? "0.6%" : "0.3%"} fee)</div>
      </div>
    </div>
  );
}

// full desktop ticket — settlement, instant buy/sell, click-to-trade arming,
// plus the auto strategy. Desktop keeps the complete toolset.
// held positions dropdown — every open position with per-token PnL, click-to-open, per-token & bulk close
function HeldPositions({ positions, tokens, pay, onOpenToken, onSellAll, onCloseAll }) {
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
              style={{ width: "100%", border: "none", borderRadius: 10, padding: "10px", fontFamily: T.mono, fontWeight: 800,
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
                  <span style={{ fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: gain ? T.green : T.red }}>
                    {gain ? "+" : "−"}${Math.abs(pnl).toFixed(2)}
                  </span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); onSellAll(h.t); }}
                  style={{ width: "100%", border: "none", borderRadius: 8, padding: "8px", fontFamily: T.mono, fontSize: 11, fontWeight: 800, background: gain ? T.green : T.red, color: gain ? "#07130d" : "#170808", cursor: "pointer", display: "flex", justifyContent: "space-between", padding: "8px 11px" }}>
                  <span>SELL ALL</span>
                  <span>{gain ? "+" : "−"}${Math.abs(pnl).toFixed(2)}</span>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DesktopTradePanel({ token, onExecute, clickMode, setClickMode, amount, setAmount, pay, setPay, position, solBalance, valoBalance, positions, tokens, onOpenToken, onCloseAll }) {
  const amt = parseFloat(amount) || 0;
  const fee = splitFee(amt, pay);
  const held = position?.amt || 0;
  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, padding: 16 }}>
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
      <div style={{ display: "flex", gap: 6 }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inp, flex: 1 }} />
        <button onClick={() => setAmount(pay === "SOL" ? solBalance.toFixed(2) : Math.floor(valoBalance).toString())}
          style={{ ...chip(false), padding: "0 12px", color: T.amber, borderColor: "rgba(240,185,11,0.4)" }}>MAX</button>
      </div>
      {/* percentage of your balance — quick sizing without full exit */}
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        {[10, 25, 50, 75, 100].map((p) => {
          const bal = pay === "SOL" ? solBalance : valoBalance;
          const val = (bal * p) / 100;
          return (
            <button key={p} onClick={() => setAmount(pay === "SOL" ? val.toFixed(2) : Math.floor(val).toString())}
              style={{ ...chip(false), flex: 1, textAlign: "center", padding: "6px 0", fontSize: 10.5, color: p === 100 ? T.amber : T.dim, borderColor: p === 100 ? "rgba(240,185,11,0.4)" : T.border }}>
              {p === 100 ? "MAX" : p + "%"}
            </button>
          );
        })}
      </div>

      {(() => {
        const bidSol = pay === "SOL" ? amt : (amt * token.price) / SOL_USD;
        const pnlPct = position ? ((token.price - position.entry) / position.entry) * 100 : 0;
        const sellCol = !position ? T.red : pnlPct > 0.05 ? T.green : pnlPct < -0.05 ? T.red : "#4a5266";
        const sellTxt = !position ? "#170808" : pnlPct > 0.05 ? "#07130d" : pnlPct < -0.05 ? "#170808" : "#e6e9ef";
        const sellAllSol = pay === "SOL" ? held : (held * token.price) / SOL_USD;
        return (<>
          <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
            <button onClick={() => onExecute({ side: "buy", pay, amt, mode: "instant", tax: taxFor(pay), burn: fee.total, legs: [] })}
              style={{ flex: 1, border: "none", borderRadius: 9, padding: "11px 6px", fontFamily: T.mono, fontWeight: 900, cursor: "pointer", background: T.green, color: "#07130d", boxShadow: "0 0 16px rgba(22,199,132,0.25)", lineHeight: 1.25 }}>
              <div style={{ fontSize: 12.5 }}>⚡ BUY</div>
              <div style={{ fontSize: 8.5, opacity: 0.85 }}>{bidSol.toFixed(2)} SOL · ${(bidSol * SOL_USD).toFixed(0)}</div>
            </button>
            <button onClick={() => onExecute({ side: "sell", pay, amt, mode: "instant", tax: taxFor(pay), burn: fee.total, legs: [] })}
              style={{ flex: 1, border: "none", borderRadius: 9, padding: "11px 6px", fontFamily: T.mono, fontWeight: 900, cursor: "pointer", background: sellCol, color: sellTxt, boxShadow: `0 0 16px ${sellCol}33`, lineHeight: 1.25, transition: "background .3s" }}>
              <div style={{ fontSize: 12.5 }}>⚡ SELL {position ? (pnlPct >= 0 ? "▲" : "▼") : ""}</div>
              <div style={{ fontSize: 8.5, opacity: 0.85 }}>{bidSol.toFixed(2)} SOL · ${(bidSol * SOL_USD).toFixed(0)}</div>
            </button>
          </div>
          <button onClick={() => { if (held > 0) onExecute({ side: "sell", pay, amt: held, mode: "instant", tax: taxFor(pay), burn: splitFee(held, pay).total, legs: [] }); }}
            disabled={held <= 0}
            style={{ width: "100%", border: `1px solid ${sellCol}`, borderRadius: 9, padding: "9px", fontFamily: T.mono, fontSize: 11, fontWeight: 800, background: `${sellCol}22`, color: sellCol, cursor: held > 0 ? "pointer" : "not-allowed", opacity: held > 0 ? 1 : 0.5, marginBottom: 12, lineHeight: 1.35 }}>
            <div>SELL ALL {held > 0 ? `· ${sellAllSol.toFixed(2)} SOL` : "· no position"}</div>
            {held > 0 && position && (
              <div style={{ fontSize: 8.5, opacity: 0.9 }}>
                avg in ${fmtP(position.entry)} → now ${fmtP(token.price)} · {pnlPct >= 0 ? "+" : "−"}${Math.abs((sellAllSol * pnlPct / 100) * SOL_USD).toFixed(2)} ({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(1)}%)
              </div>
            )}
          </button>
        </>);
      })()}

      {/* held positions dropdown */}
      <HeldPositions positions={positions} tokens={tokens} pay={pay}
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
        <TradePanel token={token} onExecute={onExecute} amount={amount} pay={pay} />
      </div>
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

function PortfolioPanel({ big, solBalance, valoWallet, positions, tokens, realizedPnl, unrealizedPnl,
  tab, setTab, range, setRange, mode, setMode, seed, onDeposit, onWithdraw, onSwap,
  hideBalance, setHideBalance, heldSlot, maxDeposit = 0, maxWithdraw = 0, activity = [], onOpenToken,
  username, setUsername, isNameTaken,
  epochLastHour = 0, epochTotalEarned = 0, valoUsdForEpoch = 0.0125, onOpenClaim }) {
  const mask = (s) => (hideBalance ? "••••••" : s);
  const valoUsd = 0.0125; // API: live $VALO price
  const liveValue = Object.entries(positions).reduce((a, [id, p]) => {
    const t = tokens.find((x) => x.id === +id); if (!t || !p) return a;
    return a + p.amt * (t.price / p.entry); // current worth of open positions (in settlement units, approx)
  }, 0);
  const walletUsd = solBalance * SOL_USD + valoWallet * valoUsd;
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalEquity = walletUsd + Math.max(0, liveValue);
  const [swapAmt, setSwapAmt] = useState("1");
  const [swapDir, setSwapDir] = useState("sol2valo"); // sol2valo | valo2sol
  const [swapArmed, setSwapArmed] = useState(false);
  const [dwAmt, setDwAmt] = useState("");
  const [dwArmed, setDwArmed] = useState(null); // null | "deposit" | "withdraw"
  const [dwWarn, setDwWarn] = useState(""); // "Not Enough" style warnings
  const series = pnlSeries(range, seed, unrealizedPnl, realizedPnl);
  const gain = totalPnl >= 0;
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(username || "");
  const [nameErr, setNameErr] = useState("");
  const saveName = () => {
    const v = (nameDraft || "").trim().replace(/^@+/, "");
    if (v.length < 3) { setNameErr("Too short (3+ chars)"); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(v)) { setNameErr("Letters, numbers, _ only"); return; }
    if (v.toLowerCase() !== (username || "").toLowerCase() && isNameTaken && isNameTaken(v)) { setNameErr("That username is taken"); return; }
    setUsername && setUsername(v); setEditingName(false); setNameErr("");
  };

  return (
    <div style={{ background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 12, padding: 14, marginTop: 12 }}>
      {/* username row */}
      {username && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, paddingBottom: 10, borderBottom: `1px solid ${T.border}` }}>
          <span style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${VALO_PURPLE}, ${T.blue})`, display: "grid", placeItems: "center", fontFamily: T.mono, fontWeight: 800, fontSize: 12, color: "#0a0713", flexShrink: 0 }}>{(username[0] || "?").toUpperCase()}</span>
          {!editingName ? (
            <>
              <span style={{ fontFamily: T.mono, fontSize: 12.5, fontWeight: 800, color: T.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>@{username}</span>
              <button onClick={() => { setNameDraft(username); setNameErr(""); setEditingName(true); }} title="Change username"
                style={{ ...chip(false), padding: "4px 8px", fontSize: 12 }}>✏️</button>
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
            <div style={{ fontFamily: T.mono, fontSize: 26, fontWeight: 800, color: T.text }}>{mask(`$${totalEquity.toLocaleString(undefined, { maximumFractionDigits: 0 })}`)}</div>
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
              <span style={{ color: T.faint }}>IN LIVE TRADES</span>
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
        <div style={{ flex: 1, overflowY: "auto", overscrollBehavior: "contain", padding: "0 8px", WebkitOverflowScrolling: "touch", position: "relative" }}>
          {/* EXIT + drag-catch are fixed to the viewport so they're always reachable */}
          <div onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
            onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
            style={{ position: "fixed", top: 0, left: 0, right: 0, height: 44, zIndex: 47, touchAction: "none", cursor: "grab" }} />
          <button onClick={onClose}
            style={{ position: "fixed", top: 8, left: 12, zIndex: 48, border: `1px solid ${T.border2}`, borderRadius: 8, background: "rgba(17,21,29,0.95)", color: T.text, fontFamily: T.mono, fontSize: 12, fontWeight: 700, padding: "6px 12px", cursor: "pointer" }}>
            ✕ EXIT
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
    { t: "p", x: "Every hour on the hour, the epoch wallet's entire balance is distributed. The system snapshots balances and volume, computes each wallet's share, builds a Merkle tree, and publishes the root on-chain. Only sub-dust rolls forward." },
    { t: "h", x: "Share formula" },
    { t: "p", x: "A wallet's share blends holder weight (time-weighted balance) and volume weight (share of epoch volume) 50/50, then scales by the loyalty multiplier." },
    { t: "h", x: "Claiming" },
    { t: "p", x: "Claiming fetches your Merkle proof and submits a claim tx — you pay your own gas, tokens land in your wallet. Unclaimed epochs stack and can be claimed together." },
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
    { t: "h", x: "Automated trading" },
    { t: "p", x: "A non-custodial builder: live-tracking buy-in price, stop-loss, and trailing take-profit legs summing to 100%. Simulated here; production routes through your wallet via a keeper." },
    { t: "h", x: "Portfolio & wallet" },
    { t: "b", x: "Equity, all-time PnL, SOL / $VALO breakdown, privacy mask." },
    { t: "b", x: "Deposit / withdraw with percentage presets and confirm-to-execute." },
    { t: "b", x: "Tax-free SOL ⇄ $VALO swap, traceable PnL chart, held-positions close-all." },
  ]},
  { id: "arch", icon: "🧩", n: "8", title: "Architecture", accent: "#16C784", body: [
    { t: "b", x: "Fee router (Anchor) — takes the fee, splits burn/vault, emits an event." },
    { t: "b", x: "Indexer (Helius → Postgres) — records trades and fees." },
    { t: "b", x: "Snapshot job (hourly) — time-weighted balances." },
    { t: "b", x: "Epoch job (hourly) — drains wallet, builds Merkle tree, publishes root." },
    { t: "b", x: "Creator-fee handler (hourly) — 25/25/50 split incl. buyback-burn." },
    { t: "b", x: "Distributor (on-chain) — verifies proofs, releases tokens." },
  ]},
  { id: "security", icon: "🛡️", n: "9", title: "Security Model", accent: "#EA3943", body: [
    { t: "b", x: "Privileged wallets held in multisig; no single hot key moves material funds." },
    { t: "b", x: "Automated jobs default to a dry-run guard; live execution is deliberate." },
    { t: "b", x: "On-chain programs audited before mainnet; Merkle logic reproducible off-chain." },
    { t: "b", x: "Claims are proof-gated; the distributor never custodies user wallets." },
  ]},
  { id: "roadmap", icon: "🗺️", n: "10", title: "Roadmap", accent: "#7D5CF0", body: [
    { t: "b", x: "Phase 1 — Terminal + simulated economics (current)." },
    { t: "b", x: "Phase 2 — Live wiring: price feeds, devnet router, indexer, hourly jobs." },
    { t: "b", x: "Phase 3 — Audit + mainnet: multisig custody, distributor live, real burns/epochs." },
    { t: "b", x: "Phase 4 — Expansion: more venues, keeper strategies, deeper analytics." },
  ]},
  { id: "disclaimer", icon: "⚠️", n: "11", title: "Disclaimers", accent: "#EA3943", body: [
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
    const el = secRefs.current[id], sc = scrollRef.current;
    if (el && sc) sc.scrollTo({ top: el.offsetTop - 12, behavior: "smooth" });
    setActive(id);
    if (isMobile) setTocOpen(false);
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
      style={{ position: "fixed", inset: 0, zIndex: 61, background: "rgba(4,6,10,0.78)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", padding: isMobile ? 8 : 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(96vw, 900px)", height: isMobile ? "92vh" : "86vh", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 16, boxShadow: "0 30px 90px rgba(0,0,0,0.7)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* header with gradient + progress bar */}
        <div style={{ position: "relative", padding: "14px 16px", background: `linear-gradient(120deg, ${activeSec.accent}22, transparent 70%)`, borderBottom: `1px solid ${T.border}`, transition: "background .4s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button onClick={() => setTocOpen((v) => !v)} title="Contents"
                style={{ ...chip(tocOpen), padding: "5px 9px", fontSize: 13 }}>☰</button>
              <span style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 20, color: VALO_PURPLE, letterSpacing: -0.5 }}>VALO</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, letterSpacing: 2, color: T.dim }}>WHITEPAPER v1.0</span>
            </div>
            <button onClick={onClose} style={{ ...chip(false), padding: "4px 10px" }}>✕</button>
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
function LiveTrades({ token, isMobile }) {
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
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "38px 1fr 62px 46px 26px", gap: 6, padding: "6px 12px", alignItems: "center", borderBottom: `1px solid ${T.border}`, borderLeft: `2px solid ${r.isBuy ? T.green : T.red}` }}>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>{ago(r.at)}</span>
              <span>
                <div style={{ fontFamily: T.mono, fontSize: 11, fontWeight: 800, color: r.isBuy ? T.green : T.red }}>{r.isBuy ? "↑" : "↓"} ${r.usd.toFixed(2)}</div>
                <div style={{ fontFamily: T.mono, fontSize: 8, color: T.faint }}>{r.sol.toFixed(3)} SOL · {r.trader}</div>
              </span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.text, textAlign: "right" }}>{fmt$(r.mc)}</span>
              <span style={{ fontFamily: T.mono, fontSize: 9.5, textAlign: "right", color: r.pnlPct == null ? T.faint : r.pnlPct >= 0 ? T.green : T.red }}>
                {r.pnlPct == null ? "—" : `${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct.toFixed(0)}%`}
              </span>
              <a href={`https://solscan.io/tx/${r.tx}`} target="_blank" rel="noopener noreferrer" title="View on Solscan" style={{ textAlign: "center", textDecoration: "none", color: T.blue, fontSize: 11 }}>🔗</a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------- search bar (tokens + users) with live suggestions ----------------
function SearchBar({ tokens, onPickToken, username, full = false }) {
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
                <div key={u} style={{ display: "flex", alignItems: "center", gap: 9, padding: "8px 12px", cursor: "default" }}>
                  <span style={{ width: 22, height: 22, borderRadius: "50%", background: `linear-gradient(135deg, ${VALO_PURPLE}, ${T.blue})`, display: "grid", placeItems: "center", fontFamily: T.mono, fontWeight: 800, fontSize: 10, color: "#0a0713" }}>{u[0].toUpperCase()}</span>
                  <span style={{ flex: 1, fontFamily: T.mono, fontSize: 11.5, fontWeight: 700, color: T.text }}>@{u}{u === username && <span style={{ color: T.green, fontSize: 8 }}> · you</span>}</span>
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.faint }}>trader</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
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
  const [myActivity, setMyActivity] = useState([]); // portfolio activity feed
  const [positions, setPositions] = useState({});
  const [realizedPnl, setRealizedPnl] = useState(0); // sum of closed-trade PnL (24h)
  const [flash, setFlash] = useState(null);
  const [tape, setTape] = useState([]);
  const [clickMode, setClickMode] = useState(null);
  const [amount, setAmount] = useState("1.0");
  const [pay, setPay] = useState("SOL");
  const [callouts, setCallouts] = useState([]); // [{id, tokenId, user, mcAt, ts}]
  const [bannerPaused, setBannerPaused] = useState(false);
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [portfolioDrawer, setPortfolioDrawer] = useState(false); // mobile portfolio drawer
  const [hideBalance, setHideBalance] = useState(false); // privacy mask for balances
  const [coinChats, setCoinChats] = useState({}); // tokenId -> [msgs]
  const [burnMine, setBurnMine] = useState(false); // header burn: total ⇄ yours
  const [markerInfo, setMarkerInfo] = useState(null); // clicked $ marker receipt
  const [highlightTx, setHighlightTx] = useState(null); // tx of the marker to highlight on chart
  const [searchQ, setSearchQ] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [caCopied, setCaCopied] = useState(null); // token id whose CA was just copied
  const [histMarker, setHistMarker] = useState(null); // a trade opened from history, shown as marker
  const [logoBurst, setLogoBurst] = useState(null); // VALO logo click effect
  const [wallOpen, setWallOpen] = useState(true); // left ticker panel expand/collapse
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
  const [extraH, setExtraH] = useState(0); // px extra chart height
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
  // chart resize drag (left / bottom / corner handles)
  useEffect(() => {
    const move = (e) => {
      const r = resizeRef.current; if (!r) return;
      const dx = r.sx - e.clientX; // dragging left = positive
      const dy = e.clientY - r.sy; // dragging down = positive
      if (r.mode === "x" || r.mode === "xy") setPullX(Math.max(0, Math.min(r.maxPull, r.px0 + dx)));
      if (r.mode === "y" || r.mode === "xy") setExtraH(Math.max(0, Math.min(420, r.h0 + dy)));
    };
    const up = () => { resizeRef.current = null; };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
  }, []);
  const startResize = (mode, e) => { resizeRef.current = { mode, sx: e.clientX, sy: e.clientY, px0: pullX, h0: extraH, maxPull: computeMaxPull() }; e.preventDefault(); };
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
    // portfolio activity feed — one bar per trade
    setMyActivity((A) => [{
      id: Math.random().toString(36).slice(2), t: Date.now(),
      sym: t.sym, hue: t.hue, img: t.img, side: o.side, amt: o.amt, unit,
      price: t.price, pnlMoney: o.side === "sell" ? sellPnlMoney : null, pnlPct: o.side === "sell" ? sellPnlPct : null,
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

  const chartTrade = ({ side }) => {
    if (!selected) return;
    const amt = parseFloat(amount) || 0;
    const tax = taxFor(pay);
    execute(selected, { side, pay, amt, mode: "instant", tax, burn: splitFee(amt, pay).total, legs: [] }, { chartClick: true });
  };

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
  const platformPnl = realizedPnl + unrealizedPnl;
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
                    {/* why it's trending */}
                    <button onClick={() => { setDevView(false); setTrendOpen(true); }} title="Why it's trending"
                      style={{ display: "flex", alignItems: "center", gap: 4, border: "1px solid rgba(240,185,11,0.4)", background: "rgba(240,185,11,0.10)", color: T.amber, borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 10, fontWeight: 800, cursor: "pointer" }}>🔥 Trending</button>
                    <button onClick={() => setShowDevTrades((v) => !v)} title="Show developer buys & sells on the chart"
                      style={{ display: "flex", alignItems: "center", gap: 4, border: `1px solid ${showDevTrades ? accent(selected.hue) : T.border2}`, background: showDevTrades ? `${accent(selected.hue)}22` : "rgba(255,255,255,0.03)", color: showDevTrades ? accent(selected.hue) : T.dim, borderRadius: 7, padding: "4px 9px", fontFamily: T.mono, fontSize: 10, fontWeight: 800, cursor: "pointer" }}>👨‍💻 Dev trades</button>
                    <div style={{ width: 1, height: 18, background: T.border, margin: "0 2px" }} />
                    <button onClick={() => setChartMode("candles")} style={chip(chartMode === "candles")}>▮ Candles</button>
                    <button onClick={() => setChartMode("line")} style={chip(chartMode === "line")}>∿ Line</button>
                  </div>
                </div>
                {/* metrics under price — same colors as the token banners */}
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
                <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
                  {TIMEFRAMES.map((f) => (
                    <button key={f.k} onClick={() => setTf(f.m)} style={{ ...chip(tf === f.m), padding: "3px 8px" }}>{f.k}</button>
                  ))}
                </div>

                <div style={{ position: "relative" }}>
                  <ProChart candles={selected.candles} hue={selected.hue} synthetic={!selected.hasDex}
                    mode={chartMode} tfMin={tf} trades={[...(tradesByToken[selected.id] || []), ...(showDevTrades ? (selected.dev.trades || []) : []), ...(histMarker && histMarker.sym === selected.sym ? [histMarker] : [])]}
                    clickMode={clickMode} onChartTrade={chartTrade} onMarkerClick={(tr) => { setMarkerInfo(tr); if (tr && tr.tx) setHighlightTx(tr.tx); }}
                    highlightTx={highlightTx}
                    position={positions[selected.id]} price={selected.price} sym={selected.sym}
                    isMobile={isMobile} height={isMobile ? 300 : 480 + extraH} />

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
                      {(pullX > 0 || extraH > 0) && (
                        <button onClick={() => { setPullX(0); setExtraH(0); }}
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

                {/* metrics — single line, short tags, horizontally scrollable if tight */}
                <div style={{ display: "flex", gap: 6, marginTop: 10, overflowX: "auto", whiteSpace: "nowrap", paddingBottom: 2 }}>
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

                {/* live on-chain trades — collapsible, with holders count */}
                <LiveTrades token={selected} isMobile={isMobile} />
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
                          <span style={{ color: m.me ? accent(258, 68) : T.blue }}>@{m.user}</span>
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

  const ticketBlock = selected ? (
    <TradePanel token={selected} onExecute={(o) => execute(selected, o)} amount={amount} pay={pay} />
  ) : (
    <div style={{ background: T.panel, border: `1px dashed ${T.border2}`, borderRadius: 12, padding: 24, textAlign: "center", color: T.faint, fontFamily: T.mono, fontSize: 11 }}>
      Auto trader appears when a pair is selected
    </div>
  );

  // compact hotbar — the only trade controls; MAX & SELL ALL included
  const mobileTradeStrip = selected && (
    <div>
      {/* amount + MAX + quick picks */}
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <input value={amount} onChange={(e) => setAmount(e.target.value)}
          style={{ ...inp, flex: 1, minWidth: 0, padding: "9px 6px", fontSize: 13, textAlign: "center" }} />
        <button onClick={() => setPay(pay === "SOL" ? "VALO" : "SOL")}
          style={{ ...chip(true), padding: "0 9px", fontSize: 10, minWidth: 50 }}>{pay === "SOL" ? "SOL" : "$VALO"}</button>
        <button onClick={() => setAmount(pay === "SOL" ? solBalance.toFixed(2) : Math.floor(myHoldings).toString())}
          style={{ ...chip(false), padding: "0 10px", fontSize: 10, color: T.amber, borderColor: "rgba(240,185,11,0.4)" }}>MAX</button>
      </div>
      {/* percentage sizing — quick partial entries/exits without going all-in/out */}
      <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
        {[10, 25, 50, 75, 100].map((p) => {
          const bal = pay === "SOL" ? solBalance : myHoldings;
          const val = (bal * p) / 100;
          return (
            <button key={p} onClick={() => setAmount(pay === "SOL" ? val.toFixed(2) : Math.floor(val).toString())}
              style={{ ...chip(false), flex: 1, textAlign: "center", padding: "7px 0", fontSize: 10, color: p === 100 ? T.amber : T.dim, borderColor: p === 100 ? "rgba(240,185,11,0.4)" : T.border }}>
              {p === 100 ? "MAX" : p + "%"}
            </button>
          );
        })}
      </div>
      {/* buy / sell / sell all — show bid size and shade by position PnL */}
      {(() => {
        const a = parseFloat(amount) || 0;
        const usdOf = (amtSol) => amtSol * SOL_USD;
        const pos = positions[selected.id];
        const pnlPct = pos ? ((selected.price - pos.entry) / pos.entry) * 100 : 0;
        // sell/sell-all shade by current PnL: green gain, red loss, gray flat
        const sellCol = !pos ? T.red : pnlPct > 0.05 ? T.green : pnlPct < -0.05 ? T.red : "#4a5266";
        const sellTxt = !pos ? "#170808" : pnlPct > 0.05 ? "#07130d" : pnlPct < -0.05 ? "#170808" : "#e6e9ef";
        const bidSol = pay === "SOL" ? a : (a * selected.price) / SOL_USD; // token amt → SOL-equiv
        const held = pos?.amt || 0;
        const sellAllSol = pay === "SOL" ? held : (held * selected.price) / SOL_USD;
        return (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => execute(selected, { side: "buy", pay, amt: a, mode: "instant", tax: taxFor(pay), burn: splitFee(a, pay).total, legs: [] })}
              style={{ flex: 1.4, border: "none", borderRadius: 10, padding: "10px 4px", fontFamily: T.mono, fontWeight: 900, letterSpacing: 0.5, background: T.green, color: "#07130d", cursor: "pointer", boxShadow: "0 0 12px rgba(22,199,132,0.28)", lineHeight: 1.2 }}>
              <div style={{ fontSize: 13 }}>⚡ BUY</div>
              <div style={{ fontSize: 8.5, opacity: 0.85 }}>{bidSol.toFixed(2)} SOL · ${usdOf(bidSol).toFixed(0)}</div>
            </button>
            <button onClick={() => execute(selected, { side: "sell", pay, amt: a, mode: "instant", tax: taxFor(pay), burn: splitFee(a, pay).total, legs: [] })}
              style={{ flex: 1.4, border: "none", borderRadius: 10, padding: "10px 4px", fontFamily: T.mono, fontWeight: 900, letterSpacing: 0.5, background: sellCol, color: sellTxt, cursor: "pointer", boxShadow: `0 0 12px ${sellCol}44`, lineHeight: 1.2, transition: "background .3s" }}>
              <div style={{ fontSize: 13 }}>⚡ SELL {pos ? (pnlPct >= 0 ? "▲" : "▼") : ""}</div>
              <div style={{ fontSize: 8.5, opacity: 0.85 }}>{bidSol.toFixed(2)} SOL · ${usdOf(bidSol).toFixed(0)}</div>
            </button>
            <button onClick={() => { if (held > 0) execute(selected, { side: "sell", pay, amt: held, mode: "instant", tax: taxFor(pay), burn: splitFee(held, pay).total, legs: [] }); }}
              disabled={held <= 0}
              style={{ flex: 1.1, border: `1px solid ${sellCol}`, borderRadius: 10, padding: "10px 4px", fontFamily: T.mono, fontWeight: 800, background: `${sellCol}22`, color: sellCol, cursor: held > 0 ? "pointer" : "not-allowed", opacity: held > 0 ? 1 : 0.5, lineHeight: 1.2 }}>
              <div style={{ fontSize: 11 }}>SELL ALL</div>
              <div style={{ fontSize: 8, opacity: 0.85 }}>{held > 0 ? (pos ? `${pnlPct >= 0 ? "+" : "−"}$${Math.abs((sellAllSol * pnlPct / 100) * SOL_USD).toFixed(1)} · ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(0)}%` : `${sellAllSol.toFixed(2)} SOL`) : "no position"}</div>
            </button>
          </div>
        );
      })()}
    </div>
  );

  // ---- airdrop derived values ----
  const msToEpoch = (epochRef.current + 1) * EPOCH_MS - now;
  const holdPctNow = myHoldings / supplyHeld;
  const volPctNow = poolVol > 0 ? myEpochVol / poolVol : 0;
  const weightNow = holdPctNow * 0.5 + volPctNow * 0.5;
  const loyaltyMult = Math.min(2.5, 1 + loyaltyDays * 0.1); // +0.1x/day, resets to 1x on withdraw
  const stackNow = loyaltyMult;
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
          <button onClick={() => setLogoBurst(Date.now())} className="valo-logo"
            style={{ border: "none", background: "transparent", cursor: "pointer", pointerEvents: "auto", padding: 0,
              fontFamily: T.sans, fontWeight: 900, fontSize: 96, lineHeight: 0.9, letterSpacing: -4 }}>
            <span className="valo-letters">VALO</span>
          </button>
          {/* simple rounded diamond (matches the icon) with a glow */}
          <div style={{ position: "relative", width: 64, height: 64, pointerEvents: "none" }}>
            <div style={{ position: "absolute", inset: -14, borderRadius: 24, background: "radial-gradient(circle, rgba(125,92,240,0.45), rgba(91,147,236,0.12) 60%, transparent 75%)" }} />
            <div style={{ position: "absolute", inset: 0, transform: "rotate(45deg)", borderRadius: 18,
              background: "linear-gradient(135deg, #a07ff2, #5b93ec)", boxShadow: "0 0 22px rgba(125,92,240,0.6)" }} />
            <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: "46%", transform: "rotate(45deg)", transformOrigin: "center", borderRadius: 18, background: "rgba(255,255,255,0.18)" }} />
          </div>
          {logoBurst && (
            <div key={logoBurst} className="logo-burst" style={{ position: "absolute", left: 200, top: 44 }}>
              {Array.from({ length: 16 }).map((_, i) => (
                <span key={i} style={{ "--a": `${(i / 16) * 360}deg`, background: i % 2 ? VALO_PURPLE : accent(200, 65) }} />
              ))}
            </div>
          )}
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
      <div style={{ borderBottom: `1px solid ${T.border}`, background: "rgba(10,13,19,0.92)", backdropFilter: "blur(8px)", position: "sticky", top: 0, zIndex: 20 }}>
        {isMobile ? (
          /* MOBILE HEADER — clean, organized brand + stats */
          <div style={{ padding: "10px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
              <button onClick={() => setLogoBurst(Date.now())}
                style={{ border: "none", background: "transparent", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                <span className="valo-letters" style={{ fontFamily: T.sans, fontWeight: 900, fontSize: 30, lineHeight: 1, letterSpacing: -1 }}>VALO</span>
                <span style={{ position: "relative", width: 20, height: 20, display: "inline-block" }}>
                  <span style={{ position: "absolute", inset: 0, borderRadius: 4, background: "linear-gradient(135deg, hsla(258,90%,72%,0.95), hsla(200,90%,65%,0.9))", transform: "rotate(45deg)", boxShadow: "0 0 10px hsla(258,90%,65%,0.7)", animation: "diamondPulse 3s ease-in-out infinite" }} />
                </span>
              </button>
              {/* whitepaper + claim */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
                ["🔥 BURN", <b style={{ color: "#f97316" }}>{(burnMine ? myBurned : burned).toFixed(3)}</b>],
              ].map(([k, v], i) => (
                <div key={k} style={{ flex: 1, textAlign: "center", padding: "6px 2px", borderLeft: i ? `1px solid ${T.border}` : "none" }}>
                  <div style={{ color: T.faint, fontSize: 7.5, letterSpacing: 0.8, marginBottom: 2 }}>{k}</div>
                  {v}
                </div>
              ))}
            </div>
          </div>
        ) : (
        <div style={{ maxWidth: 1760, margin: "0 auto", padding: "12px 16px", paddingLeft: wallOpen ? 470 : 180, transition: "padding-left .28s", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
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
            <div onClick={() => setBurnMine((v) => !v)} title="Tap to switch between total and your burn"
              style={{ cursor: "pointer", userSelect: "none", background: "rgba(249,115,22,0.05)", border: "1px solid rgba(249,115,22,0.25)", borderRadius: 9, padding: "6px 13px" }}>
              <div className="burn-swap" style={{ fontFamily: T.mono, fontSize: 8.5, color: T.faint, letterSpacing: 1, marginBottom: 2 }}>
                🔥 {burnMine ? "YOUR" : "TOTAL"} $VALO BURNED
              </div>
              <div style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 800, color: "#f97316" }}>{(burnMine ? myBurned : burned).toFixed(4)}</div>
            </div>

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

      <div style={{ maxWidth: 1760, margin: "0 auto", padding: "14px 16px", paddingRight: isMobile ? 26 : 16, paddingLeft: isMobile ? 16 : (wallOpen ? 350 : 58), transition: "padding-left .28s" }}>
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
            {/* search — tokens & users */}
            <div style={{ marginBottom: 8 }}>
              <SearchBar tokens={tokens} username={username} full onPickToken={(id) => { setSel(id); setClickMode(null); }} />
            </div>
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
        <div className="pt-grid" style={{ display: "grid", gridTemplateColumns: "300px minmax(320px,1fr) 274px 296px", gap: 14, alignItems: "start" }}>
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
                <div style={{ marginBottom: 8 }}>
                  <SearchBar tokens={tokens} username={username} full onPickToken={(id) => { setSel(id); setClickMode(null); }} />
                </div>
              )}
              {chartBlock}
            </div>
            {chatBlock}
          </div>

          {/* trade options */}
          <div style={{ position: "sticky", top: 70, maxHeight: "calc(100vh - 90px)", overflowY: "auto" }}>
            {selected ? (
              <DesktopTradePanel token={selected} onExecute={(o, tok) => execute(tok || selected, o)}
                clickMode={clickMode} setClickMode={setClickMode}
                amount={amount} setAmount={setAmount} pay={pay} setPay={setPay}
                position={positions[selected.id]} solBalance={solBalance} valoBalance={valoWallet}
                positions={positions} tokens={tokens}
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
          </div>

          {/* portfolio — its own column to the right of trade options */}
          <div style={{ position: "sticky", top: 70, maxHeight: "calc(100vh - 90px)", overflowY: "auto" }}>
            <PortfolioPanel big
              solBalance={solBalance} valoWallet={valoWallet} positions={positions} tokens={tokens}
              realizedPnl={realizedPnl} unrealizedPnl={unrealizedPnl}
              tab={portfolioTab} setTab={setPortfolioTab}
              range={perfRange} setRange={setPerfRange}
              mode={perfMode} setMode={setPerfMode} seed={pnlSeed}
              hideBalance={hideBalance} setHideBalance={setHideBalance}
              activity={myActivity} onOpenToken={(sym, act) => { const tk = tokens.find((x) => x.sym === sym); if (tk) { setSel(tk.id); setClickMode(null); if (typeof setPortfolioDrawer === 'function') setPortfolioDrawer(false); if (act) { setHistMarker({ t: act.t, side: act.side, p: act.price, price: act.price, amt: act.amt, unit: act.unit, mc: mcOf(tk), pnlPct: act.pnlPct, pnlMoney: act.pnlMoney, sym: act.sym, tx: act.tx }); setHighlightTx(act.tx); } } }}
              username={username} setUsername={(v) => { takenNames.current.add(v.toLowerCase()); setUsername(v); }} isNameTaken={(v) => takenNames.current.has(v.toLowerCase())}
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
        </div>
        )}
      </div>

      {/* LEFT-WALL TOKEN PANEL — bordered, collapsible, spans down the screen */}
      {!isMobile && (
        <div ref={wallRef} style={{ position: "fixed", left: 0, top: 158, bottom: 14, zIndex: 15, display: "flex", alignItems: "stretch" }}>
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

      {/* TRADE MARKER RECEIPT */}
      {markerInfo && (
        <div onClick={() => setMarkerInfo(null)}
          style={{ position: "fixed", inset: 0, zIndex: 62, background: "rgba(4,6,10,0.6)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(92vw, 340px)", background: T.panel, border: `1px solid ${markerInfo.side === "buy" ? T.green : T.red}`, borderRadius: 14, padding: 16, boxShadow: "0 20px 60px rgba(0,0,0,0.6)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: T.mono, fontSize: 13, fontWeight: 800, color: markerInfo.side === "buy" ? T.green : T.red }}>
                <span style={{ width: 20, height: 20, borderRadius: "50%", border: `1.5px solid ${markerInfo.side === "buy" ? T.green : T.red}`, display: "grid", placeItems: "center", fontSize: 10 }}>$</span>
                {markerInfo.side === "buy" ? "BUY" : "SELL"} · {markerInfo.sym}{markerInfo.bot ? " · BOT" : ""}{markerInfo.dev ? " · 👨‍💻DEV" : ""}
              </span>
              <button onClick={() => setMarkerInfo(null)} style={{ ...chip(false), padding: "3px 8px" }}>✕</button>
            </div>
            <div style={{ display: "grid", gap: 7 }}>
              {[
                ["TIME", new Date(markerInfo.t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })],
                ["AMOUNT", `${markerInfo.amt} ${markerInfo.unit}`],
                ["FILL PRICE", `$${fmtP(markerInfo.price)}`],
                ["MARKET CAP", fmt$(markerInfo.mc)],
                ...(markerInfo.side === "sell" && markerInfo.pnlPct != null
                  ? [["ENTRY", `$${fmtP(markerInfo.entry)}`],
                     ["PNL %", null],
                     ["PNL SOL", null],
                     ["PNL USD", null]]
                  : []),
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", fontFamily: T.mono, fontSize: 11.5, borderBottom: `1px solid ${T.border}`, paddingBottom: 5 }}>
                  <span style={{ color: T.faint, letterSpacing: 1 }}>{k}</span>
                  {v != null ? <b style={{ color: T.text }}>{v}</b> : (() => {
                    const gain = markerInfo.pnlPct >= 0;
                    // pnlMoney is in the settlement unit; derive SOL + USD
                    const pnlSol = markerInfo.unit === "SOL" ? markerInfo.pnlMoney : (markerInfo.pnlMoney * markerInfo.price) / SOL_USD;
                    const pnlUsd = pnlSol * SOL_USD;
                    if (k === "PNL %") return <b style={{ color: gain ? T.green : T.red }}>{pct(markerInfo.pnlPct)}</b>;
                    if (k === "PNL SOL") return <b style={{ color: gain ? T.green : T.red }}>{gain ? "+" : "−"}{Math.abs(pnlSol).toFixed(3)} SOL</b>;
                    return <b style={{ color: gain ? T.green : T.red }}>{gain ? "+" : "−"}${Math.abs(pnlUsd).toFixed(2)}</b>;
                  })()}
                </div>
              ))}
            </div>
            {markerInfo.side === "buy" && !markerInfo.dev && (
              <div style={{ marginTop: 10, fontFamily: T.mono, fontSize: 9.5, color: T.faint, textAlign: "center" }}>
                PnL is shown on the matching sell marker.
              </div>
            )}
            {markerInfo.dev && markerInfo.tx && (
              <a href={`https://solscan.io/tx/${markerInfo.tx}`} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", marginTop: 12, textAlign: "center", textDecoration: "none", border: `1px solid ${T.border2}`, borderRadius: 9, padding: "9px", fontFamily: T.mono, fontSize: 11, fontWeight: 700, color: T.blue, background: "rgba(76,154,255,0.08)" }}>
                🔗 View this dev transaction on Solscan →
              </a>
            )}
          </div>
        </div>
      )}

      {/* WHITEPAPER MODAL — interactive reader with expandable TOC sidebar */}
      {wpOpen && <WhitepaperModal onClose={() => setWpOpen(false)} isMobile={isMobile} />}

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
          style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(4,6,10,0.72)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(94vw, 520px)", maxHeight: "88vh", overflowY: "auto", background: T.panel, border: `1px solid ${T.border2}`, borderRadius: 14, padding: 18, boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}>
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
          <button onClick={() => setDrawerOpen((v) => !v)} aria-label="Open chat"
            style={{
              position: "fixed", right: 0, top: "42%", zIndex: 52,
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
          <button onClick={() => setPortfolioDrawer((v) => !v)} aria-label="Open portfolio"
            style={{
              position: "fixed", right: 0, top: "60%", zIndex: 52,
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
            position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 51,
            width: "min(92vw, 400px)", background: "rgba(12,15,22,0.98)",
            borderLeft: `1px solid ${T.border2}`, boxShadow: "-12px 0 40px rgba(0,0,0,0.6)",
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
              realizedPnl={realizedPnl} unrealizedPnl={unrealizedPnl}
              tab={portfolioTab} setTab={setPortfolioTab}
              range={perfRange} setRange={setPerfRange}
              mode={perfMode} setMode={setPerfMode} seed={pnlSeed}
              hideBalance={hideBalance} setHideBalance={setHideBalance}
              activity={myActivity} onOpenToken={(sym, act) => { const tk = tokens.find((x) => x.sym === sym); if (tk) { setSel(tk.id); setClickMode(null); if (typeof setPortfolioDrawer === 'function') setPortfolioDrawer(false); if (act) { setHistMarker({ t: act.t, side: act.side, p: act.price, price: act.price, amt: act.amt, unit: act.unit, mc: mcOf(tk), pnlPct: act.pnlPct, pnlMoney: act.pnlMoney, sym: act.sym, tx: act.tx }); setHighlightTx(act.tx); } } }}
              username={username} setUsername={(v) => { takenNames.current.add(v.toLowerCase()); setUsername(v); }} isNameTaken={(v) => takenNames.current.has(v.toLowerCase())}
              epochLastHour={epochLastHour} epochTotalEarned={epochTotalEarned} valoUsdForEpoch={valoUsdPrice} onOpenClaim={() => { setClaimOpen(true); if (typeof setPortfolioDrawer === 'function') setPortfolioDrawer(false); }}
              heldSlot={
                <HeldPositions positions={positions} tokens={tokens} pay={pay}
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
          background: linear-gradient(100deg,
            hsl(258 75% 42%) 0%, hsl(258 80% 68%) 30%,
            #ffffff 46%, hsl(258 80% 72%) 54%, hsl(230 75% 55%) 80%, hsl(258 70% 40%) 100%);
          background-size: 260% 100%;
          -webkit-background-clip: text; background-clip: text; color: transparent;
          -webkit-text-fill-color: transparent;
          filter: drop-shadow(0 4px 22px hsla(258,80%,55%,0.4));
          animation: valoShine 6s ease-in-out infinite;
        }
        @keyframes valoShine{ 0%,100%{ background-position: 0% 0; } 50%{ background-position: 100% 0; } }
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

        .logo-burst span{
          position:absolute; width:7px; height:7px; border-radius:50%; left:0; top:0;
          transform: rotate(var(--a)) translateX(0); opacity:1;
          animation: burstOut .7s ease-out forwards;
        }
        @keyframes burstOut{ to{ transform: rotate(var(--a)) translateX(90px) scale(.3); opacity:0; } }
        .wall-bar{ transition: transform .18s, box-shadow .18s, border-color .18s, background .18s; }
        .wall-bar:hover{ transform: translateX(2px); border-color: rgba(120,140,180,0.5) !important; background: rgba(30,38,52,0.95) !important; }
        .token-card{ transition: border-color .2s, box-shadow .2s, transform .12s; }
        @media (hover:hover){
          .token-card:hover{ border-color: rgba(120,140,180,0.55) !important; box-shadow: 0 0 0 1px rgba(120,140,180,0.25), 0 6px 20px rgba(0,0,0,0.4) !important; transform: translateY(-1px); }
        }
        @keyframes wallSlide{ from{ transform: translateX(-100%); opacity:0; } to{ transform: translateX(0); opacity:1; } }
        .ticker-track{ display:flex; width:max-content; animation: tickerScroll 58s linear infinite; }
        .ticker-half{ display:flex; align-items:center; padding-left: 96px; }
        .ticker.paused .ticker-track{ animation-play-state: paused; }
        @keyframes tickerScroll{ from{ transform:translateX(0); } to{ transform:translateX(-50%); } }
        .burn-swap{ display:inline-block; animation: burnFade .45s ease; }
        @keyframes claimPulse{ 0%,100%{ box-shadow:0 0 14px rgba(22,199,132,0.28); } 50%{ box-shadow:0 0 24px rgba(22,199,132,0.5); } }
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
