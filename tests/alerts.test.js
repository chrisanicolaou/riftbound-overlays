// Unit tests for the alerts widget's decisions: which alert an event becomes, follow merging, effect sizes.
// Run: node --test tests/alerts.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const w = require('./load-widget')('alerts');

const F = { bitsFoil: 1000 };

test('follow', () => assert.partialDeepStrictEqual(w.describeEvent('follower-latest', { name: 'ana' }, F),
  { kind: 'follow', style: 'rune', name: 'ana', line: 'New follower', hold: 4000, scale: 1, count: 1 }));
test('first sub with tier', () => assert.partialDeepStrictEqual(w.describeEvent('subscriber-latest', { name: 'ana', amount: 1, tier: '2000' }, F),
  { kind: 'sub', style: 'party', line: 'Just subscribed at tier 2', hold: 6000, scale: 1.6 }));
test('prime sub', () => assert.equal(w.describeEvent('subscriber-latest', { name: 'ana', amount: 1, tier: 'prime' }, F).line, 'Subscribed with Prime'));
test('sub without tier', () => assert.equal(w.describeEvent('subscriber-latest', { name: 'ana', amount: 1 }, F).line, 'Just subscribed'));
test('resub', () => assert.partialDeepStrictEqual(w.describeEvent('subscriber-latest', { name: 'ana', amount: 7 }, F),
  { kind: 'resub', line: 'Subscribed for 7 months' }));
test('single gift shows the gifter', () => assert.partialDeepStrictEqual(w.describeEvent('subscriber-latest', { name: 'bob', gifted: true, sender: 'ana', amount: 1 }, F),
  { kind: 'gift', name: 'ana', line: 'Gifted a sub to bob', hold: 6000 }));
test('gift bomb', () => {
  assert.partialDeepStrictEqual(w.describeEvent('subscriber-latest', { bulkGifted: true, sender: 'ana', amount: 50 }, F),
    { kind: 'bomb', name: 'ana', line: 'Just gifted 50 subs', hold: 8000, count: 50 });
  assert.equal(w.describeEvent('subscriber-latest', { bulkGifted: true, sender: 'ana', amount: 5 }, F).hold, 6000);
});
test('gift bomb parts are dropped', () => assert.equal(w.describeEvent('subscriber-latest', { isCommunityGift: true, gifted: true, sender: 'ana', name: 'bob' }, F), null));
test('anonymous gifter', () => {
  assert.equal(w.describeEvent('subscriber-latest', { bulkGifted: true, sender: 'AnAnonymousGifter', amount: 5 }, F).name, 'Anonymous');
  assert.equal(w.describeEvent('subscriber-latest', { bulkGifted: true, amount: 5 }, F).name, 'Anonymous');
});
test('cheer as a string, big enough for foil', () => assert.partialDeepStrictEqual(w.describeEvent('cheer-latest', { name: 'ana', amount: '5000' }, F),
  { kind: 'bits', style: 'card', line: 'Cheered 5,000 bits', foil: true, hold: 8000 }));
test('small cheer', () => assert.partialDeepStrictEqual(w.describeEvent('cheer-latest', { name: 'ana', amount: 100 }, F), { foil: false, hold: 5000 }));
test('huge numbers keep separators', () => {
  assert.equal(w.describeEvent('cheer-latest', { name: 'ana', amount: 100000 }, F).line, 'Cheered 100,000 bits');
  assert.equal(w.describeEvent('raid-latest', { name: 'ana', amount: 1000 }, F).line, 'Raiding with 1,000 viewers');
});
test('raid', () => assert.partialDeepStrictEqual(w.describeEvent('raid-latest', { name: 'ana', amount: 42 }, F),
  { kind: 'raid', style: 'rift', line: 'Raiding with 42 viewers', viewers: 42, hold: 8000 }));
test('ignored', () => {
  assert.equal(w.describeEvent('tip-latest', { name: 'ana', amount: 5 }, F), null);
  assert.equal(w.describeEvent('follower-latest', {}, F), null);
  assert.equal(w.describeEvent('follower-latest', null, F), null);
});
test('effect scale', () => {
  assert.equal(w.effectScale('follow', 1), 1);
  assert.equal(w.effectScale('bits', 10), 1);
  assert.ok(Math.abs(w.effectScale('bits', 100) - 1.2) < 0.01);
  assert.ok(Math.abs(w.effectScale('bomb', 5) - 2.3) < 0.01);
  assert.equal(w.effectScale('bomb', 1000), 3.6);
  assert.ok(Math.abs(w.effectScale('raid', 42) - 2.62) < 0.01);
});

const f = (name) => w.describeEvent('follower-latest', { name }, F);
const s = (name) => w.describeEvent('subscriber-latest', { name, amount: 1 }, F);
test('takeNext merges every waiting follow', () => {
  const { alert, rest } = w.takeNext([f('a'), s('s'), f('b'), f('c')]);
  assert.partialDeepStrictEqual(alert, { kind: 'follow', name: 'a and 2 others', line: 'New followers', count: 3 });
  assert.deepEqual(rest.map((x) => x.name), ['s']);
});
test('takeNext singular and pair', () => {
  assert.equal(w.takeNext([f('a')]).alert.line, 'New follower');
  assert.equal(w.takeNext([f('a'), f('b')]).alert.name, 'a and 1 other');
});
test('takeNext keeps order across a mixed burst', () => {
  const raid = w.describeEvent('raid-latest', { name: 'r', amount: 9 }, F);
  let q = [raid, ...Array.from({ length: 20 }, (_, i) => f(`f${i}`)), s('s1'), s('s2')];
  const shown = [];
  while (q.length) { const next = w.takeNext(q); shown.push(next.alert.name); q = next.rest; }
  assert.deepEqual(shown, ['r', 'f0 and 19 others', 's1', 's2']);
});
test('takeNext on an empty queue', () => assert.deepEqual(w.takeNext([]), { alert: null, rest: [] }));

test('soundFor picks the kind sound, else the main one', () => {
  const fields = { alertSound: 'main.wav', subSound: 'sub.wav', raidSound: '' };
  assert.equal(w.soundFor('bomb', fields), 'sub.wav');
  assert.equal(w.soundFor('resub', fields), 'sub.wav');
  assert.equal(w.soundFor('raid', fields), 'main.wav');
  assert.equal(w.soundFor('follow', fields), 'main.wav');
  assert.equal(w.soundFor('bits', {}), '');
});
test('nextMuted uses the event when it says, else toggles', () => {
  assert.equal(w.nextMuted(false, { muted: true }), true);
  assert.equal(w.nextMuted(true, { muted: false }), false);
  assert.equal(w.nextMuted(false, {}), true);
  assert.equal(w.nextMuted(true, undefined), false);
});
