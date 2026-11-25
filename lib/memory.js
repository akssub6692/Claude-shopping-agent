'use strict';
// Remembering interests over time: explicit likes/dislikes (profile.json) + every pick (history.jsonl).
const store = require('./store');
const { itemKey, sameProduct, normBrand } = require('./text');

const EMPTY_PROFILE = { likes: [], dislikes: [], notes: [] };

function loadProfile() { return { ...EMPTY_PROFILE, ...store.readJSON(store.files.profile(), {}) }; }
function saveProfile(p) { store.writeJSON(store.files.profile(), p); }
function loadHistory() { return store.readJSONL(store.files.history()); }

/** like/dislike a brand, optionally only for one kind of item ("milk"). */
function setPreference(kind, brand, item) {
  const p = loadProfile();
  const b = String(brand).trim();
  const it = item ? itemKey(item) : null;
  const other = kind === 'likes' ? 'dislikes' : 'likes';
  const match = (e) => normBrand(e.brand) === normBrand(b) && (e.item || null) === it;
  p[other] = p[other].filter((e) => !match(e));
  if (!p[kind].some(match)) p[kind].push(it ? { brand: b, item: it } : { brand: b });
  saveProfile(p);
  return p;
}

function addNote(text) {
  const p = loadProfile();
  p.notes.push({ at: store.now(), text: String(text).slice(0, 300) });
  saveProfile(p);
  return p;
}

/** Context the scorer needs: profile + per-item pick counts. */
function buildContext() {
  return { profile: loadProfile(), history: loadHistory() };
}

function isDisliked(ctx, brand, key) {
  return ctx.profile.dislikes.some((d) => normBrand(d.brand) === normBrand(brand) && (!d.item || d.item === key));
}

/**
 * 0..1 affinity of a candidate for an item.
 * 1   = liked brand for this item, or this exact product picked 2+ times
 * 0.5 = this exact product picked once
 * up to 0.6 = same brand picked before for this item
 */
function affinity(ctx, key, cand) {
  const liked = ctx.profile.likes.some((l) => normBrand(l.brand) === normBrand(cand.brand) && (!l.item || l.item === key));
  if (liked) return 1;
  let productPicks = 0; let brandPicks = 0;
  for (const h of ctx.history) {
    if (h.itemKey !== key || !h.picked) continue;
    if (normBrand(h.picked.brand) === normBrand(cand.brand)) {
      brandPicks += 1;
      if (sameProduct(h.picked, cand)) productPicks += 1;
    }
  }
  return Math.max(Math.min(1, productPicks / 2), 0.6 * Math.min(1, brandPicks / 2));
}

/** Write picks of a finished shortlist to history (once per intent). */
function recordIntent(intent) {
  if (intent.memoryRecorded) return 0;
  let n = 0;
  for (const item of (intent.shortlist && intent.shortlist.items) || []) {
    const pickId = intent.picks && intent.picks[item.id];
    const opt = item.options.find((o) => o.id === pickId);
    if (!opt) continue;
    store.appendJSONL(store.files.history(), {
      at: store.now(), intentId: intent.id, itemKey: item.key, itemText: item.text,
      source: item.autoPick === pickId ? 'auto' : 'user',
      picked: { brand: opt.brand, name: opt.name, size: opt.sizeText },
      notPicked: item.options.filter((o) => o.id !== pickId).map((o) => ({ brand: o.brand, name: o.name, size: o.sizeText })),
      app: intent.approval ? intent.approval.app : null,
    });
    n += 1;
  }
  return n;
}

module.exports = { loadProfile, saveProfile, loadHistory, setPreference, addNote, buildContext, isDisliked, affinity, recordIntent };
