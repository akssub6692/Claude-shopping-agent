'use strict';
// Which app should this cart go to? Ranks by: everything available > fewest substitutions >
// least out-of-pocket (cart total minus wallet balance) > lowest total > fastest delivery.

const round = (x) => Math.round(x * 100) / 100;

/** Estimated fees from prefs.apps[app].fees; the real numbers are read from the cart later. */
function estimateFees(subtotal, fees = {}) {
  const out = {};
  if (fees.delivery && !(fees.freeDeliveryAbove && subtotal >= fees.freeDeliveryAbove)) out.delivery = fees.delivery;
  if (fees.handling) out.handling = fees.handling;
  if (fees.smallCartBelow && subtotal < fees.smallCartBelow && fees.smallCartFee) out.smallCart = fees.smallCartFee;
  return out;
}

/** Cheapest way to cover a shortfall with the voucher denominations you can buy. */
function suggestVoucher(app, shortfall, prefs) {
  if (!(shortfall > 0)) return null;
  const v = (prefs.vouchers || {})[app] || {};
  const denoms = (v.denominations || [100, 250, 500, 1000, 2000]).slice().sort((a, b) => a - b);
  let amount = denoms.find((d) => d >= shortfall);
  let pieces = amount ? [amount] : [];
  if (!amount) { // greedy with the largest note
    let left = shortfall;
    const max = denoms[denoms.length - 1];
    while (left > 0) { const d = denoms.find((x) => x >= left) || max; pieces.push(d); left -= d; }
    amount = pieces.reduce((a, b) => a + b, 0);
  }
  const pct = v.discountPct || 0;
  return { app, shortfall: round(shortfall), buy: pieces, total: amount, discountPct: pct, saves: round((amount * pct) / 100) };
}

/**
 * @param intent  purchase intent with shortlist + picks
 * @param apps    app ids that were searched
 * @param wallets { app: { balance } }
 * @param prefs   prefs.json
 * @param meta    { app: { etaMins, available } } from the search files
 */
function compareApps(intent, apps, wallets, prefs = {}, meta = {}) {
  const items = intent.shortlist.items;
  const rows = apps.map((app) => {
    const m = meta[app] || {};
    if (m.available === false) return { app, unavailable: true, reason: m.reason || 'Not available', lines: [], coverage: 0 };
    const lines = [];
    for (const item of items) {
      const pickId = intent.picks[item.id];
      const picked = item.allOptions.find((o) => o.id === pickId);
      let opt = picked && picked.apps[app] ? picked : null;
      let substitution = false;
      if (!opt) {
        const subId = item.bestByApp[app];
        opt = subId ? item.allOptions.find((o) => o.id === subId) : null;
        substitution = !!opt;
      }
      if (!opt) { lines.push({ item: item.id, text: item.text, missing: true }); continue; }
      const p = opt.apps[app];
      lines.push({ item: item.id, text: item.text, option: opt.id, brand: opt.brand, name: p.name || opt.name,
        size: opt.sizeText, qty: item.count, price: p.price, lineTotal: round(p.price * item.count), substitution, url: p.url });
    }
    const found = lines.filter((l) => !l.missing);
    const subtotal = round(found.reduce((s, l) => s + l.lineTotal, 0));
    const fees = estimateFees(subtotal, ((prefs.apps || {})[app] || {}).fees);
    const total = round(subtotal + Object.values(fees).reduce((a, b) => a + b, 0));
    const wallet = wallets[app] ? Number(wallets[app].balance) || 0 : 0;
    const walletUsable = round(Math.min(wallet, total));
    return {
      app, lines, subtotal, fees, total, wallet, walletUsable, payable: round(total - walletUsable),
      coverage: items.length ? found.length / items.length : 0,
      substitutions: found.filter((l) => l.substitution).length,
      missing: lines.filter((l) => l.missing).length,
      etaMins: m.etaMins ?? null,
      overBudget: intent.budget ? total > intent.budget : false,
    };
  });
  const ranked = rows.slice().sort((a, b) => (!!a.unavailable - !!b.unavailable)
    || (b.coverage - a.coverage) || (a.substitutions - b.substitutions) || (a.payable - b.payable)
    || (a.total - b.total) || ((a.etaMins ?? 999) - (b.etaMins ?? 999)));
  const best = ranked.find((r) => !r.unavailable && r.coverage > 0) || null;
  const preferred = intent.preferredApp && rows.find((r) => r.app === intent.preferredApp && !r.unavailable);
  const recommended = preferred && preferred.coverage === 1 ? preferred : best;
  return {
    computedAt: new Date().toISOString(),
    apps: ranked,
    recommended: recommended ? recommended.app : null,
    voucher: recommended ? suggestVoucher(recommended.app, recommended.payable, prefs) : null,
  };
}

module.exports = { compareApps, suggestVoucher, estimateFees };
