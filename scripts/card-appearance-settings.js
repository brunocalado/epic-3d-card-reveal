import { MODULE_ID, SETTINGS } from "./constants.js";

const fields = foundry.data.fields;

/**
 * Data model backing the hidden `cardAppearance` world setting. Holds every default
 * visual property of the card viewer, edited through {@link CardAppearanceSettings}.
 */
export class CardAppearanceData extends foundry.abstract.DataModel {
    /** @override */
    static defineSchema() {
        return {
            glowColor: new fields.ColorField({
                required: true,
                nullable: false,
                initial: "#ffd700",
                label: "Card glow color",
                hint: "Glow / shadow color around displayed cards. Defaults to gold."
            }),
            glowIntensity: new fields.NumberField({
                required: true,
                nullable: false,
                min: 0,
                max: 1,
                initial: 0.5,
                label: "Card glow intensity",
                hint: "Strength of the glow. 0 turns it off entirely; the rest of the slider is a usable band — the default already gives a strong glow, and the top end pushes it brighter and wider still."
            }),
            backImage: new fields.FilePathField({
                categories: ["IMAGE"],
                required: true,
                blank: false,
                initial: `modules/${MODULE_ID}/assets/cardbacks/orcnogback.webp`,
                label: "Card back image",
                hint: "Default back image used when a card has no back of its own."
            }),
            dramaticRevealDelay: new fields.NumberField({
                required: true,
                integer: true,
                min: 0,
                initial: 1500,
                label: "Dramatic reveal delay (ms)",
                hint: "Milliseconds to wait before automatically flipping a card face-up during a dramatic reveal."
            })
        };
    }
}

/**
 * Settings menu form for {@link CardAppearanceData}. Opened from the module settings
 * tab via the button registered with `game.settings.registerMenu`.
 */
export class CardAppearanceSettings extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: "card-appearance-settings",
        classes: [MODULE_ID, "card-appearance-settings"],
        tag: "form",
        window: {
            title: "Card Appearance",
            icon: "fa-solid fa-palette",
            contentClasses: ["standard-form"]
        },
        // height "auto" keeps the window snug to the form content instead of a tall fixed frame.
        position: { width: 480, height: "auto" },
        form: {
            handler: CardAppearanceSettings.#onSubmit,
            closeOnSubmit: true
        }
    };

    /** @override */
    static PARTS = {
        body: { template: `modules/${MODULE_ID}/templates/card-appearance-settings.hbs` },
        footer: { template: "templates/generic/form-footer.hbs" }
    };

    /** @override Builds the render context for the full render. */
    async _prepareContext(_options) {
        const current = game.settings.get(MODULE_ID, SETTINGS.CARD_APPEARANCE);
        return {
            fields: CardAppearanceData.schema.fields,
            source: current instanceof CardAppearanceData ? current.toObject() : current,
            buttons: [{ type: "submit", icon: "fa-solid fa-floppy-disk", label: "Save Changes" }]
        };
    }

    /**
     * Form submission handler declared in `DEFAULT_OPTIONS.form`.
     * Persists the edited values into the `cardAppearance` world setting.
     * @param {SubmitEvent} _event                                  The originating submit event.
     * @param {HTMLFormElement} _form                               The form element.
     * @param {foundry.applications.ux.FormDataExtended} formData   The parsed form data.
     */
    static async #onSubmit(_event, _form, formData) {
        await game.settings.set(MODULE_ID, SETTINGS.CARD_APPEARANCE, formData.object);
    }
}
