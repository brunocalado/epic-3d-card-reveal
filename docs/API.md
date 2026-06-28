# Epic 3D Card Reveal — API Reference

The API is exposed under the global `EpicCards` namespace, which mirrors `game.modules.get('epic-3d-card-reveal').api`. Either entry point can be used interchangeably from macros and other modules.

The global is assigned during the `ready` hook; the API object itself exists from `setup` onward.

## Sharing & chat behavior

- **Any user can share.** The share (eye) button in the viewer is available to players and GMs alike. It is hidden only when the card is already being broadcast to everyone (sharing again would be pointless).
- **Revealing a card posts a clickable chat message** (when `sendToChat` is on — see below). Clicking the thumbnail in that message re-opens the card/image locally, which is handy when a card is closed by accident. Public posts go to everyone; non-public posts are whispered to the GM.
- This applies to every flow: deck/sidebar clicks, `Dealer.draw`, `Dealer.view`, **and** arbitrary `Display` images (the message carries the image itself so it can be re-opened with no backing Card document).
- Re-opening a card from a chat thumbnail never posts a second message.
- **All chat messages share one card style** (accent border, dark header, no background image), produced by a single `buildChatCard` helper.

### Card descriptions

A **Send card description to chat** world setting (Configure Settings → Module Settings) adds the card's description to the chat preview. It is **off by default**, so existing previews (image + name only) are unchanged until you enable it.

- The text comes from the **Card document's own description** field — the same place lore decks such as the **PF2e Harrow Deck** store their card text. (It is not the per-face text.)
- The description is **enriched** before posting (`TextEditor.enrichHTML`), so `@UUID` links, formatting, and inline rolls render instead of appearing as raw markup.
- Only **deck cards** can carry a description. Cards with an empty description, and arbitrary images shown through `Display` (which have no backing Card document), post exactly as they do today.
- The setting is the default for every chat path (deck/sidebar clicks, `Dealer.draw`, `Dealer.view`). `Dealer.draw` and `Dealer.view` accept an optional **`showDescription`** boolean that overrides it per call (omit to follow the world default); the macro builder bakes this choice for deck macros (see below).

### `sendToChat`

Every entry point accepts an optional `sendToChat` boolean.

- **Default:** the **Send revealed cards to chat** world setting (Configure Settings → Module Settings), which ships enabled.
- **Override:** pass `sendToChat: true`/`false` per call to force the behavior regardless of the setting.
- The macro builder exposes this as a **Send to chat** toggle (Appearance tab), seeded from the world default, and bakes the chosen value into the generated macro.
- The chat preview is posted **the moment the card's face is revealed**, never before — so it can't spoil a hidden card. A **face-up** card posts immediately; a **face-down** card posts when you flip it face-up (close it without flipping and nothing is posted); a **dramatic reveal** posts when the cards auto-flip after the delay. This mirrors the [reveal sound](#reveal-sound).

Cross-client sharing uses Foundry's native socket API (`module.epic-3d-card-reveal` channel); no socketlib dependency.

## Appearance defaults

Glow color/intensity, the default card back image, and the dramatic reveal delay come from the **Configure Card Appearance** settings menu (stored in the hidden `cardAppearance` world setting, a `DataModel`). Every visual option below overrides those defaults per call.

The glow is controlled by two values: **Glow color** (the hue, defaulting to gold) and **Glow intensity** (a `0`–`1` strength). At `0` the glow is off; the rest of the slider is a usable band with no dead zone — the default already gives a strong glow, and the top of the slider pushes it brighter and wider still.

## Reveal sound

A sound can play when a card's **face** is revealed.

- **Plays only when the face is seen.** A card shown face-up plays the sound immediately; a card shown face-down (or in a dramatic reveal) plays it the moment it is flipped/auto-flipped face-up — never while only the back is showing.
- **Plays once per viewer.** Flipping a card back and forth won't replay it.
- **Local to the viewing client.** Each client that sees the card plays the sound on its own audio device — nothing is streamed between clients. When a card is shared, everyone viewing it hears it locally.

Defaults come from the **Configure Reveal Sound** settings menu (GM-only, under Configure Settings → Module Settings), stored in the hidden `revealSound` world setting (a `DataModel`):

| Field | Description |
|---|---|
| **Reveal sound** | Audio file to play. Ships with `assets/reveal.ogg`. **Leave blank for no sound.** |
| **Reveal sound volume** | Playback volume, `0`–`1`. The chosen channel's mixer volume still applies on top. |
| **Audio channel** | Which audio channel / mixer slider the sound plays through: `interface`, `music`, or `environment`. |

The menu includes a **Reset to Defaults** button that restores the shipped sound, volume, and channel.

Every entry point can override these per call with `sound`, `soundVolume`, and `soundChannel` (see the option tables below). For `sound`:

- **omit it** → use the world default reveal sound;
- **a file path** → play that sound;
- **`""` (empty string)** → play **no sound** for this call, regardless of the world default.

`soundVolume` and `soundChannel` fall back to the world default whenever omitted. The macro builder exposes all of this as a **Reveal sound** control (Appearance tab) with three modes — *Use module default*, *Custom sound* (file + volume + channel), and *No sound* — and bakes the result into the generated macro.

## Reversed cards (Tarot-style)

Every entry point accepts an optional `reversalChance` (`0`–`100`): the percent chance that each card it shows is rendered **upside-down** (rotated 180°), the way a Tarot reading distinguishes a reversed card.

- **Off by default.** `reversalChance` defaults to `0`, so nothing is reversed unless you ask for it. `50` gives each card a coin-flip; `100` reverses every card.
- **Per card.** With multiple cards, each one rolls independently.
- **Re-rolled on every display.** The orientation is **not** stored on the card — drawing or viewing the same card again rolls afresh.
- **Text is never changed.** Only the *visual* is flipped; the card's chat description is posted exactly as written, matching real Tarot practice where the reversed meaning is inferred by the reader. The chat thumbnail mirrors the orientation and is tagged **"Reversed"**.
- **Consistent across the table and on re-open.** The roll happens once on the client that triggers the display, so every player who is shown the card sees the same orientation. The orientation is stored on the chat message, so clicking the thumbnail re-opens the card the same way up it was published.
- The macro builder exposes this as a **Reversed chance** slider (Appearance tab); leaving it at `0` bakes nothing into the generated macro.

---

## `EpicCards.Display(options)`

Construct a card-display instance for any image.

### Options
| Option | Type | Description |
|---|---|---|
| `front` | `string` | Image path or URL. Best with card-shaped images. |
| `back` | `string` (optional) | Back-image path. Falls back to the configured default card back. |
| `glowColor` | `string` (optional) | Card glow color — the hue of the halo around the card (any CSS color). Omit to use the world default. |
| `glowIntensity` | `number` (optional) | Glow strength, `0`–`1`. `0` turns the glow off; higher is brighter/wider. Omit to use the world default. When omitted but a raw `glowColor` (with its own alpha) is given, that color is used as-is. |
| `faceDown` | `boolean` (optional) | Render face-down initially. Default `true`. |
| `sendToChat` | `boolean` (optional) | Post a clickable chat message that re-opens this image. Omit to use the world default. |
| `sound` | `string` (optional) | Reveal-sound override. A path plays that sound; `""` forces no sound; omit to use the world default. See [Reveal sound](#reveal-sound). |
| `soundVolume` | `number` (optional) | Reveal-sound volume (`0`–`1`). Omit to use the world default. |
| `soundChannel` | `string` (optional) | Reveal-sound channel: `interface`, `music`, or `environment`. Omit to use the world default. |
| `revealDelay` | `number` (optional) | Dramatic-reveal delay in ms, overriding the world default. Applies only when rendered with `dramaticReveal`. |
| `reversalChance` | `number` (optional) | `0`–`100` chance that each image is shown upside-down (Tarot-style). `0` (default) disables it; re-rolled per display. See [Reversed cards](#reversed-cards-tarot-style). |

### Returns
An instance with a `.render(shareToAll, dramaticReveal)` method.

- `shareToAll` `{boolean}` — broadcast the view to all connected clients. Default `false`.
- `dramaticReveal` `{boolean}` — render face-down first, then auto-flip after the configured delay (`revealDelay`, or the world default). The card **cannot be clicked to flip early** — it must wait out the delay — and when shared, every client waits out the same reveal together. Default `false`.

### Example
```js
const myViewer = EpicCards.Display({
    front: 'https://i.imgur.com/someAmazingCardFrontImage.jpg',
    back: 'https://i.imgur.com/someAmazingCardBackImage.jpg',
    glowColor: 'rgba(200,200,255,0.4)',
    faceDown: false
});

// ...later
myViewer.render(true);
```

---

## `EpicCards.Dealer(options)`

The viewer's primary job is to show an image with the animated 3D presentation — and `Display` covers that for any arbitrary image. `Dealer` is the optional **card-logic assistant** layered on top: it ties Foundry's `Cards` API (drawing into a discard pile, finding a card across stacks) to that same viewer, so a macro or module can mutate card state **and** show the animated card in a single step instead of re-implementing the deck/pile plumbing.

Construct a dealer bound to a named deck (and, optionally, a named discard pile).

### Options
| Option | Type | Description |
|---|---|---|
| `deckName` | `string` | Name of the source `Cards` deck. |
| `discardPileName` | `string` (optional) | Name of the discard pile to draw into. If omitted, the dealer smart-matches an existing pile by name, or auto-creates `"<deckName> - Discard Pile"` on the first draw. |
| `glowColor` | `string` (optional) | Glow color (hue) for every card this dealer shows. Omit to use the world default. |
| `glowIntensity` | `number` (optional) | Glow strength (`0`–`1`) for every card this dealer shows; `0` turns the glow off. Omit to use the world default. |
| `sound` | `string` (optional) | Reveal-sound override applied to every card this dealer shows. A path plays that sound; `""` forces no sound; omit to use the world default. See [Reveal sound](#reveal-sound). |
| `soundVolume` | `number` (optional) | Reveal-sound volume (`0`–`1`). Omit to use the world default. |
| `soundChannel` | `string` (optional) | Reveal-sound channel: `interface`, `music`, or `environment`. Omit to use the world default. |
| `revealDelay` | `number` (optional) | Dramatic-reveal delay in ms for every card this dealer shows, overriding the world default. Applies only to dramatic-reveal draws/views. |
| `reversalChance` | `number` (optional) | `0`–`100` chance that each card this dealer shows is upside-down (Tarot-style). `0` (default) disables it; re-rolled per display. See [Reversed cards](#reversed-cards-tarot-style). |

Initialization is asynchronous (it resolves the deck/pile Documents by name); every method below awaits that internally, so you can call them immediately after construction.

### Returns
A `CardDealer` instance with `.draw(options)` and `.view(cards, faceDown, dramaticReveal, share)` methods.

#### `.draw(options)`
Draws random cards from the deck into the discard pile, displays them in the viewer, and posts the usual chat preview once the cards are revealed (public when shared, otherwise a GM whisper). See [`sendToChat`](#sendtochat) for the exact post timing of face-down/dramatic draws.

| Option | Type | Description |
|---|---|---|
| `quantity` | `number` (optional) | How many cards to draw. Default `1`. |
| `share` | `boolean` (optional) | Broadcast the view to all clients. Default `true`. |
| `face` | `"up"\|"down"\|"reveal"` (optional) | Force the initial face, overriding each card's source face. `"reveal"` renders face-down then auto-flips after the dramatic-reveal delay, and cannot be clicked open early. |
| `sendToChat` | `boolean` (optional) | Post a clickable chat message that re-opens each card. Omit to use the world default. |
| `showDescription` | `boolean` (optional) | Include the card's description in the chat message. Omit to use the world default ([Card descriptions](#card-descriptions)). |

#### `.view(cards, faceDown, dramaticReveal, share, options)`
Displays one or more **existing** cards (no draw side effect) and posts the chat preview once the cards are revealed (see [`sendToChat`](#sendtochat) for the timing of face-down/dramatic views).

| Param | Type | Description |
|---|---|---|
| `cards` | `string \| string[]` | Card ID(s) or name(s), searched across every stack in the world. |
| `faceDown` | `boolean` | Render face-down initially. |
| `dramaticReveal` | `boolean` | Render face-down, then auto-flip after the configured delay; the card cannot be clicked open early. |
| `share` | `boolean` | Broadcast the view to all clients. |
| `options` | `object` (optional) | `{ sendToChat, showDescription }` — post a clickable chat message that re-opens each card, and whether that message includes the card's description. Omit either to use its world default. |

### Example
```js
// Draw 3 cards into the discard pile and show them to everyone.
EpicCards.Dealer({
    deckName: 'Deck of Many Things',
    discardPileName: 'Deck of Many Things - Discard Pile'
}).draw({ quantity: 3, share: true });

// Or just re-display an existing card by name, dramatic reveal, GM-only.
EpicCards.Dealer({ deckName: 'Deck of Many Things' })
    .view('The Void', true, true, false);
```

---

# Macro builder

Prefer not to write macros by hand? The module ships a fill-in **macro builder** that turns a few fields into a ready-to-run script macro (display an image, draw from a deck, or view a specific card). Open it either way:

- **`EpicCards.MacroBuilder()`** from a macro or the console, or
- the **Open Macro Builder** button under Configure Settings → Module Settings.

Both open the same form and are GM-only. Generated macros land in the `3D Card Macros` folder.

The Appearance tab also exposes the **Dramatic reveal** toggle; enabling it forces **Start face-down** on and reveals a **Dramatic reveal delay (ms)** field (seeded from the world default), baked into the generated macro as `revealDelay`. During a dramatic reveal the card cannot be clicked open early — every viewer waits out the delay — and the wait is synchronized to all players when the card is shared.

The Appearance tab's **Reversed chance** slider sets `reversalChance` (`0`–`100`) on the generated macro; left at `0` it bakes nothing, so cards are never reversed unless you raise it. See [Reversed cards](#reversed-cards-tarot-style).

The Appearance tab also shows a **Send card description** toggle, but only for the deck-backed macro types (**Draw from a deck** and **View specific cards**) — Display-image macros have no card description, so it is hidden for them. It is seeded from the world setting and baked onto the generated macro as `showDescription`. See [Card descriptions](#card-descriptions).

# Macro example

Want to write one by hand instead? The module ships no macro compendium; copy this straight into a world macro.

## View any image as a card

```js
const img = 'modules/epic-3d-card-reveal/assets/beefy-abraham-lincoln.webp';
const backImg = 'https://i.imgur.com/mStOCso.png'; // optional
const glowColor = 'rgba(200,200,255,0.4)';         // optional
const shareToAll = true;                           // optional

EpicCards.Display({
   front: img,
   back: backImg,
   glowColor,
   // Reveal-sound overrides are optional. Omit them to use the world default,
   // pass a path for a custom sound, or pass sound: "" for no sound.
   // sound: 'modules/epic-3d-card-reveal/assets/reveal.ogg',
   // soundVolume: 0.8,
   // soundChannel: 'interface'
}).render(shareToAll);
```

## Draw a card from a deck (with card logic)

Use `Dealer` when you also want the draw recorded in Foundry — the card moves from the deck into the discard pile, and the same draw shows up in the 3D viewer.

```js
const deckName = 'Deck of Many Things'; // a Cards deck in your world
const discardPileName = undefined;      // optional; smart-matched or auto-created
const quantity = 1;                     // optional
const share = true;                     // optional

EpicCards.Dealer({ deckName, discardPileName }).draw({ quantity, share });
```
