# Site notes

What Claude in Chrome needs to know about each site, filled in from real runs. The task prompts live in `lib/prompts.js`. When Claude in Chrome trips on something (a menu name, a pop-up, a pack-size dropdown), note it here and tighten the prompt.

- `blinkit.md`, `bigbasket.md`: login, search, cart, wallet and gift-card pages
- `ishop-email.md`: what the iShop voucher emails look like

Reply formats the page accepts are defined in `lib/flow.js` (`searchFrom`, `cartFrom`, `redeemFrom`, `walletsFrom`) and shown in each prompt.
