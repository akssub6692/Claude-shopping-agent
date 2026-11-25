'use strict';
// Local state on disk. Everything here is private: state/ and memory/ are gitignored.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const STATE_DIR = process.env.SHOP_STATE_DIR || path.join(ROOT, 'state');
const MEMORY_DIR = process.env.SHOP_MEMORY_DIR || path.join(ROOT, 'memory');

const files = {
  intents: () => path.join(STATE_DIR, 'intents.json'),
  wallets: () => path.join(STATE_DIR, 'wallets.json'),
  vouchers: () => path.join(STATE_DIR, 'vouchers.json'),
  orders: () => path.join(STATE_DIR, 'orders.log.jsonl'),
  runDir: (id) => path.join(STATE_DIR, 'runs', id),
  profile: () => path.join(MEMORY_DIR, 'profile.json'),
  history: () => path.join(MEMORY_DIR, 'history.jsonl'),
  prefs: () => process.env.SHOP_PREFS || path.join(ROOT, 'prefs.json'),
};

function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw new Error(`Cannot read ${file}: ${e.message}`);
  }
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

function readJSONL(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  return text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function appendJSONL(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + '\n');
}

// The UI server and the agent's CLI both write state; a short directory lock keeps writes ordered.
function withLock(fn) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const lock = path.join(STATE_DIR, '.lock');
  const start = Date.now();
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let stale = false;
      try { stale = Date.now() - fs.statSync(lock).mtimeMs > 10000; } catch { /* gone */ }
      if (stale) { try { fs.rmdirSync(lock); } catch { /* raced */ } continue; }
      if (Date.now() - start > 5000) throw new Error('State is locked by another process');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return fn(); } finally { try { fs.rmdirSync(lock); } catch { /* ignore */ } }
}

const now = () => new Date().toISOString();
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

// ---------- intents ----------
const PURCHASE_FLOW = ['queued', 'running', 'needs_pick', 'ready_to_compare', 'needs_approval', 'approved',
  'building_cart', 'cart_ready', 'done', 'failed', 'cancelled'];
const REDEEM_FLOW = ['queued', 'running', 'done', 'failed', 'cancelled'];

function listIntents() { return readJSON(files.intents(), []); }
function getIntent(id) { return listIntents().find((i) => i.id === id) || null; }

/** Split the UI's free-text list into items: one per line (or ';'), keeping what the user typed. */
function parseItemList(text) {
  const lines = Array.isArray(text) ? text : String(text || '').split(/\n|;/);
  return lines.map((s) => String(s).trim()).filter(Boolean).slice(0, 40)
    .map((t, i) => ({ id: `i${i + 1}`, text: t.slice(0, 200) }));
}

function createIntent(input) {
  const type = input.type === 'redeem' ? 'redeem' : 'purchase';
  const intent = {
    id: newId(type === 'redeem' ? 'rdm' : 'buy'),
    type,
    status: 'queued',
    stage: 'Waiting for Claude to pick this up',
    createdAt: now(),
    updatedAt: now(),
    log: [],
  };
  if (type === 'redeem') {
    intent.apps = (input.apps || []).filter(Boolean);
  } else {
    intent.category = input.category || 'grocery';
    intent.items = parseItemList(input.items);
    if (!intent.items.length) throw new Error('Add at least one item');
    intent.preferredApp = input.preferredApp || null;
    intent.budget = input.budget ? Number(input.budget) : null;
    intent.notes = input.notes ? String(input.notes).slice(0, 500) : '';
    intent.picks = {};
  }
  withLock(() => { const all = listIntents(); all.push(intent); writeJSON(files.intents(), all); });
  return intent;
}

/** Apply a patch (object or function) to one intent. Returns the updated intent. */
function updateIntent(id, patch, logMsg) {
  return withLock(() => {
    const all = listIntents();
    const it = all.find((i) => i.id === id);
    if (!it) throw new Error(`No intent ${id}`);
    const flow = it.type === 'redeem' ? REDEEM_FLOW : PURCHASE_FLOW;
    const changes = typeof patch === 'function' ? patch(it) : patch;
    if (changes) {
      if (changes.status && !flow.includes(changes.status)) throw new Error(`Bad status ${changes.status} for ${it.type}`);
      Object.assign(it, changes);
    }
    if (logMsg) it.log.push({ at: now(), msg: String(logMsg).slice(0, 500) });
    it.updatedAt = now();
    writeJSON(files.intents(), all);
    return it;
  });
}

// ---------- wallets ----------
function getWallets() { return readJSON(files.wallets(), {}); }
function setWallet(app, balance, extra = {}) {
  return withLock(() => {
    const w = getWallets();
    const prev = w[app] ? w[app].balance : null;
    w[app] = { balance: Number(balance), previous: prev, checkedAt: now(), ...extra };
    writeJSON(files.wallets(), w);
    return w[app];
  });
}

// ---------- vouchers ----------
const codeHash = (code) => crypto.createHash('sha256').update(String(code).replace(/[^a-z0-9]/gi, '').toUpperCase()).digest('hex').slice(0, 12);
function maskCode(code) {
  const c = String(code || '').replace(/\s+/g, '');
  return c.length <= 4 ? '••••' : `••••${c.slice(-4)}`;
}
function listVouchers() { return readJSON(files.vouchers(), []); }

/** Add a voucher; returns { voucher, added:false } if this code is already known (never redeem twice). */
function addVoucher({ app, value, code, pin, expiry, source, purchasedAt }) {
  if (!app || !code) throw new Error('app and code are required');
  return withLock(() => {
    const all = listVouchers();
    const id = `v_${codeHash(code)}`;
    const existing = all.find((v) => v.id === id);
    if (existing) return { voucher: existing, added: false };
    const v = { id, app, value: value != null ? Number(value) : null, code: String(code).trim(), pin: pin || null,
      expiry: expiry || null, source: source || null, purchasedAt: purchasedAt || null,
      status: 'new', addedAt: now(), history: [] };
    all.push(v);
    writeJSON(files.vouchers(), all);
    return { voucher: v, added: true };
  });
}

function setVoucherStatus(id, status, note) {
  if (!['new', 'redeemed', 'failed', 'skipped'].includes(status)) throw new Error(`Bad voucher status ${status}`);
  return withLock(() => {
    const all = listVouchers();
    const v = all.find((x) => x.id === id);
    if (!v) throw new Error(`No voucher ${id}`);
    v.status = status;
    v.history.push({ at: now(), status, note: note || '' });
    if (status === 'redeemed') v.redeemedAt = now();
    writeJSON(files.vouchers(), all);
    return v;
  });
}

const publicVoucher = (v) => ({ id: v.id, app: v.app, value: v.value, code: maskCode(v.code), expiry: v.expiry,
  status: v.status, redeemedAt: v.redeemedAt || null, note: (v.history.at(-1) || {}).note || '' });

function getPrefs() { return readJSON(files.prefs(), { apps: {} }); }

module.exports = {
  ROOT, STATE_DIR, MEMORY_DIR, files, readJSON, writeJSON, readJSONL, appendJSONL, withLock, now,
  listIntents, getIntent, createIntent, updateIntent, parseItemList,
  getWallets, setWallet, listVouchers, addVoucher, setVoucherStatus, maskCode, publicVoucher, codeHash, getPrefs,
};
