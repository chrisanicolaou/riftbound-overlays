// Game scene: cuts the backdrop's see-through holes, fills the bar (title, current opponent, ticker) and keeps the stream's W/L record.
// Chat commands, from the broadcaster or a moderator:
//   !win  !loss  !undo  !reset        record
//   !vs Renekton                      current opponent (!vs alone clears it)
// The record and opponent are saved in the StreamElements store, so they survive reloads.
// They start fresh once nothing has changed for `resetHours`.

const STORE_KEY = 'rbGameScene';
const LATEST = { 'follower-latest': 'follower', 'subscriber-latest': 'sub', 'raid-latest': 'raid' };
const LATEST_LABELS = { follower: 'Latest follower', sub: 'Latest sub', raid: 'Latest raid' };

let fields = {};
let state = { results: [], vs: '', updated: 0 };
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

function onChat(data) {
  if (!data || typeof data.text !== 'string' || data.text[0] !== '!') return;
  if (data.msgId) {
    if (seenMessages.includes(data.msgId)) return;
    seenMessages.push(data.msgId);
    if (seenMessages.length > 50) seenMessages.shift();
  }
  if (!canControl(data)) return;
  const text = data.text.trim();
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
  document.getElementById('ticker').hidden = !items.length;
  if (!items.length) return;
  const jump = jumpTo ? items.findIndex((item) => item.key === jumpTo) : -1;
  tickerIndex = jump >= 0 ? jump : (tickerIndex + 1) % items.length;
  showTickerItem(items[tickerIndex]);
}

// Shows the next line now (or the line for `jumpTo`), then rotates.
function startTicker(jumpTo) {
  clearInterval(tickerTimer);
  advanceTicker(jumpTo);
  if (tickerItems().length > 1) {
    tickerTimer = setInterval(() => advanceTicker(), Math.max(5, Number(fields.tickerSeconds) || 20) * 1000);
  }
}

function latestText(listener, event) {
  if (!event || !event.name) return '';
  return listener === 'raid-latest' && event.amount ? `${event.name} (${event.amount})` : event.name;
}

// -- StreamElements events --------------------------------------------

window.addEventListener('onWidgetLoad', async (obj) => {
  fields = obj.detail.fieldData || {};
  setText('bar-title', fields.barTitle);
  fitTitle();
  document.fonts.ready.then(fitTitle);
  cutHoles();

  const session = (obj.detail.session && obj.detail.session.data) || {};
  Object.keys(LATEST).forEach((listener) => { latest[LATEST[listener]] = latestText(listener, session[listener]); });
  startTicker();

  await loadState();
  renderRecord();
  renderVs();
});

window.addEventListener('onEventReceived', (obj) => {
  const { listener, event } = obj.detail || {};
  if (listener === 'message') {
    onChat(event && event.data);
  } else if (LATEST[listener]) {
    latest[LATEST[listener]] = latestText(listener, event);
    startTicker(LATEST[listener]);
  }
});
