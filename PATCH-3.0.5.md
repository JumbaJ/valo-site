# VALO — Patch 3.0.5

**Hourly rewards live on chain · the mobile terminal rebuilt**

The biggest patch VALO has shipped. The epoch reward engine paid its first
real $VALO on chain and now runs every hour with nobody at the keyboard —
and the entire mobile terminal was rebuilt around one idea: the chart owns
the screen, everything else earns its space.

The new interface is live at **valotrading.app/?ui=next** — visit once and
it sticks on your device. `?ui=off` switches back any time.

---

## ⚡ Hourly epoch rewards — paid, proven, automatic

The airdrop vault has been describing hourly rewards for a while. As of this
patch they are real, and receipt-backed:

- **Trade during any hour → paid at :05 the next.** The engine snapshots the
  hour's activity, weighs every trader's volume and callout bonuses, and sends
  each share of the 300,000 $VALO pool straight to the payout wallet set in
  your profile. No claiming, no gas, no buttons.
- **First payouts settled and finalized on chain** — verify them yourself on
  Solscan from the announcements in the Telegram.
- **A payout only counts when the chain confirms it.** The engine watches
  every transaction land before recording it as sent; a dropped transaction
  retries with a fresh blockhash instead of quietly pretending it paid.
- **Every epoch pays at most once.** Idempotent by design — the record is only
  stamped after real settlement.
- **Set your payout wallet in the app.** The Airdrop Vault panel's save now
  writes for real, tells you honestly if a save fails, and creates your profile
  on first save. (Previously it could report "saved ✓" while saving nothing —
  every early tester's payout wallet was silently empty. Fixed at the root.)

## 📱 The mobile terminal, rebuilt

**The chart is the screen now.**
- Full-bleed candles — the border and padding boxing every chart are gone.
- One **ceiling band** replaces three rows of chrome: one-tap timeframes
  (1m·5m·15m·1H), a live 🎛 SIGNALS cell, and everything rarer behind ⋯.
- The OHLCV readout fused to the chart's top edge; LIVE / ALL / FIT hang
  beneath it. The purple resize grip rides the chart border itself.
- Net effect: roughly a third more chart on the same phone.

**DexScreener-grade chart physics.**
- Pan freely in every direction — vertical included. **↗ fit** snaps back.
- Hold ~1 second → the reading line appears; drag and it follows your finger;
  release and it **stays, anchored to its candle and price** — pan the chart
  and the line rides along. A clean tap clears it.
- The old frozen-axis crosshair that let candles run off the screen is gone
  entirely. The axis always fits what you're looking at.

**One dock instead of three edge tabs.**
- Wallet, watchlist, and chat lived as tabs gnawing the chart's right edge.
  They're now one small ⚡ dock in the price-axis gutter — drag it anywhere
  on the edge, tap to fan out **balance · watchlist · chat**, tap again to
  close. Glows purple when live automation is armed.

**The auto-trader went chart-first.**
- The chart takes over half the screen; the five-tab row collapsed into one
  mode cell with a hanging menu.
- One **hot bar** runs the whole flow: mode ▾ · ✋ drag-set · amount ·
  **⚡ ARM** — the arm button lights the moment your setup is valid, in any
  mode, and fires the real thing.
- **Visual trading is now literally on the chart**: tap to set your buy-in,
  tap to set your exit — the lines appear where you tapped, and ARM goes
  green. The old "tap to set" boxes are gone because the chart absorbed
  their job. ⚙ opens the full panel for trailing loss and fine-tuning.

## 👛 The wallet, one card

- The wallet tab's nine stacked boxes are now a single bank-style card:
  folder tabs grown from its top, your balance and P/L on its face (tap the
  P/L for the open/realized split), and **ASSETS ⇄ ACTIVITY** as conjoined
  segments on its base — tap to switch, tap again to fold.
- **⚡ ARM lives on the card** — 🔒 locked, ⚡ ready, ◆ armed with a glow —
  and opens the turbo controls as a proper bottom sheet (desktop: docked
  beside the rail) with everything reachable: fund, sweep, lock, automation.
- Both wallet addresses sit on the card as chips: **tap opens Solscan, ⧉
  copies.** LOG OUT moved up beside your username — and shows **LOG IN**
  when your Phantom isn't connected.
- The dock's balance and the card now agree: both speak your **turbo
  wallet's** real number, not simulated equity.

## 📡 Scanner & search — endless, and honest

- **Endless scroll actually is.** The list kept resetting because a
  background refresh amputated everything past 260 tokens every few seconds
  — the depth you scrolled into was being cut off behind you. Fixed; the
  scroll now runs as deep as the feeds go.
- **NEW shows newborns.** Fresh pump.fun launches were being filtered as
  "below launch" for having launch-sized market caps. A token minutes old is
  at the starting line, not under it.
- **HOT and MOVERS filled up** — in the scanner and the search bar. The feed
  was delivering trade counts, price change, and stat windows that the
  adopter dropped on the floor; every lens downstream was starving. All four
  fields now flow through, and both lenses use criteria tested against live
  feed data instead of ideals that matched nothing.
- Long lists render in windows as you scroll, so a thousand-token feed stays
  smooth.

## 🖥 Desktop

- The right rail folds to a slim strip on demand — the chart gains ~320px.
- Same wallet card, same Solscan chips, same slimmer profile header.

## Under the hood

- Payout runs are authenticated, scheduled externally every hour, logged with
  full responses, and alert on failure.
- The vault's on-chain balance, the burn tracker, and every panel continue to
  read live chain data — nothing simulated blends into the live experience.

*Trade during the hour. Land a callout. The pool pays at :05 — and now
that's not a promise, it's a transaction you can open.*
