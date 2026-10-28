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
    if (event.bulkGifted) return makeAlert('bomb', gifterName(event), `Just gifted ${formatNumber(amount)} subs`, amount >= BIG_BOMB ? HOLD.bigBomb : HOLD.sub, amount);
    if (event.gifted) return makeAlert('gift', gifterName(event), `Gifted a sub to ${name}`, HOLD.sub, 1);
    if (!name) return null;
    if (amount > 1) return makeAlert('resub', name, `Subscribed for ${formatNumber(amount)} months`, HOLD.sub, 1);
    return makeAlert('sub', name, TIERS[String(event.tier).toLowerCase()] || 'Just subscribed', HOLD.sub, 1);
  }
  if (listener === 'cheer-latest') {
    if (!name) return null;
    const foil = amount >= (Number(fields && fields.bitsFoil) || 1000);
    return makeAlert('bits', name, `Cheered ${formatNumber(amount)} bits`, foil ? HOLD.bitsFoil : HOLD.bits, amount, { foil });
  }
  if (listener === 'raid-latest') {
    return name ? makeAlert('raid', name, `Raiding with ${formatNumber(amount)} viewers`, HOLD.raid, amount, { viewers: amount }) : null;
  }
  return null;
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
