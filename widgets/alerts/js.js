// Alerts: one strip at a time over the game for Twitch follows, subs, gift subs, cheers and raids, each with the
// stream's picture in a badge and a sound. Follows get Rune burst, subs and gifts Poro party, cheers Card pull and
// raids Rift. Follows that are waiting in the queue are merged into one strip; a gift bomb is one alert.

const HOLD = { follow: 4000, bits: 5000, bitsFoil: 8000, sub: 6000, bigBomb: 8000, raid: 8000 };
const BIG_BOMB = 10; // gift bombs this big hold longer
const STYLE = { follow: 'rune', sub: 'party', resub: 'party', gift: 'party', bomb: 'party', bits: 'card', raid: 'rift' };
const EMOJI = {
  sub: ['⭐', '🎉', '💜'],
  resub: ['🎂', '⭐', '🎉'],
  gift: ['🎁', '🎉', '💜'],
  bomb: ['🎁', '🎉', '💥', '💜'],
};
const TIERS = { 1000: 'Just subscribed at tier 1', 2000: 'Just subscribed at tier 2', 3000: 'Just subscribed at tier 3', prime: 'Subscribed with Prime' };

// -- Decisions (pure, unit-tested in tests/alerts.test.js) ----------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const formatNumber = (n) => Number(n).toLocaleString('en-US');

// "1 bit", "5,000 bits".
function plural(n, word) {
  return `${formatNumber(n)} ${word}${Number(n) === 1 ? '' : 's'}`;
}

function raidLine(viewers) {
  return `Raiding with ${plural(viewers, 'viewer')}`;
}

function gifterName(event) {
  const sender = (event.sender || '').trim();
  return !sender || sender.toLowerCase() === 'ananonymousgifter' ? 'Anonymous' : sender;
}

// How big an alert's effects are: grows with gifts, bits, viewers or merged follows, capped at 3.6.
function effectScale(kind, n) {
  const log = Math.log10(Math.max(1, Number(n) || 1));
  if (kind === 'follow') return clamp(1 + log, 1, 3.6);
  if (kind === 'bomb') return clamp(1.6 + log, 1.6, 3.6);
  if (kind === 'bits') return clamp(log - 0.8, 1, 3.6);
  if (kind === 'raid') return clamp(1 + log, 2, 3.6);
  return 1.6;
}

function makeAlert(kind, name, line, hold, count, extra) {
  return { kind, style: STYLE[kind], name, line, hold, scale: effectScale(kind, count), count, ...(EMOJI[kind] ? { emoji: EMOJI[kind] } : {}), ...extra };
}

// The alert an event becomes, or null when it doesn't get one.
function describeEvent(listener, event, fields) {
  if (!event) return null;
  const name = (event.name || '').trim();
  const amount = Number(event.amount) || 0;
  if (listener === 'follower-latest') return name ? makeAlert('follow', name, 'New follower', HOLD.follow, 1) : null;
  if (listener === 'subscriber-latest') {
    if (event.isCommunityGift) return null; // part of a gift bomb, which has its own alert
    if (event.bulkGifted) return makeAlert('bomb', gifterName(event), `Just gifted ${plural(amount, 'sub')}`, amount >= BIG_BOMB ? HOLD.bigBomb : HOLD.sub, amount);
    if (event.gifted) return makeAlert('gift', gifterName(event), `Gifted a sub to ${name}`, HOLD.sub, 1);
    if (!name) return null;
    if (amount > 1) return makeAlert('resub', name, `Subscribed for ${plural(amount, 'month')}`, HOLD.sub, 1);
    return makeAlert('sub', name, TIERS[String(event.tier).toLowerCase()] || 'Just subscribed', HOLD.sub, 1);
  }
  if (listener === 'cheer-latest') {
    if (!name) return null;
    const foil = amount >= (Number(fields && fields.bitsFoil) || 1000);
    return makeAlert('bits', name, `Cheered ${plural(amount, 'bit')}`, foil ? HOLD.bitsFoil : HOLD.bits, amount, { foil });
  }
  if (listener === 'raid-latest') {
    return name ? makeAlert('raid', name, raidLine(amount), HOLD.raid, amount, { viewers: amount }) : null;
  }
  return null;
}

// The sound for an alert: its kind's own sound if one is set, else the main alert sound ('' for none).
const SOUND_FIELD = { follow: 'followSound', sub: 'subSound', resub: 'subSound', gift: 'subSound', bomb: 'subSound', bits: 'bitsSound', raid: 'raidSound' };
function soundFor(kind, fields) {
  const own = String(fields[SOUND_FIELD[kind]] || '').trim();
  return own || String(fields.alertSound || '').trim();
}

// The activity feed's mute button: use the state it sends if it sends one, else flip.
function nextMuted(current, event) {
  return event && typeof event.muted === 'boolean' ? event.muted : !current;
}

// The next alert to show. A follow at the front takes every other waiting follow with it, as one strip.
function takeNext(queue) {
  if (!queue.length) return { alert: null, rest: [] };
  const first = queue[0];
  if (first.kind !== 'follow') return { alert: first, rest: queue.slice(1) };
  const follows = queue.filter((a) => a.kind === 'follow');
  const rest = queue.filter((a) => a.kind !== 'follow');
  const count = follows.reduce((sum, a) => sum + a.count, 0);
  if (count === 1) return { alert: first, rest };
  const first0 = first.name.split(' and ')[0];
  const others = count - 1;
  return {
    alert: { ...first, name: `${first0} and ${others} ${others === 1 ? 'other' : 'others'}`, line: 'New followers', count, scale: effectScale('follow', count) },
    rest,
  };
}

// -- On screen ------------------------------------------------------------

const EXIT_MS = 460; // the strip's exit animation
const GAP_MS = 300; // pause between one alert leaving and the next arriving
// Every face the strips use. Web fonts only load once text uses them, so they're loaded up front: a strip measured
// in a fallback font would be sized and centred wrongly.
const FONTS = ['400 40px "Bebas Neue"', '400 40px "Lilita One"', '500 18px Figtree', '700 18px Figtree'];

let fields = {};
let queue = [];
let ready = null; // resolves once the widget has loaded and its fonts are in
let busy = false; // an alert is showing, leaving, or about to show
let current = null; // the alert on screen, until it starts leaving
let holdTimer = null;
let muted = false; // the activity feed's mute button

// Called as each alert appears: plays its sound unless alerts are muted.
function onAlertShown(alert) {
  const url = soundFor(alert.kind, fields);
  if (muted || !url) return;
  const sound = new Audio(url);
  sound.volume = clamp(num(fields.volume, 80) / 100, 0, 1);
  sound.play().catch(() => {}); // a browser may block sound until the page is clicked; OBS doesn't
}

const num = (v, fallback) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : fallback);
const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);

// Position of an element inside `root`, from layout offsets (unaffected by transforms or the StreamElements editor's scaling).
function posIn(node, root) {
  let x = 0, y = 0;
  for (let n = node; n && n !== root; n = n.offsetParent) { x += n.offsetLeft; y += n.offsetTop; }
  return { x, y };
}

// Long names shrink until they fit the strip, down to 28px.
function fitName(n) {
  let size = parseFloat(getComputedStyle(n).fontSize);
  while (n.scrollWidth > n.clientWidth + 1 && size > 28) { size -= 2; n.style.fontSize = `${size}px`; }
}

// Fits the name, then centres what you see, badge included (it hangs off the left end), and locks the width so a
// ticking count can't jiggle it.
function layoutStrip(el) {
  const name = el.querySelector('.alert__name');
  const badge = el.querySelector('.alert__badge');
  name.style.fontSize = '';
  el.style.width = '';
  fitName(name);
  el.style.left = `${num(fields.centreX, 1044) - (el.offsetWidth - Math.max(0, -badge.offsetLeft)) / 2}px`;
  el.style.width = `${el.offsetWidth}px`;
}

function runQueue() {
  if (busy || !ready || !queue.length) return;
  busy = true;
  ready.then(() => {
    const next = takeNext(queue);
    queue = next.rest;
    if (!next.alert) { busy = false; return; }
    try {
      showAlert(next.alert);
    } catch (err) {
      // Never let one broken alert stall the queue for the rest of the stream.
      console.error('Alert failed to show', err);
      current = current || next.alert;
      leaveAlert();
    }
  });
}

function showAlert(alert) {
  current = alert;
  const root = document.getElementById('alerts');
  const el = document.getElementById('alert');
  fx.parts = []; fx.queue = [];
  el.hidden = false;
  el.className = 'alert';
  el.style.left = el.style.width = '';
  el.style.top = `${num(fields.top, 44)}px`;
  void el.offsetWidth; // restart the strip's own animation
  el.className = `alert style-${alert.style}${alert.foil ? ' is-foil' : ''}`;
  const avatar = String(fields.avatar || '').trim();
  el.innerHTML = `
    <div class="alert__card">
      <div class="alert__back" aria-hidden="true"></div>
      <div class="alert__face">
        <i class="alert__frame" aria-hidden="true"></i>
        <div class="alert__badge${avatar ? '' : ' alert__badge--empty'}"><div class="alert__avatar">${avatar ? `<img src="${esc(avatar)}" alt="">` : ''}</div></div>
        <h2 class="alert__name">${esc(alert.name)}</h2>
        <p class="alert__line">${esc(alert.line)}</p>
      </div>
    </div>`;
  layoutStrip(el);
  // If a font was still loading (a cold start can beat the stylesheet), lay the strip out again once it's in.
  document.fonts.ready.then(() => { if (current === alert) layoutStrip(el); });
  const badge = el.querySelector('.alert__badge');
  const face = el.querySelector('.alert__face');

  const pulse = document.getElementById('pulse');
  pulse.classList.remove('is-on');
  if (alert.style === 'rift' && fields.raidGlow !== false) { void pulse.offsetWidth; pulse.classList.add('is-on'); }

  const cs = getComputedStyle(root);
  const col = (v) => cs.getPropertyValue(v).trim();
  const c = { p3: col('--primary-300'), p5: col('--primary-500'), s3: col('--secondary-300'), s5: col('--secondary-500') };
  const b = posIn(badge, root);
  const f = posIn(face, root);
  const o = { x: b.x + badge.offsetWidth / 2, y: b.y + badge.offsetHeight / 2 };
  const r = { x: f.x, y: f.y, w: face.offsetWidth, h: face.offsetHeight };
  BURSTS[alert.style](o, r, c, alert);
  if (alert.viewers) countUp(el.querySelector('.alert__line'), alert.viewers, 500);
  onAlertShown(alert);
  holdTimer = setTimeout(leaveAlert, alert.hold);
}

// Starts the strip's exit; the next alert follows once it's gone.
function leaveAlert() {
  if (!current) return;
  current = null;
  clearTimeout(holdTimer);
  fx.queue = []; // no more glints or count ticks for a strip that's leaving
  const el = document.getElementById('alert');
  el.classList.add('is-leaving');
  setTimeout(() => {
    el.hidden = true;
    el.classList.remove('is-leaving');
    setTimeout(() => { busy = false; runQueue(); }, GAP_MS);
  }, EXIT_MS);
}

// -- Effects: particles on two canvases, behind the strip and in front of it ------------------

const fx = { parts: [], queue: [], t: 0 };
let ctxs = null;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const at = (ms, fn) => fx.queue.push({ at: fx.t + ms / 1000, fn });
const add = (p) => fx.parts.push({ age: 0, drag: 1, g: 0, rot: 0, spin: 0, vx: 0, vy: 0, layer: 'back', ...p });

function star(x, cx, cy, s, rot) {
  x.save(); x.translate(cx, cy); x.rotate(rot); x.beginPath();
  for (let i = 0; i < 8; i++) { const r = i % 2 ? s * .18 : s; const a = i * Math.PI / 4; x.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  x.closePath(); x.fill(); x.restore();
}
const DRAW = {
  spark(x, p, k) {
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = 1 - k; x.strokeStyle = p.color; x.lineCap = 'round'; x.lineWidth = p.w;
    x.beginPath(); x.moveTo(p.x, p.y); x.lineTo(p.x - p.vx * p.tail, p.y - p.vy * p.tail); x.stroke();
  },
  ring(x, p, k) {
    const e = 1 - (1 - k) ** 3;
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = (1 - k) * p.alpha; x.strokeStyle = p.color; x.lineWidth = Math.max(1, p.w * (1 - k));
    x.beginPath(); x.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * e, 0, Math.PI * 2); x.stroke();
  },
  flash(x, p, k) {
    const r = p.r * (.4 + .6 * (1 - (1 - k) ** 2));
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = (1 - k) ** 2;
    const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, r); g.addColorStop(0, '#ffffff'); g.addColorStop(.25, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, r, 0, Math.PI * 2); x.fill();
  },
  glint(x, p, k) {
    const s = p.size * Math.sin(Math.PI * k);
    if (s <= 0) return;
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = .4;
    const g = x.createRadialGradient(p.x, p.y, 0, p.x, p.y, s * 1.1); g.addColorStop(0, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(p.x, p.y, s * 1.1, 0, Math.PI * 2); x.fill();
    x.globalAlpha = 1; x.fillStyle = p.color; star(x, p.x, p.y, s, p.rot);
  },
  emoji(x, p, k) {
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = k > .75 ? (1 - k) * 4 : 1;
    x.save(); x.translate(p.x, p.y); x.rotate(p.rot);
    x.font = `${p.size}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(p.ch, 0, 0); x.restore();
  },
  confetti(x, p, k) {
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = k > .8 ? (1 - k) * 5 : 1;
    x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.scale(1, Math.cos(p.age * p.flip));
    x.fillStyle = p.color; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore();
  },
  slit(x, p, k) {
    x.save(); x.translate(p.x, p.y); x.scale(.06 + k * .6, 1);
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = (1 - k) ** 1.5;
    const g = x.createRadialGradient(0, 0, 0, 0, 0, p.r); g.addColorStop(0, '#ffffff'); g.addColorStop(.3, p.color); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, p.r, 0, Math.PI * 2); x.fill(); x.restore();
  },
  shard(x, p, k) {
    // Glass: a see-through fill with a bright edge.
    x.globalCompositeOperation = 'lighter'; x.globalAlpha = (1 - k) * .45;
    x.save(); x.translate(p.x, p.y); x.rotate(p.rot); x.fillStyle = p.color; x.strokeStyle = '#ffffff'; x.lineWidth = 1.5; x.beginPath();
    x.moveTo(p.pts[0], p.pts[1]); x.lineTo(p.pts[2], p.pts[3]); x.lineTo(p.pts[4], p.pts[5]); x.closePath(); x.fill();
    x.globalAlpha = (1 - k) * .9; x.stroke(); x.restore();
  },
};

// The loop asks for its next frame first, so nothing in a frame can stop it.
let last = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(.05, (now - (last || now)) / 1000);
  last = now; fx.t += dt;
  const due = fx.queue.filter((q) => fx.t >= q.at);
  fx.queue = fx.queue.filter((q) => fx.t < q.at);
  due.forEach((q) => q.fn());
  for (const x of Object.values(ctxs)) { x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, 1920, 1080); }
  fx.parts = fx.parts.filter((p) => (p.age += dt) < p.life);
  for (const p of fx.parts) {
    const d = p.drag ** (dt * 60);
    p.vx *= d; p.vy *= d; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.spin * dt;
    DRAW[p.kind](ctxs[p.layer], p, p.age / p.life);
  }
}

const flash = (o, color, r) => add({ kind: 'flash', x: o.x, y: o.y, r, color, life: .4 });
const ring = (o, color, r0, r1, life, w, alpha = .9, layer = 'back') => add({ kind: 'ring', layer, x: o.x, y: o.y, r0, r1, life, w, alpha, color });
const glint = (pt, size, color, life = .8) => add({ kind: 'glint', layer: 'front', x: pt.x, y: pt.y, size, color, life, rot: rnd(-.3, .3), spin: rnd(-1, 1) });
function sparks(o, n, colours, speed = [520, 1200]) {
  for (let i = 0; i < n; i++) {
    const a = rnd(0, Math.PI * 2), v = rnd(...speed);
    add({ kind: 'spark', x: o.x + Math.cos(a) * 50, y: o.y + Math.sin(a) * 50, vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: .92, g: 380, life: rnd(.5, 1), w: rnd(2.5, 4.5), tail: .06, color: pick(colours) });
  }
}
function shards(o, n, colours, dir, spread) {
  for (let i = 0; i < n; i++) {
    const a = dir + rnd(-spread / 2, spread / 2), v = rnd(300, 900), s = rnd(8, 22);
    add({ kind: 'shard', layer: 'front', x: o.x + rnd(-6, 6), y: o.y + rnd(-30, 30), vx: Math.cos(a) * v, vy: Math.sin(a) * v, drag: .94, g: 260, life: rnd(.8, 1.5),
      rot: rnd(0, 6), spin: rnd(-6, 6), color: pick(colours), pts: [0, -s, s * rnd(.4, 1), s * rnd(.2, .8), -s * rnd(.4, 1), s * rnd(.2, .8)] });
  }
}
// Ticks a raid's viewer count up from 0.
function countUp(lineEl, viewers, startMs) {
  for (let i = 0; i <= 20; i++) at(startMs + i * 55, () => { lineEl.textContent = raidLine(Math.round(viewers * (1 - (1 - i / 20) ** 3))); });
}
function perimeter(r) {
  let t = Math.random() * 2 * (r.w + r.h), x, y;
  if (t < r.w) { x = r.x + t; y = r.y; }
  else if ((t -= r.w) < r.h) { x = r.x + r.w; y = r.y + t; }
  else if ((t -= r.h) < r.w) { x = r.x + t; y = r.y + r.h; }
  else { x = r.x; y = r.y + t - r.w; }
  return { x: x + rnd(-8, 8), y: y + rnd(-8, 8) };
}

// What each style throws around. o = badge centre, r = the strip's box, c = deck colours, a = the alert.
const BURSTS = {
  rune(o, r, c, a) {
    at(90, () => { flash(o, c.p3, 170); ring(o, c.p3, 52, 230, .7, 7); sparks(o, Math.round(26 * a.scale), [c.p3, c.p5, c.s3, '#ffffff']); });
    at(240, () => ring(o, c.s3, 52, 320, .9, 4));
  },
  card(o, r, c, a) {
    at(330, () => { flash(o, '#ffffff', 150); for (let i = 0; i < Math.round(7 * a.scale); i++) glint(perimeter(r), rnd(12, 26), pick(['#ffffff', c.p3, c.s3])); });
    if (a.foil) for (let i = 0; i < 16; i++) at(900 + i * 420, () => glint(perimeter(r), rnd(14, 30), pick(['#ffffff', '#ffe9a8', c.s3])));
  },
  party(o, r, c, a) {
    at(320, () => {
      ring(o, '#ffffff', 52, 180, .45, 9, 1, 'front');
      for (let i = 0; i < Math.round(8 * a.scale); i++) {
        const dir = Math.random() < .5 ? -1 : 1;
        add({ kind: 'emoji', layer: 'front', ch: pick(a.emoji), x: o.x, y: o.y, vx: dir * rnd(300, 780), vy: -rnd(150, 450), g: 1700, drag: .995, life: rnd(1.6, 2.4), size: rnd(34, 56), rot: rnd(-.5, .5), spin: rnd(-5, 5) });
      }
      for (let i = 0; i < Math.round(26 * a.scale); i++) {
        const dir = Math.random() < .5 ? -1 : 1;
        add({ kind: 'confetti', layer: 'front', x: o.x + rnd(-26, 26), y: o.y, vx: dir * rnd(100, 720), vy: -rnd(150, 520), g: 900, drag: .97, life: rnd(1.6, 2.8),
          w: rnd(7, 12), h: rnd(4, 8), color: pick([c.p5, c.s5, c.p3, c.s3, '#ffffff', '#ffd46b']), rot: rnd(0, 6), spin: rnd(-9, 9), flip: rnd(6, 14) });
      }
    });
  },
  rift(o, r, c, a) {
    const mid = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    const colours = [c.p3, c.s3, c.p5, '#ffffff'];
    const n = Math.round(13 * a.scale);
    at(150, () => add({ kind: 'slit', layer: 'front', x: mid.x, y: mid.y, r: 160, color: c.p3, life: .7 }));
    at(260, () => { shards(mid, n, colours, 0, 1.3); shards(mid, n, colours, Math.PI, 1.3); });
    at(520, () => { flash(o, c.s3, 190); ring(o, c.s3, 52, 260, .8, 6); });
  },
};

// -- StreamElements events --------------------------------------------

window.addEventListener('onWidgetLoad', (obj) => {
  fields = obj.detail.fieldData || {};
  Object.assign(document.getElementById('pulse').style, {
    left: `${num(fields.glowX, 432)}px`, top: `${num(fields.glowY, 48)}px`, width: `${num(fields.glowW, 1440)}px`, height: `${num(fields.glowH, 810)}px`,
  });
  ctxs = { back: document.getElementById('fx-back').getContext('2d'), front: document.getElementById('fx-front').getContext('2d') };
  requestAnimationFrame(frame);
  ready = Promise.all(FONTS.map((f) => document.fonts.load(f))).catch(() => {});
  runQueue();
});

window.addEventListener('onEventReceived', (obj) => {
  const { listener, event } = obj.detail || {};
  if (listener === 'event:skip') return leaveAlert();
  if (listener === 'alertService:toggleSound') { muted = nextMuted(muted, event); return; }
  const alert = describeEvent(listener, event, fields);
  if (alert) { queue.push(alert); runQueue(); }
});
