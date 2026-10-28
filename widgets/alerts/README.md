# Alerts

A strip over the top of the game for every Twitch follow, sub, gift sub, cheer and raid, with the stream's picture in a round badge and a sound. Alerts show one at a time, in the order they arrive. By default they sit over the opponent's face-down hand, straddling the game's top edge, which is the least useful part of the board to hide.

| Event | Style | Line under the name | Holds |
|---|---|---|---|
| Follow | Rune burst: glass, spinning deck ring, sparks | New follower | 4s |
| Sub | Poro party: white-bordered sticker in the deck's colours, emoji and confetti | Just subscribed at tier 1/2/3, or Subscribed with Prime | 6s |
| Resub | Poro party | Subscribed for N months | 6s |
| Gift sub | Poro party, with the gifter's name | Gifted a sub to {name} | 6s |
| Gift bomb | Poro party, one alert for the whole bomb | Just gifted N subs | 6s, 8s from 10 subs |
| Cheer | Card pull: a card flips over; gold foil from the "gold foil" setting | Cheered N bits | 5s, 8s with foil |
| Raid | Rift: the strip tears open, glass shards fly, the game glows twice | Raiding with N viewers | 8s |

- **Bigger events get bigger effects.** Effects grow with the size of a gift bomb or cheer, and with the number of raiders.
- **Follows are merged.** Follows still waiting in the queue are merged into one strip ("name and 7 others / New followers"), so a burst after a raid doesn't keep strips up for minutes. Subs, gifts, cheers and raids are never merged.
- **On purpose, these strips depart from the design system:** Lilita One for sub names, a white sticker border, gold foil and emoji, and loops while a strip is up.
- **Twitch only.** StreamElements only receives events from Twitch.

## StreamElements

1. Open the game scene's overlay and add a Custom Widget. Set it to position 0,0 and size 1920×1080, and keep it above the game-scene widget.
2. In the widget's editor, paste `html.html` into HTML, `css.css` into CSS, `js.js` into JS and `fields.json` into FIELDS. Click Done, then save the overlay.
3. In the widget's settings:
   - Pick the deck's Primary and Secondary domains.
   - Upload the stream picture under "Stream picture". Without one, the badge is a deck-coloured circle.
   - Upload the alert sound under "Alert sound". If it's quiet, run it through the [sound booster](../../tools/boost-sound.html) first (see below).
   - The other sounds are optional. Leave them blank to use the alert sound for everything, or give follows, subs and gifts, cheers or raids a sound of their own later.

### Making a quiet sound loud enough

Run `python -m http.server 8765` in the repo root and open `http://localhost:8765/tools/boost-sound.html`. Pick the sound and download the WAV it makes, which peaks at -1 dBFS. Upload that WAV to "Alert sound". The booster runs in the browser and uploads nothing. Don't commit sound files to this repo.

## OBS

The alerts live inside the game scene's overlay, so there's no new Browser Source. To give the alert sound its own fader in the mixer, open that overlay's Browser Source properties and tick "Control audio via OBS".

## Settings

| Setting | What it does |
|---|---|
| Primary / Secondary domain | The deck's colours |
| Stream picture | The picture in every badge |
| Gold foil from (bits) | Cheers this big get the gold foil card and hold 8s (default 1000) |
| Alert sound | Plays with every alert |
| Follow / Sub and gift / Cheer / Raid sound | Optional; blank uses the alert sound |
| Volume | 0–100 (default 80) |
| Strip centre x, strip top y | Where the strip sits (default 1044, 44: over the opponent's hand) |
| Glow around the game on raids, and its x/y/width/height | Turn the raid glow off for scenes without a game, or move it |

The activity feed's "skip alert" button ends the strip on screen, and its "mute alerts" button silences the sound.

## Testing

In the StreamElements editor, use the emulate buttons for follows, subs, gifts, cheers and raids.

Locally, run `python -m http.server 8765` in the repo root and open:

`http://localhost:8765/preview/?w=alerts&primary=calm&secondary=order&avatar=avatar.png&alertSound=alert-sound.mp4&gameshot=game-sample.webp`

`avatar.png`, `alert-sound.mp4` and `game-sample.webp` are personal copies kept in `preview/` and ignored by git. Click the page once so the browser allows sound, then fire events from the console:

```js
sendEvent('follower-latest', { name: 'someone' })
sendEvent('subscriber-latest', { name: 'someone', amount: 1, tier: '1000' })
sendEvent('subscriber-latest', { name: 'someone', amount: 7 })
sendEvent('subscriber-latest', { bulkGifted: true, sender: 'someone', amount: 50 })
sendEvent('cheer-latest', { name: 'someone', amount: 5000 })
sendEvent('raid-latest', { name: 'someone', amount: 42 })
```

The unit tests for which alert each event becomes, follow merging and sound choice run with `node --test tests/alerts.test.js`.
