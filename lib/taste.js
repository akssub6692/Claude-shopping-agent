'use strict';
// Taste memory as pure functions. Works in Node (tests) and in the browser page.
// profile: { likes: [{brand, item?}], dislikes: [{brand, item?}], notes: [] }
// history: [{ itemKey, picked: {brand, name, size} }]
const { itemKey, sameProduct, normBrand } = require('./text');

const emptyProfile = () => ({ likes: [], dislikes: [], notes: [] });

function isDisliked(ctx, brand, key) {
  return (ctx.profile.dislikes || []).some((d) => normBrand(d.brand) === normBrand(brand) && (!d.item || d.item === key));
}

/**
 * 0..1 affinity of a candidate for an item.
 * 1   = liked brand for this item, or this exact product picked 2+ times
 * 0.5 = this exact product picked once
 * up to 0.6 = same brand picked before for this item
 */
function affinity(ctx, key, cand) {
  const liked = (ctx.profile.likes || []).some((l) => normBrand(l.brand) === normBrand(cand.brand) && (!l.item || l.item === key));
  if (liked) return 1;
  let productPicks = 0; let brandPicks = 0;
  for (const h of ctx.history || []) {
    if (h.itemKey !== key || !h.picked) continue;
    if (normBrand(h.picked.brand) === normBrand(cand.brand)) {
      brandPicks += 1;
      if (sameProduct(h.picked, cand)) productPicks += 1;
    }
  }
  return Math.max(Math.min(1, productPicks / 2), 0.6 * Math.min(1, brandPicks / 2));
}

/** Return a new profile with a like/dislike added (and removed from the other list). */
function withPreference(profile, kind, brand, item) {
  const p = { ...emptyProfile(), ...profile };
  const b = String(brand).trim();
  if (!b) return p;
  const it = item ? itemKey(item) || null : null;
  const other = kind === 'likes' ? 'dislikes' : 'likes';
  const match = (e) => normBrand(e.brand) === normBrand(b) && (e.item || null) === it;
  p[other] = (p[other] || []).filter((e) => !match(e));
  p[kind] = (p[kind] || []).filter((e) => !match(e)).concat([it ? { brand: b, item: it } : { brand: b }]);
  return p;
}

/** History records for a request's final picks. */
function pickRecords(request, at) {
  const out = [];
  for (const item of (request.shortlist && request.shortlist.items) || []) {
    const pickId = request.picks && request.picks[item.id];
    const opt = item.allOptions.find((o) => o.id === pickId);
    if (!opt) continue;
    out.push({
      at, requestId: request.id, itemKey: item.key, itemText: item.text,
      source: item.autoPick === pickId ? 'auto' : 'user',
      picked: { brand: opt.brand, name: opt.name, size: opt.sizeText },
      app: request.approval ? request.approval.app : null,
    });
  }
  return out;
}

module.exports = { emptyProfile, isDisliked, affinity, withPreference, pickRecords };
