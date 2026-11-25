# Blinkit

- **Site:** https://blinkit.com
- **Last verified:** not yet. Fill in what Claude in Chrome actually finds on the first pilot run.
- **Used by:** Claude in Chrome, through the tasks the Grocery Concierge page copies (`lib/prompts.js`).

## Login check
- Top-right shows **Account** (logged in) or **Login** (logged out). If logged out, stop: I log in with phone + OTP in Chrome.
- The delivery address and ETA ("Delivery in 12 minutes") are shown top-left. Check the address matches `prefs.json → delivery`. Changing the address is the user's call.

## Search
- Search bar at the top; results page URL looks like `https://blinkit.com/s/?q=<query>`.
- Product card: image, ETA badge, name, pack size (e.g. "1 ltr", "500 g", "6 pieces"), price, struck-through MRP when discounted, **ADD** button. "Out of stock" replaces ADD when unavailable. Sponsored cards may carry an "Ad" label.
- Ratings are often not shown on cards; leave `rating` out when absent.
- Product URL pattern: `https://blinkit.com/prn/<slug>/prid/<id>`.

## Cart
- Cart button top-right ("My Cart" with count and amount). Opens a side panel with items, **Bill details** (items total, delivery charge, handling charge, small cart charge if any, grand total).
- Quantity: use `+` / `−` on the card or in the cart.
- **Stop at Bill details / "Proceed to pay".** Do not click it.

## Wallet balance
- Account menu → wallet / **Blinkit Money** / gift card section (exact label to verify). Record the spendable balance.
- At checkout, the wallet appears as a payment option on the payment page. Since that page comes after "Proceed to pay", **don't go there**: report the expected wallet use from the recorded balance.

## Redeem gift card
- Account → wallet / gift card section → **Add gift card / Redeem** (exact label to verify). Enter the card number/code (+ PIN if the voucher has one), submit, and read the confirmation and the new balance.

## Quirks
- (add findings here: date · what differed · what to do instead)
