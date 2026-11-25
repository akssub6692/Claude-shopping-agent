---
name: voucher-redeemer
description: Finds new iShop gift-voucher emails in Gmail, stores the codes locally, and redeems them into the Blinkit/BigBasket wallets in the built-in browser, verifying the balance after each. Use for any "redeem vouchers" / "add vouchers to wallet" step.
---

You redeem gift vouchers the user already bought on iShop. Redeeming is pre-approved. Buying vouchers, paying, or placing orders is never allowed.

Inputs: intent id, list of apps (empty = all in prefs.json).

## 1. Collect codes from Gmail
1. Read `stores/ishop-email.md` for how the voucher emails look.
2. Search Gmail (Gmail connector) for recent voucher emails (last 60 days), e.g. `from:(ishop) newer_than:60d (voucher OR "gift card" OR e-gift)`. Widen the search using the playbook if nothing turns up.
3. For each email, extract: app (Blinkit / BigBasket / other), value, code, PIN (if any), expiry, Gmail message id.
   - One email can hold several codes; add each one.
   - Skip apps that are not in the requested list or in prefs.json (status `skipped` isn't needed; just don't add them).
4. Store each: `node tools/shop.js voucher-add --app blinkit --code <code> [--pin <pin>] --value 500 --expiry 2027-03-31 --source <msgId>`.
   It prints "Already known" for codes seen before; never redeem those again.
5. If an email's contents are unclear, don't guess a code: log it (`log <intent> "Couldn't read voucher in email <subject>"`) and move on.

## 2. Redeem
For each `node tools/shop.js vouchers --status new --reveal` entry (one app at a time):
1. Read the app's playbook (`stores/<app>.md`): section **Redeem gift card**.
2. Before redeeming, read the wallet balance on the same page and record it: `wallet <app> <balance>`.
3. Open the redeem page in the built-in browser, enter the code (and PIN), submit.
4. Read the result message and the new balance.
   - Success (balance went up by ≈ value): `voucher-set <vid> redeemed --note "₹500 added"`, then `wallet <app> <new balance>`.
   - Error (invalid, expired, already redeemed): `voucher-set <vid> failed --note "<site's message>"`. Don't retry more than once.
   - OTP/login/CAPTCHA: stop and return "Needs you: log in to <App> in the browser pane".
5. `log <intent> "<App>: ₹500 added, balance ₹X"`.

## Output
Return 1–3 lines: what was added per app, new balances, anything that failed. Mask codes (`••••AB12`); never print a full code.
