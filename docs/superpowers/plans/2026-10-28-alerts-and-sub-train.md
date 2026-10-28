# Alerts and Sub Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A StreamElements alerts widget (follows, subs, bits, raids) and a sub train tracker in the game-scene bar, built from the approved drafts.

**Architecture:** Each widget is one plain-JS StreamElements Custom Widget (html/css/js/fields files, pasted in by hand). The decision logic in each widget's `js.js` (which alert an event becomes, follow merging, train counting and timing) is plain top-level functions, unit-tested in Node by running the file in a `node:vm` sandbox. The rendering and effects are ported from the two draft pages and checked in the preview harness in the browser.

**Tech Stack:** Plain HTML/CSS/JS, StreamElements Custom Widget API, canvas 2D, Web Audio (sound tool only), Node 24 `node:test` for unit tests, the repo's `preview/` harness.

**Spec:** `docs/superpowers/specs/2026-10-28-alerts-and-sub-train-design.md`. Read it first; it holds every look, copy and timing decision. The visual source of truth is the two draft pages it names: `preview/alerts-draft.html` and `preview/subtrain-draft.html`.

## Global Constraints

- Work on a branch `alerts-and-sub-train`, never on `main`.
- Every widget's CSS tab starts with `@import url("https://cdn.jsdelivr.net/gh/chrisanicolaou/riftbound-overlays@main/riftbound-overlays.css");`
- Every widget has `primary` and `secondary` dropdowns (fury/body/order/calm/mind/chaos, default fury/mind), applied on its root as `data-primary="{{primary}}" data-secondary="{{secondary}}"`.
- No React. Widget backgrounds stay transparent.
- No `color-mix()`; mix colours in JS. `@property` is fine.
- Place by layout offsets (`offsetLeft`/`offsetTop`/`offsetWidth`), never `getBoundingClientRect`, and measure when an alert or train is shown, not at load.
- Copy is sentence case with no exclamation marks.
- The top level of each `js.js` holds only declarations and `window.addEventListener` calls, with no DOM access, so the unit tests can load it.
- Never commit personal files: `preview/avatar.png`, `preview/alert-sound.mp4`, `preview/game-sample.webp`, or any WAV. `preview/` and `CLAUDE.md` are untracked today. Edit them where a task says so, but don't commit them; that's the streamer's call.
- Check every widget with two deck pairs, Calm/Order and Fury/Mind.
- Preview: `python -m http.server 8765` in the repo root, then `http://localhost:8765/preview/?w=<widget>&...`. In the console, `sendEvent(listener, event)` fires `onEventReceived` and `sendChat(text, role)` sends chat.

## Review Focus

1. **Mixed bursts:** a raid, then 20 follows and 2 subs within seconds. Expect the raid first, then one merged follow strip, then each sub, in order and never overlapping. (Task 1 test `takeNext keeps order across a mixed burst`; Task 2 preview check.)
2. **Odd payloads:** a missing name, `amount` as a string (`"5000"`), an anonymous gifter, a missing tier. Expect no crash and sensible text. (Task 1 tests.)
3. **Cold start:** an event fired the moment the widget loads, before fonts or styles are in. Expect the strip still centred on its field position. (Task 2 preview check, which reloads and fires immediately.)
4. **Reload mid-train, or after it ended:** expect the train to resume, or to stay gone, with no ghost train. (Task 4 `restoreTrain` tests; Task 5 preview check.)
5. **Extremes:** a 25-character name, 100,000 bits, 1,000 viewers. Expect the strip to stay under 560px wide and clear of canvas x 1366. (Task 1 copy tests; Task 2 preview check.)

---

## File map

| File | Responsibility |
|---|---|
| `tests/load-widget.js` | Runs a widget's `js.js` in a `node:vm` sandbox and returns its top-level functions |
| `tests/alerts.test.js` | Unit tests for the alerts logic |
| `tests/game-scene-train.test.js` | Unit tests for the sub train logic |
| `widgets/alerts/{html.html,css.css,js.js,fields.json,obs-sources.json,README.md}` | The new alerts widget |
| `widgets/game-scene/{html.html,css.css,js.js,fields.json,README.md}` | Add the sub train to the existing widget |
| `tools/boost-sound.html` | Turns a quiet sound into a WAV normalised to -1 dBFS, for upload |
| `preview/index.html` | Harness: add an optional `&gameshot=<url>` (not committed) |
| `.gitignore` | Keep personal preview files and WAVs out of git |
| `CLAUDE.md` | Document the new widget and the train (not committed) |

Each widget carries its own small particle engine, copied from its draft. StreamElements widgets can't share JS without hosting another file on jsDelivr, and the two engines draw different things.

---

### Task 1: Test loader and alerts decision logic

**Files:**
- Create: `.gitignore`, `tests/load-widget.js`, `tests/alerts.test.js`, `widgets/alerts/js.js` (logic only for now)

**Interfaces:**
- Produces (top-level functions in `widgets/alerts/js.js`):
  - `describeEvent(listener: string, event: object, fields: object) -> Alert | null`
  - `effectScale(kind: string, n: number) -> number`
  - `takeNext(queue: Alert[]) -> { alert: Alert | null, rest: Alert[] }`
  - `Alert = { kind: 'follow'|'sub'|'resub'|'gift'|'bomb'|'bits'|'raid', style: 'rune'|'party'|'card'|'rift', name: string, line: string, hold: number /* ms */, scale: number, count: number, foil?: boolean, viewers?: number, emoji?: string[] }`
- Produces `tests/load-widget.js`: `loadWidget(name: string) -> sandbox`, whose properties are the widget's top-level functions, plus `sandbox.listeners[type]` for each `window.addEventListener`.

- [ ] **Step 1: Branch and ignore personal files**

```bash
git checkout -b alerts-and-sub-train
```

Create `.gitignore` with `preview/avatar.png`, `preview/alert-sound.*`, `preview/game-sample.webp`, `*.wav`.

- [ ] **Step 2: Write `tests/load-widget.js`**

```js
// Runs widgets/<name>/js.js in a sandbox and returns its top-level functions, for unit tests.
// Function declarations at the top of a script become properties of the vm context.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

module.exports = function loadWidget(name) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'widgets', name, 'js.js'), 'utf8');
  const listeners = {};
  const sandbox = { window: { addEventListener: (type, fn) => { listeners[type] = fn; } }, console, setTimeout, clearTimeout, setInterval, clearInterval };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: `widgets/${name}/js.js` });
  sandbox.listeners = listeners;
  return sandbox;
};
```

- [ ] **Step 3: Write the failing tests in `tests/alerts.test.js`**

Use `node:test` and `node:assert/strict`, with `const w = require('./load-widget')('alerts')` and `const F = { bitsFoil: 1000 }`. Compare with `assert.partialDeepStrictEqual` where only some fields matter (Node 24).

```js
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
```

- [ ] **Step 4: Run them and see them fail**

Run: `node --test tests/alerts.test.js`
Expected: FAIL (`widgets/alerts/js.js` doesn't exist yet).

- [ ] **Step 5: Implement the three functions in `widgets/alerts/js.js`**

Start the file with a header comment in game-scene's style. Values from the spec:

- **Holds:** follow 4000; bits 5000, or 8000 when foil; sub/resub/gift 6000; bomb 6000, or 8000 at 10+; raid 8000.
- **Foil:** `Number(amount) >= (Number(fields.bitsFoil) || 1000)`.
- **Styles:** follow → `rune`; sub, resub, gift, bomb → `party`; bits → `card`; raid → `rift`.
- **Emoji:** sub `['⭐', '🎉', '💜']`, resub `['🎂', '⭐', '🎉']`, gift `['🎁', '🎉', '💜']`, bomb `['🎁', '🎉', '💥', '💜']`.
- **Subscriber events, checked in this order:**
  1. `isCommunityGift` → `null`.
  2. `bulkGifted` → bomb.
  3. `gifted` → single gift.
  4. `amount > 1` → resub.
  5. Otherwise a first sub. Tier: `'1000'|'2000'|'3000'` → "Just subscribed at tier N", `'prime'` → "Subscribed with Prime", anything else → "Just subscribed".
- **Gifter name:** `sender`, or "Anonymous" when it's missing or `AnAnonymousGifter`.
- **Numbers:** `Number(x).toLocaleString('en-US')`.
- **`effectScale`:** clamp of
  - follow `1 + log10(n)` in [1, 3.6];
  - sub/resub/gift: 1.6;
  - bomb `1.6 + log10(n)` in [1.6, 3.6];
  - bits `log10(n) - 0.8` in [1, 3.6];
  - raid `1 + log10(n)` in [2, 3.6].
- **`takeNext`:** a pure function. If `queue[0]` is a follow, fold every follow in the queue into one alert:
  - The first follow's name, plus " and N other(s)", and `line` "New followers" when there's more than one.
  - Its `count` is the total, and `scale` is `effectScale('follow', count)`.
  - Everything else stays in order.

  Otherwise it returns `queue[0]` and the rest.

- [ ] **Step 6: Run the tests and see them pass**

Run: `node --test tests/alerts.test.js`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add .gitignore tests/load-widget.js tests/alerts.test.js widgets/alerts/js.js docs/superpowers
git commit -m "alerts: event-to-alert logic, follow merging, and unit tests"
```

---

### Task 2: Alerts widget on screen (four styles, queue, effects)

**Files:**
- Create: `widgets/alerts/html.html`, `widgets/alerts/css.css`, `widgets/alerts/fields.json`, `widgets/alerts/obs-sources.json`
- Modify: `widgets/alerts/js.js` (add rendering below the logic), `preview/index.html` (gameshot; don't commit)

**Interfaces:**
- Consumes: `describeEvent`, `takeNext`, and `Alert` from Task 1.
- Produces (in `js.js`): `showAlert(alert: Alert) -> void`, `leaveAlert() -> void` (Task 3's skip uses it), `runQueue() -> void`, and a hook `onAlertShown(alert)` that Task 3 fills with the sound. For now it's an empty function.

- [ ] **Step 1: `fields.json`**

Groups and defaults from the spec:

- **Deck:** `primary` and `secondary` dropdowns, copied from game-scene.
- **Look:**
  - `avatar` (`image-input`, `""`, "Stream picture (shown in the badge)").
  - `bitsFoil` (`number`, 1000, min 100, step 100).
- **Position:**
  - `centreX` (number, 1044) and `top` (number, 44).
  - `raidGlow` (checkbox, true).
  - `glowX` 432, `glowY` 48, `glowW` 1440, `glowH` 810.

Sound fields come in Task 3.

- [ ] **Step 2: `html.html`**

A root `.alerts` with `data-primary="{{primary}}" data-secondary="{{secondary}}"`, containing in this order:
- `#pulse.game-pulse`
- `canvas#fx-back` (1920×1080)
- `#alert.alert[hidden]`
- `canvas#fx-front` (1920×1080)

- [ ] **Step 3: `css.css`**

- Line 1 is the stylesheet import. Line 2: `@import url("https://fonts.googleapis.com/css2?family=Lilita+One&display=swap");`
- `.alerts` is absolute at 0,0, 1920×1080, with `pointer-events: none`. The canvases are absolute at inset 0.
- Port the draft's CSS blocks from `preview/alerts-draft.html`:
  - "Shared strip" (minus the fixed `top`, which comes from JS).
  - Rune burst, Card pull, Poro party.
  - "Raids" (`.game-pulse`, `@property --rift-angle`, the Rift block).
- Rename `.style-raid-rift` to `.style-rift`.
- Add `.alert__badge--empty .alert__avatar { background: linear-gradient(135deg, var(--primary-500), var(--secondary-500)); }`.
- Drop everything under `#controls`, `#stage`, `#scene` and `#overlay`.

- [ ] **Step 4: Rendering in `js.js`**

**Port from the draft** (it's already offset-based):
- The particle engine: `DRAW` with spark, ring, flash, glint, emoji, confetti, slit and shard.
- Helpers: `star`, `sparks`, `shards`, `perimeter`, `countUp`, `posIn`, `fitName`.
- The four `BURSTS`, keyed by style: `rune`, `party`, `card`, `rift`.

**Changes from the draft:**
- Bursts read `alert.scale`, `alert.emoji`, `alert.foil` and `alert.viewers` instead of the draft's `EVENTS` table.
- Drop `fx.speed`, `setSpeed`, URL state and `playSound`.
- The frame loop requests its next frame first.

**Behaviour:**
- `onWidgetLoad` saves the fields and places `#pulse` from the glow fields. The first `showAlert` waits for `document.fonts.ready`.
- `onEventReceived`: `const a = describeEvent(listener, event, fields); if (a) { queue.push(a); runQueue(); }`.
- **`runQueue`:** does nothing while an alert is up. Otherwise it calls `takeNext`. After `alert.hold` it calls `leaveAlert()`, which adds `is-leaving` and hides the strip 460ms later. 300ms after that, it calls `runQueue()` again.
- **`showAlert`** builds the draft's strip markup:
  - Badge: an `<img>` when `fields.avatar` is set, otherwise the `alert__badge--empty` class.
  - Name: text-escaped.
  - Then `fitName`, centring with `left = centreX - (offsetWidth - max(0, -badge.offsetLeft)) / 2`, `top` from the field, and locking the width.
  - It restarts the pulse when `alert.style === 'rift' && fields.raidGlow`, runs the burst and the raid count-up, and calls `onAlertShown(alert)`.

- [ ] **Step 5: `obs-sources.json` and the harness**

`obs-sources.json` lists the game capture stand-in only:

```json
[{ "name": "Game capture", "kind": "game", "layer": "below", "x": 432, "y": 48, "width": 1440, "height": 810 }]
```

In `preview/index.html` `addSource`, when `kind === 'game'` and `q.get('gameshot')` is set, give the stand-in that image as its background (`center / 100% 100%`) instead of the label.

- [ ] **Step 6: Check in the browser**

Open `http://localhost:8765/preview/?w=alerts&primary=calm&secondary=order&avatar=avatar.png&gameshot=game-sample.webp`.

1. Fire each event type in turn and compare each with the draft (event → style, line, look, exit):
   - `sendEvent('follower-latest', {name:'runeweaver_ana'})`
   - a sub with a tier, a resub with `amount: 7`, a single gift, and a `bulkGifted` gift bomb with `amount: 50`
   - `sendEvent('cheer-latest', {name:'x', amount:100})` and `amount: 5000`
   - `sendEvent('raid-latest', {name:'x', amount:42})`
2. Check the placement in the console: the strip's visual centre, `offsetLeft + (offsetWidth - 24) / 2`, is 1044 ±2, and `offsetTop` is 44.
3. Fire a raid, then 20 follows in a loop, then 2 subs. Expect the raid, then one "f0 and 19 others" strip, then the two subs, never two at once.
4. Fire a cheer with name `TheVeryLongTwitchName_25` and `amount: 100000`. Expect `offsetWidth <= 560` and the right edge at or below 1366.
5. Reload, and fire a follow in the same console line as the reload completes. Expect the strip still centred.
6. Load without `&avatar=`. Expect a deck-gradient circle in the badge.
7. Repeat steps 1 and 2 with `primary=fury&secondary=mind`.

Take a screenshot of each style.

- [ ] **Step 7: Run the unit tests again**

Run: `node --test tests/alerts.test.js`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add widgets/alerts
git commit -m "alerts: widget with rune, party, card and rift strips, queue and effects"
```

---

### Task 3: Alert sound, mute and skip, sound booster, README

**Files:**
- Create: `tools/boost-sound.html`, `widgets/alerts/README.md`
- Modify: `widgets/alerts/js.js`, `widgets/alerts/fields.json`, `tests/alerts.test.js`

**Interfaces:**
- Consumes: `onAlertShown(alert)` and `leaveAlert()` from Task 2.
- Produces:
  - `soundFor(kind: string, fields: object) -> string` (a URL or `''`).
  - `nextMuted(current: boolean, event: object) -> boolean`.

- [ ] **Step 1: Failing tests (append to `tests/alerts.test.js`)**

```js
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
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/alerts.test.js`
Expected: the two new tests FAIL (not defined).

- [ ] **Step 3: Implement**

- **Kinds to sound fields:** follow → `followSound`; sub, resub, gift, bomb → `subSound`; bits → `bitsSound`; raid → `raidSound`. A blank or missing field falls back to `alertSound`.
- **`onAlertShown`:** unless muted, plays `new Audio(url)` with `volume = clamp(fields.volume / 100, 0, 1)`.
- **Listeners:**
  - `event:skip` → `leaveAlert()` when an alert is up.
  - `alertService:toggleSound` → `muted = nextMuted(muted, event)`.

  While previewing, log both payloads once (`console.log`) so the real shape can be compared later, then remove the log before committing.
- **Fields (group Sound):** `alertSound`, `followSound`, `subSound`, `bitsSound`, `raidSound` (`sound-input`, `""`); `volume` (slider, 0–100, step 5, value 80).

- [ ] **Step 4: Run the tests and see them pass**

Run: `node --test tests/alerts.test.js`
Expected: all pass.

- [ ] **Step 5: `tools/boost-sound.html`**

A page in the style of `tools/shatter.html`:
- It takes a file input (or `?src=<url>` for testing) and decodes it with `AudioContext.decodeAudioData`.
- It shows the peak in dBFS, scales the sound so the peak is −1 dBFS (gain `0.891 / peak`), and encodes 16-bit PCM WAV with the original channels and sample rate.
- It offers a download named `<original name> (boosted).wav`.
- Functions: `peakOf(buffer: AudioBuffer) -> number` and `encodeWav(buffer: AudioBuffer, gain: number) -> ArrayBuffer`.

- [ ] **Step 6: Check the booster and the sound in the browser**

1. Open `http://localhost:8765/tools/boost-sound.html?src=../preview/alert-sound.mp4`. In the console, check:
   - the original peak shows about −23 dBFS;
   - `peakOf` of the decoded output is about 0.891;
   - the WAV starts with `RIFF` and contains `WAVE`;
   - its length is about 2.2s.
2. Open the alerts preview with `&alertSound=alert-sound.mp4&volume=80`, click the page once (browsers block sound before a click), and fire a follow. Expect the sound to play once per alert.
3. `sendEvent('alertService:toggleSound', {})`, then fire an event. Expect silence.
4. During a raid's 8s hold, `sendEvent('event:skip', {})`. Expect the strip to leave at once and the next alert to follow.

- [ ] **Step 7: `widgets/alerts/README.md`**

Follow `widgets/game-scene/README.md`'s shape:
- **What it does:** each event and its style.
- **StreamElements:**
  - Add a Custom Widget to the game-scene overlay, at 0,0, 1920×1080, on top of the layout widget.
  - Paste in the four files, then set the deck, avatar and sounds.
  - Use `tools/boost-sound.html` to make the quiet sound loud enough before uploading it.
- **OBS:** tick "Control audio via OBS" on the overlay's Browser Source.
- **Fields:** a table.
- **Testing:** the editor's emulate buttons, and the preview URL.

- [ ] **Step 8: Commit**

```bash
git add widgets/alerts tests/alerts.test.js tools/boost-sound.html
git commit -m "alerts: sound with per-kind overrides, mute and skip, sound booster, README"
```

---

### Task 4: Sub train logic

**Files:**
- Modify: `widgets/game-scene/js.js` (add a "Sub train" logic section)
- Create: `tests/game-scene-train.test.js`

**Interfaces:**
- Produces (top-level functions):
  - `trainSubs(listener: string, event: object) -> number`
  - `trainName(event: object) -> string`
  - `trainLevel(count: number, every: number) -> number`
  - `trainHype(level: number) -> number` (0..1, peak at level 5)
  - `trainAdd(train: Train|null, n: number, name: string, nowMs: number, cfg: Cfg) -> { train: Train, levelUp: boolean, started: boolean }`
  - `trainPhase(train: Train|null, nowMs: number, cfg: Cfg) -> 'off'|'live'|'over'`
  - `restoreTrain(saved: any, nowMs: number) -> Train|null`
  - `Train = { count: number, latest: string, endsAt: number /* epoch ms */ }`
  - `Cfg = { seconds: number, every: number, showFrom: number }`
  - "Over" lasts 5000ms (`TRAIN_OVER_MS`).

- [ ] **Step 1: Failing tests in `tests/game-scene-train.test.js`**

```js
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
```

(Plus the `node:test` / `node:assert/strict` requires at the top.)

- [ ] **Step 2: Run and see them fail**

Run: `node --test tests/game-scene-train.test.js`
Expected: FAIL (`trainSubs` is not a function).

- [ ] **Step 3: Implement the functions in `widgets/game-scene/js.js`**

Add the train lines to the header comment.
- **`trainAdd`:** if `train` is null or `nowMs >= train.endsAt` (ended, including "Train over"), it starts fresh. Otherwise it adds to the count.
  - `endsAt = nowMs + seconds * 1000`.
  - `levelUp = before >= showFrom && trainLevel(after) > trainLevel(before)`, and only when continuing a train.
- **`trainPhase`:**
  - `'off'` if there's no train, `count < showFrom`, or `nowMs >= endsAt + TRAIN_OVER_MS`.
  - `'over'` if `nowMs >= endsAt`.
  - Otherwise `'live'`.

- [ ] **Step 4: Run all tests and see them pass**

Run: `node --test tests/game-scene-train.test.js tests/alerts.test.js`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add widgets/game-scene/js.js tests/game-scene-train.test.js
git commit -m "game-scene: sub train counting, levels and timing, with unit tests"
```

---

### Task 5: Sub train in the bar

**Files:**
- Modify: `widgets/game-scene/html.html`, `css.css`, `js.js`, `fields.json`, `README.md`

**Interfaces:**
- Consumes: everything from Task 4.
- Produces: `renderTrain(nowMs: number) -> void` (called every frame and every 250ms), `addToTrain(n: number, name: string) -> void`. Store key: `rbSubTrain`.

- [ ] **Step 1: `fields.json`**

Add a "Sub train" group:
- `showTrain` (checkbox, true)
- `trainSeconds` (number, 120, min 15, max 600, step 5)
- `trainShowFrom` (number, 2, min 1, max 10)
- `trainLevelEvery` (number, 5, min 2, max 20)

- [ ] **Step 2: Markup in `html.html`**

Inside `#ticker`, after `#ticker-item`, add:
- `canvas#train-lines.train__lines`
- `div#train.train[hidden]`, with the draft's inner markup: count, label row with the level pill, track (progress/grad, ticks, then loco), timer, and the latest/time row.

As the last child of `.scene`, add `canvas#train-fx` (1920×1080).

- [ ] **Step 3: `css.css`**

- `.bar__ticker` gets `align-self: stretch; display: flex; align-items: center;`, so the section spans the bar's height. Keep its existing flex sizing.
- `#train-fx`: absolute at inset 0, `pointer-events: none`.
- `.train__lines`: absolute, with `left: var(--space-6)` (after the hairline divider), and `top: 0; right: 0; bottom: 0`.
- Port the draft's train CSS from `preview/subtrain-draft.html`, everything from `.train` through `level-flash`, minus `top`, `height` and `position`. Here `.train` is `position: relative; z-index: 1; flex: 1; display: flex;`.
- `.train-on #ticker-item { display: none; }`.

- [ ] **Step 4: Behaviour in `js.js`**

- **`onWidgetLoad`:**
  - `train = restoreTrain(await SE_API.store.get('rbSubTrain'), Date.now())`, inside try/catch like `loadState`.
  - Start a frame loop that requests its next frame first, plus `setInterval(() => renderTrain(Date.now()), 250)`.
- **`onEventReceived`:** for `subscriber-latest` with `fields.showTrain !== false`, take `n = trainSubs(...)`; if `n`, call `addToTrain(n, trainName(event))`. The ticker's existing "latest sub" handling stays.
- **`addToTrain`:**
  - Calls `trainAdd` with the fields as `Cfg`, then saves to `rbSubTrain`.
  - Then: the count punch, the level-up sequence (track to 100%, after 700ms snap to 0 with transitions off, then grow to the remainder), the level pill flash, and the bursts. Port `burst` and `setProgress`, positioning with `posIn(node, root)` copied from the alerts draft (offsets up to `.scene`) instead of the draft's `boxOf`.
- **`renderTrain`:**
  - Phase `off`: hide the train and remove `train-on`. If the train was showing, call `startTicker()` to resume.
  - Otherwise: show the train, add `train-on` to `.scene`, stop the ticker interval, set the texts ("Sub train"/"Train over", latest or "N subs", m:ss), the timer width, the `is-low` class (10s or less), `--hype` (`trainHype(level)`, 0 when over) and the gradient width (the track's `offsetWidth`).
- **The ticker:** `startTicker` and `advanceTicker` do nothing while the train shows, so a new follower or sub doesn't bring the ticker back mid-train. `advanceTicker` hides `#ticker` only when there are no ticker items and no train.
- **Full steam:** port `emit` and the `puff`/`line`/`spark`/`ring`/`flash` drawing.
  - Speed lines draw on `#train-lines`. Size the canvas to its own `offsetWidth`/`offsetHeight` when shown.
  - Puffs and bursts draw on `#train-fx`.
  - Emit only in phase `live`.

- [ ] **Step 5: Check in the browser**

Open `http://localhost:8765/preview/?w=game-scene&primary=calm&secondary=order&trainSeconds=15`.

1. `sendEvent('subscriber-latest', {name:'a', amount:1})`. Expect no train yet.
2. A second sub. Expect the train in the ticker's slot with ×2, Level 1, the track at 40%, and the ticker gone.
3. Three more subs. Expect the level-up at 5: the track runs to the end, bursts, and restarts empty; the pill flashes.
4. A `bulkGifted` event with `amount: 50`. Expect +50, Level 12, the track carrying the remainder, and full steam (speed lines, steady puffs, fast rattle).
5. Wait 15s. Expect blinking in the last 10s, then "Train over / 56 subs" for 5s, then the ticker back.
6. Start a train, reload the page mid-train, and expect it to resume with the right time left. Let it end, reload, and expect no train.
7. `sendChat('!vs Renekton')` while a train runs. Expect the train to still fit its narrower section.
8. During a train, `sendEvent('follower-latest', {name:'x'})`. Expect the ticker to stay hidden.
9. Repeat with `primary=fury&secondary=mind`.

Take screenshots of a live train at level 1 and at level 5.

- [ ] **Step 6: Run all tests**

Run: `node --test tests/game-scene-train.test.js tests/alerts.test.js`
Expected: all pass.

- [ ] **Step 7: README**

In `widgets/game-scene/README.md`:
- Add a "Sub train" section: what counts, levels, the timer, "Train over", surviving reloads, and full steam.
- Add the four fields.
- Note that the ticker pauses during a train.

- [ ] **Step 8: Commit**

```bash
git add widgets/game-scene
git commit -m "game-scene: sub train in the bar with level track and full steam"
```

---

### Task 6: Docs and sign-off

**Files:**
- Modify: `CLAUDE.md` (don't commit)
- Delete after the streamer approves: `preview/alerts-draft.html`, `preview/subtrain-draft.html`

- [ ] **Step 1: Update `CLAUDE.md`**

- Under "Widgets in this repo", add `widgets/alerts` (what it shows and where) and the sub train in game-scene.
- Note that the alerts and train deliberately depart from the design system (Lilita One, sticker borders, gold, emoji, loops while up).
- Add `tests/` (`node --test tests/*.test.js`) and `tools/boost-sound.html`.
- Under "Open items", remove "Alerts (follows, subs, raids) aren't built yet".
- In the design system notes, correct the game UI: the player's point track is bottom-left and the opponent's top-right beside the log column.

- [ ] **Step 2: Final check**

Run `node --test tests/alerts.test.js tests/game-scene-train.test.js`; expected all pass. Then open both previews with Calm/Order and Fury/Mind and fire one of each event.

- [ ] **Step 3: Hand over to the streamer**

Share screenshots and the paste-in steps from both READMEs. Ask them to try it in StreamElements and OBS, including the emulator's tier and mute payloads. Once they approve, delete the two draft pages. Those were never committed, so it's a plain delete.
