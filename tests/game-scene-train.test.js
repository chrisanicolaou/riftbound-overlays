// Unit tests for the game scene's sub train: what counts, levels, timing, and picking up again after a reload.
// Run: node --test tests/game-scene-train.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('./load-widget')('game-scene');

const cfg = { seconds: 120, every: 5, showFrom: 2 };

test('what counts', () => {
  assert.equal(w.trainSubs('follower-latest', { name: 'a' }), 0);
  assert.equal(w.trainSubs('subscriber-latest', { name: 'a', amount: 7 }), 1);
  assert.equal(w.trainSubs('subscriber-latest', { name: 'b', gifted: true, sender: 'a' }), 1);
  assert.equal(w.trainSubs('subscriber-latest', { bulkGifted: true, sender: 'a', amount: 50 }), 50);
  assert.equal(w.trainSubs('subscriber-latest', { isCommunityGift: true, gifted: true, sender: 'a', name: 'b' }), 0);
});
test('who gets the credit', () => {
  assert.equal(w.trainName({ name: 'a', amount: 1 }), 'a');
  assert.equal(w.trainName({ name: 'b', gifted: true, sender: 'a' }), 'a');
  assert.equal(w.trainName({ bulkGifted: true, sender: 'AnAnonymousGifter', amount: 5 }), 'Anonymous');
});
test('levels and hype', () => {
  assert.deepEqual([0, 4, 5, 12].map((n) => w.trainLevel(n, 5)), [1, 1, 2, 3]);
  assert.deepEqual([1, 3, 5, 8].map((l) => w.trainHype(l)), [0, 0.5, 1, 1]);
});
test('a first sub starts a train', () => assert.deepEqual(w.trainAdd(null, 1, 'a', 1000, cfg),
  { train: { count: 1, latest: 'a', endsAt: 121000 }, levelUp: false, started: true }));
test('a sub refills and can level up', () => {
  const r = w.trainAdd({ count: 4, latest: 'a', endsAt: 121000 }, 1, 'b', 2000, cfg);
  assert.deepEqual(r, { train: { count: 5, latest: 'b', endsAt: 122000 }, levelUp: true, started: false });
  assert.equal(w.trainAdd({ count: 3, latest: 'a', endsAt: 121000 }, 5, 'b', 2000, cfg).levelUp, true);
});
test('no level-up effect before the train was showing', () =>
  assert.equal(w.trainAdd({ count: 1, latest: 'a', endsAt: 121000 }, 4, 'b', 2000, cfg).levelUp, false));
test('a sub during "Train over" starts a new train', () =>
  assert.deepEqual(w.trainAdd({ count: 9, latest: 'a', endsAt: 1000 }, 1, 'b', 2000, cfg).train, { count: 1, latest: 'b', endsAt: 122000 }));
test('phases', () => {
  const t = { count: 3, latest: 'a', endsAt: 10000 };
  assert.equal(w.trainPhase({ ...t, count: 1 }, 5000, cfg), 'off');
  assert.equal(w.trainPhase(t, 5000, cfg), 'live');
  assert.equal(w.trainPhase(t, 12000, cfg), 'over');
  assert.equal(w.trainPhase(t, 15000, cfg), 'off');
  assert.equal(w.trainPhase(null, 0, cfg), 'off');
});
test('restoring after a reload', () => {
  const saved = { count: 3, latest: 'a', endsAt: 5000 };
  assert.deepEqual(w.restoreTrain(saved, 4000), saved);
  assert.equal(w.restoreTrain(saved, 6000), null);
  assert.equal(w.restoreTrain({ count: 'x', latest: 'a', endsAt: 5000 }, 4000), null);
  assert.equal(w.restoreTrain(null, 0), null);
});
