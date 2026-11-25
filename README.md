# Claude shopping agent

A grocery concierge for **Blinkit and BigBasket** that works entirely from a browser: no desktop app, nothing to install except the Claude in Chrome extension. It redeems iShop vouchers into app wallets, shortlists premium products, compares the two apps by **wallet balance, price and availability**, and fills the cart. **You always place the order.**

## How it works

```
 Grocery Concierge page (claude.ai artifact)                     Claude in Chrome (your logged-in Chrome)
 ┌──────────────────────────────────────────┐   copy task ──►   ┌─────────────────────────────────────┐
 │ 1. New request: "Milk 1L x2, Atta 5kg"   │                   │ searches Blinkit + BigBasket,       │
 │ 2. Paste reply ◄─────────────────────────┼─── JSON reply ◄── │ reads wallets, never pays           │
 │ 3. Top 3 per item → you pick             │                   └─────────────────────────────────────┘
 │ 4. Blinkit vs BigBasket table → approve  │   copy cart task ──►  fills the cart, stops at the bill
 │ 5. Paste bill → you place the order      │ ◄── JSON reply ──
 └──────────────────────────────────────────┘
 Saved privately in the page: requests, wallets, vouchers (last 4 characters only), your taste.
```

- **Shortlisting:** each item's results from both apps are scored on relevance (35%), your past picks and liked brands (25%), premium signal (20%), rating × number of reviews (15%) and discount (5%). Wrong products ("atta noodles") and out-of-stock items are dropped. The same product sold on both apps is merged into one card. You see the top 3 per item.
- **Comparison:** apps are ranked by all items available, then fewest substitutions, then lowest **you pay** (total minus wallet), then total, then delivery time. If the wallet is short, the page suggests which iShop voucher to buy.
- **Memory:** after you pick the same product twice, it's picked for you. Liked brands rank first; avoided brands never appear.
- **Vouchers:** you buy them on iShop. A "redeem" task has Claude in Chrome find the code in your Gmail and redeem it on the site. Only the last 4 characters come back to the page.

## Setup (once)

1. Install **Claude in Chrome** from the Chrome Web Store and sign in.
2. In Chrome, log in to blinkit.com, bigbasket.com and Gmail.
3. Open the **Grocery Concierge** page: https://claude.ai/artifact/T1KPhKczobAugKBriRtaDd

## First pilot run

- [ ] **Balances:** "Copy balance check" → paste into Claude in Chrome → paste its reply into the page. Both balances should match the apps.
- [ ] **Voucher:** buy a small iShop voucher for each app → "Add vouchers to wallets" → copy the redeem task → paste the reply. Balances go up by the voucher value.
- [ ] **Order:** "Milk, eggs, atta 5kg" → search task → paste reply → pick → approve → cart task → paste reply → place the order on the site → "I placed the order".
- [ ] Repeat the same list twice more: your picks become automatic.
- [ ] Note anything Claude in Chrome got wrong in `stores/*.md` so the prompts can be tightened.

## Developing

| Path | What |
|---|---|
| `lib/` | Scoring (`shortlist.js`), app ranking (`compare.js`), taste memory (`taste.js`), reply parsing and request flow (`flow.js`), Claude in Chrome task prompts (`prompts.js`) |
| `web/concierge.src.html` | The page |
| `build.js` | Bundles `lib/` + `prefs.json` into `dist/concierge.html` |
| `prefs.json` | Pincode, fee estimates, voucher denominations/discounts, premium brands |
| `stores/*.md` | Notes on each site and the iShop emails, filled in from real runs |
| `.claude/skills/shop` | `/shop` in Claude Code on the web: status, likes/dislikes, check Gmail for new vouchers |

```bash
npm test
```

```bash
node build.js
```

Then republish `dist/concierge.html` to the page URL above (ask Claude Code on the web to do this).

## Safety

- No step ever pays, places an order or buys a voucher. Every Chrome task says so explicitly.
- Full voucher codes never reach the page. Only the last 4 characters are kept.
- The page's data is readable and writable only by you, even if you share the link.
