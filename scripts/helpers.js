import { MODULE_ID, SETTINGS } from "./constants.js";

/** Accent color used for the chat card border and title, matching the module's look. */
const CHAT_CARD_ACCENT = "#C9A060";

/**
 * Escape a string for safe interpolation into a double-quoted HTML attribute. Card names and
 * image paths are user-supplied, so they must never break out of the attributes that carry the
 * re-open metadata. Reused across {@link buildChatCard}, {@link postCardToChat} and
 * {@link postImageToChat}.
 *
 * @param {*} value  The raw value to escape.
 * @returns {string} The value with HTML-significant characters replaced by entities.
 */
export function escapeHtmlAttr(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

/**
 * Resolve the effective `sendToChat` flag for a call. An explicit boolean wins; `undefined`
 * falls back to the world-level default setting. Shared by the public API and the deck/chat
 * re-open paths so every entry point honors the same default.
 *
 * @param {boolean} [value]  Per-call override, or undefined to use the world default.
 * @returns {boolean} Whether a chat message should be posted.
 */
export function resolveSendToChat(value) {
    return value ?? game.settings.get(MODULE_ID, SETTINGS.SEND_TO_CHAT);
}

/**
 * Run a chat-posting callback, but hold it until a dramatic reveal has flipped the cards. The chat
 * preview shows the card front, which would spoil a dramatic reveal that is still counting down, so
 * when `dramaticReveal` is set the post is deferred by the reveal delay; otherwise it posts now.
 *
 * Call sites: FancyDisplay#render, CardViewerApp#_onShare, CardDealer#draw / #view.
 *
 * @param {boolean} dramaticReveal   Whether the cards are being shown with a dramatic reveal.
 * @param {number} [revealDelay]     Per-call dramatic-reveal delay (ms); omit for the world default.
 * @param {() => void} post          Callback that performs the actual chat posting.
 */
export function postChatAfterReveal(dramaticReveal, revealDelay, post) {
    if (!dramaticReveal) {
        post();
        return;
    }
    const delayMs = revealDelay ?? game.settings.get(MODULE_ID, SETTINGS.CARD_APPEARANCE).dramaticRevealDelay;
    setTimeout(post, delayMs);
}

/**
 * Build the module's standard chat-card HTML: an accent-bordered card with a dark, centered
 * uppercase header and a dark content area holding the supplied body. The card carries unique,
 * module-scoped class names and is styled entirely by `styles/chat-card.css`, which uses
 * defensive resets so the card renders identically regardless of the host game system's CSS.
 * Only the dynamic accent color is inlined, as the `--e3cr-chat-accent` custom property the
 * stylesheet reads. This module intentionally uses no background image in the content area
 * (a solid dark fill instead).
 *
 * @param {string} title     Header text (rendered uppercase via CSS).
 * @param {string} bodyHtml  HTML placed inside the content area.
 * @param {object} [options]
 * @param {string} [options.titleColor=CHAT_CARD_ACCENT]  Accent color for the border and title.
 * @returns {string} Complete HTML string for use as a ChatMessage's content.
 */
export function buildChatCard(title, bodyHtml, { titleColor = CHAT_CARD_ACCENT } = {}) {
    return `
    <div class="${MODULE_ID} ${MODULE_ID}-chat" style="--e3cr-chat-accent: ${titleColor};">
        <header class="${MODULE_ID}-chat-header">
            <h3 class="${MODULE_ID}-chat-title">${title}</h3>
        </header>
        <div class="${MODULE_ID}-chat-body">
            ${bodyHtml}
        </div>
    </div>`;
}

/**
 * Create a ChatMessage, whispering the active GM when the post is not public. Used by both
 * chat-posting helpers below.
 *
 * @param {string} content          The message HTML (already wrapped by {@link buildChatCard}).
 * @param {boolean} isPublic        Post publicly instead of whispering the GM.
 * @returns {Promise<ChatMessage|undefined>} The created message, or undefined when a non-public
 *                                           post has no active GM to whisper.
 */
async function _postChat(content, isPublic) {
    const whisper = [];
    if (!isPublic) {
        const gm = game.users.find(u => u.isGM && u.active);
        if (!gm) {
            console.warn(`${MODULE_ID} | GM user not found; chat message was not posted.`);
            return;
        }
        whisper.push(gm.id);
    }

    const ChatMessageCls = foundry.utils.getDocumentClass("ChatMessage");
    return ChatMessageCls.create({ content, whisper });
}

/**
 * The clickable thumbnail block embedded in every re-openable chat card. The wrapper carries the
 * `<MODULE_ID>-msg` token plus the re-open metadata read back by the chat click handler
 * (scripts/hooks.js). Shared by {@link postCardToChat} and {@link postImageToChat}.
 *
 * @param {string} front           Front image path.
 * @param {string} alt             Image alt text.
 * @param {string} dataAttrs       Pre-escaped `data-*` attributes describing how to re-open.
 * @returns {string} The inner body HTML for {@link buildChatCard}.
 */
function _reopenBody(front, alt, dataAttrs) {
    // Keep the `<MODULE_ID>-msg` token and `card-face` class: the chat click handler
    // (scripts/hooks.js `_registerCardImgClickInChat`) selects on both to re-open the viewer.
    // The `-chat-*` classes are the styling hooks consumed by styles/chat-card.css.
    return `<div class="${MODULE_ID}-msg ${MODULE_ID}-chat-thumb" ${dataAttrs}>
            <img class="card-face ${MODULE_ID}-chat-img" src="${escapeHtmlAttr(front)}" alt="${escapeHtmlAttr(alt)}" />
            <span class="${MODULE_ID}-chat-caption">Click to reveal</span>
        </div>`;
}

/**
 * Post a deck-card preview to chat so the card can be re-opened later by clicking the thumbnail.
 * Local-only views whisper the GM; cards shared with everyone are posted publicly so any user can
 * re-open them on demand.
 *
 * Call sites: hooks.js `_viewCard`, CardDealer#draw / #view, CardViewerApp#_onShare.
 *
 * @param {object} opts
 * @param {string} opts.deckName           Name of the deck the card belongs to.
 * @param {string} opts.cardId             Card document id.
 * @param {string} opts.cardName           Display name of the card (used as the card title).
 * @param {string} opts.front              Front image path.
 * @param {string} [opts.desc]             Card description (rich text).
 * @param {boolean} [opts.isPublic=false]  Post publicly instead of whispering the GM.
 * @returns {Promise<ChatMessage|undefined>} The created message, or undefined when no GM is available to whisper.
 */
export async function postCardToChat({ deckName, cardId, cardName, front, desc, isPublic = false }) {
    const dataAttrs = `data-reopen-kind="card" data-deck="${escapeHtmlAttr(deckName)}" data-card="${escapeHtmlAttr(cardId)}"`;
    let body = _reopenBody(front, cardName, dataAttrs);
    if (desc) body += `<div class="${MODULE_ID}-chat-desc">${desc}</div>`;

    return _postChat(buildChatCard(cardName, body), isPublic);
}

/**
 * Post a raw-image preview to chat so an arbitrary `Display` image can be re-opened later by
 * clicking the thumbnail. The re-open metadata carries the image set itself (there is no backing
 * Card document to look up). Local views whisper the GM; shared views post publicly.
 *
 * Call site: FancyDisplay#render (raw-image display only).
 *
 * @param {object} opts
 * @param {string} opts.front              Front image path.
 * @param {string} [opts.back]             Back image path.
 * @param {string} [opts.glowColor]        Glow color to restore when re-opened.
 * @param {number} [opts.glowIntensity]    Glow strength (0..1) to restore when re-opened.
 * @param {boolean} [opts.faceDown=false]  Whether to re-open face-down.
 * @param {boolean} [opts.isPublic=false]  Post publicly instead of whispering the GM.
 * @returns {Promise<ChatMessage|undefined>} The created message, or undefined when no GM is available to whisper.
 */
export async function postImageToChat({ front, back, glowColor, glowIntensity, faceDown = false, isPublic = false }) {
    const dataAttrs = `data-reopen-kind="image" data-front="${escapeHtmlAttr(front)}" data-back="${escapeHtmlAttr(back ?? "")}" data-glow="${escapeHtmlAttr(glowColor ?? "")}" data-glow-intensity="${escapeHtmlAttr(glowIntensity ?? "")}" data-face-down="${faceDown}"`;
    const body = _reopenBody(front, "", dataAttrs);

    return _postChat(buildChatCard("Card", body), isPublic);
}
