import { MODULE_ID, SETTINGS } from "./constants.js";
import { registerSettings } from "./settings.js";
import { postCardToChat, resolveSendToChat } from "./helpers.js";
import FancyDisplay from "./fancy-display.js";
import CardDealer from "./card-dealer.js";
import MacroBuilder from "./macro-builder.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/card-viewer.hbs`;
const SOCKET_EVENT = `module.${MODULE_ID}`;

/**
 * Wire up every hook this module needs. Called once from `init.js`.
 */
export default function registerHooks() {
    /* -------------------------- init -------------------------- */
    Hooks.once("init", async () => {
        registerSettings();
        // Pre-compile the viewer template so the first render doesn't pay the parse cost.
        await foundry.applications.handlebars.loadTemplates([TEMPLATE]);
    });

    /* ------------------------- setup ------------------------- */
    Hooks.once("setup", () => {
        game.modules.get(MODULE_ID).api = {
            /**
             * Factory: returns a {@link FancyDisplay} instance for direct manipulation.
             * Pass a single `front` (+ optional `back`) for one card, or a `cards` array of
             * `{front, back}` pairs to show several cards in one viewer (a non-empty `cards`
             * wins over `front`/`back`). The optional `sendToChat` key posts a clickable chat
             * message that re-opens the image later; omit it to follow the world default. The
             * optional `sound` keys override the reveal sound for this call: a path plays that
             * sound, `""` forces no sound, and omitting `sound` uses the world default.
             * `soundVolume` (0..1) and `soundChannel` (`interface`/`music`/`environment`)
             * likewise fall back to the default when omitted. `revealDelay` (ms) overrides the
             * dramatic-reveal wait; it only matters when `render(..., dramaticReveal=true)` is used,
             * during which the card cannot be clicked open early.
             * The optional `glowColor` / `glowIntensity` keys theme the glow: `glowColor` is the hue and
             * `glowIntensity` (0..1) its strength (0 turns the glow off). Omit both to use the world default.
             * The optional `reversalChance` (0..100) is the Tarot-style chance that each image is shown
             * upside-down; 0 / omitted disables it and the orientation is re-rolled on every display.
             * Example: `EpicCards.Display({ front: img }).render(true);`
             */
            Display({ front, back = null, cards = null, glowColor = null, glowIntensity, faceDown = true, sendToChat, sound, soundVolume, soundChannel, revealDelay, reversalChance = 0 } = {}) {
                // Roll the Tarot-style "reversed" flag per card, here on the originating client, so the
                // same orientation is broadcast to everyone (rolling later, per-viewer, would desync).
                const rollReversed = () => Math.random() * 100 < (reversalChance ?? 0);
                // A non-empty `cards` array shows several cards; otherwise fall back to the single
                // front/back pair so existing one-card callers keep working unchanged.
                const imgArray = Array.isArray(cards) && cards.length
                    ? cards.map(c => ({ front: c.front, back: c.back ?? null, reversed: rollReversed() }))
                    : [{ front, back, reversed: rollReversed() }];
                return new FancyDisplay({
                    imgArray,
                    glowColor,
                    glowIntensity,
                    faceDown,
                    sendToChat,
                    sound,
                    soundVolume,
                    soundChannel,
                    revealDelay
                });
            },

            /**
             * Factory: returns a {@link CardDealer} instance that ties Foundry's card logic
             * (drawing into a discard pile, looking cards up across stacks) to the 3D viewer.
             * Lets macros/modules mutate card state and show the animated viewer in one step.
             * The optional `glowColor` / `glowIntensity` keys theme the 3D viewer's glow for this call,
             * mirroring the same options on {@link FancyDisplay} (`Display`): `glowColor` is the hue and
             * `glowIntensity` (0..1) its strength. Omit them to use the global card-appearance default.
             * The optional `sound` keys override the reveal sound for every
             * card this dealer shows: a path plays that sound, `""` forces no sound, and omitting
             * `sound` uses the world default (with `soundVolume`/`soundChannel` falling back too).
             * `revealDelay` (ms) overrides the dramatic-reveal wait; it applies only to dramatic-reveal
             * draws/views, during which a card cannot be clicked open early.
             * The optional `reversalChance` (0..100) is the Tarot-style chance that each card this dealer
             * shows is upside-down; 0 / omitted disables it and the orientation is re-rolled per display.
             * Example: `EpicCards.Dealer({ deckName, discardPileName }).draw({ share: true });`
             */
            Dealer({ deckName, discardPileName, glowColor = null, glowIntensity, sound, soundVolume, soundChannel, revealDelay, reversalChance = 0 }) {
                return new CardDealer({ deckName, discardPileName, glowColor, glowIntensity, sound, soundVolume, soundChannel, revealDelay, reversalChance });
            },

            /**
             * Open the macro-builder form: fill in a few fields and it writes a ready-to-run
             * script macro into a fixed folder. Helps users who aren't comfortable writing
             * macros by hand. GM-only, because creating the world Folder it stores macros in
             * is GM-restricted in Foundry.
             * Example: `EpicCards.MacroBuilder();`
             * @returns {Promise<MacroBuilder>|null} The rendered app, or null for non-GMs.
             */
            MacroBuilder() {
                if (!game.user.isGM) {
                    ui.notifications.warn("Only the GM can create macros with this tool.");
                    return null;
                }
                return new MacroBuilder().render({ force: true });
            }
        };
    });

    /* ------------------------- ready ------------------------- */
    Hooks.once("ready", () => {
        // Single global namespace. Mirrors the module API so macros can call either
        // `EpicCards.Display(...)` or `game.modules.get(MODULE_ID).api.Display(...)` interchangeably.
        globalThis.EpicCards = game.modules.get(MODULE_ID).api;

        // Native socket. Single channel, payload `{ type, payload }`.
        game.socket.on(SOCKET_EVENT, (data) => _onSocketMessage(data));
    });

    /* ------------------------ card UIs ----------------------- */
    // Sidebar / Cards stack window: clicking a card thumbnail opens the viewer.
    Hooks.on("renderCardsConfig", (app, html) => {
        const root = html instanceof HTMLElement ? html : html?.[0];
        if (!root) return;
        _registerCardImgClickInDeck(root, app.document);
    });

    // Chat message: clicking the embedded card thumbnail opens the viewer.
    // V14 hook fires with a real HTMLElement (renderChatMessage with jQuery is deprecated).
    Hooks.on("renderChatMessageHTML", (message, html) => _registerCardImgClickInChat(html));
}

/**
 * Receive a socket message broadcast by another client and react accordingly.
 * Currently only handles `shareToAll` (open the viewer with the sender's payload).
 * @param {{type:string, payload:object}} data
 */
function _onSocketMessage({ type, payload } = {}) {
    if (type !== "shareToAll" || !payload) return;
    new FancyDisplay({
        imgArray: payload.images,
        glowColor: payload.glowColor,
        glowIntensity: payload.glowIntensity,
        faceDown: payload.faceDown,
        // The sender resolved these, so pass them through verbatim ("" stays "no sound").
        sound: payload.sound,
        soundVolume: payload.soundVolume,
        soundChannel: payload.soundChannel,
        // Carry the delay so a replayed dramatic reveal waits the same amount of time as the sender.
        revealDelay: payload.revealDelay,
        // Everyone is already seeing this card, so the receiving viewer hides the share button.
        isShared: true
        // Replay the dramatic reveal (locked, timed) when the sender was still mid-reveal.
    }).render(false, !!payload.dramaticReveal);
}

/**
 * Open the viewer for a single deck card and post its chat preview.
 * Local views whisper the GM; sharing later (via the viewer's eye button) posts publicly.
 * @param {Card} card           The card document to display.
 * @param {string} deckName     Name of the deck the card belongs to (used by the chat preview).
 * @param {object} [options]
 * @param {boolean} [options.faceDown=false]      Render face-down initially.
 * @param {boolean} [options.suppressChat=false]  Skip the chat preview. Used when re-opening
 *                                                a card from an existing chat message.
 * @param {boolean} [options.reversed=false]      Show the card upside-down (Tarot-style). Carried
 *                                                back from a chat re-open so the orientation matches
 *                                                the published thumbnail; sidebar clicks leave it off.
 */
function _viewCard(card, deckName, { faceDown = false, suppressChat = false, reversed = false } = {}) {
    const props = {
        id: card.id,
        name: card.faces[0].name,
        front: card.faces[0].img,
        back: card.back.img,
        desc: card.faces[0].text,
        reversed
    };

    // Deck/sidebar clicks have no per-call override, so they follow the world default.
    const sendToChat = resolveSendToChat();

    const postPreview = () =>
        postCardToChat({ deckName, cardId: props.id, cardName: props.name, front: props.front, desc: props.desc, reversed: props.reversed, isPublic: false });

    new FancyDisplay({
        imgArray: [props],
        faceDown,
        sendToChat,
        chatMeta: { deckName, cards: [props] },
        // A face-down card holds its preview (which shows the front) until it is flipped face-up
        // in the viewer, so it isn't posted to chat while still sitting face-down.
        onReveal: sendToChat && !suppressChat && faceDown ? postPreview : undefined
    }).render(false);

    // Face-up views post the preview now; face-down views defer to onReveal above.
    if (sendToChat && !suppressChat && !faceDown) postPreview();
}

/**
 * Find a card by id across every Cards stack in the world.
 * Needed because cards can move between deck / hand / pile freely.
 * @param {string} cardId  Card document id.
 * @returns {Card|undefined}
 */
function _findCardAnywhere(cardId) {
    return game.cards.find(stack => stack.cards.get(cardId))?.cards.get(cardId);
}

/**
 * Wire click handlers on card thumbnails inside a CardsConfig sheet so clicking opens the viewer.
 * @param {HTMLElement} root      The sheet's root element.
 * @param {Cards} deckDoc         The Cards document the sheet is rendering.
 */
function _registerCardImgClickInDeck(root, deckDoc) {
    if (!game.settings.get(MODULE_ID, SETTINGS.ENABLE_CARD_ICON_CLICK)) return;

    // The render hook fires on every re-render but AppV2 reuses the same root element,
    // so guard against stacking duplicate listeners (each one would open its own viewer).
    if (root.dataset.dcvCardClickBound) return;
    root.dataset.dcvCardClickBound = "true";

    root.addEventListener("click", (event) => {
        const img = event.target.closest("img.card-face, .cards img.face");
        if (!img) return;

        const li = img.closest("li");
        const cardId = li?.dataset.cardId;
        if (!cardId) return;

        const deckCard = deckDoc?.cards?.get(cardId);
        if (!deckCard) return;

        // Source face: null means showing the back (face-down).
        _viewCard(deckCard, deckCard.source.name, { faceDown: deckCard.face === null });
    });
    // TODO: drag-to-canvas support.
}

/**
 * Wire a click handler on the card thumbnail embedded in our chat previews so any user
 * can re-open the viewer from chat history. Not gated by the clickable-icon setting: these
 * cards exist only because the user opted into "send to chat", and being clickable to re-open
 * is their entire purpose.
 * @param {HTMLElement} html  The rendered chat message element.
 */
function _registerCardImgClickInChat(html) {
    // Attribute selector matches the class built from MODULE_ID in the chat HTML.
    const selector = `[class~="${MODULE_ID}-msg"]`;
    const message = html.querySelector(selector);
    if (!message) return;

    message.addEventListener("click", (event) => {
        const img = event.target.closest("img.card-face");
        if (!img) return;

        const container = img.closest(selector);
        if (!container) return;

        // Re-open with the same orientation that was published, so a reversed thumbnail re-opens
        // reversed (the flag was rolled once and stored on the message; it is not re-rolled here).
        const reversed = container.dataset.reversed === "true";

        // Raw-image displays carry their image set inline; deck cards carry a deck/card reference.
        if (container.dataset.reopenKind === "image") {
            new FancyDisplay({
                imgArray: [{ front: container.dataset.front, back: container.dataset.back || null, reversed }],
                glowColor: container.dataset.glow || null,
                glowIntensity: container.dataset.glowIntensity ? Number(container.dataset.glowIntensity) : undefined,
                faceDown: container.dataset.faceDown === "true",
                // Re-opening from chat must not post a second message.
                sendToChat: false
            }).render(false);
            return;
        }

        const deckName = container.dataset.deck;
        const cardId = container.dataset.card;
        if (!deckName || !cardId) return;

        const card = _findCardAnywhere(cardId);
        if (!card) {
            ui.notifications.warn("No card with that id was found in any stack.");
            return;
        }

        // Re-opening from chat must not post a second chat preview.
        _viewCard(card, deckName, { suppressChat: true, reversed });
    });
    // TODO: drag-to-canvas support.
}
