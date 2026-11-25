# Store playbooks

One file per site. Each describes **goals and landmarks** (what to look for), not CSS selectors, because these sites change layout often. When something differs on the site, follow the site and then fix the playbook: update **Last verified** and add a line under **Quirks**.

Pilot apps: `blinkit.md`, `bigbasket.md`. Voucher emails: `ishop-email.md`.

## Search result file format

`state/runs/<intentId>/search-<app>.json`, written by the quick-commerce agent and read by `node tools/shop.js shortlist <intentId>`:

```json
{
  "app": "blinkit",
  "available": true,
  "etaMins": 12,
  "items": [
    {
      "item": "i1",
      "query": "milk 1L",
      "results": [
        {
          "name": "Akshayakalpa Organic Artisanal Toned Milk",
          "brand": "Akshayakalpa",
          "size": "1 L",
          "price": 92,
          "mrp": 95,
          "rating": 4.6,
          "reviews": 2100,
          "sponsored": false,
          "inStock": true,
          "relevant": true,
          "image": "https://…",
          "url": "https://blinkit.com/prn/…"
        }
      ]
    }
  ]
}
```

- `item` must be the intent's item id (`i1`, `i2`, …).
- `price`/`mrp` are numbers in rupees. Leave out (don't guess) fields the card doesn't show.
- `relevant: false` = a different product that matched the keyword. Those are dropped.
- If the app can't serve the address: `{"app":"bigbasket","available":false,"reason":"Not serviceable at 560001","items":[]}`.
