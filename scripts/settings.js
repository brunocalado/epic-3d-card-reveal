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
