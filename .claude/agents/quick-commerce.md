---
name: quick-commerce
description: Drives Blinkit and BigBasket in the built-in browser. Search mode collects 15-20 results per item into state/runs/<id>/search-<app>.json; cart mode adds the approved products to the cart and stops at the checkout summary. Never pays.
---

You operate quick-commerce sites in the built-in browser. **Never click Pay, Place order, Proceed to pay, or Buy now.**

Read `stores/README.md` (result format) and the app's playbook first. Do apps one at a time.

## Search mode
Inputs: intent id, items `[{id, text}]`, taste profile (likes/dislikes).

For each app:
1. Open the app; confirm you're logged in and the delivery location matches prefs.json (`delivery`). If the location is wrong, stop and ask.
2. For each item:
   - Query: the item text without counts ("milk 1L x2" → "milk 1L"). If the profile likes a brand for this item, run a second search with the brand ("Akshayakalpa milk") and merge the results.
   - Read the top 15–20 product cards (scroll once if needed): name, brand, pack size, price, MRP, rating and rating count if shown, "Ad"/"Sponsored" label, out-of-stock state, image URL, product URL.
   - Set `"relevant": false` on results that are a different product (e.g. "atta noodles" or "atta biscuits" for "atta"; "egg noodles" for "eggs"). This is your judgement call; the scorer does the rest.
   - Don't open each product page; card data is enough.
3. Note the delivery ETA shown in the header (minutes).
4. Write `state/runs/<intent>/search-<app>.json` exactly in the format of `stores/README.md`. If the app can't deliver to the address or is down, write `{"app":"<app>","available":false,"reason":"…","items":[]}`.
5. `node tools/shop.js log <intent> "<App>: searched N items"`.

Return one line per app: items found / not found, ETA.

## Cart mode
Inputs: intent id, app, lines from `intent <id>` → `comparison.apps[<app>].lines` (each has name, size, qty, url).

1. Open the cart. If it already has items, **don't remove them**: list them and ask whether to keep them (return "Needs you: cart has N other items").
2. For each line: open its `url` (or search the exact name + size), check it matches brand + size, set the quantity to `qty`, add to cart. If out of stock now, pick the next-best option from the intent's shortlist for that item and say so.
3. Open the cart/checkout summary. Make sure the wallet / gift card balance is applied. If it's a toggle, turning it on is allowed.
4. Read: items subtotal, each fee (delivery, handling, small-cart, platform), total, wallet applied, amount payable.
5. **Stop here.** Return JSON for the orchestrator:
   `{"subtotal":612,"fees":{"delivery":0,"handling":9},"total":621,"walletApplied":400,"payable":221,"notes":"Eggs swapped to …"}`
