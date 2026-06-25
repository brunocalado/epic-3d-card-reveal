import { MODULE_ID, SETTINGS } from "./constants.js";
import { postCardToChat, postImageToChat, postChatAfterReveal, resolveSendToChat } from "./helpers.js";

const TEMPLATE = `modules/${MODULE_ID}/templates/card-viewer.hbs`;

/**
 * Decorative glowing light orbs clustered around the card. Each entry is rendered as a single
 * pure-CSS radial-gradient sphere by {@link CardViewerApp#_injectSparkles} — no image assets.
 * Positions are percentages of the card-display box, so the orbs hug the card and move/scale with it;
 * values may fall below 0 or above 100 to sit just outside the card edges. `size` is a fixed pixel
 * diameter, which keeps every orb a perfect circle regardless of the card's aspect ratio.
 * `drift`/`twinkle`/`delay` are in ms.
 *
 * Two groups: "behind" orbs sit within the card silhouette and render under it (z-index:-1), peeking
 * out as the card tilts; "frame" orbs hug the outer edges and stay visible to wreath the card.
 * @type {Array<{top:number, left:number, size:number, drift:number, twinkle:number, delay:number}>}
 */
const SPARKLE_DATA = [
    // Behind the card (revealed as it tilts)
    { top: 16, left: 22,  size: 34, drift: 12750, twinkle: 6560, delay: -100 },
    { top: 30, left: 78,  size: 30, drift: 11900, twinkle: 4200, delay: -3300 },
    { top: 52, left: 14,  size: 38, drift: 10815, twinkle: 6731, delay: -2100 },
    { top: 70, left: 84,  size: 32, drift: 13649, twinkle: 6529, delay: -800 },
    { top: 86, left: 40,  size: 28, drift: 11700, twinkle: 4800, delay: -1100 },
    { top: 44, left: 60,  size: 26, drift: 12322, twinkle: 5003, delay: -500 },
    { top: 10, left: 55,  size: 24, drift: 12914, twinkle: 4546, delay: -300 },
    { top: 38, left: 36,  size: 22, drift: 11500, twinkle: 5200, delay: -1300 },
    { top: 62, left: 50,  size: 30, drift: 13200, twinkle: 6100, delay: -2400 },
    { top: 24, left: 88,  size: 20, drift: 10700, twinkle: 4300, delay: -900 },
    { top: 78, left: 20,  size: 26, drift: 12300, twinkle: 5800, delay: -1900 },
    // Framing the card edges
    { top: 25, left: -10, size: 48, drift: 11311, twinkle: 5521, delay: -700 },
    { top: 60, left: -14, size: 40, drift: 12400, twinkle: 3900, delay: -1700 },
    { top: 88, left: -6,  size: 34, drift: 11200, twinkle: 6300, delay: -400 },
    { top: 20, left: 110, size: 44, drift: 10500, twinkle: 6100, delay: -2500 },
    { top: 55, left: 114, size: 52, drift: 13813, twinkle: 7056, delay: -900 },
    { top: 82, left: 106, size: 36, drift: 13100, twinkle: 5400, delay: -600 },
    { top: -10, left: 30, size: 38, drift: 12600, twinkle: 5900, delay: -1900 },
    { top: -12, left: 72, size: 30, drift: 13400, twinkle: 4100, delay: -2800 },
    { top: 108, left: 35, size: 34, drift: 11700, twinkle: 4700, delay: -2200 },
    { top: 110, left: 68, size: 40, drift: 10900, twinkle: 5600, delay: -1500 },
    { top: -6, left: 100, size: 28, drift: 12100, twinkle: 4800, delay: -1000 },
    { top: 5,  left: -10, size: 26, drift: 11800, twinkle: 5300, delay: -1600 },
    { top: 42, left: -8,  size: 30, drift: 12900, twinkle: 6400, delay: -2700 },
    { top: 95, left: 112, size: 34, drift: 10600, twinkle: 4500, delay: -700 },
    { top: 38, left: 108, size: 28, drift: 13500, twinkle: 5700, delay: -2000 }
];

/**
 * Internal AppV2 that renders the full-screen card viewer with all of its
 * interactive flourishes (flip, perspective tilt, glint, sparkles, dramatic reveal).
 *
 * Not exported on the module API — instantiated indirectly through {@link FancyDisplay}.
 */
class CardViewerApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
    /** @override */
    static DEFAULT_OPTIONS = {
        id: "card-viewer-{id}",
        classes: [MODULE_ID, "card-viewer-app"],
        tag: "div",
        window: {
            frame: false,
            positioned: false
        },
        actions: {
            flip: CardViewerApp.prototype._onFlip,
            share: CardViewerApp.prototype._onShare,
            close: CardViewerApp.prototype._onCloseAll
        }
    };

    /** @override */
    static PARTS = {
        viewer: { template: TEMPLATE }
    };

    /**
     * @param {object} options                            App options.
     * @param {Array<{front:string, back:string|null}>} options.images  Cards to render.
     * @param {string} options.glowColor                  Glow color (the card's edge): the glow halo frames the
     *                                                    card and tints the moving glint.
     * @param {number} [options.glowIntensity]            Glow strength (0..1). 0 disables the glow; the visible
     *                                                    band runs from a clear minimum up through a strong default
     *                                                    to an even brighter/wider halo at the top. When omitted,
     *                                                    the glow color is used as-is at the base size (so a raw
     *                                                    per-call `glowColor` keeps whatever alpha it carries).
     * @param {boolean} options.faceDown                  Whether cards initially render face-down.
     * @param {boolean} options.dramaticReveal            Whether to start face-down then auto-flip face-up after
     *                                                    the delay. While the countdown runs the card cannot be
     *                                                    flipped manually, so it can never be revealed early.
     * @param {number} [options.revealDelay]              Per-call dramatic-reveal delay (ms). Falls back to
     *                                                    the world `dramaticRevealDelay` setting when omitted.
     * @param {boolean} options.showShareBtn              Whether to render the "share with everyone" button.
     * @param {boolean} [options.sendToChat]              Resolved flag: whether sharing also mirrors the
     *                                                    card to chat (see {@link CardViewerApp#_onShare}).
     * @param {{deckName:string, cards:Array<object>}|null} [options.chatMeta]  Card metadata used to post a
     *                                                    public chat preview when the view is shared.
     * @param {string} [options.sound]                    Resolved reveal-sound path. Empty string means no
     *                                                    sound. Played locally when the card face is revealed.
     * @param {number} [options.soundVolume]              Resolved reveal-sound volume (0..1).
     * @param {string} [options.soundChannel]             Resolved audio channel for the reveal sound.
     * @param {() => void} [options.onReveal]             Optional callback fired once when the face is first
     *                                                    revealed. Used to hold a face-down card's chat preview
     *                                                    (which shows the front) until the card is flipped face-up.
     */
    constructor(options = {}) {
        super(options);
        this.images = options.images ?? [];
        this.glowColor = options.glowColor;
        this.glowIntensity = options.glowIntensity;
        this.faceDown = !!options.faceDown;
        this.dramaticReveal = !!options.dramaticReveal;
        this.revealDelay = options.revealDelay;
        this.showShareBtn = !!options.showShareBtn;
        this.sendToChat = !!options.sendToChat;
        this.chatMeta = options.chatMeta ?? null;
        this.sound = options.sound;
        this.soundVolume = options.soundVolume;
        this.soundChannel = options.soundChannel;
        // Optional callback fired the first time the face is revealed; lets a face-down card hold its
        // chat preview until it is actually flipped face-up (see _revealFace).
        this.onReveal = options.onReveal ?? null;
        // The reveal sound plays at most once per viewer; this guards every reveal path
        // (initial face-up render, dramatic auto-flip, and manual flips).
        this._soundPlayed = false;
        // onReveal likewise fires at most once, on the first reveal.
        this._revealFired = false;
        // A dramatic reveal locks the card until its timed auto-flip: manual flips are refused while
        // the countdown runs, so the card can never be revealed early. _scheduleDramaticReveal
        // clears this when the delay elapses.
        this._revealLocked = this.dramaticReveal;
        // Index of the card currently blown up to full size via right-click, or null for the
        // normal fanned-out hand. See _toggleSolo.
        this._soloIndex = null;
    }

    /** @override Called once per render before {@link _renderHTML} runs. */
    async _prepareContext(_options) {
        return {
            images: this.images,
            // The box-shadow that draws the glow halo, sized + tinted from the color and intensity.
            glowShadow: CardViewerApp._composeGlowShadow(this.glowColor, this.glowIntensity),
            // The glow is the card's edge now, so the moving glint takes its rim hue from the glow.
            glintColor: CardViewerApp._adjustToGlintColor(this.glowColor),
            faceDown: this.faceDown,
            dramaticReveal: this.dramaticReveal,
            showShareBtn: this.showShareBtn,
            // Drives the extra "right-click to enlarge" hint, which only makes sense for a hand.
            hasMultiple: this.images.length > 1
        };
    }

    /** @override Runs once after the first render. */
    _onFirstRender(_context, _options) {
        this._layoutArc();
        this._injectSparkles();
        this._scheduleDramaticReveal();

        // Cards that render face-up (not face-down and not a pending dramatic reveal) expose their
        // face immediately, so the reveal fires right away. Face-down / dramatic-reveal cards
        // instead fire it when the face is later revealed (see _onFlip / _scheduleDramaticReveal).
        if (!this.faceDown && !this.dramaticReveal) this._revealFace();

        const stage = this.element.querySelector(".cv-stage");
        if (!stage) return;

        stage.addEventListener("mousemove", (event) => {
            const mouseX = event.clientX;
            const mouseY = event.clientY;
            requestAnimationFrame(() => {
                if (!this.element) return;
                // Skip hidden cards (solo mode) — only the visible card(s) need the tilt/glint.
                this.element.querySelectorAll(".cv-arc-container:not(.cv-hidden) .cv-perspective-container").forEach(wrpCard => {
                    const dispGlint = wrpCard.querySelector(".cv-glint");
                    if (dispGlint) CardViewerApp._applyPerspective(wrpCard, dispGlint, mouseX, mouseY);
                });
            });
        });

        // Right-click a card to blow it up to full (single-card) size, hiding the rest of the
        // hand; right-click again to restore the fan. preventDefault suppresses the browser's
        // context menu over the cinematic overlay even when the click misses a card.
        stage.addEventListener("contextmenu", (event) => {
            event.preventDefault();
            const arc = event.target.closest(".cv-arc-container");
            if (arc) this._toggleSolo(arc);
        });
    }

    /**
     * Flip handler. Called for each `data-action="flip"` element.
     * @param {PointerEvent} _event   The originating click event.
     * @param {HTMLElement} target    The card container that was clicked.
     */
    _onFlip(_event, target) {
        // A locked dramatic reveal forbids flipping early — the viewer must wait for the timed
        // auto-reveal. Applies to every card, including one blown up to full size via right-click.
        if (this._revealLocked) return;
        const flipContainer = target.closest(".cv-flip-container");
        if (!flipContainer) return;
        flipContainer.classList.toggle("flipped");
        // Removing "flipped" turns the card face-up: the face is now seen, so fire the reveal (once).
        // Flipping back face-down never re-fires it thanks to the _soundPlayed / _revealFired guards.
        if (!flipContainer.classList.contains("flipped")) this._revealFace();
    }

    /**
     * Share handler. Sends the current card payload to all other clients via the native socket.
     * Sharing makes the card public, so deck cards are also mirrored to chat as a public
     * message that any user can click to re-open the card locally.
     * @param {PointerEvent} _event   The originating click event.
     * @param {HTMLElement} target    The share button element.
     */
    _onShare(_event, target) {
        target.disabled = true;
        // While this viewer is still mid-reveal, receivers replay the locked dramatic reveal so
        // nobody sees the card early. Once it has revealed, drop the dramatic reveal and show the
        // card face-up — a completed dramatic reveal ends face-up regardless of how it started.
        const stillRevealing = this._revealLocked;
        const faceDown = this.dramaticReveal && !stillRevealing ? false : this.faceDown;
        CardViewerApp._broadcastShare({
            images: this.images,
            glowColor: this.glowColor,
            glowIntensity: this.glowIntensity,
            faceDown,
            dramaticReveal: stillRevealing,
            revealDelay: this.revealDelay,
            // Forward the already-resolved reveal sound so receivers play it locally on reveal.
            sound: this.sound,
            soundVolume: this.soundVolume,
            soundChannel: this.soundChannel
        });
        if (this.sendToChat && this.chatMeta) {
            // If still mid-reveal, hold the public preview until the reveal completes so sharing
            // doesn't spoil the front before everyone's viewer has flipped.
            postChatAfterReveal(this._revealLocked, this.revealDelay, () => {
                for (const { id, name, front, desc } of this.chatMeta.cards) {
                    postCardToChat({ deckName: this.chatMeta.deckName, cardId: id, cardName: name, front, desc, isPublic: true });
                }
            });
        }
    }

    /**
     * Close handler. Closes every active card viewer (matches the legacy behavior of
     * "click outside dismisses the whole stack").
     */
    async _onCloseAll() {
        await CardViewerApp.closeAll();
    }

    /**
     * Force-skip the core closing transition on every close path. AppV2's default close
     * animation collapses the element via inline `max-height: 0`, which re-reveals this
     * full-screen overlay's centered card squashed at the top of the viewport before teardown.
     * @override
     * @param {object} [options]  Closing options forwarded to ApplicationV2#close.
     * @returns {Promise<CardViewerApp>}
     */
    async close(options = {}) {
        return super.close({ ...options, animate: false });
    }

    /**
     * Close every CardViewerApp instance currently rendered.
     */
    static async closeAll() {
        const apps = [...foundry.applications.instances.values()].filter(a => a instanceof CardViewerApp);
        await Promise.all(apps.map(a => a.close()));
    }

    /**
     * Compute and apply the arc layout to each card wrapper so multi-card hands fan out naturally.
     * Called from {@link _onFirstRender}.
     */
    _layoutArc() {
        // Only visible cards are laid out: in solo mode a single visible card lands centered at
        // full size; in the normal hand every card is visible and fans out.
        const things = this.element.querySelectorAll(".cv-arc-container:not(.cv-hidden)");
        if (!things.length) return;

        const dir = 1; // 1 = frown shape, -1 = smile shape
        const rotate = true;
        let radius = 200;

        let totalWidth = 0;
        const centers = [];
        things.forEach(thing => {
            const widthPx = thing.offsetWidth;
            const widthVh = (widthPx / window.innerHeight) * 100;
            const center = totalWidth + widthVh / 2;
            centers.push(center);
            totalWidth += widthVh;
        });

        if (radius < totalWidth / 2) radius = totalWidth / 2;

        const baseArc = totalWidth;
        const angle = 2 * Math.asin(baseArc / (2 * radius));
        const fullArcLength = radius * angle;

        let iteratorX = 0;
        things.forEach((thing, i) => {
            const widthPx = thing.offsetWidth;
            const widthVh = (widthPx / window.innerHeight) * 100;

            const arcLetter = (widthVh / totalWidth) * fullArcLength;
            const beta = arcLetter / radius;
            const h = radius * Math.cos(beta / 2);

            const alpha = Math.acos((totalWidth / 2 - iteratorX) / radius);
            const theta = alpha + beta / 2;

            const x = Math.cos(theta) * h;
            const y = Math.sin(theta) * h;
            const xpos = iteratorX + Math.abs(totalWidth / 2 - x - iteratorX);

            const xval = xpos - centers[i];
            const yval = dir * (radius - y);
            const ang = rotate ? dir * -Math.asin(x / radius) * (180 / Math.PI) : 0;

            thing.style.display = "inline-block";
            thing.style.position = "relative";
            thing.style.left = `${xval}vh`;
            thing.style.top = `${yval}vh`;
            thing.style.transform = `rotate(${ang}deg)`;
            thing.style.transformOrigin = "bottom center";

            iteratorX = 2 * xpos - iteratorX;
        });
    }

    /**
     * Toggle "solo" mode for one card: hide every other card so the clicked one grows to the size
     * it would have on its own, then re-center it. Right-clicking the same card again (or any card
     * while soloed back to itself) restores the full fan. A no-op for single-card viewers, which
     * are already full size. Called from the stage's contextmenu handler in {@link _onFirstRender}.
     * @param {HTMLElement} arc  The `.cv-arc-container` of the right-clicked card.
     */
    _toggleSolo(arc) {
        const containers = [...this.element.querySelectorAll(".cv-arc-container")];
        if (containers.length < 2) return;

        const index = containers.indexOf(arc);
        if (index < 0) return;

        const goingSolo = this._soloIndex !== index;
        this._soloIndex = goingSolo ? index : null;
        containers.forEach((c, i) => c.classList.toggle("cv-hidden", goingSolo && i !== index));

        // Re-run the arc layout over the now-visible card(s): the lone visible card lands centered
        // at full size; restoring all of them rebuilds the fan.
        this._layoutArc();
    }

    /**
     * Inject the decorative light orbs into the cards display box so they cluster around the card.
     * Each orb is a single CSS radial-gradient sphere (see {@link SPARKLE_DATA}); no image assets.
     * Called from {@link _onFirstRender}.
     */
    _injectSparkles() {
        const container = this.element.querySelector(".cv-cards-display");
        if (!container) return;

        for (const data of SPARKLE_DATA) {
            const orb = document.createElement("div");
            orb.classList.add("cv-sparkle-orb");
            orb.style.top = `${data.top}%`;
            orb.style.left = `${data.left}%`;
            // Fixed pixel diameter on a square box keeps every orb a perfect circle.
            orb.style.width = `${data.size}px`;
            orb.style.height = `${data.size}px`;
            // Two independent animations: a slow positional drift and a faster brightness twinkle.
            orb.style.animationDuration = `${data.drift}ms, ${data.twinkle}ms`;
            orb.style.animationDelay = `${data.delay}ms, ${data.delay}ms`;
            container.appendChild(orb);
        }
    }

    /**
     * When a dramatic reveal is requested, flip the cards face-up one by one after the delay and
     * release the reveal lock. A dramatic reveal always starts face-down, so this runs regardless
     * of the `faceDown` option. Called from {@link _onFirstRender}.
     */
    _scheduleDramaticReveal() {
        if (!this.dramaticReveal) return;

        // Per-call delay wins; fall back to the world default when this viewer didn't carry one.
        const delayMs = this.revealDelay ?? game.settings.get(MODULE_ID, SETTINGS.CARD_APPEARANCE).dramaticRevealDelay;
        const flips = this.element.querySelectorAll(".cv-flip-container");

        setTimeout(() => {
            // The viewer may have been dismissed during the wait; don't reveal/sound a dead card.
            if (!this.element?.isConnected) return;
            // The wait is over: lift the manual-flip lock so cards behave normally again.
            this._revealLocked = false;
            // The face becomes visible as the first card flips, so the reveal fires here (once)
            // rather than per-card, even when a whole hand fans out.
            this._revealFace();
            let i = 0;
            const interval = setInterval(() => {
                flips[i]?.classList.remove("flipped");
                i++;
                if (i >= flips.length) clearInterval(interval);
            }, 80);
        }, delayMs);
    }

    /**
     * Run the once-per-viewer "the face is now visible" side effects: play the reveal sound and fire
     * the optional {@link onReveal} callback. The callback lets a face-down card hold its chat preview
     * (which shows the front) until the card is actually flipped face-up, so it isn't posted while the
     * card still sits face-down. Each effect is independently guarded to run at most once.
     * Called wherever the face becomes visible: {@link _onFirstRender} (immediate face-up render),
     * {@link _onFlip} (manual flip) and {@link _scheduleDramaticReveal} (timed auto-flip).
     */
    _revealFace() {
        this._playRevealSound();
        if (!this.onReveal || this._revealFired) return;
        this._revealFired = true;
        try {
            this.onReveal();
        } catch (error) {
            console.error(`${MODULE_ID} | Reveal callback failed.`, error);
        }
    }

    /**
     * Play the configured reveal sound on this client, at most once per viewer. No-op when no sound
     * is configured (empty string / nullish). Local-only: each client that sees the card plays its
     * own sound, so a shared reveal is heard by everyone viewing it without any socket broadcast of
     * the audio itself.
     * Called from {@link _revealFace}.
     */
    _playRevealSound() {
        if (this._soundPlayed || !this.sound) return;
        this._soundPlayed = true;
        // socketOptions `false`: do not rebroadcast — playback stays on the viewing client.
        foundry.audio.AudioHelper.play({
            src: this.sound,
            volume: this.soundVolume,
            channel: this.soundChannel,
            autoplay: true,
            loop: false
        }, false);
    }

    /**
     * Apply a tilt + glint effect to a single card based on cursor position.
     * @param {HTMLElement} wrpCard    The perspective container element.
     * @param {HTMLElement} dispGlint  The glint overlay element.
     * @param {number} mouseX          Pointer X in viewport coordinates.
     * @param {number} mouseY          Pointer Y in viewport coordinates.
     */
    static _applyPerspective(wrpCard, dispGlint, mouseX, mouseY) {
        const bcr = wrpCard.getBoundingClientRect();
        const hView = window.innerHeight;

        const cCenterX = bcr.left + bcr.width / 2;
        const cCenterY = bcr.top + bcr.height / 2;

        const cMouseX = mouseX - cCenterX;
        const cMouseY = (hView - mouseY) - (hView - cCenterY);

        const scaleFactor = hView * 2;
        const distance = Math.sqrt(cMouseX ** 2 + cMouseY ** 2);
        const falloffFactor = 3 * Math.max(0.1, 1 - Math.pow(distance / scaleFactor, 0.5));

        const rotX = (cMouseY / scaleFactor) * falloffFactor;
        const rotY = (cMouseX / scaleFactor) * falloffFactor;

        // Frameless cards: spread the edge glint slightly past the card so the rim light reaches
        // the very edge (there is no frame to contain it).
        const glintEdgeSpreadTop = 110;
        const glintEdgeSpreadBottom = -10;

        wrpCard.style.transform = `perspective(100vh) rotateX(${rotX}rad) rotateY(${rotY}rad)`;

        const glintDist = Math.sqrt(cMouseX ** 2 + cMouseY ** 2);
        const glintDistRatio = glintDist / hView;

        const pctLeft = ((mouseX - bcr.left) / bcr.width) * 100;
        const pctTop = ((mouseY - bcr.top) / bcr.height) * 100;
        const pctLeftClamped = Math.max(0, Math.min(100, pctLeft));
        const pctTopClamped = Math.max(0, Math.min(100, pctTop));
        const glintOpacityFalloff = glintDistRatio * 0.33;

        const gradSpot = `radial-gradient(
            circle at left ${pctLeft}% top ${pctTop}%,
            rgba(255, 255, 255, 0.73) 0%,
            rgba(255, 255, 255, ${1.0 - glintOpacityFalloff}) 1%,
            rgba(255, 255, 255, ${1.0 - glintOpacityFalloff}) ${1 + (glintDistRatio * 2)}%,
            rgba(255, 255, 255, 0.53) ${2 + (glintDistRatio * 2)}%,
            transparent ${5 + (glintDistRatio * 13)}%
        )`;

        const gradSpotInv = `radial-gradient(
            circle at left ${100 - pctLeftClamped}% top ${100 - pctTopClamped}%,
            #fff2 0%,
            #fff2 ${10 + (glintDistRatio * 2)}%,
            transparent ${20 + (glintDistRatio * 5)}%
        )`;

        const gradEdge = `linear-gradient(
            ${-rotX + rotY}rad,
            var(--rgb-card-glint--edge) ${glintEdgeSpreadBottom}%,
            transparent 4%,
            transparent 96%,
            var(--rgb-card-glint--edge) ${glintEdgeSpreadTop}%
        )`;

        dispGlint.style.background = `${gradSpot}, ${gradSpotInv}, ${gradEdge}`;
    }

    /**
     * Emit the share-to-all payload to other clients via the native socket.
     * @param {object} payload Share payload mirrored to other clients.
     */
    static _broadcastShare(payload) {
        game.socket.emit(`module.${MODULE_ID}`, { type: "shareToAll", payload });
    }

    /**
     * Compose the `box-shadow` value that draws the glow halo around a card from a base color and a
     * 0..1 intensity. The mapping kills the old "everything below 0.5 is invisible" dead zone:
     *
     * - `intensity === 0` → `"none"` (no glow at all).
     * - `(0, 0.5]` → the lower half ramps the color's alpha from ~50% up to 100% at the base halo
     *   size, so even the smallest non-zero intensity is already clearly visible and the **0.5
     *   default reproduces the original full-strength look** (alpha 100%, `30px/10px`).
     * - `(0.5, 1]` → alpha stays at 100% while the blur/spread grow, pushing the halo brighter and
     *   wider than the previous maximum for an even stronger glow.
     *
     * When `intensity` is omitted (a raw per-call `glowColor` with no intensity), the color is used
     * verbatim at the base size so it keeps whatever alpha the caller supplied.
     *
     * @param {string} color        Glow color. A hex color when an intensity is given (its own alpha
     *                              is ignored and replaced by the computed one); any CSS color otherwise.
     * @param {number} [intensity]  Glow strength (0..1), or undefined to use the color as-is.
     * @returns {string} A CSS `box-shadow` value (or `"none"`).
     */
    static _composeGlowShadow(color, intensity) {
        // No intensity → keep the caller's color (and its alpha) at the base halo size.
        if (intensity == null || !Number.isFinite(intensity)) return `0 0 30px 10px ${color}`;
        if (intensity <= 0) return "none";

        // Intensity replaces the color's alpha, so the color must resolve to RGB. The settings menu
        // and macro builder always pass a hex color; a public-API caller could pass any CSS color,
        // so fall back to the base halo (color as-is) when it isn't parseable to RGB.
        let rgb;
        try {
            rgb = foundry.utils.Color.from(color).rgb;
        } catch {
            rgb = null;
        }
        if (!rgb || rgb.some(v => !Number.isFinite(v))) return `0 0 30px 10px ${color}`;

        const t = Math.min(intensity, 1);
        let alpha, blur, spread;
        if (t <= 0.5) {
            // Lower half: ramp alpha 0.5 → 1.0 at the base size. t → 0 gives ~0.5 (clearly visible).
            alpha = 0.5 + t;
            blur = 30;
            spread = 10;
        } else {
            // Upper half: alpha pinned at full; grow the halo for an even stronger glow than before.
            const k = (t - 0.5) * 2; // 0 → 1 across the upper half
            alpha = 1;
            blur = 30 + 30 * k;      // up to 60px
            spread = 10 + 12 * k;    // up to 22px
        }

        const [r, g, b] = rgb.map(v => Math.round(v * 255));
        return `0 0 ${Math.round(blur)}px ${Math.round(spread)}px rgb(${r} ${g} ${b} / ${Math.round(alpha * 100)}%)`;
    }

    /**
     * Nudge the glow color into a warm "glint" hue used for the card edge gradient.
     * @param {string} color  Source color (hex or rgb).
     * @returns {string|null} An HSL string suitable for CSS, or null when no usable color is given.
     */
    static _adjustToGlintColor(color) {
        if (!color || color === "transparent") return null;
        // The glow color is user-supplied (it accepts any CSS color, incl. named ones the hex/rgb
        // parser can't read). A color we can't parse just means no edge glint — never a failed render.
        let H, S, L;
        try {
            [H, S, L] = CardViewerApp._convertHexToHSL(color);
        } catch {
            return null;
        }
        const Y = 58;
        const newH = H > (Y + 10) ? H - 10 : H < (Y - 10) ? H + 10 : Y;
        const newS = Math.pow(S, 1.08);
        const newL = (L * 10 + 100) / 11;
        return `hsl(${Math.round(newH)} ${Math.round(newS)}% ${Math.round(newL)}% / 100%)`;
    }

    /**
     * Convert a CSS hex or rgb color string to HSL components.
     * @param {string} color  Source color (hex `#abc`, `#aabbcc`, or `rgb(...)`).
     * @returns {[number, number, number]} `[hue 0..360, saturation 0..100, lightness 0..100]`.
     */
    static _convertHexToHSL(color) {
        let r, g, b;
        if (color.startsWith("#")) {
            let hex = color.slice(1);
            if (hex.length === 3) hex = [hex[0], hex[0], hex[1], hex[1], hex[2], hex[2]].join("");
            r = parseInt(hex.substr(0, 2), 16) / 255;
            g = parseInt(hex.substr(2, 2), 16) / 255;
            b = parseInt(hex.substr(4, 2), 16) / 255;
        } else if (color.startsWith("rgb")) {
            const rgb = color.match(/(\d+)/g);
            r = parseInt(rgb[0]) / 255;
            g = parseInt(rgb[1]) / 255;
            b = parseInt(rgb[2]) / 255;
        } else {
            throw new Error("Invalid color format");
        }

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h, s;
        const l = (max + min) / 2;

        if (max === min) {
            h = 6.2069;
            s = 0;
        } else {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            switch (max) {
                case r: h = (g - b) / d + (g < b ? 6 : 0); break;
                case g: h = (b - r) / d + 2; break;
                case b: h = (r - g) / d + 4; break;
            }
            h /= 6;
        }

        return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
    }
}

/**
 * Public-facing card viewer. Each instance wraps one render configuration; calling
 * {@link FancyDisplay#render} spawns a {@link CardViewerApp} on the local client and,
 * if requested, also broadcasts to all other clients via the native socket.
 *
 * This class is what gets exposed as `EpicCards.Display` (and
 * `game.modules.get(MODULE_ID).api.Display`).
 */
export default class FancyDisplay {
    /**
     * @param {object} config
     * @param {Array<{front:string, back?:string|null}>} config.imgArray  Cards to display (front + optional back).
     * @param {string} [config.glowColor]                                 Override default glow color (the card's edge).
     * @param {number} [config.glowIntensity]                             Override default glow strength (0..1). 0 turns
     *                                                                    the glow off; higher is brighter/wider. Omit to
     *                                                                    use the world default (a raw `glowColor` with no
     *                                                                    intensity keeps its own alpha at the base size).
     * @param {boolean} [config.faceDown]                                 Whether to render the card face-down initially.
     * @param {{deckName:string, cards:Array<object>}} [config.chatMeta]  Internal: card metadata forwarded to the
     *                                                                    viewer so sharing can post a public chat preview.
     * @param {boolean} [config.sendToChat]                               Whether to also post a clickable chat message
     *                                                                    that re-opens the card/image. Omit to use the
     *                                                                    world default (see {@link resolveSendToChat}).
     * @param {string} [config.sound]                                     Reveal-sound override. A path plays that sound;
     *                                                                    an empty string `""` forces no sound; omit (undefined)
     *                                                                    to use the world default reveal sound.
     * @param {number} [config.soundVolume]                               Reveal-sound volume override (0..1). Omit to use the default.
     * @param {string} [config.soundChannel]                              Reveal-sound audio channel override
     *                                                                    (`interface` / `music` / `environment`). Omit to use the default.
     * @param {number} [config.revealDelay]                               Dramatic-reveal delay override (ms). Omit to use the
     *                                                                    world default. Only matters when {@link FancyDisplay#render}
     *                                                                    is called with `dramaticReveal` true.
     * @param {boolean} [config.isShared]                                 Internal: true when this render was triggered by a
     *                                                                    broadcast from another client (hides the share button).
     * @param {() => void} [config.onReveal]                              Internal: callback fired once when the card is first
     *                                                                    revealed. Card flows (e.g. the dealer) pass this to
     *                                                                    defer a face-down card's chat preview until it flips.
     */
    constructor({ imgArray, glowColor, glowIntensity, faceDown, chatMeta, sendToChat, sound, soundVolume, soundChannel, revealDelay, isShared, onReveal } = {}) {
        this.imgArray = imgArray ?? [];
        this.glowColor = glowColor;
        this.glowIntensity = glowIntensity;
        this.faceDown = faceDown;
        this.chatMeta = chatMeta ?? null;
        this.sendToChat = sendToChat;
        this.sound = sound;
        this.soundVolume = soundVolume;
        this.soundChannel = soundChannel;
        this.revealDelay = revealDelay;
        this.isShared = !!isShared;
        this.onReveal = onReveal ?? null;
    }

    /**
     * Render the viewer locally; optionally broadcast to other clients.
     * @param {boolean} [shareToAll=false]      If true and the local user may share, also broadcast to other clients.
     * @param {boolean} [dramaticReveal=false]  If true, render face-down first then auto-flip after the configured delay.
     */
    async render(shareToAll = false, dramaticReveal = false) {
        try {
            if (!this.imgArray.length) {
                ui.notifications.warn("Image URL or file path not provided.");
                return;
            }

            const appearance = game.settings.get(MODULE_ID, SETTINGS.CARD_APPEARANCE);

            // Fill in missing back images with the configured default.
            for (const image of this.imgArray) {
                if (!image.back) image.back = appearance.backImage;
            }

            // Glow color is the hue; glow intensity is its strength. A per-call color override with no
            // intensity is treated as a raw color (used as-is, keeping its own alpha); otherwise the
            // world default supplies both the color and the intensity.
            const glowColor = this.glowColor || appearance.glowColor;
            const glowIntensity = this.glowIntensity ?? (this.glowColor ? undefined : appearance.glowIntensity);
            const sendToChat = resolveSendToChat(this.sendToChat);

            // Resolve the reveal sound: an explicit per-call value wins (including `""` for "no
            // sound"); only a truly absent (undefined) value falls back to the world default.
            const soundCfg = game.settings.get(MODULE_ID, SETTINGS.REVEAL_SOUND);
            const sound = this.sound === undefined ? soundCfg.sound : this.sound;
            const soundVolume = this.soundVolume ?? soundCfg.volume;
            const soundChannel = this.soundChannel ?? soundCfg.channel;

            // A face-down card with no dramatic auto-reveal waits for a manual flip in the viewer;
            // its chat preview (which shows the front) is held until that flip so it doesn't spoil
            // the card while it sits face-down. Face-up and dramatic-reveal cards keep their timing.
            const manualReveal = !!this.faceDown && !dramaticReveal;

            // Raw-image displays (no backing Card) mirror to chat from here, so the image can be
            // re-opened later. Card flows (chatMeta present) post their own previews via the dealer
            // and the deck/hook paths, and broadcast receivers (isShared) must never re-post.
            const postImages = (sendToChat && !this.chatMeta && !this.isShared)
                ? () => {
                    for (const image of this.imgArray) {
                        postImageToChat({
                            front: image.front,
                            back: image.back,
                            glowColor,
                            glowIntensity,
                            faceDown: !!this.faceDown,
                            isPublic: shareToAll
                        });
                    }
                }
                : null;

            const app = new CardViewerApp({
                images: this.imgArray,
                glowColor,
                glowIntensity,
                faceDown: this.faceDown,
                dramaticReveal,
                revealDelay: this.revealDelay,
                // The share button is pointless once every client is already seeing the card:
                // hide it when this render is itself a broadcast (sender or receiver side).
                showShareBtn: !shareToAll && !this.isShared,
                sendToChat,
                chatMeta: this.chatMeta,
                sound,
                soundVolume,
                soundChannel,
                // Card flows pass their reveal-time chat post via the constructor (this.onReveal);
                // raw-image flows defer their own post here. Either fires when a manual face-down
                // card is flipped face-up.
                onReveal: this.onReveal ?? (manualReveal ? postImages : null)
            });

            // Broadcast to other clients BEFORE awaiting the local render. Receivers build their own
            // viewer and do not depend on this client's render, so the share must not be chained
            // behind (and silently lost to) any rejection in the local render pipeline. This mirrors
            // CardViewerApp#_onShare, which likewise broadcasts independently of the local viewer —
            // and is why the manual share button kept working while an auto-share (render(true, …))
            // could go missing when the local render threw after the card was already on screen.
            if (shareToAll) {
                CardViewerApp._broadcastShare({
                    images: this.imgArray,
                    glowColor,
                    glowIntensity,
                    faceDown: this.faceDown,
                    // Replay the dramatic reveal on every receiver so the whole table waits out the
                    // same locked countdown and sees the flip together — no one can reveal early.
                    dramaticReveal,
                    revealDelay: this.revealDelay,
                    // Broadcast the resolved values so each receiver plays the same sound locally.
                    sound,
                    soundVolume,
                    soundChannel
                });
            }

            await app.render({ force: true });

            // Face-up / dramatic-reveal raw images post on their existing schedule (now, or after the
            // dramatic delay). Manual face-down images are handled by onReveal above instead.
            if (postImages && !manualReveal) {
                postChatAfterReveal(dramaticReveal, this.revealDelay, postImages);
            }
        } catch (error) {
            ui.notifications.error("Error rendering the card viewer.");
            console.error(error);
        }
    }
}

export { CardViewerApp };
