/**
 * String identifier for the module used throughout other scripts.
 * Single source of truth: matches the `id` field in module.json verbatim.
 */
export const MODULE_ID = "epic-3d-card-reveal";

/**
 * Setting and menu keys registered under the module namespace.
 */
export const SETTINGS = {
    ENABLE_CARD_ICON_CLICK: "enableCardIconClick",
    SEND_TO_CHAT: "sendToChat",
    CARD_APPEARANCE: "cardAppearance",
    CARD_APPEARANCE_MENU: "cardAppearanceMenu",
    REVEAL_SOUND: "revealSound",
    REVEAL_SOUND_MENU: "revealSoundMenu",
    MACRO_BUILDER_MENU: "macroBuilderMenu"
};

/**
 * Valid audio channels a reveal sound can play through, in display order. Mirror of the keys of
 * core's `CONST.AUDIO_CHANNELS` (interface / music / environment) — kept here so the value list is
 * a dependency-free constant. Human-readable labels are resolved at runtime from
 * `CONST.AUDIO_CHANNELS` (localization keys), so they follow the client's language and Foundry's
 * own audio mixer naming.
 * @type {string[]}
 */
export const SOUND_CHANNELS = ["interface", "music", "environment"];

/**
 * Fixed folder (Macro directory) where the macro builder stores every generated macro.
 * Always the same folder so generated macros stay grouped together.
 */
export const MACRO_FOLDER_NAME = "3D Card Macros";

/**
 * Default hotbar icon applied to macros produced by the builder when the user leaves
 * the icon picker untouched (or clears it). A core Foundry icon, so it always resolves.
 */
export const DEFAULT_MACRO_ICON = "icons/sundries/documents/document-symbol-skull-tan.webp";
