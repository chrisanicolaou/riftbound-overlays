# Alerts and sub train: design

Date: 2026-10-28. Worked out in conversation with the streamer; nothing is built yet.

## Why

The stream (Riftbound on Twitch and YouTube at once, through OBS, with overlays built as StreamElements Custom Widgets) has no alerts. When someone follows, subscribes, cheers or raids on Twitch, they should get a moment on screen with a sound, without the alert hiding the game. Subs and raids matter most to the streamer, so they should stand out more than follows and bits. A run of subs (a sub train) should build visible hype in the bar under the game.

## What gets built

1. **A new widget, `widgets/alerts/`**: alerts for follows, subs (including resubs and gift subs), bits and raids.
2. **A sub train tracker inside the existing `widgets/game-scene/` widget**, in the bar's ticker slot.

The look and motion of both were settled on two throwaway draft pages, which are the visual spec. Port their CSS, markup and canvas effects:

- `preview/alerts-draft.html`: the alert styles, with sound.
- `preview/subtrain-draft.html`: the sub train.

Run `python -m http.server 8765` in the repo root and open `/preview/alerts-draft.html` or `/preview/subtrain-draft.html`. The drafts lay everything over the game-scene widget, with a real game screenshot standing in for the game capture. Their draft-only parts are listed under "Don't port".

## Goals

- Every Twitch follow, sub, resub, single gift sub, gift bomb, cheer and raid gets one alert: the viewer's name, what they did, the stream's avatar in a round badge, and a sound.
- Subs and raids feel bigger than follows and bits.
- Alerts hide as little of the board as possible: just the opponent's face-down hand, for a few seconds.
- The sub train shows the count, the level, progress to the next level, the latest subscriber and the time left, and visibly picks up speed as the levels climb.
- Swapping the sounds or the avatar later is a settings change in StreamElements, never a code change.
- Everything can be checked in the local preview harness before it goes into StreamElements.

## Non-goals

- Tips, YouTube events, other platforms. (StreamElements only gets events from the primary platform, Twitch.)
- Other scenes. The streamer wants alerts over other scenes eventually, so the alerts widget takes its position from fields and can be pasted into another scene's overlay later. No other scene is built now.
- Chat commands that fire test alerts. The StreamElements editor's emulate buttons cover testing.
- The raider's own avatar on raid alerts (it would need an outside lookup service).
- One shared deck setting across widgets. That's still an open item in CLAUDE.md, so the alerts widget gets its own deck fields like every other widget.
- Adding these styles to the design system. They deliberately depart from it (see Constraints) and stay inside the widget.

## Anti-goals (failures even if it technically works)

- Covering the player's hand, either point track, the log column, the opponent's decks and legend cards, or the Floating Energy/Power panel.
- 50 alerts for a 50-sub gift bomb, a minute of follow strips after a raid, or the sub train counting a gift bomb twice.
- Two alerts on screen at once, or one alert cutting another off.
- A sound too quiet to hear, or one that blasts.
- Effects that never stop. Effects run only while an alert is up or a train is running.
- Personal files (the avatar, the sound, the game screenshot) committed to this public repo.

## Constraints

- **The StreamElements conventions in CLAUDE.md:** each widget's four tabs (HTML/CSS/JS/Fields) live as files in `widgets/<name>/`, next to `obs-sources.json` and a short `README.md`. The CSS tab starts with the jsDelivr stylesheet `@import`. There are `primary`/`secondary` dropdowns, set on the root as `data-primary`/`data-secondary`. No React, and a transparent background.
- **StreamElements behaviour (checked against its docs):**
  - Field types `image-input`, `sound-input` and `slider` exist.
  - Events arrive through `onEventReceived`, with listeners `follower-latest`, `subscriber-latest`, `cheer-latest` and `raid-latest`.
  - The activity feed's "skip alert" button sends `event:skip`, and its "mute/unmute alerts" button sends `alertService:toggleSound`. The docs give no payload for either, so the builder checks how mute state comes through.
- **OBS's browser version isn't pinned**, so avoid very new CSS. Don't use `color-mix()`; mix colours in JS, as the drafts do. `@property` (used by the raid's spinning border) has been in Chromium since version 85 and is fine.
- **Agreed departures from the design system, for the alerts and train only:**
  - Lilita One (Google Fonts) for the sub alert's name.
  - White sticker borders, gold and foil on big cheers, and emoji.
  - Loops while an alert or train is up: the raid border spin and colour flow, and the foil shimmer.

  Everything else (role tokens, Bebas Neue/Figtree, night surfaces) still comes from `riftbound-overlays.css`.
- **Canvas geometry:** 1920×1080. In game-scene the game capture sits at 432,48, size 1440×810 (75% scale), so game pixel (x, y) is canvas (432 + 0.75x, 48 + 0.75y).
- **Measuring positions:** use layout offsets (`offsetLeft`/`offsetTop`/`offsetWidth`), not `getBoundingClientRect`, for anything placed by measurement: centring the strip, particle origins, the train's track width. The StreamElements editor scales its preview, which skews client rects; game-scene's `maskOut` does the same for this reason. The alerts draft already uses offsets (`posIn`); the train draft uses client rects and needs converting.
- **Measure at show time, not at load:** on a cold OBS start, `onWidgetLoad` can fire before the stylesheet applies, while boxes are 0px (see `watchHoles` in game-scene). So measure when an alert or train is shown, and again if the bar's sections change size.
- **Checking:** test every widget with at least two deck pairs (CLAUDE.md).

## Part 1: the alerts widget

### Placement

- One Custom Widget, 1920×1080 at 0,0, added to game-scene's StreamElements overlay. Full canvas, so effects can spill past the strip. It goes on top of the game-scene layout widget.
- **Every alert is a compact strip:**
  - The avatar badge, a 104px circle, hangs 24px off the strip's left end.
  - Then the viewer's name, large, and one line under it.
  - The strip's width fits its content (min 300px, max 560px), and long names shrink down to 28px.
- **Centred on canvas x 1044, top at y 44**, so the strip straddles the game's top edge and sits over the opponent's face-down hand (game x ~615–1005, y 0–130). Even a 25-character name stays clear of the opponent's deck count on the left (canvas x ≤ 612) and the Floating Energy/Power panel on the right (canvas x ≥ 1366). These measurements come from a real game screenshot, `preview/game-sample.webp`.
- The centre x and top come from fields, so the widget can sit elsewhere in another scene.

### Style per event

| Event | Style | Line under the name |
|---|---|---|
| Follow | Rune burst | New follower |
| First sub | Poro party | Just subscribed at tier 1/2/3, or Subscribed with Prime |
| Resub | Poro party | Subscribed for N months |
| Single gift sub | Poro party | Gifted a sub to {recipient} (the name shown is the gifter) |
| Gift bomb | Poro party | Just gifted N subs (gifter's name; one alert for the whole bomb) |
| Cheer | Card pull | Cheered N bits (with thousands separators: 5,000) |
| Raid | Rift | Raiding with N viewers (N counts up from 0 as it appears) |

Copy is in sentence case, with no exclamation marks.

What each style does (the drafts have the exact CSS, keyframes and particle settings):

- **Rune burst (follows):** the design system's glass, as a pill with a deck-gradient border. The badge pops in inside a spinning ring of the deck's colours. A flash, two shockwave rings and sparks burst from the badge, and a sheen sweeps across once.
- **Poro party (subs and gifts):** a sticker pill with a white border, a primary→secondary gradient fill and dark text, tilted −2°.
  - The badge drops in with a squash-and-stretch and a wiggle.
  - Emoji and confetti fly from the badge. The emoji depend on the event: ⭐🎉💜 for subs, 🎂⭐🎉 for resubs, 🎁🎉💜 for gifts, plus 💥 for gift bombs.
- **Card pull (bits):** a card flips from its back (a deck-coloured pattern) to its face (night gradient, deck-gradient border, a thin inner frame), with glints around the edge as it lands.
  - Cheers of 1,000 bits or more (a field) get a gold edge, a gold badge ring, a moving foil shimmer and glints through the hold.
  - No rarity labels.
- **Rift (raids):**
  - A bright slit tears open into the strip, and translucent, bright-edged glass shards fly out both sides.
  - The badge spins out of a swirling portal.
  - The fill is the deck's two colours flowing slowly along the strip, with dark text, inside a spinning white-and-deck border.
  - A deck-coloured glow pulses twice around the game capture. Its rectangle comes from fields, and it can be turned off for scenes without a game.

Bigger events get bigger effects (more sparks, emoji, confetti, shards and glints), up to a cap. The draft's multipliers are: follow 1, sub or resub 1.6, 5 gifts 2.2, 50 gifts 3.6, 100 bits 1.2, 5,000 bits 3.2, raid 3. The builder picks a formula that grows with the gift count, bits or viewers and tops out around 3.6.

### Timing and queue

- Alerts show one at a time, in arrival order. The next starts after the current one has finished leaving (about 400ms), plus a short gap.
- Hold times:
  - Follow: 4s.
  - Cheer: 5s; 8s at 1,000+ bits.
  - Sub, resub or single gift: 6s.
  - Gift bomb: 6s; 8s at 10+ subs.
  - Raid: 8s.
- Each style has its own exit, per the draft. Rune burst and Rift fade and lift, Card pull flips away, and Poro party pops out.
- `event:skip` ends the current alert early, and `alertService:toggleSound` mutes or unmutes the sound.

### Follow bursts

Follows can pile up, for example when raiders follow right after a raid, and at 4 seconds each a backlog would keep strips over the board for minutes. So when a follow is about to show, any other follows already waiting in the queue are folded into it:

- One Rune burst strip. The name reads "{first follower} and N others" (the first in arrival order), and the line under it reads "New followers". The usual name shrinking handles the length.
- It holds 4 seconds, takes the place of the earliest follow in the queue, and plays the sound once. Its effects scale with the number of follows, under the same cap as everything else.
- Follows that arrive while it's showing wait, and get folded into the next follow strip in the same way.
- Subs, gifts, bits and raids are never merged, and keep their place in the queue.

### Gift bombs

StreamElements sends a gift bomb as one event with `bulkGifted` (`sender` is the gifter, `amount` the count), followed by one event per gifted sub with `isCommunityGift`. Show one alert for the `bulkGifted` event and ignore the `isCommunityGift` ones. A single gift (`gifted` set, not part of a bomb) gets its own alert, with `sender` as the gifter and `name` as the recipient.

### Sound

- **Fields:**
  - `alertSound` (`sound-input`), used by every alert.
  - Optional `followSound`, `subSound`, `bitsSound` and `raidSound`. Blank means use `alertSound`.
  - A `volume` slider, 0–100.
- The sound plays as the alert appears. Muting from the activity feed silences it until it's unmuted.
- **The sound for now** is the streamer's `C:\Users\chris\Videos\Riftbound\Channel Assets\timewarp noise.mp4`: a 2.2-second swell peaking 0.6s in (stereo, 44.1kHz, AAC).
  - It's very quiet, peaking around −23 dBFS.
  - Make a WAV copy boosted to peak at −1 dBFS. This machine has no ffmpeg, but the browser can decode the file (the draft does, with Web Audio), so a small converter page works.
  - The streamer uploads the WAV through the `alertSound` field. Never commit the sound files.

### Avatar

- An `avatar` field (`image-input`). The streamer uploads their stream picture (a pirate poro with a bell) in StreamElements.
- The badge crops it to the poro: `object-fit: cover`, scaled 1.43 and shifted −4.4% / +3.5%, per the draft. Another square picture still works.
- With no avatar set, the badge is a plain deck-coloured circle.

### Fields (alerts)

- **Deck:** `primary`, `secondary`.
- **Look:** `avatar`, `bitsFoil` (bits for the gold foil card, default 1000).
- **Sound:** `alertSound`, `followSound`, `subSound`, `bitsSound`, `raidSound`, `volume`.
- **Position:** `centreX` (1044), `top` (44); `raidGlow` (on), `glowX`, `glowY`, `glowW`, `glowH` (432, 48, 1440, 810).

### Preview

- `/preview/?w=alerts&avatar=avatar.png&alertSound=alert-sound.mp4` works with the existing harness. It takes any field from the query string, and relative URLs resolve against `/preview/`, where the drafts' copies of the avatar and sound already are.
- Fire events from the console, e.g. `sendEvent('cheer-latest', { name: 'someone', amount: 5000 })`.
- Mute and skip can be tested with `sendEvent('event:skip', {})` and the `alertService:toggleSound` listener.
- The harness's game stand-in is a blue grid. The drafts show how to swap in `preview/game-sample.webp`; building that into the harness is the builder's call.

## Part 2: the sub train (in game-scene)

### Why it lives in game-scene

It takes the bar's ticker slot while it runs, and the bar belongs to the game-scene widget (one widget per scene layout, per CLAUDE.md). game-scene already listens for subscriber events to update its ticker.

### Behaviour

- **What counts:** every sub, resub and single gift sub adds 1, Prime included. A gift bomb adds its whole count once, from the `bulkGifted` event; its `isCommunityGift` events are ignored.
- **Starting:** a train starts with the first sub and appears from the 2nd (field, default 2).
- **Timer:** each sub refills the timer to its full length (field, default 2 minutes).
- **Levels:** every 5 subs is a level (field, default 5). Level 1 is 0–4 subs, level 2 is 5–9, and so on.
- **Ending:** when the timer runs out, the train shows "Train over" with the total ("12 subs") for 5 seconds, then fades out and the ticker comes back. A sub during "Train over" starts a new train.
- **Reloads:** the count, latest name and end time (a timestamp) are saved in `SE_API.store`, so reloading the Browser Source mid-train keeps it. A saved train that has already ended is ignored.
- **The ticker:** it pauses while the train shows and resumes afterwards. New subs still update its "latest sub" line.

### Look

Per `preview/subtrain-draft.html`. The train fills the ticker's section of the bar (after the section's hairline divider). It fits whether or not the "Current opponent" section is showing, which narrows the ticker section.

- **Count:** on the left, "×12" in Bebas Neue 76px, primary-300 with a glow. It punches in on each sub.
- **Top row:** a "Sub train" eyebrow (primary-300) on the left, and a "Level N" pill (primary wash) on the right.
- **Track** (14px, night-800): fills toward the next level, a fifth per sub, with dividers marking each sub.
  - The fill uncovers a primary→secondary gradient that spans the whole track, so the leading edge turns from primary to secondary as the next level nears.
  - Its glow follows the leading edge's colour, mixed in JS.
  - A 🚂, mirrored to face right, rides the leading edge in front of the dividers.
- **Under the track:** a thin timer line drains, with the latest subscriber below it on the left and the time left (m:ss) on the right. The timer line and time blink for the last 10 seconds.
- **Level-up:** the track runs to its end and bursts there (flash, ring, sparks in the secondary colour), while sparks fly from the count and the level pill flashes in the secondary colour. Then the track starts the next level from empty, carrying any leftover subs from a gift bomb.
- **Full steam (how the hype builds):** hype goes from 0 at level 1 to 1 at level 5, then stays at 1.
  - Steam puffs from the engine: one every ~1.4s at level 1, a steady stream at the peak. The puffs are blown back harder as hype rises.
  - The engine rattles faster, from one rattle every 0.8s to every 0.2s.
  - From level 2, thin deck-coloured and white speed lines stream right to left behind the train's content, clipped to the section. They get denser and faster with hype.

### Fields (added to game-scene)

`showTrain` (on), `trainSeconds` (120), `trainShowFrom` (2), `trainLevelEvery` (5).

## Don't port (draft-only)

The control bars, settings kept in the URL, Speed/Replay/Play buttons, the sound boost toggle, the game screenshot swap, "Jump to level", the Hold timer, and any debugging helpers.

## Repo housekeeping

- `preview/` holds personal files the drafts use: `preview/avatar.png`, `preview/alert-sound.mp4` and `preview/game-sample.webp` (which shows the opponent's name and a chat message). Add a `.gitignore` for them, plus the boosted WAV. `preview/` itself is untracked and may be committed later.
- Once the streamer approves the real widgets, delete the two draft pages.
- Update CLAUDE.md:
  - Add the alerts widget and the sub train, and remove "Alerts (follows, subs, raids) aren't built yet" from Open items.
  - Note that the alerts and train deliberately depart from the design system.
  - Correct the game UI note: the player's point track is bottom-left and the opponent's is top-right beside the log column, not "the left edge".
- Write `widgets/alerts/README.md`:
  - Paste-in steps, and what each field does.
  - Uploading the avatar and the boosted sound.
  - The OBS step. The alerts widget lives inside game-scene's overlay, so there's no new Browser Source, but the overlay's Browser Source needs "Control audio via OBS" ticked so the sound gets its own mixer fader.
- Update `widgets/game-scene/README.md` for the train and its fields.

## Decided by the streamer

- Follows: Rune burst, showing just "New follower" under the name. Follows waiting in the queue are merged into one strip ("name and N others"), since most setups just let them pile up.
- Subs, resubs and gifts: Poro party. Resubs read "Subscribed for N months".
- Bits: Card pull, without rarity labels.
- Raids: Rift, with the deck's two colours as its background, so raids are the most recognisable.
- All alerts: the compact strip, at the top of the game over the opponent's hand. Smaller than the first drafts, to keep off the opponent's board.
- The stream's avatar in a round badge on every alert.
- One sound for every alert for now, customisable per alert later.
- The sub train sits in the bar under the game, with the level shown on the right. Its track fills from primary to secondary toward the next level, and Full steam is the hype effect.
- Alerts will later show over other scenes, but only the game scene is in scope.

## Calls made by Claude (the streamer can overrule)

- The alerts widget sits inside game-scene's overlay and takes its position from fields, so it can go into other scenes' overlays later.
- Hold times: 4/5/6/8 seconds as listed above.
- Gift bomb merging; anonymous gifts show "Anonymous" as the name.
- A boosted WAV for upload, rather than boosting in the widget.
- Avatar and sounds uploaded through StreamElements fields, not committed.
- With no avatar, a plain deck-coloured circle.
- Gold foil from 1,000 bits, adjustable in a field.
- The raid glow around the game can be turned off and repositioned.
- Sub train: shows from the 2nd sub, a 2-minute timer, a level every 5 subs, 5 seconds of "Train over", and it survives reloads.
- A `.gitignore` for the personal preview files, and deleting the drafts after approval.

## Left to the builder

- Code structure, naming and exact field keys.
- Fine-tuning effects within the drafts' look.
- The formula that scales effects with event size.
- How the tier and Prime come through on `subscriber-latest` (the docs don't list a tier field), and what `alertService:toggleSound` carries. Check with the StreamElements emulator or by logging live events, and handle a missing tier by leaving it out of the line ("Just subscribed").
- How to make the boosted WAV.
