'use strict';
// Turn 15-20 raw search results per app into the top 3 products per item.
const { parseSize, unitPrice, unitLabel, sizeRatio } = require('./units');
const { tokens, normBrand, sameProduct, parseItem } = require('./text');
const taste = require('./taste');

const WEIGHTS = { relevance: 0.35, affinity: 0.25, premium: 0.2, quality: 0.15, value: 0.05 };
const SHORTLIST_SIZE = 3;
const DEFAULT_PREMIUM_WORDS = ['organic', 'a2', 'cold pressed', 'premium', 'artisanal', 'single origin', 'extra virgin',
  'grass fed', 'free range', 'select', 'gold', 'farm fresh', 'unpolished', 'sourdough', 'whole wheat', 'imported'];

const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const round2 = (x) => Math.round(x * 100) / 100;

function normalizeResult(r, app) {
  const brand = r.brand || String(r.name || '').split(/\s+/)[0] || '';
  const size = parseSize(r.size) || parseSize(r.name);
  const price = r.price != null ? Number(r.price) : null;
  return {
    app, name: String(r.name || '').trim(), brand: String(brand).trim(), sizeText: r.size || '', size,
    price, mrp: r.mrp != null ? Number(r.mrp) : null, unitPrice: unitPrice(price, size),
    rating: r.rating != null ? Number(r.rating) : null, reviews: r.reviews != null ? Number(r.reviews) : null,
    sponsored: !!r.sponsored, inStock: r.inStock !== false, relevant: r.relevant, image: r.image || null, url: r.url || null,
  };
}

/** Share of the item's words that appear in the product. */
function coverage(item, c) {
  const want = tokens(item.text);
  if (!want.length) return 1;
  const have = new Set(tokens(`${c.brand} ${c.name} ${c.sizeText}`));
  return want.filter((w) => have.has(w)).length / want.length;
}

function sizeFit(item, c) {
  if (!item.size) return { score: 1, mismatch: false };
  const r = sizeRatio(c.size, item.size);
  if (r == null) return { score: 0.5, mismatch: true };
  if (r >= 0.9 && r <= 1.1) return { score: 1, mismatch: false };
  if (r >= 0.5 && r <= 2) return { score: 0.6, mismatch: true };
  return { score: 0.2, mismatch: true };
}

function premiumScore(c, prefs, pricePct) {
  const brands = (prefs.premiumBrands || []).map(normBrand);
  const words = prefs.premiumKeywords || DEFAULT_PREMIUM_WORDS;
  const name = `${c.name} ${c.sizeText}`.toLowerCase();
  const brand = brands.includes(normBrand(c.brand)) ? 0.6 : 0;
  const kw = words.some((w) => name.includes(w)) ? 0.25 : 0;
  return clamp(brand + kw + 0.25 * pricePct);
}

function qualityScore(c) {
  if (c.rating == null) return 0.5;
  const confidence = c.reviews == null ? 0.5 : clamp(Math.log10(c.reviews + 1) / 3);
  return clamp(((c.rating - 3.5) / 1.5) * confidence + 0.5 * (1 - confidence));
}

function valueScore(c) {
  if (!c.mrp || !c.price || c.mrp <= c.price) return 0;
  return clamp(((c.mrp - c.price) / c.mrp) * 2);
}

/** Percentile (0..1) of each candidate's unit price among candidates with the same unit. */
function pricePercentiles(cands) {
  const out = new Map();
  for (const base of ['g', 'ml', 'pc', null]) {
    const group = cands.filter((c) => (c.size ? c.size.base : null) === base);
    const prices = group.map((c) => c.unitPrice ?? c.price).filter((p) => p != null).sort((a, b) => a - b);
    for (const c of group) {
      const p = c.unitPrice ?? c.price;
      out.set(c, p == null || prices.length < 2 ? 0.5 : prices.filter((x) => x < p).length / (prices.length - 1));
    }
  }
  return out;
}

/**
 * Score one item's results from all apps and merge identical products across apps.
 * @param item       { id, text }
 * @param resultsByApp { blinkit: [raw results], bigbasket: [...] }
 * @param ctx        { profile, history } (see taste.js)
 * @param prefs      prefs.json
 */
function shortlistItem(item, resultsByApp, ctx, prefs = {}) {
  const parsed = parseItem(item.text);
  const it = { ...item, ...parsed, text: parsed.text };
  const dropped = { outOfStock: 0, irrelevant: 0, disliked: 0 };
  let cands = [];
  for (const [app, results] of Object.entries(resultsByApp)) {
    for (const raw of results || []) {
      const c = normalizeResult(raw, app);
      if (!c.name || c.price == null) continue;
      if (!c.inStock) { dropped.outOfStock += 1; continue; }
      if (c.relevant === false) { dropped.irrelevant += 1; continue; }
      if (taste.isDisliked(ctx, c.brand, it.key)) { dropped.disliked += 1; continue; }
      c.coverage = coverage(it, c);
      if (c.coverage < 0.5) { dropped.irrelevant += 1; continue; }
      cands.push(c);
    }
  }
  const pct = pricePercentiles(cands);
  cands = cands.map((c) => {
    const fit = sizeFit(it, c);
    const parts = {
      relevance: 0.6 * c.coverage + 0.4 * fit.score,
      affinity: taste.affinity(ctx, it.key, c),
      premium: premiumScore(c, prefs, pct.get(c)),
      quality: qualityScore(c),
      value: valueScore(c),
    };
    const score = Object.entries(WEIGHTS).reduce((s, [k, w]) => s + w * parts[k], 0);
    return { ...c, sizeMismatch: fit.mismatch, parts: mapRound(parts), score: round2(score) };
  }).sort((a, b) => b.score - a.score);

  // Merge the same product listed on several apps into one option with a price per app.
  const options = [];
  for (const c of cands) {
    let opt = options.find((o) => sameProduct(o, c));
    if (!opt) {
      opt = { id: `${item.id}o${options.length + 1}`, brand: c.brand, name: c.name, sizeText: c.sizeText || sizeLabel(c.size),
        size: c.size, image: c.image, score: c.score, parts: c.parts, sizeMismatch: c.sizeMismatch, apps: {} };
      options.push(opt);
    }
    if (!opt.apps[c.app]) {
      opt.apps[c.app] = { price: c.price, mrp: c.mrp, unitPrice: c.unitPrice, unit: unitLabel(c.size), rating: c.rating,
        reviews: c.reviews, sponsored: c.sponsored, url: c.url, name: c.name };
      opt.image = opt.image || c.image;
    }
  }
  const top = options.slice(0, SHORTLIST_SIZE);
  const bestByApp = {};
  for (const app of Object.keys(resultsByApp)) {
    const best = options.find((o) => o.apps[app]);
    bestByApp[app] = best ? best.id : null;
  }
  // Auto-pick only what memory already knows you like; anything new is your call.
  const autoPick = top.length && (top[0].parts.affinity >= 0.99 || (top.length === 1 && options.length === 1)) ? top[0].id : null;
  return {
    id: item.id, text: item.text, key: it.key, count: it.count, wantedSize: it.size ? sizeLabel(it.size) : null,
    options: top, allOptions: options.map(slim), bestByApp, autoPick, dropped, candidates: cands.length,
  };
}

const slim = (o) => ({ id: o.id, brand: o.brand, name: o.name, sizeText: o.sizeText, score: o.score, apps: o.apps });
function mapRound(o) { return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round2(v)])); }
function sizeLabel(s) {
  if (!s) return '';
  if (s.base === 'g') return s.qty >= 1000 ? `${s.qty / 1000} kg` : `${s.qty} g`;
  if (s.base === 'ml') return s.qty >= 1000 ? `${s.qty / 1000} L` : `${s.qty} ml`;
  return `${s.qty} pc`;
}

module.exports = { shortlistItem, normalizeResult, WEIGHTS, sizeLabel };
