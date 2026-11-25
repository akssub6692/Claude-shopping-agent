'use strict';
// Pack-size parsing and unit prices, so "Aashirvaad Atta 5 kg" and "1L x 2" compare fairly.

const UNIT = {
  kg: ['g', 1000], kgs: ['g', 1000], kilo: ['g', 1000], g: ['g', 1], gm: ['g', 1], gms: ['g', 1], gram: ['g', 1], grams: ['g', 1],
  l: ['ml', 1000], ltr: ['ml', 1000], litre: ['ml', 1000], liter: ['ml', 1000], litres: ['ml', 1000], liters: ['ml', 1000],
  ml: ['ml', 1],
  pc: ['pc', 1], pcs: ['pc', 1], piece: ['pc', 1], pieces: ['pc', 1], n: ['pc', 1], unit: ['pc', 1], units: ['pc', 1],
  pack: ['pc', 1], eggs: ['pc', 1], egg: ['pc', 1],
};

const SIZE_RE = /(\d+(?:\.\d+)?)\s*(kgs?|kilo|grams?|gms?|g|litres?|liters?|ltr|l|ml|pcs?|pieces?|units?|n|eggs?)\b(?:\s*[x×*]\s*(\d+))?/i;

/** Parse a size string or product name. Returns { qty, base: 'g'|'ml'|'pc' } (qty in base units) or null. */
function parseSize(text) {
  if (!text) return null;
  const s = String(text).toLowerCase().replace(/,/g, '');
  // "2 x 500 g"
  const mult = s.match(/(\d+)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*(kgs?|g|gms?|l|ltr|ml)\b/);
  if (mult) {
    const [b, f] = UNIT[mult[3]];
    return { qty: round(Number(mult[1]) * Number(mult[2]) * f), base: b };
  }
  const m = s.match(SIZE_RE);
  let size = null;
  if (m) {
    const [b, f] = UNIT[m[2].toLowerCase()] || UNIT[m[2].toLowerCase().replace(/s$/, '')];
    size = { qty: round(Number(m[1]) * f * (m[3] ? Number(m[3]) : 1)), base: b };
  }
  const pack = s.match(/(?:pack|set)\s+of\s*(\d+)/);
  if (pack) {
    const n = Number(pack[1]);
    size = size && size.base !== 'pc' ? { qty: size.qty * n, base: size.base } : { qty: n, base: 'pc' };
  }
  return size;
}

function round(n) { return Math.round(n * 1000) / 1000; }

/** Price per kg / per litre / per piece, or null when size is unknown. */
function unitPrice(price, size) {
  if (!size || !size.qty || price == null) return null;
  const per = size.base === 'pc' ? 1 : 1000;
  return round((price / size.qty) * per);
}

function unitLabel(size) {
  if (!size) return '';
  return size.base === 'g' ? '/kg' : size.base === 'ml' ? '/L' : '/pc';
}

/** Ratio of a to b when both are the same base unit (1 = identical size). */
function sizeRatio(a, b) {
  if (!a || !b || a.base !== b.base || !b.qty) return null;
  return a.qty / b.qty;
}

module.exports = { parseSize, unitPrice, unitLabel, sizeRatio };
