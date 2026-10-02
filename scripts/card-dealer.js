import { FLAGS, MODULE_ID } from "./constants.js";
import { postCardToChat, postChatAfterReveal, resolveSendToChat, resolveShowDescription } from "./helpers.js";
import FancyDisplay from "./fancy-display.js";

/**
 * Coordinates drawing cards from a deck into a discard pile and rendering them
 * through {@link FancyDisplay}. The deck and pile Documents are looked up by {@link draw} itself, on
 * every call, so a dealer never holds a stale or half-initialized reference.
 *
 * This is the optional "card logic" assistant on top of the primary {@link FancyDisplay}
 * viewer: macros/modules that want to mutate card state (draw into a discard pile, move
 * cards between stacks) AND show the animated viewer in one step can lean on it instead
 * of wiring the Cards API themselves.
 */
export default class CardDealer {
    /**
     * @param {object} opts
     * @param {string} opts.deckName             Name of the source `Cards` deck.
     * @param {string} [opts.discardPileName]    Optional name of the discard pile to use (created if missing); if absent,
     *                                           the deck's own auto-created pile is used.
     * @param {string} [opts.glowColor]          Optional viewer glow color (hue) override.
     * @param {number} [opts.glowIntensity]      Optional viewer glow strength (0..1) override; 0 turns the glow off.
     * @param {string} [opts.sound]              Optional reveal-sound override: a path plays that sound, `""` forces
     *                                           no sound, and omitting it uses the world default reveal sound.
     * @param {number} [opts.soundVolume]        Optional reveal-sound volume override (0..1).
     * @param {string} [opts.soundChannel]       Optional reveal-sound audio channel override.
     * @param {number} [opts.revealDelay]        Optional dramatic-reveal delay override (ms). Used only when a
     *                                           card is shown with a dramatic reveal; omit for the world default.
     * @param {number} [opts.reversalChance]     Optional 0..100 chance that each card is shown upside-down
     *                                           (Tarot-style). 0 / omitted disables it. Re-rolled per display.
     */
    constructor({ deckName, discardPileName, glowColor = null, glowIntensity, sound, soundVolume, soundChannel, revealDelay, reversalChance = 0 } = {}) {
        this.deckName = deckName;
        this.discardPileName = discardPileName;

        // Optional viewer glow overrides forwarded to FancyDisplay on draw()/view().
        // When left null/undefined, FancyDisplay falls back to the global card-appearance default.
        this.glowColor = glowColor;
        this.glowIntensity = glowIntensity;

        // Optional reveal-sound overrides forwarded to FancyDisplay on draw()/view().
        // Left undefined, FancyDisplay falls back to the global reveal-sound default.
        this.sound = sound;
        this.soundVolume = soundVolume;
        this.soundChannel = soundChannel;

        // Optional dramatic-reveal delay forwarded to FancyDisplay on draw()/view().
        // Falls back to the world default when undefined.
        this.revealDelay = revealDelay;

        // Optional Tarot-style "reversed" chance (0..100). Each card displayed by this dealer rolls
        // independently against it; the orientation is re-rolled per display (never persisted).
        this.reversalChance = reversalChance;
    }

    /**
     * Draw one or more random cards from the deck into the discard pile and display them.
     * @param {object} [options]
     * @param {number} [options.quantity=1]      How many cards to draw.
     * @param {boolean} [options.share=true]     Whether to share the rendered cards with all players.
     * @param {"up"|"down"|"reveal"} [options.face]  Force a specific face / reveal behavior, overriding the source face.
     * @param {boolean} [options.sendToChat]     Whether to post a clickable chat message that re-opens each card.
     *                                           Omit to follow the world default.
     * @param {boolean} [options.showDescription]  Whether the chat message includes the card's description.
     *                                             Omit to follow the world default.
     * @returns {Promise<Array<object>|null>}    The data of the cards that were drawn and shown — one entry
     *   per card, as produced by {@link _extractCardProperties} — or `null` if nothing was drawn. Exposed so
     *   another module can act on the same cards (e.g. place them on the scene with the orientation the table
     *   just saw): `reversed` is rolled here and never persisted on the Card, so this is the only way to read
     *   it. Resolves once the cards are drawn and the viewer has been launched, NOT when the reveal animation
     *   finishes — the roll is already final by then. The entries are copies; mutating them affects nothing.
     */
    async draw({ quantity = 1, share = true, face, sendToChat, showDescription } = {}) {
        const { deckName } = this;
        let deck, pile;
        try {
            if (!deckName) {
                ui.notifications.warn("Deck name not provided.");
                return null;
            }
            deck = game.cards.getName(deckName);
            // Bail before touching the pile so a dud dealer never creates a stray discard pile.
            if (!deck) {
                ui.notifications.warn(`No deck named "${deckName}" was found.`);
                return null;
            }
            pile = await this._resolveDiscardPile(deck);
        } catch (error) {
            console.error(`${MODULE_ID} | Error rendering CardDealer.draw().`, error);
            return null;
        }

        // Expected, user-facing condition: the deck has run dry (all cards drawn). Foundry's
        // Cards#draw throws a technical error in this case (e.g. "There are not 1 available cards
        // remaining in Cards [id]"), so check up front to surface a clean message instead.
        const available = deck.availableCards?.length ?? 0;
        if (available < quantity) {
            ui.notifications.warn(
                available === 0
                    ? `The deck "${deckName}" has no cards left to draw. Reset or recall the deck and try again.`
                    : `The deck "${deckName}" only has ${available} card(s) left to draw, but ${quantity} were requested.`
            );
            return null;
        }

        try {
            await pile.draw(deck, quantity, { how: CONST.CARD_DRAW_MODES.RANDOM });
        } catch (error) {
            // Fallback for unexpected draw failures (e.g. a concurrent draw emptied the deck after
            // the check above): tell the user something went wrong and keep the detail in the console.
            ui.notifications.error(`Could not draw from the deck "${deckName}". See the console for details.`);
            console.error(`${MODULE_ID} | Error drawing cards from the deck.`, error);
            return null;
        }

        try {
            const drawnCards = pile.cards.contents.slice(-quantity);
            const faceDown =
                face && face.toLowerCase() === "down" ? true :
                face && (face.toLowerCase() === "up" || face.toLowerCase() === "reveal") ? false :
                drawnCards[0].face === null; // source face: null = showing back = face-down

            // Dramatic reveal only triggers when explicitly requested via face: "reveal".
            const dramaticReveal = !!(face && face.toLowerCase() === "reveal");
            // A face-down draw with no dramatic auto-reveal waits for a manual flip in the viewer.
            const manualReveal = faceDown && !dramaticReveal;

            const drawnArray = drawnCards.map(c => this._extractCardProperties(c));
            const post = resolveSendToChat(sendToChat);
            const showDesc = resolveShowDescription(showDescription);

            // Drawn cards land in chat (when enabled): publicly when shared with everyone, otherwise
            // as a GM whisper so the GM can re-open them later.
            const postPreviews = () => {
                for (const { id, name, front, desc, reversed } of drawnArray) {
                    postCardToChat({ deckName, cardId: id, cardName: name, front, desc, reversed, isPublic: share, showDescription: showDesc });
                }
            };

            new FancyDisplay({
                imgArray: drawnArray,
                glowColor: this.glowColor,
                glowIntensity: this.glowIntensity,
                faceDown,
                sendToChat: post,
                // Carry the resolved flag so a later eye-button share (CardViewerApp#_onShare) posts
                // the description consistently with this draw.
                chatMeta: { deckName, cards: drawnArray, showDescription: showDesc },
                sound: this.sound,
                soundVolume: this.soundVolume,
                soundChannel: this.soundChannel,
                revealDelay: this.revealDelay,
                // For a manual face-down reveal, hold the preview (which shows the front) until the
                // card is flipped face-up in the viewer, so it isn't posted while sitting face-down.
                onReveal: post && manualReveal ? postPreviews : undefined
            }).render(share, dramaticReveal);

            // Face-up posts now; a dramatic reveal holds the preview until the cards auto-flip. A
            // manual face-down reveal is handled by onReveal above instead.
            if (post && !manualReveal) postChatAfterReveal(dramaticReveal, this.revealDelay, postPreviews);

            // Hand back copies, never the live array: FancyDisplay#render mutates these entries to
            // fill in a missing `back` with the world default, so the original would change under
            // the caller after this method has already resolved.
            return drawnArray.map(c => ({ ...c }));
        } catch (error) {
            console.error(`${MODULE_ID} | Error rendering CardDealer.draw().`, error);
            return null;
        }
    }

    /**
     * View one or more existing cards (no draw side effect).
     * A chat preview is always posted: publicly when shared with everyone, otherwise
     * whispered to the GM so the card can be re-opened later from chat history.
     * @param {Array<string>|string} cards    Card IDs or names, in any deck.
     * @param {boolean} faceDown              Render face-down initially.
     * @param {boolean} dramaticReveal        Render face-down then auto-flip after a delay.
     * @param {boolean} share                 Broadcast to all players.
     * @param {object} [options]
     * @param {boolean} [options.suppressChat=false]  Skip the chat preview. Used when re-opening
     *                                                a card from an existing chat message.
     * @param {boolean} [options.sendToChat]          Whether to post a clickable chat message that
     *                                                re-opens each card. Omit to follow the world default.
     * @param {boolean} [options.showDescription]     Whether the chat message includes the card's
     *                                                description. Omit to follow the world default.
     * @returns {Promise<Array<object>|null>}  The data of the cards that were shown — one entry per resolved
     *   card, as produced by {@link _extractCardProperties} — or `null` if none could be resolved. Cards that
     *   were not found are warned about and left out. See {@link draw} for the timing and copy semantics.
     */
    async view(cards, faceDown, dramaticReveal, share, { suppressChat = false, sendToChat, showDescription } = {}) {
        try {
            const { deckName } = this;
            const cardsArray = Array.isArray(cards) ? cards : [cards];

            if (!cardsArray.length) {
                ui.notifications.warn("Please provide a card name or ID.");
                return null;
            }

            const cardDataArray = [];
            for (const card of cardsArray) {
                const cardToView = this._findCardAnywhere(card);
                if (!cardToView) {
                    ui.notifications.warn(`${card}: No card by that ID or name was found.`);
                    continue;
                }
                cardDataArray.push(this._extractCardProperties(cardToView));
            }
            if (!cardDataArray.length) return null;
            const post = resolveSendToChat(sendToChat);
            const showDesc = resolveShowDescription(showDescription);
            // A face-down view with no dramatic auto-reveal waits for a manual flip in the viewer.
            const manualReveal = !!faceDown && !dramaticReveal;

            const postPreviews = () => {
                for (const { id, name, front, desc, reversed } of cardDataArray) {
                    postCardToChat({ deckName, cardId: id, cardName: name, front, desc, reversed, isPublic: share, showDescription: showDesc });
                }
            };

            new FancyDisplay({
                imgArray: cardDataArray,
                glowColor: this.glowColor,
                glowIntensity: this.glowIntensity,
                faceDown,
                sendToChat: post,
                // Carry the resolved flag so a later eye-button share posts the description consistently.
                chatMeta: { deckName, cards: cardDataArray, showDescription: showDesc },
                sound: this.sound,
                soundVolume: this.soundVolume,
                soundChannel: this.soundChannel,
                revealDelay: this.revealDelay,
                // For a manual face-down reveal, hold the preview (which shows the front) until the
                // card is flipped face-up in the viewer, so it isn't posted while sitting face-down.
                onReveal: post && !suppressChat && manualReveal ? postPreviews : undefined
            }).render(share, dramaticReveal);

            // Face-up posts now; a dramatic reveal holds the preview until the cards auto-flip. A
            // manual face-down reveal is handled by onReveal above instead.
            if (post && !suppressChat && !manualReveal) postChatAfterReveal(dramaticReveal, this.revealDelay, postPreviews);

            // Copies, for the same reason as draw(): the live array is mutated by FancyDisplay#render.
            return cardDataArray.map(c => ({ ...c }));
        } catch (error) {
            console.error(`${MODULE_ID} | Error rendering CardDealer.view().`, error);
            return null;
        }
    }

    /**
     * Find a card by id or name across every Cards stack in the world.
     * Needed because cards can move between deck / hand / discard freely.
     * @param {string} cardStr  Card id or exact name.
     * @returns {Card|undefined}
     */
    _findCardAnywhere(cardStr) {
        let card = game.cards.find(stack => stack.cards.get(cardStr))?.cards.get(cardStr);
        card = card || game.cards.find(stack => stack.cards.getName(cardStr))?.cards.getName(cardStr);
        return card;
    }

    /**
     * Find the pile this dealer draws into, creating it if it doesn't exist yet.
     * A named pile is matched by name. Without a name, the pile is the one this module created for
     * `deck`, found by the flag that links it to the deck — never by name, so renaming either stack
     * keeps the link and two decks can never end up sharing a pile.
     * @param {Cards} deck
     * @returns {Promise<Cards>}
     */
    async _resolveDiscardPile(deck) {
        const CardsCls = foundry.utils.getDocumentClass("Cards");
        if (this.discardPileName) {
            const pile = game.cards.getName(this.discardPileName);
            if (pile) return pile;
            ui.notifications.info(`No pile found by the name "${this.discardPileName}". Creating a new discard pile by that name.`);
            return CardsCls.create({ name: this.discardPileName, type: "pile" });
        }

        const pile = game.cards.find(c => c.type === "pile" && c.getFlag(MODULE_ID, FLAGS.SOURCE_DECK) === deck.id);
        if (pile) return pile;
        return CardsCls.create({
            name: `${deck.name} - Discard Pile`,
            type: "pile",
            flags: { [MODULE_ID]: { [FLAGS.SOURCE_DECK]: deck.id } }
        });
    }

    /**
     * Pull the displayable properties from a Card document. The `reversed` flag is rolled here, so it
     * is re-rolled on every draw/view (never persisted), matching the "re-roll each display" behavior.
     * @param {Card} card
     * @returns {{id:string, uuid:string, name:string, front:string, back:string, desc:string, reversed:boolean}}
     */
    _extractCardProperties(card) {
        return {
            id: card.id,
            // A drawn card lives in the discard pile, so its id alone is only meaningful together
            // with the stack. The uuid lets an API consumer resolve the Card with fromUuid()
            // wherever it ended up — this is what makes the draw()/view() return value actionable.
            uuid: card.uuid,
            name: card.faces[0].name,
            front: card.faces[0].img,
            back: card.back.img,
            // The Card document's own description (where decks like the PF2e Harrow keep their
            // lore), not the per-face text. Only posted to chat when the SHOW_DESCRIPTION setting
            // is on; gated and enriched in postCardToChat.
            desc: card.description,
            reversed: Math.random() * 100 < (this.reversalChance ?? 0)
        };
    }
}
