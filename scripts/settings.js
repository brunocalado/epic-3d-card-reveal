import { MODULE_ID, SETTINGS } from "./constants.js";
import { CardAppearanceData, CardAppearanceSettings } from "./card-appearance-settings.js";
import { RevealSoundData, RevealSoundSettings } from "./reveal-sound-settings.js";
import MacroBuilder from "./macro-builder.js";

/**
 * Register all world-scoped module settings and the card appearance settings menu.
 * Called from the `init` hook.
 */
export function registerSettings() {
    game.settings.register(MODULE_ID, SETTINGS.ENABLE_CARD_ICON_CLICK, {
        name: "Enable clickable card icons",
        hint: "Enable/disable clickable card image thumbnails in the Sidebar and in Card Stack app windows. Cards will always be displayed either face-down or face-up depending on how the icon shows them.",
        scope: "world",
        config: true,
        default: true,
        type: Boolean
    });

    // Default for the per-call `sendToChat` option used by the public API and the macro builder.
    // Each macro can still override it; this is only the fallback when none is supplied.
    game.settings.register(MODULE_ID, SETTINGS.SEND_TO_CHAT, {
        name: "Send revealed cards to chat",
        hint: "When enabled, revealing a card also posts a clickable chat message so it can be re-opened later (handy when a card is closed by accident). This is the default for macros; each macro can override it.",
        scope: "world",
        config: true,
        default: true,
        type: Boolean
    });

    // Off by default so existing worlds keep their current chat previews (image + name only).
    // When enabled, the chat reveal also carries the Card document's description — handy for
    // lore-heavy decks such as the PF2e Harrow Deck. Empty descriptions and raw Display images
    // (which have no Card document) are unaffected.
    game.settings.register(MODULE_ID, SETTINGS.SHOW_DESCRIPTION, {
        name: "Send card description to chat",
        hint: "When enabled, the chat reveal also shows the card's description (e.g. the lore on a PF2e Harrow card). Rich text and links are rendered. Cards with no description, and arbitrary images shown via the API, are unaffected.",
        scope: "world",
        config: true,
        default: false,
        type: Boolean
    });

    // Hidden storage for the appearance defaults; edited through the menu registered below.
    game.settings.register(MODULE_ID, SETTINGS.CARD_APPEARANCE, {
        scope: "world",
        config: false,
        type: CardAppearanceData,
        default: {}
    });

    game.settings.registerMenu(MODULE_ID, SETTINGS.CARD_APPEARANCE_MENU, {
        name: "Card Appearance",
        label: "Configure Card Appearance",
        hint: "Default card glow color and opacity, the default card back image, and the dramatic reveal delay.",
        icon: "fa-solid fa-palette",
        type: CardAppearanceSettings,
        restricted: true
    });

    // Hidden storage for the reveal-sound defaults; edited through the menu registered below.
    game.settings.register(MODULE_ID, SETTINGS.REVEAL_SOUND, {
        scope: "world",
        config: false,
        type: RevealSoundData,
        default: {}
    });

    game.settings.registerMenu(MODULE_ID, SETTINGS.REVEAL_SOUND_MENU, {
        name: "Reveal Sound",
        label: "Configure Reveal Sound",
        hint: "Default sound played locally when a card's face is revealed, plus its volume and audio channel.",
        icon: "fa-solid fa-volume-high",
        type: RevealSoundSettings,
        restricted: true
    });

    // Opens the macro builder straight from the settings panel — same form as
    // `EpicCards.MacroBuilder()`. GM-only (restricted), because the builder writes a world
    // Folder/Macro, which is GM-restricted in Foundry.
    game.settings.registerMenu(MODULE_ID, SETTINGS.MACRO_BUILDER_MENU, {
        name: "Macro Builder",
        label: "Open Macro Builder",
        hint: "Build a ready-to-run 3D card macro (display an image, draw from a deck, or view a specific card) without writing code.",
        icon: "fa-solid fa-scroll",
        type: MacroBuilder,
        restricted: true
    });
}
