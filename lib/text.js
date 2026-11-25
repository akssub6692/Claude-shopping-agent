'use strict';
// Small text helpers shared by shortlisting and memory.
const { parseSize, sizeRatio } = require('./units');

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'with', 'for', 'in', 'fresh', 'pack', 'x', 'buy', 'get', 'new',
  'kg', 'kgs', 'g', 'gm', 'gms', 'gram', 'grams', 'l', 'ltr', 'litre', 'liter', 'ml', 'pc', 'pcs', 'piece', 'pieces', 'unit', 'units', 'n']);

function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('es') && /(ch|sh|x|ss|o)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Content words, lower-cased, stemmed, with sizes and numbers removed. */
function tokens(text) {
  return String(text || '').toLowerCase()
    .replace(/(\d+(?:\.\d+)?)\s*(kgs?|g|gms?|grams?|l|ltr|litres?|liters?|ml|pcs?|pieces?|n)\b/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter((w) => w && !/^\d/.test(w) && !STOP.has(w)).map(stem);
}

/** Stable key for "the same kind of item" across intents: "Atta 5kg" and "atta" -> "atta". */
function itemKey(text) { return [...new Set(tokens(text))].sort().join(' '); }

const normBrand = (b) => String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function jaccard(a, b) {
  const A = new Set(a); const B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/** Is this the same product (brand + variant + size) even if each app words the title differently? */
function sameProduct(a, b) {
  if (normBrand(a.brand) !== normBrand(b.brand)) return false;
  const sa = parseSize(a.size || a.sizeText || a.name); const sb = parseSize(b.size || b.sizeText || b.name);
  if (sa && sb) {
    const r = sizeRatio(sa, sb);
    if (r == null || r < 0.95 || r > 1.05) return false;
  }
  const brandTok = new Set(tokens(a.brand));
  const strip = (t) => tokens(t).filter((w) => !brandTok.has(w));
  return jaccard(strip(a.name), strip(b.name)) >= 0.5;
}

/** Split "2 x Amul butter 500g" / "milk 1L x2" into a count and the rest. */
function parseItem(text) {
  let t = String(text).trim(); let count = 1;
  // Only an explicit multiplier is a count; "12 eggs" is a pack size, not 12 packs.
  let m = t.match(/^(\d+)\s*[x×*]\s+(.*)$/i);
  if (m) { count = Number(m[1]); t = m[2]; }
  m = t.match(/^(.*\S)\s+[x×*]\s*(\d+)\s*$/i) || t.match(/^(.*[a-z)])[x×*](\d+)\s*$/i);
  if (m) { count = Number(m[2]); t = m[1]; }
  return { count: Math.max(1, Math.min(count, 50)), text: t, size: parseSize(t), key: itemKey(t) };
}

module.exports = { tokens, itemKey, normBrand, jaccard, sameProduct, parseItem, stem };
