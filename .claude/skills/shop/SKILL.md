---
name: shop
description: Process shopping requests. Use when the user says "/shop", "process my intents", "buy …", "redeem my vouchers", "add vouchers to wallet", "check my wallet balances", or lists groceries to buy. Runs voucher redemption and purchase flows across Blinkit and BigBasket, stopping before payment.
---

# /shop: run the request queue

Arguments (optional): free text such as `redeem`, `balances`, or an item list ("milk, eggs, atta 5kg").

## 0. Start
1. If arguments contain items, queue them: `node tools/shop.js new-purchase --items "milk;eggs;atta 5kg"`. If they say redeem: `new-redeem`. If they say balances, run step A3 only and stop.
2. `node tools/shop.js intents` → process each open intent, oldest first.
3. Remind the user once per session that the UI is at http://localhost:4317 (`npm run ui` if it isn't running).

Before each step, `set <id> <status> --stage "<one line the user sees>"`.

## A. Redeem intent (no confirmation needed)
1. `set <id> running --stage "Looking for new voucher emails"`.
2. Delegate to **voucher-redeemer** with the intent id and the apps (empty = all apps in prefs.json).
3. Delegate to **wallet-manager** for any app not checked by step 2.
4. `set <id> done --json '{"result":{"summary":"Added ₹500 to Blinkit; BigBasket: no new voucher"}}'`.
   If nothing could be redeemed because of an error, use `failed` with the reason.

## B. Purchase intent
1. `set <id> running --stage "Checking wallets and memory"`.
   - `node tools/shop.js profile` (taste memory).
   - If any `vouchers --status new` exist, run the redeem flow (A2) first.
   - Delegate to **wallet-manager** if a balance is missing or older than 24 h.
2. **Search**: delegate to **quick-commerce** in *search mode* with the intent id, each item's id/text, and the profile. It writes `state/runs/<id>/search-<app>.json` for Blinkit, then for BigBasket.
3. **Shortlist**: `node tools/shop.js shortlist <id>`.
   - Items the user always buys are auto-picked from memory; the rest need a pick.
   - If status is `needs_pick`: tell the user in one line ("Pick 2 items in the UI"), then `node tools/shop.js wait <id> ready_to_compare,cancelled` (repeat the wait if it times out; after 3 timeouts, stop and say you'll continue when they've picked). The user may also pick in chat: then write the picks with `set <id> ready_to_compare --json '{"picks":{"i1":"i1o2"}}'`. Merge with the existing picks; don't drop them.
   - If an item has **no options**, say so and suggest a different wording; continue with the rest.
4. **Compare**: `node tools/shop.js compare <id>`. Show the result as one short table (app, total, wallet, you pay, items, ETA) plus one line: the recommendation and, if the wallet is short, which iShop voucher to buy.
5. **Approval gate**: wait for approval (`wait <id> approved,cancelled`). The user approves in the UI or in chat. In chat: `set <id> approved --json '{"approval":{"app":"blinkit"}}'`.
   - If they choose to buy a voucher first: pause here. When they say it's bought, run flow A, then `compare <id>` again.
6. **Cart**: `set <id> building_cart --stage "Adding items on <App>"`, then delegate to **quick-commerce** in *cart mode* with the approved app and the chosen products from `intent <id>` → `comparison.apps[app].lines`. It stops at the checkout summary and returns subtotal, fees, total, wallet applied and payable.
   - Record it: `node tools/shop.js cart <id> --app <app> --json '{...}'`.
   - If the real payable differs from the comparison by more than 10%, say so in one line.
7. `node tools/shop.js record <id>` (memory). Tell the user: "Cart ready on <App>: ₹X after wallet. Place the order in the app." The user marks it done in the UI.

## Never
- Never click pay/place order, buy vouchers, or show full voucher codes. See CLAUDE.md.
- Never run two browser sub-agents at the same time.
