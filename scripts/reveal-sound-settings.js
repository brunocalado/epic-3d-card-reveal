import { MODULE_ID, SETTINGS, SOUND_CHANNELS } from "./constants.js";

const fields = foundry.data.fields;

/**
 * Data model backing the hidden `revealSound` world setting. Holds the default reveal sound, its
 * playback volume, and the audio channel it plays through, edited via {@link RevealSoundSettings}.
 * The reveal sound is what plays — locally, on the client viewing the card — the moment a card's
 * face becomes visible (see CardViewerApp in scripts/fancy-display.js).
 */
export class RevealSoundData extends foundry.abstract.DataModel {
    /** @override */
    static defineSchema() {
        return {
            // blank is allowed so clearing the field disables the reveal sound globally ("no sound").
            sound: new fields.FilePathField({
                categories: ["AUDIO"],
                required: true,
                blank: true,
                initial: `modules/${MODULE_ID}/assets/reveal.ogg`,
                label: "Reveal sound",
                hint: "Sound played on the local client when a card's face is revealed. Leave blank for no sound."
            }),
            volume: new fields.AlphaField({
                initial: 0.8,
                label: "Reveal sound volume",
                hint: "Playback volume. 0 is silent; 1 is full volume. The chosen channel's mixer volume still applies on top."
            }),
            channel: new fields.StringField({
                required: true,
                blank: false,
                initial: "interface",
                choices: SOUND_CHANNELS,
                label: "Audio channel",
                hint: "Which audio channel (and mixer volume slider) the reveal sound plays through."
            })
        };
    }
}

/**
 * Settings menu form for {@link RevealSoundData}. Opened from the module settings tab via the
 * button registered with `game.settings.registerMenu`. Adds a "Reset to Defaults" action that
 * restores the schema initials (default sound `assets/reveal.ogg`, volume, and channel).
 */
export class RevealSoundSettings extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: "reveal-sound-settings",
        classes: [MODULE_ID, "reveal-sound-settings"],
        tag: "form",
        window: {
            title: "Reveal Sound",
            icon: "fa-solid fa-volume-high",
            contentClasses: ["standard-form"]
        },
        // height "auto" keeps the window snug to the form content instead of a tall fixed frame.
        position: { width: 480, height: "auto" },
        actions: {
            reset: RevealSoundSettings.prototype._onReset
        },
        form: {
            handler: RevealSoundSettings.#onSubmit,
            closeOnSubmit: true
        }
    };

    /** @override */
    static PARTS = {
        body: { template: `modules/${MODULE_ID}/templates/reveal-sound-settings.hbs` },
        footer: { template: "templates/generic/form-footer.hbs" }
    };

    /** @override Builds the render context for the full render. */
    async _prepareContext(_options) {
        const current = game.settings.get(MODULE_ID, SETTINGS.REVEAL_SOUND);
        const source = current instanceof RevealSoundData ? current.toObject() : current;
        return {
            fields: RevealSoundData.schema.fields,
            source,
            // Localized channel labels follow the client's language and match Foundry's audio mixer.
            // `selected` is precomputed so the template needs no comparison helper.
            channels: SOUND_CHANNELS.map(value => ({
                value,
                label: game.i18n.localize(CONST.AUDIO_CHANNELS[value]),
                selected: value === source.channel
            })),
            buttons: [
                { type: "button", action: "reset", icon: "fa-solid fa-rotate-left", label: "Reset to Defaults" },
                { type: "submit", icon: "fa-solid fa-floppy-disk", label: "Save Changes" }
            ]
        };
    }

    /**
     * "Reset to Defaults" action declared in `DEFAULT_OPTIONS.actions`. Persists the schema initials
     * back into the world setting and re-renders the form so the controls reflect the restored
     * defaults. The user does not need to also click Save.
     * @param {PointerEvent} _event   The originating click event.
     * @param {HTMLElement} _target   The reset button.
     */
    async _onReset(_event, _target) {
        await game.settings.set(MODULE_ID, SETTINGS.REVEAL_SOUND, new RevealSoundData().toObject());
        ui.notifications.info("Reveal sound settings reset to defaults.");
        await this.render();
    }

    /**
     * Form submission handler declared in `DEFAULT_OPTIONS.form`.
     * Persists the edited values into the `revealSound` world setting.
     * @param {SubmitEvent} _event                                  The originating submit event.
     * @param {HTMLFormElement} _form                               The form element.
     * @param {foundry.applications.ux.FormDataExtended} formData   The parsed form data.
     */
    static async #onSubmit(_event, _form, formData) {
        await game.settings.set(MODULE_ID, SETTINGS.REVEAL_SOUND, formData.object);
    }
}
