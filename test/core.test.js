'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shop-test-'));
process.env.SHOP_STATE_DIR = path.join(tmp, 'state');
process.env.SHOP_MEMORY_DIR = path.join(tmp, 'memory');

const { parseSize, unitPrice } = require('../lib/units');
const { parseItem, sameProduct, itemKey } = require('../lib/text');
const { shortlistItem } = require('../lib/shortlist');
const { compareApps, suggestVoucher } = require('../lib/compare');
const store = require('../lib/store');
const memory = require('../lib/memory');
const prefs = require('../prefs.json');

const reset = () => fs.rmSync(tmp, { recursive: true, force: true });

test('sizes and unit prices', () => {
  assert.deepEqual(parseSize('5 kg'), { qty: 5000, base: 'g' });
  assert.deepEqual(parseSize('Amul Taaza 1 ltr'), { qty: 1000, base: 'ml' });
  assert.deepEqual(parseSize('2 x 500 g'), { qty: 1000, base: 'g' });
  assert.deepEqual(parseSize('6 pieces'), { qty: 6, base: 'pc' });
  assert.deepEqual(parseSize('Eggs - Pack of 12'), { qty: 12, base: 'pc' });
  assert.equal(parseSize('Greek yogurt'), null);
  assert.equal(unitPrice(285, parseSize('5 kg')), 57);
});

test('item parsing keeps pack sizes and reads explicit counts', () => {
  assert.deepEqual(parseItem('Milk 1L x2').count, 2);
  assert.equal(parseItem('Milk 1L x2').text, 'Milk 1L');
  assert.equal(parseItem('2 x Amul butter 500g').count, 2);
  assert.equal(parseItem('12 eggs').count, 1);
  assert.deepEqual(parseItem('12 eggs').size, { qty: 12, base: 'pc' });
  assert.equal(itemKey('Atta 5kg'), itemKey('atta'));
});

test('same product is matched across apps despite different titles', () => {
  assert.ok(sameProduct({ brand: 'Aashirvaad', name: 'Aashirvaad Shudh Chakki Atta', size: '5 kg' },
    { brand: 'aashirvaad', name: 'Aashirvaad Atta - Shudh Chakki', size: '5kg' }));
  assert.ok(!sameProduct({ brand: 'Aashirvaad', name: 'Aashirvaad Shudh Chakki Atta', size: '5 kg' },
    { brand: 'Aashirvaad', name: 'Aashirvaad Shudh Chakki Atta', size: '10 kg' }));
});

const ATTA = {
  blinkit: [
    { name: 'Aashirvaad Shudh Chakki Atta', brand: 'Aashirvaad', size: '5 kg', price: 285, mrp: 310, sponsored: true, url: 'https://blinkit.com/prn/a' },
    { name: 'Pro Nature Organic Whole Wheat Atta', brand: 'Pro Nature', size: '5 kg', price: 420, mrp: 450, url: 'https://blinkit.com/prn/b' },
    { name: 'Fortune Chakki Fresh Atta', brand: 'Fortune', size: '5 kg', price: 260, mrp: 280 },
    { name: 'Maggi Atta Noodles', brand: 'Maggi', size: '290 g', price: 70, relevant: false },
    { name: 'Aashirvaad Select Sharbati Atta', brand: 'Aashirvaad', size: '5 kg', price: 380, inStock: false },
  ],
  bigbasket: [
    { name: 'Aashirvaad Atta - Shudh Chakki', brand: 'Aashirvaad', size: '5 kg', price: 279, mrp: 310, rating: 4.4, reviews: 52000, url: 'https://www.bigbasket.com/pd/1/' },
    { name: '24 Mantra Organic Atta', brand: '24 Mantra Organic', size: '5 kg', price: 399, mrp: 450, rating: 4.3, reviews: 8000 },
  ],
};

test('shortlist: filters noise, merges apps, prefers premium, asks on first run', () => {
  reset();
  const ctx = memory.buildContext();
  const s = shortlistItem({ id: 'i1', text: 'Atta 5kg' }, ATTA, ctx, prefs);
  assert.equal(s.options.length, 3);
  assert.equal(s.dropped.irrelevant, 1);
  assert.equal(s.dropped.outOfStock, 1);
  const aash = s.allOptions.find((o) => o.brand === 'Aashirvaad');
  assert.deepEqual(Object.keys(aash.apps).sort(), ['bigbasket', 'blinkit']);
  assert.ok(['Pro Nature', '24 Mantra Organic'].includes(s.options[0].brand), `premium first, got ${s.options[0].brand}`);
  assert.equal(s.autoPick, null);
});

test('disliked brands never appear', () => {
  reset();
  memory.setPreference('dislikes', 'Fortune');
  const s = shortlistItem({ id: 'i1', text: 'atta 5kg' }, ATTA, memory.buildContext(), prefs);
  assert.ok(!s.allOptions.some((o) => o.brand === 'Fortune'));
  assert.equal(s.dropped.disliked, 1);
});

test('compare ranks by availability then out-of-pocket and suggests a voucher', () => {
  const intent = {
    picks: { i1: 'i1o1' }, budget: null, preferredApp: null,
    shortlist: { items: [{ id: 'i1', text: 'atta', count: 2, options: [], bestByApp: { blinkit: 'i1o1', bigbasket: 'i1o1' },
      allOptions: [{ id: 'i1o1', brand: 'A', name: 'A atta', sizeText: '5 kg', apps: { blinkit: { price: 285 }, bigbasket: { price: 279 } } }] }] },
  };
  const cmp = compareApps(intent, ['blinkit', 'bigbasket'], { blinkit: { balance: 600 }, bigbasket: { balance: 0 } }, prefs);
  assert.equal(cmp.recommended, 'blinkit');
  const b = cmp.apps.find((a) => a.app === 'blinkit');
  assert.equal(b.total, 579); assert.equal(b.payable, 0);
  const cmp2 = compareApps(intent, ['blinkit', 'bigbasket'], { blinkit: { balance: 100 }, bigbasket: { balance: 0 } }, prefs);
  assert.equal(cmp2.voucher.total, 500);
  assert.deepEqual(suggestVoucher('blinkit', 2600, prefs).buy, [2000, 1000]);
});

test('vouchers are deduplicated and masked', () => {
  reset();
  assert.equal(store.addVoucher({ app: 'blinkit', code: 'ABCD-1234-WXYZ', value: 500 }).added, true);
  assert.equal(store.addVoucher({ app: 'blinkit', code: 'abcd1234wxyz', value: 500 }).added, false);
  const pub = store.listVouchers().map(store.publicVoucher);
  assert.equal(pub[0].code, '••••WXYZ');
  assert.ok(!JSON.stringify(pub).includes('ABCD'));
});

test('end to end: queue → shortlist → pick → compare → approve → cart → memory auto-picks next time', () => {
  reset();
  const { execFileSync } = require('child_process');
  const cli = (...a) => execFileSync(process.execPath, [path.join(__dirname, '..', 'tools', 'shop.js'), ...a], { env: process.env, encoding: 'utf8' });
  const run = (items) => {
    const id = cli('new-purchase', '--items', items).split(/\s+/)[0];
    const dir = store.files.runDir(id);
    fs.mkdirSync(dir, { recursive: true });
    for (const app of ['blinkit', 'bigbasket']) {
      store.writeJSON(path.join(dir, `search-${app}.json`), { app, etaMins: app === 'blinkit' ? 10 : 25, items: [{ item: 'i1', query: 'atta', results: ATTA[app] }] });
    }
    cli('shortlist', id);
    return id;
  };
  cli('wallet', 'blinkit', '700');
  const id = run('Atta 5kg');
  let it = store.getIntent(id);
  assert.equal(it.status, 'needs_pick');
  const aash = it.shortlist.items[0].allOptions.find((o) => o.brand === 'Aashirvaad');
  store.updateIntent(id, { picks: { i1: aash.id }, status: 'ready_to_compare' });
  cli('compare', id);
  it = store.getIntent(id);
  assert.equal(it.status, 'needs_approval');
  assert.equal(it.comparison.recommended, 'blinkit');
  store.updateIntent(id, { status: 'approved', approval: { app: 'blinkit' } });
  cli('cart', id, '--app', 'blinkit', '--json', '{"subtotal":285,"fees":{"handling":9},"total":294,"walletApplied":294,"payable":0}');
  assert.equal(store.getIntent(id).status, 'cart_ready');
  cli('record', id);
  cli('record', id); // idempotent
  assert.equal(memory.loadHistory().length, 1);
  // Second time: picked once → not yet auto. Third time: picked twice → auto-picked.
  const id2 = run('atta');
  assert.equal(store.getIntent(id2).status, 'needs_pick');
  store.updateIntent(id2, { picks: { i1: store.getIntent(id2).shortlist.items[0].allOptions.find((o) => o.brand === 'Aashirvaad').id }, memoryRecorded: false });
  cli('record', id2);
  const id3 = run('atta 5 kg');
  const it3 = store.getIntent(id3);
  assert.equal(it3.status, 'ready_to_compare');
  assert.equal(it3.shortlist.items[0].options[0].brand, 'Aashirvaad');
});
