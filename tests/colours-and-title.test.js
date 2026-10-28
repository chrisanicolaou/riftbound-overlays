// Unit tests for the !colors and !title chat commands. Both widgets take !colors, so its tests run against each.
// Run: node --test tests/colours-and-title.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./load-widget');

const fields = { primary: 'fury', secondary: 'mind', barTitle: "Kai'Sa" };

for (const name of ['game-scene', 'alerts']) {
  const w = load(name);
  test(`${name}: !colors names two colours`, () => {
    assert.deepEqual(w.coloursCommand('!colors green yellow'), { primary: 'calm', secondary: 'order' });
    assert.deepEqual(w.coloursCommand('!colours Red BLUE'), { primary: 'fury', secondary: 'mind' });
    assert.deepEqual(w.coloursCommand('  !colors   orange   purple '), { primary: 'body', secondary: 'chaos' });
    assert.deepEqual(w.coloursCommand('!colors red red'), { primary: 'fury', secondary: 'fury' });
  });
  test(`${name}: !colors on its own goes back to the settings`, () =>
    assert.deepEqual(w.coloursCommand('!colors'), { primary: '', secondary: '' }));
  test(`${name}: anything else is ignored`, () => {
    for (const text of ['!colors red', '!colors red blue green', '!colors red bleu', '!colors fury mind',
      '!colors constructor toString', '!colorsred blue', '!win', 'colors red blue']) {
      assert.equal(w.coloursCommand(text), null, text);
    }
  });
  test(`${name}: saved colours win over the settings`, () => {
    assert.deepEqual(w.coloursToShow({ primary: 'calm', secondary: 'order' }, fields), { primary: 'calm', secondary: 'order' });
    assert.deepEqual(w.coloursToShow({ primary: '', secondary: '' }, fields), { primary: 'fury', secondary: 'mind' });
    assert.deepEqual(w.coloursToShow({ primary: 'green', secondary: 'x' }, fields), { primary: 'fury', secondary: 'mind' });
    assert.deepEqual(w.coloursToShow(null, fields), { primary: 'fury', secondary: 'mind' });
  });
  test(`${name}: only the broadcaster and mods can use commands`, () => {
    assert.ok(w.canControl({ badges: [{ type: 'broadcaster' }] }));
    assert.ok(w.canControl({ tags: { mod: '1' } }));
    assert.ok(!w.canControl({ badges: [{ type: 'subscriber' }], tags: { mod: '0' } }));
  });
}

const g = load('game-scene');
test('!title sets the bar title', () => {
  assert.equal(g.titleCommand("!title Kai'Sa coaching from willwin"), "Kai'Sa coaching from willwin");
  assert.equal(g.titleCommand('!TITLE  Renekton  '), 'Renekton');
  assert.equal(g.titleCommand(`!title ${'x'.repeat(80)}`), 'x'.repeat(60));
});
test('!title on its own goes back to the setting', () => assert.equal(g.titleCommand('!title'), ''));
test('other messages are not titles', () => {
  for (const text of ['!titles foo', '!win', 'title foo']) assert.equal(g.titleCommand(text), null, text);
});
test('a saved title wins over the setting', () => {
  assert.equal(g.titleToShow({ title: 'Renekton' }, fields), 'Renekton');
  assert.equal(g.titleToShow({ title: '' }, fields), "Kai'Sa");
  assert.equal(g.titleToShow(null, fields), "Kai'Sa");
  assert.equal(g.titleToShow({ title: 5 }, fields), "Kai'Sa");
});
