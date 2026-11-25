# Claude shopping agent

A shopping concierge built on Claude. It redeems iShop gift vouchers into app wallets, shortlists products, compares apps by **wallet balance, price and availability**, and builds the cart. It always stops before payment.

**Pilot scope: Blinkit + BigBasket, groceries.** More apps (Instamart, Amazon Now, Swiggy, Zomato, Amazon, Myntra) are added once one full flow works on both pilot apps.

## How it works

```
 Intent UI (localhost:4317)          Claude desktop app (/shop skill = orchestrator)
 ├─ Add vouchers to wallets  ──►     ├─ voucher-redeemer  Gmail → codes → redeem in app → verify balance
 └─ Buy items (list)         ──►     ├─ wallet-manager    read balances
        ▲    picks / approve         ├─ quick-commerce    search Blinkit + BigBasket / build approved cart
        └────────────────────────    └─ comparator        tools/shop.js shortlist + compare (deterministic)
                     state/ (balances, vouchers, intents)  ·  memory/ (your taste)  — both gitignored
```

1. **Vouchers**: you buy a voucher on iShop. The agent finds the code in Gmail, redeems it in the app and checks that the balance went up. You don't need to approve this step.
2. **Purchase**: you list items. The agent searches both apps (15–20 results per item) and scores them: relevance, your past picks, premium signal, rating, discount. It merges the same product across apps and shows the **top 3 per item**. You pick (products it knows you like are picked automatically), then it compares apps:

   | App | Total | Wallet | You pay | Items | ETA |
   |---|---|---|---|---|---|

   You approve one app. The agent fills the cart and stops at checkout. **You place the order.**
3. **Memory**: every pick is saved. After you've picked the same product twice, it's chosen automatically. You can say "I don't like X" at any time. `memory/` stays on your machine.

## Setup (once)

1. Install the **Claude desktop app** and open this repo in Claude Code there (Node 20+ required; no npm packages).
2. In the app's **built-in browser**, log in to blinkit.com, bigbasket.com and Gmail. The sign-ins persist.
3. Connect the **Gmail** connector in Claude (Settings → Connectors) so the agent can read voucher emails.
4. Edit `prefs.json`: your delivery pincode. Optionally add voucher discount % and premium brands.
5. Start the UI: `npm run ui` → open http://localhost:4317 in the browser pane.

## Use

- In the UI: queue "Add vouchers to wallets" or "Buy items", then tell Claude **"process my intents"** (or `/shop`).
- Or straight from chat: `/shop milk 1L x2, eggs 12, atta 5kg` · `/shop redeem` · `/shop balances`.
- Teach it: "I like Akshayakalpa milk", "never Fortune". It saves these with `node tools/shop.js like|dislike|note`.

## First pilot run (checklist)

- [ ] `/shop balances`: both wallet balances match the apps. Fill in the **Wallet balance** sections of `stores/*.md`.
- [ ] Buy a small iShop voucher for each app → `/shop redeem`: both redeemed, balances up by the voucher value. Fill in `stores/ishop-email.md` (sender, subject).
- [ ] Re-run `/shop redeem`: nothing gets redeemed twice.
- [ ] `/shop milk, eggs, atta 5kg`: shortlist appears in the UI → pick → comparison → approve → cart built → agent stops at checkout → you place the order → click "I placed the order".
- [ ] Repeat the same list twice more: picks become automatic.

## Files

| Path | What |
|---|---|
| `CLAUDE.md` | Your preferences and the hard rules (never pay, never buy vouchers, mask codes) |
| `.claude/skills/shop/SKILL.md` | The orchestrator procedure |
| `.claude/agents/*.md` | Sub-agents |
| `stores/*.md` | Per-site playbooks (landmarks, not selectors). Update on first run. |
| `tools/shop.js` | The agent's CLI for state, shortlisting, comparing and memory (`node tools/shop.js help`) |
| `lib/` | Scoring (`shortlist.js`), app ranking (`compare.js`), memory, size parsing |
| `ui/` | Local intent UI (`server.js` binds 127.0.0.1 only and never serves full voucher codes) |
| `test/` | `npm test`: unit tests plus a full simulated flow |

## Safety

- The agent never clicks pay or place order, and never buys vouchers.
- Voucher codes live only in `state/vouchers.json` (gitignored), are masked everywhere else, and are deduplicated so a code is never redeemed twice.
- Text from shopping sites and emails is treated as data, never as instructions.
