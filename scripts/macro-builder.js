import { MODULE_ID, MACRO_FOLDER_NAME, SETTINGS, DEFAULT_MACRO_ICON, SOUND_CHANNELS } from "./constants.js";

const fields = foundry.data.fields;

/**
 * Field definitions that drive the formGroup-rendered inputs in the builder template.
 *
 * Most fields use a *unique flat name* (`quantity`, `glowColor`, `share`, …). `{{formGroup}}`
 * names each input after the field's own leaf name, and on submit `FormDataExtended` returns one
 * flat object keyed by those names. Because no two of these fields share a name across the whole
 * form (per-type fields use type-specific names like `drawDeck`), the hidden sections never
 * collide with the active one, and the handlers just read the flat keys relevant to the chosen
 * macro type plus the shared appearance keys.
 *
 * Two inputs are *not* in this schema because they are dynamic lists built in JS: the Display
 * image rows (indexed `displayCards.<i>.front/back` names that {@link MacroBuilder#readForm}
 * expands via `foundry.utils.expandObject` into an object keyed by row index) and the View card
 * list (a single hidden `viewCards` input holding a JSON array). See
 * {@link MacroBuilder#initDisplayCards} / {@link MacroBuilder#initCardDrop}.
 *
 * The schema is never instantiated as a document; it exists only to render native widgets
 * (FilePicker, color picker, checkboxes).
 */
const BUILDER_SCHEMA = new fields.SchemaField({
    // --- Draw ---
    quantity: new fields.NumberField({
        required: true,
        integer: true,
        min: 1,
        initial: 1,
        label: "Number of cards",
        hint: "How many cards to draw from the deck."
    }),
    // --- Shared appearance (applies to all macro types) ---
    glowColor: new fields.ColorField({
        required: false,
        nullable: true,
        blank: true,
        label: "Glow color",
        hint: "Optional. Leave blank to use the default glow color."
    }),
    glowIntensity: new fields.NumberField({
        required: false,
        nullable: true,
        min: 0,
        max: 1,
        label: "Glow intensity",
        hint: "Strength of the card glow. 0 turns it off; higher is brighter and wider. Leave at the default to follow the module setting."
    }),
    reversalChance: new fields.NumberField({
        required: true,
        integer: true,
        min: 0,
        max: 100,
        initial: 0,
        label: "Reversed chance (%)",
        hint: "Chance that each card is shown upside-down, Tarot-style. 0 means cards are never reversed. Only the card's visual is flipped — its chat text is unchanged; the orientation is re-rolled every time."
    }),
    faceDown: new fields.BooleanField({
        label: "Start face-down",
        hint: "Show the card back first."
    }),
    dramaticReveal: new fields.BooleanField({
        label: "Dramatic reveal",
        hint: "Start face-down then auto-flip face-up after a short delay."
    }),
    dramaticRevealDelay: new fields.NumberField({
        required: true,
        integer: true,
        min: 0,
        initial: 1500,
        label: "Dramatic reveal delay (ms)",
        hint: "How long the card stays face-down before auto-flipping. The card can't be clicked open early. Leave at the default to follow the module setting."
    }),
    share: new fields.BooleanField({
        initial: true,
        label: "Share with all players",
        hint: "Broadcast the card to every connected player when the macro runs."
    }),
    sendToChat: new fields.BooleanField({
        initial: true,
        label: "Send to chat",
        hint: "Post a clickable chat message so the card can be re-opened later (e.g. if closed by accident)."
    }),
    // Deck-only: only deck cards (Draw / View) carry a description; Display images have none. The
    // template hides this control for the Display type (see MacroBuilder#initTypeToggle).
    showDescription: new fields.BooleanField({
        label: "Send card description",
        hint: "Include the card's description (e.g. PF2e Harrow lore) in the chat message. Only applies when Send to chat is on."
    }),
    // Reveal sound override. The flat `soundMode` select (default/custom/none) decides whether these
    // are baked; see {@link applySound}. The schema is only used to render widgets and labels.
    sound: new fields.FilePathField({
        categories: ["AUDIO"],
        required: false,
        blank: true,
        label: "Reveal sound",
        hint: "Audio played locally when the card face is revealed."
    }),
    soundVolume: new fields.AlphaField({
        required: false,
        nullable: true,
        label: "Reveal sound volume",
        hint: "Volume of the reveal sound. 0 is silent; 1 is full volume."
    }),
    soundChannel: new fields.StringField({
        required: false,
        blank: true,
        label: "Audio channel",
        hint: "Audio channel the reveal sound plays through."
    })
});

/** Macro type options offered by the builder. Each maps to one public API action. */
const MACRO_TYPES = [
    { value: "display", label: "Display images" },
    { value: "draw", label: "Draw from a deck" },
    { value: "view", label: "View specific cards" }
];

/**
 * Reveal-sound modes offered in the Appearance tab.
 * - `default`: bake nothing — the macro follows the world reveal-sound setting.
 * - `custom`: bake the chosen sound (and any changed volume/channel).
 * - `none`: bake `sound: ""` so the macro plays no sound, regardless of the world default.
 */
const SOUND_MODES = [
    { value: "default", label: "Use module default" },
    { value: "custom", label: "Custom sound" },
    { value: "none", label: "No sound" }
];

/**
 * Map the shared face-down / dramatic-reveal toggles onto the `face` argument the dealer's
 * `draw()` understands. Reveal wins over a plain face-down request.
 * @param {object} d  The flat form data.
 * @returns {"reveal"|"down"|"up"}
 */
function deriveFace(d) {
    if (d.dramaticReveal) return "reveal";
    if (d.faceDown) return "down";
    return "up";
}

/**
 * Fold the shared glow override (color + intensity) into the target, but only when the user
 * actually changed something. The viewer takes the glow as a separate hue (`glowColor`) and
 * strength (`glowIntensity`, 0..1), so both are baked explicitly whenever either is customized —
 * the chosen/inherited color plus the slider value — making the generated macro self-contained.
 * When neither the color nor the intensity differs from the world default, nothing is baked and
 * the runtime falls back to the module's default appearance entirely.
 * @param {object} d       The flat form data.
 * @param {object} target  Object to receive the keys (a `Display` opts object or a `Dealer` config).
 * @returns {object} The same `target`, for chaining.
 */
function applyGlow(d, target) {
    const appearance = game.settings.get(MODULE_ID, SETTINGS.CARD_APPEARANCE);
    const hasColor = !!d.glowColor;
    const rawIntensity = (d.glowIntensity === "" || d.glowIntensity == null) ? null : Number(d.glowIntensity);
    // Compare on whole percent so the slider's float steps don't read as a change against the default.
    const intensityChanged = rawIntensity !== null
        && Math.round(rawIntensity * 100) !== Math.round(appearance.glowIntensity * 100);
    if (!hasColor && !intensityChanged) return target;

    target.glowColor = d.glowColor || appearance.glowColor;
    target.glowIntensity = rawIntensity ?? appearance.glowIntensity;
    return target;
}

/**
 * Fold the reveal-sound controls into the target, following the `soundMode` select:
 * - `none` bakes `sound: ""` (explicitly silent, overriding the world default);
 * - `custom` bakes the chosen sound path, plus volume/channel only when they differ from the
 *   world default (so an untouched custom slider bakes nothing extra);
 * - `default` (or anything else) bakes nothing, letting the runtime use the world default.
 * @param {object} d       The flat form data.
 * @param {object} target  Object to receive the keys (a `Display` opts object or a `Dealer` config).
 * @returns {object} The same `target`, for chaining.
 */
function applySound(d, target) {
    if (d.soundMode === "none") {
        target.sound = "";
        return target;
    }
    if (d.soundMode !== "custom") return target;

    const defaults = game.settings.get(MODULE_ID, SETTINGS.REVEAL_SOUND);
    if (d.sound) target.sound = d.sound;

    const rawVolume = (d.soundVolume === "" || d.soundVolume == null) ? null : Number(d.soundVolume);
    // Compare on whole percent so the slider's float steps don't read as a change against the default.
    if (rawVolume !== null && Math.round(rawVolume * 100) !== Math.round(defaults.volume * 100)) {
        target.soundVolume = rawVolume;
    }
    if (d.soundChannel && d.soundChannel !== defaults.channel) target.soundChannel = d.soundChannel;
    return target;
}

/**
 * Fold the dramatic-reveal delay into the target, but only when a dramatic reveal is requested
 * (otherwise it has no effect) and only when it differs from the world default — so an untouched
 * form bakes nothing.
 * @param {object} d       The flat form data.
 * @param {object} target  Object to receive the keys (a `Display` opts object or a `Dealer` config).
 * @returns {object} The same `target`, for chaining.
 */
function applyReveal(d, target) {
    if (!d.dramaticReveal) return target;

    const appearance = game.settings.get(MODULE_ID, SETTINGS.CARD_APPEARANCE);
    const delay = (d.dramaticRevealDelay === "" || d.dramaticRevealDelay == null) ? null : Number(d.dramaticRevealDelay);
    if (delay !== null && Number.isFinite(delay) && delay !== appearance.dramaticRevealDelay) {
        target.revealDelay = delay;
    }
    return target;
}

/**
 * Fold the Tarot-style reversed chance into the target, but only when it is above 0 — an untouched
 * form (0 = never reversed) bakes nothing, keeping the feature off by default.
 * @param {object} d       The flat form data.
 * @param {object} target  Object to receive the key (a `Display` opts object or a `Dealer` config).
 * @returns {object} The same `target`, for chaining.
 */
function applyReversal(d, target) {
    const chance = (d.reversalChance === "" || d.reversalChance == null) ? 0 : Number(d.reversalChance);
    if (Number.isFinite(chance) && chance > 0) target.reversalChance = chance;
    return target;
}

/**
 * Collect the shared appearance overrides, emitting only the keys the user actually filled so
 * the generated code (and the live preview) stays clean.
 * @param {object} d     The flat form data.
 * @param {object} target  Object to receive the keys (a `Display` opts object or a `Dealer` config).
 * @returns {object} The same `target`, for chaining.
 */
function applyAppearance(d, target) {
    applyGlow(d, target);
    applySound(d, target);
    applyReveal(d, target);
    applyReversal(d, target);
    return target;
}

/*
 * Each macro type has a paired "args" + "command" function. The args function distills the raw
 * flat form data into the exact values passed to the public API; the command function stringifies
 * them into macro script. Both the generated macro and the live Preview consume the same args, so
 * a preview always matches what the saved macro would do.
 */

/**
 * Read the Display tab's repeatable image rows into a `cards` array. The builder expands the flat
 * form data (see {@link MacroBuilder#readForm}), turning the indexed `displayCards.<i>.front/back`
 * input names into an object keyed by row index; rows without a front image are dropped.
 * @param {object} d  The flat form data.
 * @returns {Array<{front:string, back?:string}>}
 */
function readDisplayCards(d) {
    return Object.values(d.displayCards ?? {})
        .filter(c => c && c.front)
        .map(c => (c.back ? { front: c.front, back: c.back } : { front: c.front }));
}

/**
 * Human-readable comment for each argument the builder can bake into a macro, keyed by the option
 * name as it appears in the generated `EpicCards.*` call. Used by {@link objectLiteralWithComments}
 * so a user opening a generated macro can see what every baked-in value does. Keys absent from a
 * given call are simply unused.
 * @type {Object<string, string>}
 */
const ARG_COMMENTS = {
    // Display / shared appearance
    cards: "Cards to show; each { front, back } is one card's face/back image path.",
    glowColor: "Glow hue around the card (any CSS color).",
    glowIntensity: "Glow strength, 0-1 (0 turns the glow off).",
    sound: "Reveal sound: a path plays it, \"\" forces silence (omitted = world default).",
    soundVolume: "Reveal-sound volume, 0-1.",
    soundChannel: "Audio channel: interface, music, or environment.",
    revealDelay: "Dramatic-reveal delay in ms before the card auto-flips.",
    reversalChance: "Chance (0-100) each card is shown upside-down (Tarot-style).",
    faceDown: "Start face-down (flip to reveal).",
    sendToChat: "Also post a clickable chat message that re-opens the card.",
    // Dealer config
    deckName: "Name of the source Cards deck.",
    discardPileName: "Discard pile to draw into (auto-matched/created when omitted).",
    // Draw options
    quantity: "How many cards to draw.",
    face: "Initial face: \"up\", \"down\", or \"reveal\" (dramatic auto-flip).",
    share: "Broadcast the view to all connected clients.",
    showDescription: "Include the card's description in the chat message."
};

/**
 * Serialize a plain options object into a pretty-printed JS object literal where every top-level key
 * carries a trailing `// ...` comment from {@link ARG_COMMENTS}. Generated macros use this instead of
 * a bare `JSON.stringify` so the saved script is self-documenting. Nested values (e.g. the `cards`
 * array) are JSON-stringified and the comment rides their opening line; keys with no known comment
 * are emitted plain.
 * @param {object} obj  The options object to serialize.
 * @returns {string}  A multi-line JS object literal (`"{}"` when empty).
 */
function objectLiteralWithComments(obj) {
    const keys = Object.keys(obj);
    if (!keys.length) return "{}";
    const lines = keys.map((key, i) => {
        const comma = i < keys.length - 1 ? "," : "";
        const comment = ARG_COMMENTS[key] ? `  // ${ARG_COMMENTS[key]}` : "";
        // Indent every line of the value by one level so nested entries sit under the key.
        const valueLines = JSON.stringify(obj[key], null, 2).split("\n").map(l => `  ${l}`);
        const first = `  ${JSON.stringify(key)}: ${valueLines[0].trimStart()}`;
        if (valueLines.length === 1) return `${first}${comma}${comment}`;
        // Multi-line value: comment rides the opening line; the comma closes the final line.
        const rest = valueLines.slice(1);
        rest[rest.length - 1] += comma;
        return [`${first}${comment}`, ...rest].join("\n");
    });
    return `{\n${lines.join("\n")}\n}`;
}

/**
 * Distil the form data into `EpicCards.Display(...).render(...)` arguments.
 * @param {object} d  The flat form data.
 * @returns {{opts: object, share: boolean, reveal: boolean}}
 */
function displayArgs(d) {
    const opts = {};
    const cards = readDisplayCards(d);
    if (cards.length) opts.cards = cards;
    applyAppearance(d, opts);
    // A dramatic reveal always starts face-down (its disabled checkbox can't report it), so force it.
    opts.faceDown = !!d.faceDown || !!d.dramaticReveal;
    opts.sendToChat = !!d.sendToChat;
    return { opts, share: !!d.share, reveal: !!d.dramaticReveal };
}

/**
 * @param {object} d  The flat form data.
 * @returns {string}  Executable macro script.
 */
function buildDisplayCommand(d) {
    const { opts, share, reveal } = displayArgs(d);
    return [
        `EpicCards.Display(${objectLiteralWithComments(opts)}).render(`,
        `  ${share},  // shareToAll: broadcast the view to all connected clients`,
        `  ${reveal}  // dramaticReveal: render face-down, then auto-flip after the delay`,
        `);`
    ].join("\n");
}

/**
 * Distil the form data into `EpicCards.Dealer(...).draw(...)` arguments. Draws `quantity` cards
 * (default 1); the shared face-down / reveal toggles drive the drawn cards' face.
 * @param {object} d  The flat form data.
 * @returns {{dealer: object, draw: object}}
 */
function drawArgs(d) {
    const dealer = { deckName: d.drawDeck };
    if (d.drawDiscardPile) dealer.discardPileName = d.drawDiscardPile;
    applyAppearance(d, dealer);
    const draw = { quantity: Number(d.quantity) || 1, face: deriveFace(d), share: !!d.share, sendToChat: !!d.sendToChat, showDescription: !!d.showDescription };
    return { dealer, draw };
}

/**
 * @param {object} d  The flat form data.
 * @returns {string}  Executable macro script.
 */
function buildDrawCommand(d) {
    const { dealer, draw } = drawArgs(d);
    return `EpicCards.Dealer(${objectLiteralWithComments(dealer)}).draw(${objectLiteralWithComments(draw)});`;
}

/**
 * Parse the View tab's JSON card list (the hidden `viewCards` input populated by the drop zone).
 * @param {object} d  The flat form data.
 * @returns {Array<{id:string, name:string, deck:string, thumb:string}>}
 */
function readViewCards(d) {
    try {
        const list = JSON.parse(d.viewCards || "[]");
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

/**
 * Distil the form data into `EpicCards.Dealer(...).view(...)` arguments. The cards come from one
 * or more Cards dragged onto the drop zone, so any number of cards can be viewed at once.
 * @param {object} d  The flat form data.
 * @returns {{dealer: object, cards: string[], faceDown: boolean, reveal: boolean, share: boolean, sendToChat: boolean, showDescription: boolean}}
 */
function viewArgs(d) {
    const list = readViewCards(d);
    // The dealer's deckName is metadata only (used for the chat preview); the cards themselves are
    // resolved by id across every stack, so the first card's deck is enough.
    const dealer = applyAppearance(d, { deckName: list[0]?.deck ?? "" });
    // A dramatic reveal always starts face-down (its disabled checkbox can't report it), so force it.
    const faceDown = !!d.faceDown || !!d.dramaticReveal;
    return { dealer, cards: list.map(c => c.id), faceDown, reveal: !!d.dramaticReveal, share: !!d.share, sendToChat: !!d.sendToChat, showDescription: !!d.showDescription };
}

/**
 * @param {object} d  The flat form data.
 * @returns {string}  Executable macro script.
 */
function buildViewCommand(d) {
    const { dealer, cards, faceDown, reveal, share, sendToChat, showDescription } = viewArgs(d);
    return [
        `EpicCards.Dealer(${objectLiteralWithComments(dealer)}).view(`,
        `  ${JSON.stringify(cards)},  // cards: ID(s)/name(s), searched across every stack in the world`,
        `  ${faceDown},  // faceDown: render face-down initially`,
        `  ${reveal},  // dramaticReveal: render face-down, then auto-flip after the delay`,
        `  ${share},  // share: broadcast the view to all connected clients`,
        `  ${JSON.stringify({ sendToChat, showDescription })}  // sendToChat: post a re-open message; showDescription: include the card's description`,
        `);`
    ].join("\n");
}

/**
 * Build the macro script for the chosen type.
 * @param {string} type  The selected macro type.
 * @param {object} d     The flat form data.
 * @returns {string|null}   Executable macro script, or null for an unknown type.
 */
function buildCommand(type, d) {
    switch (type) {
        case "display": return buildDisplayCommand(d);
        case "draw": return buildDrawCommand(d);
        case "view": return buildViewCommand(d);
        default: return null;
    }
}

/**
 * Run the chosen action live (without saving a macro) by calling the public API with the same
 * arguments the generated macro would use. This is the Preview behaviour.
 * @param {string} type  The selected macro type.
 * @param {object} d     The flat form data.
 * @returns {Promise<void>|void}
 */
function runPreview(type, d) {
    const api = game.modules.get(MODULE_ID).api;
    switch (type) {
        case "display": {
            const { opts, share, reveal } = displayArgs(d);
            return api.Display(opts).render(share, reveal);
        }
        case "draw": {
            const { dealer, draw } = drawArgs(d);
            return api.Dealer(dealer).draw(draw);
        }
        case "view": {
            const { dealer, cards, faceDown, reveal, share, sendToChat, showDescription } = viewArgs(d);
            return api.Dealer(dealer).view(cards, faceDown, reveal, share, { sendToChat, showDescription });
        }
        default: return undefined;
    }
}

/**
 * Validate the fields that matter for the chosen macro type. Kept here (not as HTML `required`)
 * so hidden sections' inputs never block submit, and shared by both submit and preview.
 * @param {string} type  The selected macro type.
 * @param {object} d     The flat form data.
 * @returns {string|null}   A warning message when invalid, otherwise null.
 */
function validate(type, d) {
    if (type === "display" && !readDisplayCards(d).length) return "Add at least one front image.";
    if (type === "draw") {
        if (!d.drawDeck) return "Choose a deck to draw from.";
        if (!(Number(d.quantity) >= 1)) return "Draw at least one card.";
    }
    if (type === "view" && !readViewCards(d).length) return "Drag at least one card onto the drop zone first.";
    return null;
}

/**
 * Derive a sensible macro name when the user leaves the name field blank.
 * @param {string} type  The selected macro type.
 * @param {object} d     The flat form data.
 * @returns {string}
 */
function defaultMacroName(type, d) {
    switch (type) {
        case "display": {
            const n = readDisplayCards(d).length;
            return n > 1 ? `Show ${n} Cards (3D)` : "Show Card (3D)";
        }
        case "draw": {
            const n = Number(d.quantity) || 1;
            return n > 1 ? `Draw ${n} from ${d.drawDeck}` : `Draw from ${d.drawDeck}`;
        }
        case "view": {
            const list = readViewCards(d);
            return list.length > 1 ? `View ${list.length} cards` : `View ${list[0]?.name || "card"}`;
        }
        default: return "3D Card Macro";
    }
}

/**
 * Resolve the fixed macro folder, creating it the first time. World Folder creation is
 * GM-restricted, which is why {@link MacroBuilder} is only opened for the GM.
 * @returns {Promise<Folder>}
 */
async function getOrCreateMacroFolder() {
    const FolderCls = foundry.utils.getDocumentClass("Folder");
    let folder = game.folders.find(f => f.type === "Macro" && f.name === MACRO_FOLDER_NAME);
    if (!folder) folder = await FolderCls.create({ name: MACRO_FOLDER_NAME, type: "Macro" });
    return folder;
}

/**
 * Fill-in form that turns a few fields into a ready-to-run script macro, so users who aren't
 * comfortable writing macros can still drive the module's public API. The form is split into two
 * tabs: **Options** (per-type fields — image, deck, or a dragged card) and **Appearance** (shared
 * visual settings applied to whichever macro type is generated). Every generated macro lands in
 * the same {@link MACRO_FOLDER_NAME} folder. Opened through `EpicCards.MacroBuilder()`.
 */
export default class MacroBuilder extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: "card-macro-builder",
        classes: [MODULE_ID, "card-macro-builder"],
        tag: "form",
        window: {
            title: "Macro Builder",
            icon: "fa-solid fa-scroll",
            contentClasses: ["standard-form"]
        },
        // height "auto" keeps the window snug; re-applied on tab/type switch in _onRender.
        position: { width: 520, height: "auto" },
        actions: {
            preview: MacroBuilder.prototype._onPreview,
            pickIcon: MacroBuilder.prototype._onPickIcon
        },
        form: {
            handler: MacroBuilder.#onGenerate,
            // Keep the form open so several macros can be produced in one sitting.
            closeOnSubmit: false
        }
    };

    /** @override */
    static PARTS = {
        body: { template: `modules/${MODULE_ID}/templates/macro-builder.hbs` },
        footer: { template: "templates/generic/form-footer.hbs" }
    };

    /** @override Builds the render context for the full render. */
    async _prepareContext(_options) {
        // Seed the appearance controls from the world defaults so an untouched form generates
        // no override (the glow intensity slider in particular starts on the current default).
        const appearance = game.settings.get(MODULE_ID, SETTINGS.CARD_APPEARANCE);
        const revealSound = game.settings.get(MODULE_ID, SETTINGS.REVEAL_SOUND);
        return {
            macroTypes: MACRO_TYPES,
            soundModes: SOUND_MODES,
            // Localized channel labels, with the world-default channel pre-selected.
            channels: SOUND_CHANNELS.map(value => ({
                value,
                label: game.i18n.localize(CONST.AUDIO_CHANNELS[value]),
                selected: value === revealSound.channel
            })),
            decks: game.cards.filter(c => c.type === "deck").map(c => ({ name: c.name })),
            piles: game.cards.filter(c => c.type === "pile").map(c => ({ name: c.name })),
            fields: BUILDER_SCHEMA.fields,
            data: {
                macroIcon: DEFAULT_MACRO_ICON,
                quantity: 1,
                glowColor: "",
                glowIntensity: appearance.glowIntensity,
                // Reversed is opt-in: start at 0 so an untouched form bakes nothing.
                reversalChance: 0,
                faceDown: false, dramaticReveal: false,
                // Seed the delay from the world default so an untouched form bakes no override.
                dramaticRevealDelay: appearance.dramaticRevealDelay,
                share: true,
                // Seed from the world default so an untouched form bakes the current setting.
                sendToChat: game.settings.get(MODULE_ID, SETTINGS.SEND_TO_CHAT),
                // Deck-only; seed from the world default so it matches the current setting.
                showDescription: game.settings.get(MODULE_ID, SETTINGS.SHOW_DESCRIPTION),
                // Reveal sound starts on "use module default"; the custom controls seed from the
                // world reveal-sound setting so switching to Custom shows the current values.
                soundMode: "default",
                sound: "",
                soundVolume: revealSound.volume,
                soundChannel: revealSound.channel
            },
            buttons: [
                { type: "button", action: "preview", icon: "fa-solid fa-eye", label: "Preview" },
                { type: "submit", icon: "fa-solid fa-wand-magic-sparkles", label: "Generate Macro" }
            ]
        };
    }

    /**
     * @override Wire the tab navigation, the macro-type section toggle, and the View drop zone.
     * Attaching listeners here (rather than via actions) is correct because each render replaces
     * the DOM, so no duplicate listeners accumulate.
     */
    _onRender(_context, _options) {
        this.#initTabs();
        this.#initTypeToggle();
        this.#initDisplayCards();
        this.#initCardDrop();
        this.#initSoundToggle();
        this.#initDramaticToggle();
    }

    /**
     * Toggle the Options / Appearance tab panels. Both panels stay in the DOM (so hidden-tab
     * inputs still submit); only their visibility changes.
     */
    #initTabs() {
        const tabs = this.element.querySelectorAll("[data-tab-target]");
        const panels = this.element.querySelectorAll("[data-tab-panel]");

        for (const tab of tabs) {
            tab.addEventListener("click", () => {
                const target = tab.dataset.tabTarget;
                for (const t of tabs) t.classList.toggle("active", t === tab);
                for (const p of panels) p.hidden = p.dataset.tabPanel !== target;
                this.setPosition({ height: "auto" });
            });
        }
    }

    /** Show only the selected macro type's fields inside the Options tab. */
    #initTypeToggle() {
        const typeSelect = this.element.querySelector('select[name="macroType"]');
        if (!typeSelect) return;
        const sections = this.element.querySelectorAll("[data-macro-section]");
        // Controls that only make sense for deck-backed cards (Draw / View), e.g. the card
        // description toggle. Hidden for the deckless Display type.
        const deckOnly = this.element.querySelectorAll("[data-deck-only]");

        const sync = () => {
            for (const section of sections) {
                section.hidden = section.dataset.macroSection !== typeSelect.value;
            }
            const usesDeck = typeSelect.value === "draw" || typeSelect.value === "view";
            for (const el of deckOnly) el.hidden = !usesDeck;
            this.setPosition({ height: "auto" });
        };

        typeSelect.addEventListener("change", sync);
        sync();
    }

    /**
     * Reveal the dramatic-reveal delay field only when "Dramatic reveal" is checked, and force the
     * "Start face-down" toggle on (and disabled) while it is — a dramatic reveal always starts
     * face-down, so the face-up combination is disallowed rather than left as a broken state.
     */
    #initDramaticToggle() {
        const checkbox = this.element.querySelector('[name="dramaticReveal"]');
        if (!checkbox) return;
        const extra = this.element.querySelector("[data-reveal-extra]");
        const faceDown = this.element.querySelector('[name="faceDown"]');

        const sync = () => {
            if (extra) extra.hidden = !checkbox.checked;
            if (faceDown) {
                if (checkbox.checked) faceDown.checked = true;
                faceDown.disabled = checkbox.checked;
            }
            this.setPosition({ height: "auto" });
        };

        checkbox.addEventListener("change", sync);
        sync();
    }

    /** Show the custom reveal-sound controls only when the "Custom sound" mode is selected. */
    #initSoundToggle() {
        const modeSelect = this.element.querySelector('select[name="soundMode"]');
        if (!modeSelect) return;
        const custom = this.element.querySelector("[data-sound-custom]");

        const sync = () => {
            if (custom) custom.hidden = modeSelect.value !== "custom";
            this.setPosition({ height: "auto" });
        };

        modeSelect.addEventListener("change", sync);
        sync();
    }

    /**
     * Wire the repeatable Display image list: "Add image" appends a row and each row's remove
     * button drops it. Rows carry indexed `displayCards.<i>.front/back` names that the builder
     * expands (via `expandObject`) into a per-index object on submit; renumbering here keeps the
     * indices contiguous as rows come and go.
     */
    #initDisplayCards() {
        const list = this.element.querySelector("[data-display-cards]");
        const addBtn = this.element.querySelector("[data-display-add]");
        if (!list || !addBtn) return;

        const renumber = () => {
            const rows = list.querySelectorAll("[data-card-row]");
            rows.forEach((row, i) => {
                const front = row.querySelector('file-picker[data-role="front"]');
                const back = row.querySelector('file-picker[data-role="back"]');
                if (front) front.setAttribute("name", `displayCards.${i}.front`);
                if (back) back.setAttribute("name", `displayCards.${i}.back`);
                // Always keep one row, so disable the lone row's remove button.
                const remove = row.querySelector("[data-row-remove]");
                if (remove) remove.disabled = rows.length === 1;
            });
        };

        list.addEventListener("click", (event) => {
            const remove = event.target.closest("[data-row-remove]");
            if (!remove || list.querySelectorAll("[data-card-row]").length <= 1) return;
            remove.closest("[data-card-row]").remove();
            renumber();
            this.setPosition({ height: "auto" });
        });

        addBtn.addEventListener("click", () => {
            const rows = list.querySelectorAll("[data-card-row]");
            const clone = rows[rows.length - 1].cloneNode(true);
            list.appendChild(clone);
            // Clear the cloned pickers once connected (and thus upgraded) so the new row is empty.
            clone.querySelectorAll("file-picker").forEach(fp => { fp.value = ""; });
            renumber();
            this.setPosition({ height: "auto" });
        });

        renumber();
    }

    /** Accept dragged Cards on the View drop zone, accumulating them into a removable list. */
    #initCardDrop() {
        const drop = this.element.querySelector("[data-card-drop]");
        if (!drop) return;
        this._viewCards ??= [];
        this.#renderViewCards();

        // Highlight the drop zone while a card hovers over it so it's clear that releasing adds it.
        // The placeholder text is pointer-events:none (CSS) so dragenter/leave fire only on the zone.
        drop.addEventListener("dragover", (event) => event.preventDefault());
        drop.addEventListener("dragenter", () => drop.classList.add("drag-over"));
        drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
        drop.addEventListener("drop", (event) => {
            drop.classList.remove("drag-over");
            this.#onDropCard(event);
        });

        const list = this.element.querySelector("[data-view-list]");
        list?.addEventListener("click", (event) => {
            const remove = event.target.closest("[data-view-remove]");
            if (!remove) return;
            this._viewCards = this._viewCards.filter(c => c.id !== remove.dataset.viewRemove);
            this.#renderViewCards();
            this.setPosition({ height: "auto" });
        });
    }

    /**
     * Render the View card chips and mirror the list into the hidden `viewCards` input so it
     * submits with the form. Called whenever the list changes.
     */
    #renderViewCards() {
        const hidden = this.element.querySelector('input[name="viewCards"]');
        if (hidden) hidden.value = JSON.stringify(this._viewCards ?? []);

        const list = this.element.querySelector("[data-view-list]");
        if (!list) return;
        list.replaceChildren();
        for (const card of this._viewCards ?? []) {
            const chip = document.createElement("div");
            chip.className = "cmb-view-chip";

            if (card.thumb) {
                const img = document.createElement("img");
                img.src = card.thumb;
                img.alt = "";
                chip.appendChild(img);
            }

            const label = document.createElement("span");
            label.className = "cmb-view-name";
            label.textContent = card.deck ? `${card.name} — ${card.deck}` : card.name;
            chip.appendChild(label);

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "cmb-view-remove";
            remove.dataset.viewRemove = card.id;
            remove.setAttribute("data-tooltip", "Remove card");
            remove.innerHTML = '<i class="fa-solid fa-xmark"></i>';
            chip.appendChild(remove);

            list.appendChild(chip);
        }
    }

    /**
     * Resolve a dropped Card document and add it to the View list, ignoring duplicates.
     * @param {DragEvent} event  The drop event.
     */
    async #onDropCard(event) {
        event.preventDefault();

        let payload;
        try {
            payload = JSON.parse(event.dataTransfer.getData("text/plain"));
        } catch {
            return;
        }
        if (payload?.type !== "Card" || !payload.uuid) {
            ui.notifications.warn("Drop a card here.");
            return;
        }

        const card = await fromUuid(payload.uuid);
        if (!card) {
            ui.notifications.warn("That card could not be found.");
            return;
        }

        this._viewCards ??= [];
        if (this._viewCards.some(c => c.id === card.id)) return;

        this._viewCards.push({
            id: card.id,
            name: card.name ?? card.faces?.[0]?.name ?? "Card",
            deck: card.parent?.name ?? "",
            thumb: card.faces?.[0]?.img ?? card.img ?? ""
        });
        this.#renderViewCards();
        this.setPosition({ height: "auto" });
    }

    /**
     * Read the form's current state, expanded so nested names (the Display image rows) resolve.
     * @returns {{type: string, data: object}}
     */
    #readForm() {
        // FormDataExtended#object is flat: dotted names like `displayCards.0.front` stay as literal
        // keys. ApplicationV2 (unlike the legacy FormApplication) does not expand them, so do it here
        // to surface the indexed Display image rows as a nested `displayCards` object.
        const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(this.element).object);
        return { type: data.macroType, data };
    }

    /**
     * Icon-picker action (declared in `DEFAULT_OPTIONS.actions`). Opens a FilePicker on the icon
     * button beside the macro name and writes the chosen image into the hidden `macroIcon` input
     * and the button's thumbnail, so submission carries the user's pick.
     * @param {PointerEvent} _event   The originating click event.
     * @param {HTMLElement} target    The icon button hosting the thumbnail.
     */
    async _onPickIcon(_event, target) {
        const hidden = this.element.querySelector('input[name="macroIcon"]');
        const thumb = target.querySelector("img");
        // Resolve the active FilePicker implementation so host environments can substitute their own.
        const FilePickerClass = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
        const picker = new FilePickerClass({
            type: "image",
            current: hidden?.value || DEFAULT_MACRO_ICON,
            callback: (path) => {
                if (hidden) hidden.value = path;
                if (thumb) thumb.src = path;
            }
        });
        picker.render(true);
    }

    /**
     * Preview action (declared in `DEFAULT_OPTIONS.actions`). Runs the chosen action live —
     * exactly what the saved macro would do — without creating the macro, so the user can see the
     * result first. Note that Draw/View have real side effects (they draw/move cards and post to
     * chat); Display is purely visual.
     * @param {PointerEvent} _event   The originating click event.
     * @param {HTMLElement} _target   The preview button.
     */
    async _onPreview(_event, _target) {
        const { type, data } = this.#readForm();

        const error = validate(type, data);
        if (error) {
            ui.notifications.warn(error);
            return;
        }

        try {
            await runPreview(type, data);
        } catch (err) {
            ui.notifications.error("Preview failed.");
            console.error(`${MODULE_ID} | Macro preview failed.`, err);
        }
    }

    /**
     * Form submission handler declared in `DEFAULT_OPTIONS.form`. Validates the fields relevant to
     * the chosen type, generates the macro script, and writes a script Macro into the fixed folder.
     * Leaves the form open for the next macro.
     * @param {SubmitEvent} _event                                  The originating submit event.
     * @param {HTMLFormElement} _form                               The form element.
     * @param {foundry.applications.ux.FormDataExtended} formData   The parsed form data.
     */
    static async #onGenerate(_event, _form, formData) {
        // Expand the flat form data so the indexed `displayCards.<i>.front/back` names become a
        // nested `displayCards` object (see #readForm). The handler receives the raw FormDataExtended.
        const data = foundry.utils.expandObject(formData.object);
        const type = data.macroType;

        const error = validate(type, data);
        if (error) {
            ui.notifications.warn(error);
            return;
        }

        const command = buildCommand(type, data);
        if (!command) {
            ui.notifications.warn("Pick a macro type.");
            return;
        }

        const MacroCls = foundry.utils.getDocumentClass("Macro");
        // The user-picked hotbar icon, falling back to the module default when the field is cleared.
        const img = data.macroIcon || DEFAULT_MACRO_ICON;
        const name = (data.macroName ?? "").trim() || defaultMacroName(type, data);

        try {
            const folder = await getOrCreateMacroFolder();
            await MacroCls.create({ name, type: "script", scope: "global", command, img, folder: folder.id });
            ui.notifications.info(`Macro "${name}" created in the "${MACRO_FOLDER_NAME}" folder.`);
        } catch (err) {
            ui.notifications.error("Failed to create the macro.");
            console.error(`${MODULE_ID} | Failed to create macro.`, err);
        }
    }
}
