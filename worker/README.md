# VALO stream worker

Holds one upstream subscription to Bitquery and fans live pump.fun / Solana DEX
trades out to every browser watching that token. Your terminal already builds
candles from a trade tape, so this simply replaces polling with a stream.

## 1. Bitquery account (free tier)
1. Sign up at https://account.bitquery.io — the free tier / 7-day trial is enough to start.
2. Create an **API access token** (docs: https://docs.bitquery.io — "generate an API access token").
3. Keep it secret. It goes into Railway only, never into the repo or a browser.

## 2. Deploy the worker (Railway — ~$5/mo, or their free allowance)
1. Push this `worker/` folder to its own GitHub repo (or a subfolder of valo-site).
2. railway.app → New Project → Deploy from GitHub → pick that repo.
3. Settings → set the root directory to `worker` if it lives inside valo-site.
4. Variables:
   - `BITQUERY_TOKEN`  = your Bitquery access token   ← secret
   - `ALLOWED_ORIGINS` = https://valotrading.app,https://valoterminal-git-phase2-live-data-valodev.vercel.app
   - (optional) `BITQUERY_WS` if Bitquery gives you a different endpoint
5. Deploy. Railway gives you a URL like `valo-stream-production.up.railway.app`.

## 3. Check it's alive
Open `https://YOUR-WORKER-URL/health` — you should see:
```json
{ "ok": true, "upstream": "connected", "rooms": 0, "clients": 0 }
```
`upstream: "connected"` is the one that matters. `"no-token"` means the env var
didn't land; `"disconnected"` means Bitquery refused the socket (usually the token).

## 4. Point VALO at it
In **Vercel → Settings → Environment Variables**, add for Production *and* Preview:

```
VITE_VALO_STREAM = wss://YOUR-WORKER-URL
```

Then redeploy the site. That's it — the terminal connects on load, subscribes to
whatever token you have open, and starts drawing candles from live trades.

## What happens if the worker is down
Nothing breaks. The terminal keeps its REST polling and reconnects to the socket
in the background with backoff. With the socket live, polling drops to a 30s
backstop instead of every 5s.

## Swapping providers
Write `src/upstream-<name>.js` exporting `createUpstream({ onTrade, onStatus })`
that emits `{ mint, pool, at, isBuy, usd, price, wallet, tx }`, then change the
one import at the top of `src/server.js`. Nothing else in the worker or the
terminal cares which provider you use.
