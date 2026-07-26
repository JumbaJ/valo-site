# VALO — From Simulation to Real Test
### The complete step-by-step build-out plan · v2.0.2 baseline

This document takes VALO from what it is today (a single-file, fully client-side simulation) to a properly deployed **real test**: live Solana market data, paper trading against real prices, persistent accounts, and — only when you choose to flip that switch — real on-chain swaps. Follow the phases in order. Each phase is shippable on its own; you can stop at any phase and have a working product.

---

## PHASE 0 — Understand what you have (30 min)

Right now `valo-terminal-v69.jsx` is ~10,000 lines where **everything is simulated in the browser**:

| System | Current reality |
|---|---|
| Tokens & prices | Seeded random generators, candles synthesized client-side |
| Live trades / holders | Deterministic fake traders from hash functions |
| Fills, PnL, positions | Client-side math, resets on refresh |
| Wallet (SOL/$VALO) | React state, not persisted |
| Chat, callouts, notifications | Local state, single-user |
| Watchlists, subsections | Local state, lost on refresh |

**The good news:** the UI, the interaction model, and the trade math are done. "Going real" means swapping the *data sources* underneath the same components, phase by phase, without rewriting the interface you've built.

---

## PHASE 1 — Repo & deploy hygiene (half a day)

Goal: a professional pipeline — push to GitHub → auto-deploy to Vercel, with a separate staging URL for testing.

### 1.1 Restructure into a real Vite app
Your file currently lives as one JSX. Wrap it properly:

```
valo/
├─ index.html
├─ package.json
├─ vite.config.js
├─ .env.example          ← names of env vars, NO real values
├─ .gitignore            ← must include .env, .env.local, node_modules, dist
└─ src/
   ├─ main.jsx           ← mounts <App/>
   ├─ App.jsx            ← your current 10k-line file (renamed)
   └─ lib/
      ├─ data.js         ← (Phase 2) all market-data fetching lives here
      └─ paper.js        ← (Phase 3) paper-trade engine extracted here
```

Commands (on your Ubuntu box or any machine with Node ≥ 18):
```bash
npm create vite@latest valo -- --template react
cd valo
# copy valo-terminal-v69.jsx to src/App.jsx, adjust the default export name
npm install
npm run dev        # verify it runs locally at localhost:5173
```

### 1.2 GitHub setup
```bash
git init
git add -A
git commit -m "v2.0.2 baseline"
git branch -M main
git remote add origin git@github.com:YOURNAME/valo.git
git push -u origin main
git checkout -b staging && git push -u origin staging
```
**Rule from here on:** all work happens on `staging`. `main` only receives merges that you've tested on the staging URL.

### 1.3 Vercel setup
1. Vercel dashboard → Add New Project → import the GitHub repo.
2. Framework preset: **Vite**. Build command `npm run build`, output `dist`.
3. Under **Settings → Git**: production branch = `main`. Every push to `staging` automatically gets its own preview URL — that's your test site.
4. Under **Settings → Environment Variables**: this is where every API key will live (Phase 2+). Add them per-environment (Preview vs Production). **Never commit keys to the repo, and never paste keys into chats — set them in Vercel directly.**
5. Custom domain: point `valotrading.app` at production, and optionally `test.valotrading.app` at the staging branch.

### 1.4 Your Ubuntu box's role
Keep it — it becomes your **data proxy + websocket server** in Phase 2/4 (Vercel serverless functions can't hold persistent websocket connections to price feeds; a small always-on Node process on Ubuntu can). For now just make sure it has Node 18+, `pm2` (`npm i -g pm2`), and either Caddy or nginx with a TLS cert.

✅ **Phase 1 done when:** pushing to `staging` produces a working preview URL identical to your current site.

---

## PHASE 2 — Real market data, read-only (2–4 days)

Goal: the scanner, charts, live trades, and holders show **real Solana tokens with real prices** — while trading remains simulated. This alone makes it a "real test."

### 2.1 Choose your data providers
| Provider | What it gives you | Cost | Key needed |
|---|---|---|---|
| **DexScreener API** | Token profiles, price, MC, liquidity (TVL), 24h vol, buys/sells counts, per-pair data | Free | No |
| **Jupiter Price API** | Fast batch prices for any mint | Free tier | No |
| **Birdeye** | OHLCV candles, trades feed, holders, websocket streams | Free tier is tight; paid tiers for real use | Yes |
| **Helius** | RPC, token metadata, webhooks/websockets for on-chain tx | Generous free tier | Yes |

**Recommended combo to start:** DexScreener (token cards + prices, no key, easy) + Birdeye free key (candles + trades) + Helius free key (holders via RPC). Check each provider's current docs before wiring — endpoints and rate limits change.

### 2.2 Build the data proxy (on Ubuntu)
Never call these APIs directly from the browser with your keys — the keys would be visible to anyone. Instead run a tiny Express server that holds the keys, caches responses, and serves your frontend:

```
valo-proxy/
└─ server.js
```
Responsibilities:
- `GET /api/tokens?list=trending` → fetch DexScreener trending/pairs for Solana, map into **your token shape** (`{ id, sym, name, price, mc, tvl, greenUsd, redUsd, traders, hue, img, candles }`), cache 10–20s.
- `GET /api/candles?mint=...&tf=1m` → Birdeye OHLCV mapped to your candle array shape.
- `GET /api/trades?mint=...` → recent trades mapped to your live-trades row shape (side, sol amount, wallet, time).
- `GET /api/holders?mint=...` → top holders mapped to your holders rows (name/wallet, qty, usd).
- Global in-memory cache + per-route rate limiting so you never blow through free tiers.

Run it: `pm2 start server.js --name valo-proxy`, put it behind Caddy at `https://api.valotrading.app`, allow CORS only from your Vercel domains.

### 2.3 Wire the frontend
In `src/lib/data.js` create fetchers pointed at `import.meta.env.VITE_API_BASE` (set to your proxy URL in Vercel env vars). Then in App.jsx:
1. **Feature flag first:** `const LIVE_DATA = import.meta.env.VITE_LIVE_DATA === "1";` — when off, everything behaves exactly as today. This is your safety net.
2. Replace the seeded token list with a `useEffect` that loads `/api/tokens` on mount and refreshes every ~15s, mapping into the exact same state your components already read.
3. Replace synthesized candles with `/api/candles` per selected token + timeframe.
4. Replace fake live trades/holders with the proxy routes (poll every 5–10s to start; websockets come in Phase 4).
5. Keep the simulated fields that have no real analog yet (score/rating, momentum) computed client-side from the real inputs — your scoring formulas can now run on *real* volume/liquidity numbers.

### 2.4 Test checklist
- [ ] Scanner shows real tokens with believable MC/TVL/price
- [ ] Opening a token shows real candles that match DexScreener's chart for the same pair
- [ ] Live trades update on refresh interval
- [ ] Turning `VITE_LIVE_DATA` off returns the site to full simulation (regression safety)

✅ **Phase 2 done when:** staging shows real market data end-to-end with your keys never exposed in the browser.

---

## PHASE 3 — Paper trading on real prices + persistence (3–5 days)

Goal: users trade with fake money against **real live prices**, and everything survives refresh. This is the real test of your product loop.

### 3.1 Stand up Supabase (fastest legit backend)
1. Create a project at supabase.com (free tier is fine for testing).
2. Tables:
   - `profiles` (id, handle, icon, created_at)
   - `wallets` (user_id, sol_balance, valo_balance) — seed every new user with e.g. 10 SOL paper money
   - `positions` (user_id, mint, qty, entry_price, pay_unit, opened_at)
   - `activity` (user_id, mint, side, amt, unit, price, tok_qty, val_usd, pnl_money, rem_qty, ts) — matches the TX-accounting fields you built in v2.0.2
   - `watchlists` (user_id, sections jsonb) — your subsections serialize straight into this
   - `bot_runs` (user_id, mint, level, side, remaining, entry, status)
3. Turn on **Row Level Security** on every table with "users can only read/write their own rows" policies. Supabase's dashboard has one-click templates for this.
4. Auth: enable email magic-link to start (wallet sign-in can come later).

### 3.2 Wire the frontend
- `npm i @supabase/supabase-js`; init with the **anon key** (this one is designed to be public — RLS is the security).
- On login: load wallet, positions, watchlist sections into your existing state.
- Your fill engine stays exactly as-is — but it now (a) prices fills from the live price feed, and (b) after each fill writes the activity row + updated position + wallet to Supabase.
- Watchlist/subsection changes debounce-save the sections JSON.

### 3.3 The one honest warning for this phase
Paper fills at "current price" are optimistic — real trading has slippage and failed transactions. For a *test* that's fine; just label the site clearly as **PAPER TRADING / SIMULATED FILLS** so testers' expectations are calibrated. When you later compare paper results to what real fills would have cost, Jupiter's quote API (Phase 5) can give you realistic slippage numbers even in paper mode.

✅ **Phase 3 done when:** two different people can log in on their phones, trade the same real token with paper money, refresh, and their separate portfolios persist.

---

## PHASE 4 — Realtime & social (2–4 days)

- **Live prices/trades push:** upgrade the Ubuntu proxy to hold one Birdeye/Helius websocket upstream and fan out to browsers via Socket.IO or plain WebSocket (`wss://api.valotrading.app/stream`). The frontend swaps its polling for the socket — same state, faster.
- **Chat & callouts:** Supabase Realtime channels (`messages` and `callouts` tables with RLS) get you multi-user chat and callout broadcasting with almost no server code. Your callout tier math stays client-side, computed from the `callouts` history.
- **Notifications:** a `notifications` table + Realtime subscription feeds your existing notification modal (the username→portfolio and callout→chart routing you built already fits this).

---

## PHASE 5 — Real on-chain trading (only when you're ready — 1–2 weeks + serious care)

This is the step where mistakes cost real money, so it's last and optional for a "test."

1. **Wallet connect:** `@solana/wallet-adapter` (Phantom, Solflare, Backpack). Users' keys never touch your servers — all signing happens in their wallet extension/app. This is non-custodial and the standard, safe pattern.
2. **Quotes & swaps:** Jupiter's public quote + swap APIs — request a quote for mint-in/mint-out/amount, receive a serialized transaction, pass it to the wallet adapter for the user to sign. Show the quote's price impact and minimum-received in your order ticket before they sign.
3. **Positions from chain:** replace paper positions with actual token balances read via Helius RPC; your PnL math applies against recorded entry fills.
4. **Hard requirements before real users touch it:**
   - Devnet first, then mainnet with tiny amounts you own.
   - Slippage limits and a transaction-failed path in the UI.
   - Clear risk disclosures; check what financial-services rules apply where you and your users are — a conversation with a lawyer is genuinely worth it before public launch of real trading.
   - Never hold user funds or keys. If a feature seems to need custody, redesign it so it doesn't.

---

## WHAT I NEED FROM YOU (send in chat as decisions, never as secrets)

1. **Confirm the target for "real test":** Phase 2 (real data, simulated trading) → Phase 3 (paper trading + accounts) is my recommended stopping point for a public beta. Yes/no?
2. **Repo layout choice:** keep one big `App.jsx` for now (fastest) or have me split it into components while we're at it (cleaner, ~a day of extra work)?
3. **Provider picks:** DexScreener + Birdeye + Helius as above, or do you have existing keys/preferences?
4. **Your Ubuntu box:** OS version, whether a domain/subdomain already points at it, and whether nginx or Caddy is installed — so the proxy steps can be exact commands.
5. When you're at each step, paste me: your `package.json`, any error output, and the file you're working in — I'll write the exact code for that step (the proxy server, the data mappers into your token shape, the Supabase wiring) the same way we've been doing the terminal.

**Never paste into chat:** API keys, seed phrases, private keys, or `.env` contents. Keys go straight into Vercel env vars / your server's `.env` — I only ever need to know the *names* of the variables.
