# VALO — Patch 3.0.6

**The Floor · a live Telegram inside the terminal · a quieter room**

3.0.5 rebuilt how VALO works on a phone. 3.0.6 rebuilds what you see *between*
trades — the empty space became a live market overview, the community moved
inside the terminal, and the interface stopped shouting so the signals could be
heard.

---

## 🏛 The Floor — the terminal's new home screen

Close a chart and you no longer stare at "select a pair." You land on **The
Floor**: a live market overview built from real chain data, updating on its own
every 30 seconds.

**Three columns, all clickable:**

- **NEW LAUNCHES** — tokens minted in the last 24 hours, freshest first, with
  age, holders, transaction count and LP.
- **BIGGEST MOVES** — what's actually moving right now, ranked by 24h change
  (and by momentum where a token is too young to have one).
- **CALLS RIDING NOW** — every live callout at 2x or better with its current
  multiplier. Signed out, this column becomes the three-step version of how
  getting paid works.

**Every row is an instrument panel.** Avatar, symbol, age and price on top; a
bordered metric strip beneath: **MCAP · TXNS · VOL · LP · B/S · MOM**. Tap any
price to flip the whole floor between price and market cap.

**Market caps are now live for every token.** Where a feed doesn't report one —
common for tokens minutes old — VALO computes it from price × supply instead of
showing a dash. The figure ticks as the price ticks.

**Tap any row to open its chart. Tap the token's name in the chart header to
close it and land back exactly where you were.**

## ⚡ The epoch, front and centre

The hourly reward is the reason VALO exists, so it now leads the Floor: a full
band with the **countdown in large type**, this hour's **300,000 $VALO** pool,
and the deal in plain language — trade anything this hour and your wallet is in
the split, paid automatically at :05, on chain, no claiming and no gas.

Inside the final ten minutes the whole band turns amber and reads
**⚡ CLOSING — LAST CALL**. Colour that only appears when it's true.

## ✈ Telegram, live inside the terminal

The VALO Telegram group now runs **inside the site** as its own chat room —
and it works both ways.

- Messages, **GIFs (playing, looping)**, photos and stickers land on-site
  seconds after they're posted in the group.
- **Type on the site and it posts to the group**, tagged with your VALO handle —
  and your name in Telegram is a link that opens your VALO profile.
- Every sender's name on-site is clickable too: tap it, see their profile.
- The room refreshes the moment you come back to the tab, so nothing is missed
  after a lock screen or a switch away.

## 💬 A quieter chat panel

Six controls stacked above every conversation became three: a **room selector**
(social · this token's room · market alerts · your trades · Telegram), a
**live dot** you tap to pause, and a **✕**. Each room in the selector explains
itself in a line, so nothing needs to be guessed.

## 🎨 Colour only where it means something

A user pointed out that VALO glowed everywhere, which made the parts that matter
compete with decoration. They were right. Three passes:

- **The wallet card** is flat now. The only glow left on it is the **ARM state**,
  which is the one thing that should catch your eye.
- **The header stopped animating for no reason.** The sheen and the ember loops
  are gone. Now the 🔥 dances *only when a burn actually lands* — motion means
  something happened.
- **Scanner cards are neutral by default.** Momentum colours at 85+, buy/sell
  pressure at a real skew (70+ / 30−), the score badge at 80+. Rug warnings stay
  red always. A hot card now stands out because its neighbours are calm.

## 📱 Mobile

- The **grate button beside the search bar** swaps between **The Floor** and the
  **scanner** — one tap, no scrolling.
- On the Floor, the **column header** swaps between **new launches** and
  **biggest moves**.
- The chart's touch model from 3.0.5 carries into every chart on the Floor.

## 🖥 Desktop

- All three Floor columns side by side, each scrolling on its own.
- **Your positions are always reachable.** The POSITIONS tab in the right rail
  no longer requires a chart to be open — your holdings are yours, not a
  property of whatever pair happens to be selected.

## Fixes

- The scanner, search and Floor could all go empty at once. Cause: a hosting
  protection setting was serving sign-in pages instead of data. Diagnosed and
  documented so it can never cost an hour again.
- Tokens appearing twice on the Floor — the de-duplication was keyed on a field
  the data didn't carry.
- Rows that wouldn't open a chart: the Floor's own tokens weren't visible to the
  opener.
- Prices truncating to `$0.0₅23…` in narrow columns; market caps reading `$0.00`
  for anything under a thousand dollars.
- Telegram's welcome message trimmed from sixteen lines to three.

---

*Trade the hour. Land a callout. The pool pays at :05 — and now the terminal
shows you the whole floor while you decide.*

**valotrading.app**
