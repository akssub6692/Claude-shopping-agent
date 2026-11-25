#!/usr/bin/env node
'use strict';
// Local Intent UI. Listens on 127.0.0.1 only; never serves full voucher codes.
const http = require('http');
const fs = require('fs');
const path = require('path');
const store = require('../lib/store');
const memory = require('../lib/memory');

const PORT = Number(process.env.PORT || 4317);
const HTML = path.join(__dirname, 'index.html');

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 100000) { reject(new Error('Too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new Error('Bad JSON')); } });
  });
}

/** What the page sees: intents without private bits, masked vouchers. */
function publicState() {
  const prefs = store.getPrefs();
  const intents = store.listIntents().slice(-30).reverse().map((i) => {
    const { log, ...rest } = i;
    return { ...rest, log: (log || []).slice(-12) };
  });
  const p = memory.loadProfile();
  return {
    apps: Object.entries(prefs.apps || {}).filter(([, a]) => a.enabled !== false).map(([id, a]) => ({ id, name: a.name || id, categories: a.categories || [] })),
    categories: prefs.categories || ['grocery'],
    wallets: store.getWallets(),
    vouchers: store.listVouchers().slice(-20).reverse().map(store.publicVoucher),
    intents,
    profile: { likes: p.likes, dislikes: p.dislikes, picks: memory.loadHistory().length },
    now: store.now(),
  };
}

function act(id, fn) {
  return store.updateIntent(id, (it) => fn(it));
}

const routes = {
  'GET /': (req, res) => send(res, 200, fs.readFileSync(HTML, 'utf8'), 'text/html'),
  'GET /api/state': (req, res) => send(res, 200, publicState()),
  'POST /api/intents': async (req, res) => {
    const b = await readBody(req);
    const intent = store.createIntent({ type: b.type, items: b.items, category: b.category, preferredApp: b.preferredApp || null,
      budget: b.budget || null, notes: b.notes, apps: b.apps });
    send(res, 201, { id: intent.id });
  },
  'POST /api/intents/:id/picks': async (req, res, id) => {
    const b = await readBody(req);
    const it = act(id, (i) => {
      if (i.status !== 'needs_pick') throw new Error('Not waiting for picks');
      const items = i.shortlist.items;
      const picks = { ...i.picks };
      for (const [itemId, optId] of Object.entries(b.picks || {})) {
        const item = items.find((x) => x.id === itemId);
        if (item && item.allOptions.some((o) => o.id === optId)) picks[itemId] = optId;
      }
      const left = items.filter((x) => x.options.length && !picks[x.id]).length;
      return { picks, status: left ? 'needs_pick' : 'ready_to_compare', stage: left ? `Pick ${left} more` : 'Picks saved. Claude is comparing apps' };
    });
    send(res, 200, { status: it.status });
  },
  'POST /api/intents/:id/approve': async (req, res, id) => {
    const b = await readBody(req);
    const it = act(id, (i) => {
      if (i.status !== 'needs_approval') throw new Error('Not waiting for approval');
      const row = (i.comparison.apps || []).find((a) => a.app === b.app && !a.unavailable);
      if (!row) throw new Error('Unknown app');
      return { status: 'approved', approval: { app: b.app, at: store.now() }, stage: `Approved ${b.app}. Claude is building the cart` };
    });
    send(res, 200, { status: it.status });
  },
  'POST /api/intents/:id/placed': async (req, res, id) => {
    const it = act(id, (i) => {
      if (i.status !== 'cart_ready') throw new Error('Cart is not ready');
      return { status: 'done', stage: 'Order placed', placedAt: store.now() };
    });
    send(res, 200, { status: it.status });
  },
  'POST /api/intents/:id/cancel': async (req, res, id) => {
    const it = act(id, (i) => {
      if (['done', 'cancelled'].includes(i.status)) throw new Error(`Already ${i.status}`);
      return { status: 'cancelled', stage: 'Cancelled by you' };
    });
    send(res, 200, { status: it.status });
  },
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  // Writes only from this page: block cross-site form posts.
  if (req.method === 'POST') {
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return send(res, 403, { error: 'Forbidden origin' });
    if (!String(req.headers['content-type'] || '').includes('application/json')) return send(res, 415, { error: 'JSON only' });
  }
  const m = url.pathname.match(/^\/api\/intents\/([\w-]+)\/(\w+)$/);
  const key = m ? `${req.method} /api/intents/:id/${m[2]}` : `${req.method} ${url.pathname}`;
  const handler = routes[key];
  if (!handler) return send(res, 404, { error: 'Not found' });
  try { await handler(req, res, m && m[1]); } catch (e) { send(res, 400, { error: e.message }); }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => process.stdout.write(`Shopping agent UI: http://localhost:${PORT}\n`));
}

module.exports = { server, publicState };
