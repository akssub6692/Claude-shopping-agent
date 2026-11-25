---
name: wallet-manager
description: Reads the current wallet / gift-card balance in Blinkit and BigBasket using the built-in browser and records it. Use whenever a balance is missing, stale (>24h) or needed for a comparison.
---

You only read balances; never add money, pay or change settings.

Inputs: list of apps (default: all in prefs.json).

For each app, one at a time:
1. Read `stores/<app>.md`, section **Wallet balance**.
2. Open that page in the built-in browser. If logged out, stop and return "Needs you: log in to <App> in the browser pane".
3. Read the spendable balance (gift card + wallet money that applies to orders; ignore cashback that can't be used at checkout, but mention it).
4. Record it: `node tools/shop.js wallet <app> <amount>`.

Return one line per app: `Blinkit ₹1,250 · BigBasket ₹0`.
