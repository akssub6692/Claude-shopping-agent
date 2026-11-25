'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSize, unitPrice } = require('../lib/units');
const { parseItem, sameProduct, itemKey, parseItemList } = require('../lib/text');
const { shortlistItem } = require('../lib/shortlist');
const { compareApps, suggestVoucher } = require('../lib/compare');
const taste = require('../lib/taste');
const flow = require('../lib/flow');
const prompts = require('../lib/prompts');
const prefs = require('../prefs.json');

const ctx0 = () => ({ profile: taste.emptyProfile(), history: [] });

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
  assert.equal(parseItem('Milk 1L x2').count, 2);
  assert.equal(parseItem('Milk 1L x2').text, 'Milk 1L');
  assert.equal(parseItem('2 x Amul butter 500g').count, 2);
  assert.equal(parseItem('12 eggs').count, 1);
  assert.deepEqual(parseItem('12 eggs').size, { qty: 12, base: 'pc' });
  assert.equal(itemKey('Atta 5kg'), itemKey('atta'));
  assert.deepEqual(parseItemList('milk\n\n eggs ;atta').map((i) => i.id), ['i1', 'i2', 'i3']);
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
    { name: 'Pro Nature Organic Whole Wheat Atta', brand: 'Pro Nature', size: '5 kg', price: 420, mrp: 450 },
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
  const s = shortlistItem({ id: 'i1', text: 'Atta 5kg' }, ATTA, ctx0(), prefs);
  assert.equal(s.options.length, 3);
  assert.equal(s.dropped.irrelevant, 1);
  assert.equal(s.dropped.outOfStock, 1);
  const aash = s.allOptions.find((o) => o.brand === 'Aashirvaad');
  assert.deepEqual(Object.keys(aash.apps).sort(), ['bigbasket', 'blinkit']);
  assert.ok(['Pro Nature', '24 Mantra Organic'].includes(s.options[0].brand), `premium first, got ${s.options[0].brand}`);
  assert.equal(s.autoPick, null);
});

test('liked brands are auto-picked; avoided brands never appear', () => {
  let p = taste.withPreference(taste.emptyProfile(), 'dislikes', 'Fortune');
  p = taste.withPreference(p, 'likes', 'Aashirvaad', 'atta');
  const s = shortlistItem({ id: 'i1', text: 'atta 5kg' }, ATTA, { profile: p, history: [] }, prefs);
  assert.ok(!s.allOptions.some((o) => o.brand === 'Fortune'));
  assert.equal(s.options[0].brand, 'Aashirvaad');
  assert.equal(s.autoPick, s.options[0].id);
  // liking it again doesn't duplicate; flipping to avoid removes the like
  assert.equal(taste.withPreference(p, 'likes', 'aashirvaad', 'Atta').likes.length, 1);
  assert.equal(taste.withPreference(p, 'dislikes', 'Aashirvaad', 'atta').likes.length, 0);
});

test('compare ranks by availability then out-of-pocket and suggests a voucher', () => {
  const request = {
    picks: { i1: 'i1o1' }, budget: null, preferredApp: null,
    shortlist: { items: [{ id: 'i1', text: 'atta', count: 2, options: [], bestByApp: { blinkit: 'i1o1', bigbasket: 'i1o1' },
      allOptions: [{ id: 'i1o1', brand: 'A', name: 'A atta', sizeText: '5 kg', apps: { blinkit: { price: 285 }, bigbasket: { price: 279 } } }] }] },
  };
  const cmp = compareApps(request, ['blinkit', 'bigbasket'], { blinkit: { balance: 600 }, bigbasket: { balance: 0 } }, prefs);
  assert.equal(cmp.recommended, 'blinkit');
  const b = cmp.apps.find((a) => a.app === 'blinkit');
  assert.equal(b.total, 579); assert.equal(b.payable, 0);
  const cmp2 = compareApps(request, ['blinkit', 'bigbasket'], { blinkit: { balance: 100 }, bigbasket: { balance: 0 } }, prefs);
  assert.equal(cmp2.voucher.total, 500);
  assert.deepEqual(suggestVoucher('blinkit', 2600, prefs).buy, [2000, 1000]);
});

test('replies: JSON is pulled out of chatter and classified', () => {
  const reply = 'Here you go!\n```json\n{"wallets":{"Blinkit":"₹1,250","BB":0}}\n```\nAnything else?';
  const obj = flow.extractJson(reply);
  assert.equal(flow.classifyReply(obj), 'wallets');
  assert.deepEqual(flow.walletsFrom(obj), { blinkit: 1250, bigbasket: 0 });
  assert.throws(() => flow.extractJson('no json here'), /No JSON/);
  assert.equal(flow.classifyReply({ subtotal: 1 }), 'cart');
  assert.equal(flow.classifyReply({ vouchers: [] }), 'redeem');
});

test('redeem replies never keep full codes', () => {
  const { vouchers, wallets } = flow.redeemFrom({ vouchers: [{ app: 'Blinkit', value: '500', code: 'ABCD-1234-WXYZ', status: 'redeemed' }], wallets: { blinkit: 900 } });
  assert.equal(vouchers[0].last4, 'WXYZ');
  assert.ok(!JSON.stringify(vouchers).includes('ABCD'));
  assert.equal(wallets.blinkit, 900);
  assert.equal(flow.voucherId(vouchers[0]), 'blinkit-WXYZ-500');
});

test('prompts carry the request, the taste and the never-pay rule', () => {
  const r = { id: 'R1ABC', items: parseItemList('milk 1L x2\natta 5kg') };
  const p = prompts.searchPrompt(r, taste.withPreference(taste.emptyProfile(), 'likes', 'Akshayakalpa', 'milk'), '560001');
  assert.match(p, /R1ABC/); assert.match(p, /i2: atta 5kg/); assert.match(p, /Akshayakalpa/); assert.match(p, /Never click Pay/); assert.match(p, /560001/);
  assert.match(prompts.redeemPrompt([{ app: 'blinkit', last4: 'WXYZ', value: 500 }], ['blinkit']), /••••WXYZ/);
});

test('end to end: search reply → shortlist → picks → compare → cart reply → memory auto-picks next time', () => {
  const history = [];
  const runOnce = (text, wallets) => {
    const r = { id: 'RX', items: parseItemList(text), picks: {}, results: {} };
    const reply = '```json\n' + JSON.stringify({ request: 'RX', sites: [
      { app: 'blinkit', available: true, etaMins: 10, wallet: wallets.blinkit, items: [{ item: 'i1', query: 'atta', results: ATTA.blinkit }] },
      { app: 'bigbasket', available: true, etaMins: 25, wallet: wallets.bigbasket, items: [{ item: 'i1', query: 'atta', results: ATTA.bigbasket }] }] }) + '\n```';
    const obj = flow.extractJson(reply);
    assert.equal(flow.classifyReply(obj), 'search');
    const { results, wallets: w } = flow.searchFrom(obj, r);
    r.results = results;
    Object.assign(r, flow.runShortlist(r, { profile: taste.emptyProfile(), history }, prefs));
    return { r, w };
  };
  const { r, w } = runOnce('Atta 5kg', { blinkit: 700, bigbasket: 0 });
  assert.equal(flow.openItems(r).length, 1);
  const aash = r.shortlist.items[0].allOptions.find((o) => o.brand === 'Aashirvaad');
  r.picks.i1 = aash.id;
  assert.equal(flow.openItems(r).length, 0);
  const wallets = Object.fromEntries(Object.entries(w).map(([a, b]) => [a, { balance: b }]));
  r.comparison = flow.runCompare(r, wallets, prefs);
  assert.equal(r.comparison.recommended, 'blinkit');
  r.approval = { app: 'blinkit' };
  const cart = flow.cartFrom(flow.extractJson('{"app":"Blinkit","subtotal":285,"fees":{"handling":"₹9"},"total":294,"walletApplied":294,"payable":0}'));
  assert.deepEqual(cart.fees, { handling: 9 });
  history.push(...taste.pickRecords(r, 't1'));
  assert.equal(history.length, 1);
  // Picked once: still asks. Picked twice: auto-picked.
  const second = runOnce('atta', { blinkit: 0, bigbasket: 0 }).r;
  assert.equal(flow.openItems(second).length, 1);
  second.picks.i1 = second.shortlist.items[0].allOptions.find((o) => o.brand === 'Aashirvaad').id;
  history.push(...taste.pickRecords(second, 't2'));
  const third = runOnce('atta 5 kg', { blinkit: 0, bigbasket: 0 }).r;
  assert.equal(flow.openItems(third).length, 0);
  assert.equal(third.shortlist.items[0].options[0].brand, 'Aashirvaad');
});
