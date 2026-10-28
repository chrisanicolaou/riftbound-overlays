// Game scene: cuts the backdrop's see-through holes, fills the bar (title, current opponent, ticker) and keeps the stream's W/L record.
// Chat commands, from the broadcaster or a moderator:
//   !win  !loss  !undo  !reset        record
//   !vs Renekton                      current opponent (!vs alone clears it)
//   !colors red blue                  the deck's colours, here and in the alerts widget (alone: back to the settings)
//   !title Kai'Sa                     the bar title (alone: back to the setting)
// The record and opponent are saved in the StreamElements store, so they survive reloads.
// They start fresh once nothing has changed for `resetHours`. Colours and title are saved too, and stay until the next
// command.
// Sub train: every sub, resub and gift sub (a gift bomb counts all its subs) adds to a train that takes the ticker's
// place in the bar from its `trainShowFrom`th sub. Each sub refills its `trainSeconds` timer; every `trainLevelEvery`
// subs is a level, and the train picks up speed up to level 5. When the timer runs out it shows "Train over" for
// 5 seconds and the ticker comes back. The train is saved in the store too, so a reload mid-train keeps it.

const STORE_KEY = 'rbGameScene';
const COLOURS_KEY = 'rbColours'; // shared with the alerts widget
const TITLE_KEY = 'rbTitle';
const COLOURS = { red: 'fury', orange: 'body', yellow: 'order', green: 'calm', blue: 'mind', purple: 'chaos' };
const LATEST = { 'follower-latest': 'follower', 'subscriber-latest': 'sub', 'raid-latest': 'raid' };
const LATEST_LABELS = { follower: 'Latest follower', sub: 'Latest sub', raid: 'Latest raid' };

let fields = {};
let state = { results: [], vs: '', updated: 0 };
let savedColours = null; // what the last !colors saved
let savedTitle = null; // what the last !title saved
const latest = { follower: '', sub: '', raid: '' };
const seenMessages = [];
let tickerIndex = -1;
let tickerTimer = null;

function setText(id, value) {
  const text = (value || '').trim();
  document.getElementById(id).textContent = text;
  document.getElementById(id).hidden = !text;
}

// Masks `target` so it is transparent over each of `els` (same box, same corner radius).
// Uses layout offsets rather than getBoundingClientRect so the StreamElements editor's preview scaling doesn't skew it.
function maskOut(target, els) {
  const w = target.offsetWidth;
  const h = target.offsetHeight;
  const holes = [...els].map((el) => {
    const r = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return `<rect x='${el.offsetLeft}' y='${el.offsetTop}' width='${el.offsetWidth}' height='${el.offsetHeight}' rx='${r}' fill='black'/>`;
  }).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'>` +
    `<mask id='m'><rect width='${w}' height='${h}' fill='white'/>${holes}</mask>` +
    `<rect width='${w}' height='${h}' mask='url(#m)'/></svg>`;
  const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
  target.style.webkitMaskImage = url;
  target.style.maskImage = url;
}

// The backdrop is see-through wherever a [data-hole] frame sits, and its shards stay out from behind
// [data-no-shards] panels, so those only blur the plain ground.
function cutHoles() {
  maskOut(document.getElementById('backdrop'), document.querySelectorAll('[data-hole]'));
  maskOut(document.getElementById('shards'), document.querySelectorAll('[data-no-shards]'));
}

// Cuts the holes now and again whenever one of those boxes changes size. On a cold OBS start, onWidgetLoad
// can fire before the stylesheet is applied, when the backdrop is 0px tall and its mask would hide all of it.
function watchHoles() {
  cutHoles();
  const observer = new ResizeObserver(() => cutHoles());
  document.querySelectorAll('#backdrop, #shards, [data-hole], [data-no-shards]').forEach((el) => observer.observe(el));
}

// Long titles drop from the 44px title size to the 32px heading size before they get cut off.
function fitTitle() {
  const el = document.getElementById('bar-title');
  el.classList.replace('heading', 'title');
  if (el.scrollWidth > el.clientWidth) el.classList.replace('title', 'heading');
}

// -- Current opponent and record ------------------------------------------

function renderVs() {
  document.getElementById('vs').hidden = !state.vs;
  document.getElementById('vs-name').textContent = state.vs;
}

function renderRecord() {
  document.getElementById('wins').textContent = state.results.filter((r) => r === 'W').length;
  document.getElementById('losses').textContent = state.results.filter((r) => r === 'L').length;
}

function freshIfStale() {
  const maxAge = (Number(fields.resetHours) || 6) * 3600 * 1000;
  if (Date.now() - (state.updated || 0) > maxAge) state = { results: [], vs: '', updated: 0 };
}

async function loadState() {
  try {
    const saved = window.SE_API && await SE_API.store.get(STORE_KEY);
    if (saved && Array.isArray(saved.results)) {
      state = { results: saved.results.filter((r) => r === 'W' || r === 'L'), vs: typeof saved.vs === 'string' ? saved.vs : '', updated: saved.updated || 0 };
    }
  } catch (e) { /* no saved record yet */ }
  freshIfStale();
}

function saveState() {
  state.updated = Date.now();
  if (window.SE_API) SE_API.store.set(STORE_KEY, state);
}

function canControl(data) {
  const types = (data.badges || []).map((b) => b.type);
  const tags = data.tags || {};
  const yt = data.authorDetails || {};
  return types.includes('broadcaster') || types.includes('moderator') || tags.mod === '1' ||
    /(^|,)broadcaster\//.test(tags.badges || '') || yt.isChatOwner || yt.isChatModerator;
}

// -- Colours and title ----------------------------------------------------

// What "!colors red blue" (or !colours) asks for: the two domains, both '' to go back to the widget's settings (the
// command on its own), or null if it isn't a colours command with two known colours.
function coloursCommand(text) {
  const [command, ...words] = text.trim().toLowerCase().split(/\s+/);
  if (command !== '!colors' && command !== '!colours') return null;
  if (!words.length) return { primary: '', secondary: '' };
  if (words.length !== 2 || !words.every((w) => Object.hasOwn(COLOURS, w))) return null;
  return { primary: COLOURS[words[0]], secondary: COLOURS[words[1]] };
}

// The colours the last !colors saved, or the widget's settings when it saved none.
function coloursToShow(saved, fields) {
  const domains = Object.values(COLOURS);
  if (saved && domains.includes(saved.primary) && domains.includes(saved.secondary)) return { primary: saved.primary, secondary: saved.secondary };
  return { primary: fields.primary, secondary: fields.secondary };
}

// What "!title ..." asks for: the new bar title, '' to go back to the widget's setting, or null if it isn't !title.
function titleCommand(text) {
  const trimmed = text.trim();
  const command = trimmed.split(/\s+/)[0].toLowerCase();
  return command === '!title' ? trimmed.slice(command.length).trim().slice(0, 60) : null;
}

function titleToShow(saved, fields) {
  return saved && typeof saved.title === 'string' && saved.title ? saved.title : fields.barTitle || '';
}

function renderLook() {
  Object.assign(scene().dataset, coloursToShow(savedColours, fields));
  setText('bar-title', titleToShow(savedTitle, fields));
  fitTitle();
}

async function loadLook() {
  try {
    savedColours = window.SE_API && await SE_API.store.get(COLOURS_KEY);
    savedTitle = window.SE_API && await SE_API.store.get(TITLE_KEY);
  } catch (e) { /* nothing saved yet */ }
}

// -- Chat commands ----------------------------------------------------------

function onChat(data) {
  if (!data || typeof data.text !== 'string' || data.text[0] !== '!') return;
  if (data.msgId) {
    if (seenMessages.includes(data.msgId)) return;
    seenMessages.push(data.msgId);
    if (seenMessages.length > 50) seenMessages.shift();
  }
  if (!canControl(data)) return;
  const text = data.text.trim();
  const colours = coloursCommand(text);
  const title = titleCommand(text);
  if (colours || title !== null) {
    if (colours) savedColours = colours;
    else savedTitle = { title };
    if (window.SE_API) SE_API.store.set(colours ? COLOURS_KEY : TITLE_KEY, colours || savedTitle);
    renderLook();
    return;
  }
  const command = text.split(/\s+/)[0].toLowerCase();
  if (!['!win', '!loss', '!undo', '!reset', '!vs'].includes(command)) return;
  freshIfStale();
  if (command === '!win') state.results.push('W');
  else if (command === '!loss') state.results.push('L');
  else if (command === '!undo') state.results.pop();
  else if (command === '!reset') state.results = [];
  else state.vs = text.slice(command.length).trim().slice(0, 40);
  saveState();
  renderRecord();
  renderVs();
}

// -- Ticker -------------------------------------------------------------

function tickerItems() {
  const items = (fields.tickerLines || '').split('|').map((line) => {
    const text = line.trim();
    const colon = text.indexOf(':');
    if (!text) return null;
    return colon > 0 ? { label: text.slice(0, colon).trim(), text: text.slice(colon + 1).trim() } : { label: '', text };
  }).filter(Boolean);
  if (fields.showLatest !== false) {
    Object.keys(latest).filter((key) => latest[key]).forEach((key) => items.push({ key, label: LATEST_LABELS[key], text: latest[key] }));
  }
  return items;
}

function showTickerItem(item) {
  const el = document.createElement('div');
  el.className = 'ticker__item';
  el.id = 'ticker-item';
  if (item.label) {
    const label = document.createElement('p');
    label.className = 'rb-eyebrow';
    label.textContent = item.label;
    el.append(label);
  }
  const text = document.createElement('p');
  text.className = 'body ticker__text';
  text.textContent = item.text;
  el.append(text);
  document.getElementById('ticker-item').replaceWith(el);
}

function advanceTicker(jumpTo) {
  const items = tickerItems();
  document.getElementById('ticker').hidden = !items.length && !trainShowing;
  if (!items.length) return;
  const jump = jumpTo ? items.findIndex((item) => item.key === jumpTo) : -1;
  tickerIndex = jump >= 0 ? jump : (tickerIndex + 1) % items.length;
  showTickerItem(items[tickerIndex]);
}

// Shows the next line now (or the line for `jumpTo`), then rotates. Paused while the sub train shows.
function startTicker(jumpTo) {
  clearInterval(tickerTimer);
  if (trainShowing) return;
  advanceTicker(jumpTo);
  if (tickerItems().length > 1) {
    tickerTimer = setInterval(() => advanceTicker(), Math.max(5, Number(fields.tickerSeconds) || 20) * 1000);
  }
}

function latestText(listener, event) {
  if (!event || !event.name) return '';
  return listener === 'raid-latest' && event.amount ? `${event.name} (${event.amount})` : event.name;
}

// -- Sub train: decisions (pure, unit-tested in tests/game-scene-train.test.js) --------

const TRAIN_OVER_MS = 5000; // how long "Train over" stays up
const TRAIN_PEAK_LEVEL = 5; // full speed from this level up

// The train's total for "Train over": "1 sub", "12 subs".
function subsText(n) {
  return `${n} sub${n === 1 ? '' : 's'}`;
}

// How many subs an event adds to the train. A gift bomb counts once, from its first event; the gifts that follow don't.
function trainSubs(listener, event) {
  if (listener !== 'subscriber-latest' || !event || event.isCommunityGift) return 0;
  if (event.bulkGifted) return Math.max(0, Math.floor(Number(event.amount) || 0));
  return 1;
}

// Who a sub is credited to: the gifter for gifts, else the subscriber.
function trainName(event) {
  if (!event.gifted && !event.bulkGifted) return (event.name || '').trim();
  const sender = (event.sender || '').trim();
  return !sender || sender.toLowerCase() === 'ananonymousgifter' ? 'Anonymous' : sender;
}

function trainLevel(count, every) {
  return Math.floor(count / every) + 1;
}

// How hyped the train is, 0 at level 1 to 1 at the peak level and beyond.
function trainHype(level) {
  return Math.min(level - 1, TRAIN_PEAK_LEVEL - 1) / (TRAIN_PEAK_LEVEL - 1);
}

// Adds `n` subs at `nowMs`. A train that has run out (including one showing "Train over") is replaced by a new one.
function trainAdd(train, n, name, nowMs, cfg) {
  const continuing = !!train && nowMs < train.endsAt;
  const before = continuing ? train.count : 0;
  const count = before + n;
  const levelUp = continuing && before >= cfg.showFrom && trainLevel(count, cfg.every) > trainLevel(before, cfg.every);
  return { train: { count, latest: name, endsAt: nowMs + cfg.seconds * 1000 }, levelUp, started: !continuing };
}

function trainPhase(train, nowMs, cfg) {
  if (!train || train.count < cfg.showFrom || nowMs >= train.endsAt + TRAIN_OVER_MS) return 'off';
  return nowMs >= train.endsAt ? 'over' : 'live';
}

// A train saved before a reload, if it's well formed and still running.
function restoreTrain(saved, nowMs) {
  if (!saved || !Number.isFinite(saved.count) || typeof saved.latest !== 'string' || !Number.isFinite(saved.endsAt)) return null;
  return nowMs < saved.endsAt ? { count: saved.count, latest: saved.latest, endsAt: saved.endsAt } : null;
}

// -- Sub train: on screen -------------------------------------------------

const TRAIN_KEY = 'rbSubTrain';
const TRAIN_LOW_MS = 10000; // the timer blinks for the last 10 seconds

let train = null;
let trainShowing = false;
let trainLive = false;
let trainProgressTimer = null;
let trainCtxs = null;
let trainLast = 0;
const trainParts = [];
const trainAcc = { line: 0, puff: 0 };

function fieldNumber(value, fallback, min) {
  const n = Number(value);
  return value !== '' && value != null && Number.isFinite(n) ? Math.max(min, n) : fallback;
}

function trainCfg() {
  return { seconds: fieldNumber(fields.trainSeconds, 120, 5), every: fieldNumber(fields.trainLevelEvery, 5, 1), showFrom: fieldNumber(fields.trainShowFrom, 2, 1) };
}

const trainPart = (sel) => document.getElementById('train').querySelector(sel);
const scene = () => document.querySelector('.scene');

// Position of an element inside `root`, from layout offsets (unaffected by transforms or the StreamElements editor's scaling).
function posIn(node, root) {
  let x = 0, y = 0;
  for (let n = node; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
  return { x, y };
}

function deckColours() {
  const cs = getComputedStyle(scene());
  const col = (v) => cs.getPropertyValue(v).trim();
  return { p3: col('--primary-300'), p5: col('--primary-500'), s3: col('--secondary-300'), s5: col('--secondary-500') };
}
const hexRgb = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace('#', '').slice(i, i + 2), 16));
const mixColour = (a, b, t) => { const A = hexRgb(a), B = hexRgb(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(', ')})`; };

function setTrainText(sel, text) {
  const n = trainPart(sel);
  if (n.textContent !== text) n.textContent = text;
}

// The level track: fills toward the next level. On a level-up it runs to the end, then starts the next level from empty.
function setTrack(frac) {
  const prog = trainPart('.train__progress');
  const c = deckColours();
  prog.style.width = `${frac * 100}%`;
  trainPart('.train__loco').style.left = `${frac * 100}%`;
  prog.style.setProperty('--glow', frac > 0 ? mixColour(c.p5, c.s5, frac) : 'transparent');
}
function setProgress(levelUp) {
  const every = trainCfg().every;
  const frac = (train ? train.count % every : 0) / every;
  clearTimeout(trainProgressTimer);
  if (!levelUp) return setTrack(frac);
  setTrack(1);
  trainProgressTimer = setTimeout(() => {
    const prog = trainPart('.train__progress');
    prog.classList.add('no-anim');
    setTrack(0);
    void prog.offsetWidth;
    prog.classList.remove('no-anim');
    setTrack(frac);
  }, 700);
}

// Shows, updates or hides the train for the time `nowMs`. Runs every frame, and every 250ms in case frames pause.
function renderTrain(nowMs) {
  const phase = fields.showTrain === false ? 'off' : trainPhase(train, nowMs, trainCfg());
  const el = document.getElementById('train');
  const showing = phase !== 'off';
  trainLive = phase === 'live';
  if (showing !== trainShowing) {
    trainShowing = showing;
    el.hidden = !showing;
    scene().classList.toggle('train-on', showing);
    if (showing) {
      clearInterval(tickerTimer);
      document.getElementById('ticker').hidden = false;
      setProgress(false);
    } else {
      el.classList.remove('is-over', 'is-leaving', 'is-low', 'is-levelup');
      startTicker();
    }
  }
  if (!showing) return;

  const over = phase === 'over';
  const level = trainLevel(train.count, trainCfg().every);
  const left = Math.max(0, train.endsAt - nowMs);
  el.classList.toggle('is-over', over);
  el.classList.toggle('is-leaving', over && nowMs >= train.endsAt + TRAIN_OVER_MS - 500);
  el.classList.toggle('is-low', !over && left <= TRAIN_LOW_MS);
  const hype = String(over ? 0 : trainHype(level));
  if (el.style.getPropertyValue('--hype') !== hype) el.style.setProperty('--hype', hype);
  const every = String(trainCfg().every); // one divider per sub in a level
  if (el.style.getPropertyValue('--every') !== every) el.style.setProperty('--every', every);
  // The gradient spans the whole track, which narrows when the count gets more digits or the opponent shows.
  const trackWidth = `${trainPart('.train__track').offsetWidth}px`;
  if (trainPart('.train__grad').style.width !== trackWidth) trainPart('.train__grad').style.width = trackWidth;
  const lines = document.getElementById('train-lines');
  if (lines.width !== lines.offsetWidth || lines.height !== lines.offsetHeight) { lines.width = lines.offsetWidth; lines.height = lines.offsetHeight; }

  setTrainText('.train__n', String(train.count));
  setTrainText('.train__level', `Level ${level}`);
  setTrainText('.train__label', over ? 'Train over' : 'Sub train');
  setTrainText('.train__latest', over ? subsText(train.count) : train.latest);
  setTrainText('.train__time', `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, '0')}`);
  trainPart('.train__timer i').style.width = `${over ? 0 : (left / (trainCfg().seconds * 1000)) * 100}%`;
}

function addToTrain(n, name) {
  const now = Date.now();
  const wasShowing = trainShowing;
  const result = trainAdd(train, n, name, now, trainCfg());
  train = result.train;
  if (window.SE_API) SE_API.store.set(TRAIN_KEY, train);
  const el = document.getElementById('train');
  el.classList.remove('is-over', 'is-leaving', 'is-levelup');
  renderTrain(now);
  if (!trainShowing) return;
  setProgress(result.levelUp && wasShowing);
  const count = trainPart('.train__count');
  count.classList.remove('is-punch'); void count.offsetWidth; count.classList.add('is-punch');
  if (result.levelUp) { void el.offsetWidth; el.classList.add('is-levelup'); }
  trainBurst(n, result.levelUp);
}

// -- Sub train: sparks, steam and speed lines -----------------------------

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const addPart = (p) => trainParts.push({ age: 0, drag: 1, g: 0, vx: 0, vy: 0, layer: 'front', ...p });
const TRAIN_DRAW = {
  spark(x, p, k) {
    x.globalAlpha = 1 - k; x.strokeStyle = p.color; x.lineCap = 'round'; x.lineWidth = p.w;
    x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x - p.vx * p.tail, p.y - p.vy * p.tail); x.stroke();
  },
  ring(x, p, k) {
    const e = 1 - (1 - k) ** 3;
    x.globalAlpha = (1 - k) * .9; x.strokeStyle = p.color; x.lineWidth = Math.max(1, p.w * (1 - k));
    x.beginPath(); x.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, 0, Math.PI * 2); x.stroke();
  },
  flash(x, p, k) {
    const r = p.r * (.4 + .6 * (1 - (1 - k) ** 2));
    x.globalAlpha = (1 - k) ** 2;
    const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(.25, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill();
  },
  puff(x, p, k) {
    const r = p.size * (.4 + k);
    x.globalAlpha = (1 - k) * .3;
    const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill();
  },
  line(x, p, k) {
    x.globalAlpha = p.alpha * Math.min(1, (1 - k) * 4); x.strokeStyle = p.color; x.lineWidth = p.w; x.lineCap = 'round';
    x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x + p.len, p.y); x.stroke();
  },
};
function trainSparks(o, n, colours, speed) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = rnd(...speed);
    addPart({ kind: 'spark', x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: .92, g: 300, life: rnd(.4, .9), w: rnd(2, 4), tail: .06, color: pick(colours) });
  }
}
function trainBurst(n, levelUp) {
  const c = deckColours();
  const count = trainPart('.train__count');
  const p = posIn(count, scene());
  const o = { x: p.x + count.offsetWidth / 2, y: p.y + count.offsetHeight / 2 };
  trainSparks(o, levelUp ? 50 : 14 + Math.min(n, 10) * 4, [c.p3, c.p5, c.s3, '#ffffff'], levelUp ? [500, 1300] : [300, 800]);
  if (n > 1 || levelUp) addPart({ kind: 'flash', x: o.x, y: o.y, r: levelUp ? 200 : 130, color: c.p3, life: .45 });
  if (levelUp) {
    // The level-up also bursts from the end of the track, where the train just arrived.
    const track = trainPart('.train__track');
    const t = posIn(track, scene());
    const e = { x: t.x + track.offsetWidth, y: t.y + track.offsetHeight / 2 };
    addPart({ kind: 'flash', x: e.x, y: e.y, r: 160, color: c.s3, life: .5 });
    addPart({ kind: 'ring', x: e.x, y: e.y, r0: 10, r1: 160, life: .8, w: 5, color: c.s3 });
    trainSparks(e, 40, [c.s3, c.s5, '#ffffff'], [400, 1100]);
  }
}

// Full steam: puffs from the engine (now and then at level 1, a steady stream at the peak), and from level 2 speed
// lines streaming past behind the train, denser and faster as the hype climbs. Rates are per second.
function every(key, rate, dt, fn) {
  trainAcc[key] += rate * dt;
  while (trainAcc[key] >= 1) { trainAcc[key]--; fn(); }
}
function emitSteam(dt) {
  const hype = trainHype(trainLevel(train.count, trainCfg().every));
  const c = deckColours();
  const lines = document.getElementById('train-lines');
  if (hype > 0) every('line', hype * 50, dt, () => {
    const speed = rnd(900, 2000) * (.6 + hype), len = rnd(60, 220);
    addPart({ kind: 'line', layer: 'lines', x: lines.width + rnd(0, 80), y: rnd(8, lines.height - 8), vx: -speed, life: (lines.width + len + 100) / speed, len,
      alpha: rnd(.12, .3) * (.6 + hype * .6), w: rnd(1, 2.5), color: pick([c.p3, c.s3, '#ffffff']) });
  });
  const loco = posIn(trainPart('.train__loco'), scene());
  every('puff', 1 / (1.4 - hype * 1.2), dt, () => addPart({ kind: 'puff', x: loco.x - 6, y: loco.y - 18, vx: -rnd(30, 80) * (1 + hype * 3), vy: -rnd(20, 50), drag: .98, life: 1.2, size: rnd(14, 26) }));
}

// The loop asks for its next frame first, so nothing in a frame can stop it.
function trainFrame(t) {
  requestAnimationFrame(trainFrame);
  const dt = Math.min(.05, (t - (trainLast || t)) / 1000);
  trainLast = t;
  renderTrain(Date.now());
  for (const x of Object.values(trainCtxs)) { x.globalAlpha = 1; x.clearRect(0, 0, x.canvas.width, x.canvas.height); x.globalCompositeOperation = 'lighter'; }
  if (trainLive) emitSteam(dt);
  for (let i = trainParts.length - 1; i >= 0; i--) {
    const p = trainParts[i];
    if ((p.age += dt) >= p.life) { trainParts.splice(i, 1); continue; }
    const d = p.drag ** (dt * 60);
    p.vx *= d; p.vy *= d; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    TRAIN_DRAW[p.kind](trainCtxs[p.layer], p, p.age / p.life);
  }
}

function startTrain() {
  trainCtxs = { front: document.getElementById('train-fx').getContext('2d'), lines: document.getElementById('train-lines').getContext('2d') };
  requestAnimationFrame(trainFrame);
  setInterval(() => renderTrain(Date.now()), 250);
}

// -- StreamElements events --------------------------------------------

window.addEventListener('onWidgetLoad', async (obj) => {
  fields = obj.detail.fieldData || {};
  renderLook();
  document.fonts.ready.then(fitTitle);
  watchHoles();
  loadLook().then(renderLook);

  const session = (obj.detail.session && obj.detail.session.data) || {};
  Object.keys(LATEST).forEach((listener) => { latest[LATEST[listener]] = latestText(listener, session[listener]); });
  startTicker();

  await loadState();
  renderRecord();
  renderVs();

  try {
    train = restoreTrain(window.SE_API && await SE_API.store.get(TRAIN_KEY), Date.now());
  } catch (e) { /* no saved train */ }
  startTrain();
});

window.addEventListener('onEventReceived', (obj) => {
  const { listener, event } = obj.detail || {};
  if (listener === 'message') {
    onChat(event && event.data);
  } else if (LATEST[listener]) {
    latest[LATEST[listener]] = latestText(listener, event);
    startTicker(LATEST[listener]);
    const subs = fields.showTrain === false ? 0 : trainSubs(listener, event);
    if (subs) addToTrain(subs, trainName(event));
  }
});
