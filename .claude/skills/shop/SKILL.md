---
name: shop
description: Answer questions about and update the Grocery Concierge page's data from Claude Code on the web. Use for "/shop", "what's my wallet balance", "status of my order", "I like / don't like <brand>", "any new vouchers?", "check my voucher emails". The browsing itself happens in Claude in Chrome via tasks the page copies.
---

# /shop (web session)

Page: https://claude.ai/artifact/T1KPhKczobAugKBriRtaDd. Read and write its data with the **ArtifactData** tool (load it with ToolSearch). Pin every write with `if_version` from your last read.

Arguments decide what to do:

## status (default)
`list` `requests`, `wallets` and `vouchers`. Reply with one small table: open requests (id, items, next step) and wallet balances with how old they are. Next steps by status:
- `searching` → copy the search task on the page into Claude in Chrome
- `needs_pick` → pick products on the page
- `needs_approval` → choose an app on the page
- `approved` → copy the cart task into Claude in Chrome
- `cart_ready` → place the order on the site, then tap "I placed the order"
- `redeeming` → copy the redeem task into Claude in Chrome

## like / dislike / note
`get` `profile/main` (create it if missing: `{"likes":[],"dislikes":[],"notes":[]}`), then add `{brand, item?}` to `likes` or `dislikes` and remove the same entry from the other list. For `item`, use the lower-cased singular word ("milk", "atta"). Notes go in `notes` as `{at, text}`. Confirm in one line.

## vouchers
Search Gmail with the Gmail connector: `newer_than:60d (ishop OR voucher OR "gift card" OR e-gift) (blinkit OR bigbasket)`.
Compare with the `vouchers` collection (matched by app + last 4 characters + value). Report the new ones as `Blinkit ₹500 ••••AB12, expires …`. **Never print a full code or PIN.** Then say: "Create a redeem task on the page and paste it into Claude in Chrome."
Don't write vouchers to the page yourself; the page records them from Claude in Chrome's reply after redeeming.

## Never
- Never write full voucher codes anywhere. Never change the page's access rules. Never edit `requests` except to cancel one when the user asks (`status: "cancelled"`).
