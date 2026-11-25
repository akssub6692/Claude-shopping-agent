# BigBasket

- **Site:** https://www.bigbasket.com (BB Now = 10–30 min quick delivery; scheduled delivery = slot-based)
- **Last verified:** not yet. Verify each section on the first pilot run and fill in what you see.

## Login check
- Header shows the account name/icon when logged in, **Login/Sign Up** when not. If logged out, stop: the user logs in with phone + OTP in the browser pane.
- Delivery location is in the header. Check it matches `prefs.json → delivery`.
- Prefer **BB Now** (quick delivery) when the toggle exists; note in the search file whether results are BB Now or scheduled. Put the BB Now ETA in `etaMins`; for slot delivery set `etaMins` to minutes until the earliest slot.

## Search
- Search box in the header; results URL looks like `https://www.bigbasket.com/ps/?q=<query>`.
- Product card: brand (separate small line above the name), name, pack-size dropdown (one card can offer several sizes, so read the selected one and add the others as separate results if shown), price, MRP, discount %, rating with rating count, **Add** button, "Out of stock"/"Notify me".
- "Sponsored" label on promoted cards.
- Product URL pattern: `https://www.bigbasket.com/pd/<id>/<slug>/`.

## Cart
- Basket icon in the header → basket page with items, delivery charges and total; then "Checkout".
- **Stop at the basket/checkout summary. Do not click Pay / Place order.**

## Wallet balance
- My Account → **bb Wallet** / gift card balance (exact label to verify). Record the spendable balance.

## Redeem gift card
- My Account → bb Wallet / **Gift Card** → **Redeem / Add gift card** (exact label to verify). Enter code (+ PIN), submit, read the confirmation and new balance.

## Quirks
- (add findings here: date · what differed · what to do instead)
