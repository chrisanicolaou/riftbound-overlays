# Game scene

Camera top left, chat below it, the game at 75% (1440×810) top right, and a bar under the game. It's one StreamElements widget covering the whole 1920×1080 canvas. The camera and game are OBS sources placed *under* the overlay, and they show through rounded holes in its backdrop. Chat comes from a ProChat Browser Source placed *over* it.

The backdrop is the design system's shatter Backdrop: the deck's two colours as grainy shards drifting slowly down and to the right over a graphite fade. The shards are kept out from behind the chat panel and the bar, so those stay plain.

The bar, left to right:

- **Title:** a deck name ("Kai'Sa") or a stream title ("Kai'Sa coaching from willwin"). Long titles shrink from 44px to 32px to fit, up to about 45 characters.
- **Current opponent:** e.g. "Renekton". Hidden until set.
- **Ticker:** your info lines plus the latest follower, sub and raid, one every N seconds. A new follower, sub or raid shows straight away. Events are Twitch only.
- **Record:** the stream's wins and losses.

## StreamElements

1. Create a 1920×1080 overlay and add a Custom Widget. Set the widget to position 0,0 and size 1920×1080.
2. In the widget's editor, paste `html.html` into HTML, `css.css` into CSS, `js.js` into JS and `fields.json` into FIELDS. Click Done, then save the overlay.
3. In the widget's settings:
   - Type the bar title, and pick the deck's Primary / Secondary domains. The domains only set the overlay's colours.
   - Write the ticker lines as `Label: text`, separated by `|`. For example: `YouTube: @handle | Deck list: type !deck in chat`.

## Chat commands

From you or a moderator, in Twitch chat (ProChat can send them). StreamElements doesn't receive YouTube chat.

| Command | Does |
|---|---|
| `!win` / `!loss` | adds a win or a loss |
| `!undo` | removes the last result |
| `!reset` | sets the record back to 0–0 |
| `!vs Renekton` | sets the current opponent |
| `!vs` | hides the current opponent |

The record and opponent are saved in StreamElements, so they survive reloads. They start fresh when nothing has changed for 6 hours (the "fresh record" setting), so each stream starts at 0–0.

## OBS scene, top to bottom

Set each one with Edit Transform (Ctrl+E): position, then size with the bounding box type set to "Stretch to bounds".

| Source | Type | Position | Size |
|---|---|---|---|
| ProChat overlay | Browser Source, 312×568 | 72, 440 | 312×568 |
| StreamElements overlay | Browser Source, 1920×1080 | 0, 0 | 1920×1080 |
| Camera | your camera, cropped square (e.g. crop 420 left and right on a 1920×1080 camera) | 48, 48 | 360×360 |
| Game capture | window or game capture | 432, 48 | 1440×810 |

The ProChat URL contains an access token. Keep it in OBS only, never in this repo.

## ProChat overlay settings

ProChat's page blocks OBS's Custom CSS, so it can only be styled through its own Overlay settings. These get closest to the design system:

- Font: `Figtree`, font size 20px, emote size about 28px
- Background transparency 100%, outline 0px, drop shadow distance 0px
- Newest at bottom, new message animation Slide up, message fade out Never
- Platform icons Show (that's what tells Twitch from YouTube)
- Chatter badges Hide, Activity Hide, Moderation events Hide, moderated message text Hide

Names keep each viewer's platform colour. ProChat can't change that.

## Preview

Run `python -m http.server 8765` in the repo root, then open `http://localhost:8765/preview/?w=game-scene&primary=calm&secondary=order`. Any field can go in the query string. Chat in the preview is a mock of ProChat with made-up messages. In the browser console, `sendChat("!win")` sends a command as the broadcaster, and `sendEvent("follower-latest", { name: "someone" })` fires an event.
