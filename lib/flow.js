'use strict';
// The request lifecycle, as pure functions. The hosted page calls these and saves the results.
//
// purchase: searching -> needs_pick -> needs_approval -> approved -> cart_ready -> done
// redeem:   redeeming -> done
const { shortlistItem } = require('./shortlist');
const { compareApps } = require('./compare');

const APPS = ['blinkit', 'bigbasket'];
const num = (v) => { if (v == null || v === '') return null; const n = Number(String(v).replace(/[₹,\s]/g, '')); return Number.isFinite(n) ? n : null; };
const str = (v, max = 200) => (v == null ? '' : String(v).slice(0, max));

/** Pull the first JSON object out of a pasted reply (handles ```json fences and chatter around it). */
function extractJson(text) {
  const s = String(text || '');
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : s;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('No JSON found. Copy the whole reply from Claude in Chrome, including the { } block.');
  try { return JSON.parse(body.slice(start, end + 1)); } catch (e) {
    throw new Error(`The JSON in that reply is incomplete (${e.message}). Ask Claude in Chrome to "send the JSON again, complete".`);
  }
}

/** What kind of reply is this? search | cart | redeem | wallets */
function classifyReply(obj) {
  if (Array.isArray(obj.sites)) return 'search';
  if (obj.subtotal != null || obj.payable != null || obj.total != null) return 'cart';
  if (Array.isArray(obj.vouchers)) return 'redeem';
  if (obj.wallets && typeof obj.wallets === 'object') return 'wallets';
  throw new Error('This reply doesn\'t look like any of the Claude in Chrome tasks. Check you pasted the right one.');
}

const cleanApp = (a) => { const s = String(a || '').toLowerCase().replace(/[^a-z]/g, ''); return s.startsWith('bb') || s.includes('basket') ? 'bigbasket' : s.includes('blinkit') ? 'blinkit' : s; };

/** Normalise wallet balances from any reply. */
function walletsFrom(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj.wallets || {})) { const n = num(v); if (n != null && APPS.includes(cleanApp(k))) out[cleanApp(k)] = n; }
  for (const s of obj.sites || []) { const n = num(s.wallet); if (n != null && APPS.includes(cleanApp(s.app))) out[cleanApp(s.app)] = n; }
  return out;
}

function cleanResult(r) {
  return {
    name: str(r.name, 160), brand: str(r.brand, 60), size: str(r.size, 40), price: num(r.price), mrp: num(r.mrp),
    rating: num(r.rating), reviews: num(r.reviews), sponsored: !!r.sponsored, inStock: r.inStock !== false,
    relevant: r.relevant === false ? false : undefined,
    url: /^https:\/\/(blinkit\.com|www\.bigbasket\.com)\//.test(r.url || '') ? str(r.url, 300) : null,
  };
}

/** Search reply -> { results: {app: {...}}, wallets } for one request. */
function searchFrom(obj, request) {
  const ids = new Set(request.items.map((i) => i.id));
  const results = {};
  for (const s of obj.sites) {
    const app = cleanApp(s.app);
    if (!APPS.includes(app)) continue;
    if (s.available === false) { results[app] = { available: false, reason: str(s.reason) || 'Not available', items: [] }; continue; }
    results[app] = {
      available: true, etaMins: num(s.etaMins),
      items: (s.items || []).filter((x) => ids.has(x.item)).map((x) => ({ item: x.item, query: str(x.query, 80),
        results: (x.results || []).slice(0, 20).map(cleanResult).filter((r) => r.name && r.price != null) })),
    };
  }
  if (!Object.keys(results).length) throw new Error('The reply has no Blinkit or BigBasket results.');
  return { results, wallets: walletsFrom(obj) };
}

/** Score results into a shortlist; auto-pick what memory knows. */
function runShortlist(request, ctx, prefs) {
  const apps = Object.keys(request.results || {});
  const items = request.items.map((item) => {
    const byApp = {};
    for (const app of apps) {
      const r = request.results[app];
      if (!r.available) continue;
      const found = r.items.find((x) => x.item === item.id);
      byApp[app] = found ? found.results : [];
    }
    const s = shortlistItem(item, byApp, ctx, prefs);
    s.options = s.options.map(({ parts, size, ...o }) => ({ ...o, parts }));
    return s;
  });
  const picks = { ...(request.picks || {}) };
  for (const it of items) if (!picks[it.id] && it.autoPick) picks[it.id] = it.autoPick;
  const meta = Object.fromEntries(apps.map((a) => [a, { etaMins: request.results[a].etaMins ?? null, available: request.results[a].available, reason: request.results[a].reason || '' }]));
  return { shortlist: { items, apps, meta }, picks };
}

const openItems = (request) => request.shortlist.items.filter((it) => it.options.length && !request.picks[it.id]);

function runCompare(request, wallets, prefs) {
  return compareApps(request, request.shortlist.apps, wallets, prefs, request.shortlist.meta);
}

/** Cart reply -> cart summary (no codes, numbers only). */
function cartFrom(obj) {
  const fees = {};
  for (const [k, v] of Object.entries(obj.fees || {})) { const n = num(v); if (n != null) fees[str(k, 30)] = n; }
  return { app: cleanApp(obj.app), subtotal: num(obj.subtotal), fees, total: num(obj.total), walletApplied: num(obj.walletApplied) || 0,
    payable: num(obj.payable), notes: str(obj.notes, 400), missing: (obj.missing || []).map((m) => str(m, 120)).slice(0, 20) };
}

/** Redeem reply -> vouchers keeping only the last 4 characters, never full codes. */
function redeemFrom(obj) {
  const vouchers = (obj.vouchers || []).map((v) => {
    const raw = String(v.last4 || v.code || '').replace(/[^a-z0-9]/gi, '');
    return { app: cleanApp(v.app), value: num(v.value), last4: raw.slice(-4).toUpperCase(), expiry: str(v.expiry, 20),
      status: ['redeemed', 'failed', 'skipped'].includes(v.status) ? v.status : 'failed', note: str(v.note, 200) };
  }).filter((v) => APPS.includes(v.app) && v.last4);
  return { vouchers, wallets: walletsFrom(obj) };
}

const voucherId = (v) => `${v.app}-${v.last4}-${v.value || 0}`;

module.exports = { APPS, extractJson, classifyReply, walletsFrom, searchFrom, runShortlist, openItems, runCompare, cartFrom, redeemFrom, voucherId, cleanApp };
