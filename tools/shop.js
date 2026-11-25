#!/usr/bin/env node
'use strict';
// The agent's only way to touch state. Run `node tools/shop.js help`.
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const memory = require('../lib/memory');
const { shortlistItem } = require('../lib/shortlist');
const { compareApps } = require('../lib/compare');

const HELP = `node tools/shop.js <command>
  intents [--status s]                 list intents (default: open ones)
  intent <id>                          full intent JSON
  new-purchase --items "a;b" [--category grocery] [--app blinkit] [--budget 800]
  new-redeem [--apps blinkit,bigbasket]
  set <id> <status> [--stage "text"] [--json '{...}']   update an intent
  log <id> "message"
  wait <id> <status[,status]> [--timeout 540]           block until the UI moves it (exit 2 on timeout)
  wallet <app> <balance>               record a balance you just read
  wallets
  voucher-add --app a --code c [--value 500] [--pin p] [--expiry 2027-01-31] [--source gmailMsgId]
  vouchers [--status new] [--app a] [--reveal]          --reveal prints full codes (never repeat them in chat)
  voucher-set <voucherId> <redeemed|failed|skipped> [--note "..."]
  shortlist <id>                       score state/runs/<id>/search-*.json -> top 3 per item
  compare <id>                         rank apps for the picked products
  cart <id> --app a --json '{"subtotal":..,"fees":{..},"total":..,"walletApplied":..,"payable":..}'
  record <id>                          save picks to memory
  like <brand> [--item milk] | dislike <brand> [--item x] | note "text" | profile`;

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opt[k] = true; else { opt[k] = next; i += 1; }
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}

const out = (x) => process.stdout.write(`${typeof x === 'string' ? x : JSON.stringify(x, null, 2)}\n`);
const die = (msg, code = 1) => { process.stderr.write(`${msg}\n`); process.exit(code); };
const need = (v, name) => { if (v === undefined || v === true || v === '') die(`Missing ${name}`); return v; };
const inr = (n) => (n == null ? '–' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);

const appName = (id) => ((store.getPrefs().apps || {})[id] || {}).name || id;

function brief(i) {
  const what = i.type === 'redeem' ? `redeem ${(i.apps || []).join(',') || 'all'}` : `${i.category}: ${i.items.map((x) => x.text).join(', ')}`;
  return `${i.id}  ${i.status.padEnd(14)} ${what}`;
}

function loadSearches(id) {
  const dir = store.files.runDir(id);
  let names = [];
  try { names = fs.readdirSync(dir).filter((f) => /^search-.+\.json$/.test(f)); } catch { /* none */ }
  if (!names.length) die(`No search files in ${dir}. Write search-<app>.json first (see stores/README.md).`);
  return names.map((f) => store.readJSON(path.join(dir, f)));
}

const commands = {
  help: () => out(HELP),

  intents: ({ opt }) => {
    const open = ['queued', 'running', 'needs_pick', 'ready_to_compare', 'needs_approval', 'approved', 'building_cart', 'cart_ready'];
    const list = store.listIntents().filter((i) => (opt.status ? i.status === opt.status : open.includes(i.status)));
    out(list.length ? list.map(brief).join('\n') : 'No open intents.');
  },

  intent: ({ pos }) => out(store.getIntent(need(pos[0], 'id')) || die('Not found')),

  'new-purchase': ({ opt }) => {
    const i = store.createIntent({ type: 'purchase', items: String(need(opt.items, '--items')).split(';'),
      category: opt.category, preferredApp: opt.app, budget: opt.budget });
    out(brief(i));
  },

  'new-redeem': ({ opt }) => {
    const i = store.createIntent({ type: 'redeem', apps: opt.apps ? String(opt.apps).split(',') : [] });
    out(brief(i));
  },

  set: ({ pos, opt }) => {
    const patch = opt.json ? JSON.parse(opt.json) : {};
    if (pos[1]) patch.status = pos[1];
    if (opt.stage) patch.stage = opt.stage;
    out(brief(store.updateIntent(need(pos[0], 'id'), patch, opt.stage)));
  },

  log: ({ pos }) => out(brief(store.updateIntent(need(pos[0], 'id'), null, need(pos[1], 'message')))),

  wait: ({ pos, opt }) => {
    const id = need(pos[0], 'id');
    const want = String(need(pos[1], 'status')).split(',');
    const until = Date.now() + Number(opt.timeout || 540) * 1000;
    for (;;) {
      const i = store.getIntent(id);
      if (!i) die('Not found');
      if (want.includes(i.status)) return out({ status: i.status, picks: i.picks, approval: i.approval || null });
      if (['cancelled', 'failed'].includes(i.status)) die(`Intent is ${i.status}`, 3);
      if (Date.now() > until) die(`Still ${i.status}; waiting timed out`, 2);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
    }
  },

  wallet: ({ pos }) => {
    const bal = Number(need(pos[1], 'balance'));
    if (Number.isNaN(bal)) die('Balance must be a number');
    const w = store.setWallet(need(pos[0], 'app'), bal);
    out(`${pos[0]} wallet ${inr(w.balance)}${w.previous != null ? ` (was ${inr(w.previous)})` : ''}`);
  },

  wallets: () => {
    const w = store.getWallets();
    out(Object.keys(w).length ? Object.entries(w).map(([a, v]) => `${a.padEnd(10)} ${inr(v.balance).padStart(10)}  checked ${v.checkedAt}`).join('\n') : 'No balances recorded yet.');
  },

  'voucher-add': ({ opt }) => {
    const { voucher, added } = store.addVoucher({ app: need(opt.app, '--app'), code: need(opt.code, '--code'), value: opt.value,
      pin: opt.pin, expiry: opt.expiry, source: opt.source, purchasedAt: opt.purchased });
    out(`${added ? 'Added' : 'Already known'} ${voucher.id} ${voucher.app} ${inr(voucher.value)} ${store.maskCode(voucher.code)} [${voucher.status}]`);
  },

  vouchers: ({ opt }) => {
    const list = store.listVouchers().filter((v) => (!opt.status || v.status === opt.status) && (!opt.app || v.app === opt.app));
    if (opt.reveal) return out(list.map((v) => ({ id: v.id, app: v.app, value: v.value, code: v.code, pin: v.pin, expiry: v.expiry, status: v.status })));
    out(list.length ? list.map((v) => `${v.id}  ${v.app.padEnd(10)} ${inr(v.value).padStart(8)}  ${store.maskCode(v.code)}  ${v.status}${v.expiry ? `  exp ${v.expiry}` : ''}`).join('\n') : 'No vouchers.');
  },

  'voucher-set': ({ pos, opt }) => {
    const v = store.setVoucherStatus(need(pos[0], 'voucherId'), need(pos[1], 'status'), opt.note);
    out(`${v.id} ${v.app} ${store.maskCode(v.code)} -> ${v.status}`);
  },

  shortlist: ({ pos }) => {
    const id = need(pos[0], 'id');
    const intent = store.getIntent(id) || die('Not found');
    const searches = loadSearches(id);
    const ctx = memory.buildContext();
    const prefs = store.getPrefs();
    const items = intent.items.map((item) => {
      const byApp = {};
      for (const s of searches) {
        if (s.available === false) continue;
        const found = (s.items || []).find((x) => x.item === item.id);
        byApp[s.app] = found ? found.results : [];
      }
      return shortlistItem(item, byApp, ctx, prefs);
    });
    const picks = { ...(intent.picks || {}) };
    for (const it of items) if (!picks[it.id] && it.autoPick) picks[it.id] = it.autoPick;
    const meta = Object.fromEntries(searches.map((s) => [s.app, { etaMins: s.etaMins ?? null, available: s.available !== false, reason: s.reason }]));
    const open = items.filter((it) => !picks[it.id] && it.options.length);
    const status = open.length ? 'needs_pick' : 'ready_to_compare';
    store.updateIntent(id, { shortlist: { items, apps: searches.map((s) => s.app), meta }, picks, status,
      stage: open.length ? `Pick ${open.length} item${open.length > 1 ? 's' : ''} in the UI` : 'Comparing apps' },
    `Shortlisted ${items.length} items; ${items.length - open.length} auto-picked from memory`);
    out(items.map((it) => {
      const head = `${it.id} "${it.text}" -> ${it.options.length} options${it.autoPick ? ` (auto: ${it.autoPick})` : ''}${it.options.length ? '' : '  !! nothing matched'}`;
      const rows = it.options.map((o) => `   ${o.id} ${o.score.toFixed(2)} ${o.brand} | ${o.name} | ${o.sizeText} | ${Object.entries(o.apps).map(([a, p]) => `${a} ${inr(p.price)}`).join(', ')}`);
      return [head, ...rows].join('\n');
    }).join('\n'));
    out(`status: ${status}`);
  },

  compare: ({ pos }) => {
    const id = need(pos[0], 'id');
    const intent = store.getIntent(id) || die('Not found');
    if (!intent.shortlist) die('Run shortlist first');
    const missing = intent.shortlist.items.filter((it) => it.options.length && !intent.picks[it.id]);
    if (missing.length) die(`Waiting for picks: ${missing.map((m) => m.id).join(', ')}`, 2);
    const cmp = compareApps(intent, intent.shortlist.apps, store.getWallets(), store.getPrefs(), intent.shortlist.meta);
    const rec = cmp.apps.find((a) => a.app === cmp.recommended);
    store.updateIntent(id, { comparison: cmp, status: 'needs_approval',
      stage: rec ? `Recommend ${appName(rec.app)}: pay ${inr(rec.payable)} after wallet. Approve in the UI.` : 'No app has these items' },
    'Comparison ready');
    out(cmp.apps.map((a) => (a.unavailable ? `${a.app.padEnd(10)} unavailable: ${a.reason}`
      : `${a.app.padEnd(10)} total ${inr(a.total)}  wallet ${inr(a.walletUsable)}  pay ${inr(a.payable)}  items ${Math.round(a.coverage * 100)}%  subs ${a.substitutions}${a.etaMins != null ? `  ${a.etaMins}m` : ''}`)).join('\n'));
    out(`recommended: ${cmp.recommended || 'none'}${cmp.voucher ? ` | top-up: buy ${cmp.voucher.buy.map(inr).join(' + ')} ${cmp.voucher.app} voucher` : ''}`);
  },

  cart: ({ pos, opt }) => {
    const id = need(pos[0], 'id');
    const cart = { app: need(opt.app, '--app'), ...JSON.parse(need(opt.json, '--json')), at: store.now() };
    const i = store.updateIntent(id, { cart, status: 'cart_ready', stage: `Cart ready on ${appName(cart.app)}: pay ${inr(cart.payable ?? cart.total)}. Place the order in the app.` }, 'Cart built; stopped before payment');
    store.appendJSONL(store.files.orders(), { at: store.now(), intentId: id, ...cart, items: i.items.map((x) => x.text) });
    out(brief(i));
  },

  record: ({ pos }) => {
    const id = need(pos[0], 'id');
    const intent = store.getIntent(id) || die('Not found');
    const n = memory.recordIntent(intent);
    store.updateIntent(id, { memoryRecorded: true }, n ? `Remembered ${n} picks` : null);
    out(`Remembered ${n} picks`);
  },

  like: ({ pos, opt }) => { memory.setPreference('likes', need(pos[0], 'brand'), opt.item); out(`Noted: you like ${pos[0]}${opt.item ? ` for ${opt.item}` : ''}`); },
  dislike: ({ pos, opt }) => { memory.setPreference('dislikes', need(pos[0], 'brand'), opt.item); out(`Noted: avoid ${pos[0]}${opt.item ? ` for ${opt.item}` : ''}`); },
  note: ({ pos }) => { memory.addNote(need(pos.join(' '), 'text')); out('Noted.'); },
  profile: () => out(memory.loadProfile()),
};

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const fn = commands[cmd || 'help'];
  if (!fn) die(`Unknown command ${cmd}\n\n${HELP}`);
  try { fn(parseArgs(rest)); } catch (e) { die(e.message); }
}

main();
