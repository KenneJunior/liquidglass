/**
 * Liquid Glass Slider widget
 *
 * A physics-driven glass slider thumb with spring-based animations
 */

import type { SliderOptions, FilterCacheResult, LiquidGlassOptions } from "./Types.ts";
import { Spring, MathUtils } from "./utils.ts";
import { buildGlassFilterAsync } from "./filters.ts";

/**
 * A physics-driven glass slider thumb.
 *
 * Architecture:
 *   • Builds its own SVG filter via buildGlassFilterAsync (shared cache)
 *   • Owns three springs: scale (squish), brightness (press feedback),
 *     and refractionSpring (displacement animation during press)
 *   • Manages all pointer events internally; exposes value via callbacks
 *   • Dual render path: backdrop-filter url() on Chrome, clone-world filter
 *     fallback on other browsers — same detection as demo.html
 *
 * DOM structure injected into `container`:
 * ``` html
 *   .lg-slider-track
 *     .lg-slider-track-inner
 *       .lg-slider-fill
 *     .lg-slider-thumb               ← glass element
 *       .lg-slider-thumb-clone       ← clone-world fallback
 *         .lg-slider-thumb-clone-inner
 *       .lg-slider-thumb-inner       ← receives backdrop-filter or filter
 *       <svg> … filter definition …
 * ```
 */
export class LiquidGlassSlider {
    // ── Resolved configuration ───────────────────────────────────────────────
    private readonly cfg: Required<SliderOptions>;

    // ── State ────────────────────────────────────────────────────────────────
    private value: number;         // 0–100
    private isPressed = false;
    private dragStartX = 0;

    // ── Springs ──────────────────────────────────────────────────────────────
    // Stiffness/damping values match the original demo.html Pebble & Void numbers
    // exactly — 2000/80 for scale and brightness, 100/10 for the refraction pulse.
    private spScale = new Spring(0.6, 2000, 80);   // thumb scale
    private spBrightness = new Spring(1, 2000, 80);   // thumb opacity
    private spRefr = new Spring(0.4, 100, 10);   // disp map scale

    // ── DOM refs ─────────────────────────────────────────────────────────────
    private track!: HTMLElement;
    private fill!: HTMLElement;
    private thumb!: HTMLElement;
    private thumbInner!: HTMLElement;
    private cloneInner!: HTMLElement;
    /** Outer label wrapper - null when label position is not set**/
    private labelEl: HTMLElement|null = null;
    /** The displayed integer/decimal from the previous frame — drives drum direction */
    private prevDisplayValue = -1;
    private prevDisplayText='';

    // ── Filter ───────────────────────────────────────────────────────────────
    private filter?: FilterCacheResult;
    private filterId?: string;
    private maxDisp = 0;
    private rafId: number | null = null;

    // ── Feature detection ─────────────────────────────────────────────────────
    /** True when backdrop-filter: url() is supported (Chrome ≥ 76). */
    private static _useBackdrop: boolean | null = null;
    private static get useBackdrop(): boolean {
        if (this._useBackdrop === null) {
            const t = document.createElement('div');
            t.style.backdropFilter = 'url(#test)';
            this._useBackdrop = !!(window as any).chrome && t.style.backdropFilter.includes('url');
        }
        return this._useBackdrop;
    }

    constructor(
        private container: HTMLElement,
        options: SliderOptions = {}
    ) {
        // Merge with defaults — every field guaranteed non-optional from here on
        this.cfg = {
            refractiveIndex:  options.refractiveIndex  ?? 1.45,
            glassThickness:   options.glassThickness   ?? 80,
            bezelWidth:       options.bezelWidth        ?? 16,
            refractionScale:  options.refractionScale   ?? 1.2,
            specularAlpha:    options.specularAlpha     ?? 0.4,
            trackWidth:       options.trackWidth        ?? 330,
            trackHeight:      options.trackHeight       ?? 18,
            trackFill:        options.trackFill         ?? 'linear-gradient(90deg,#3b82f6,#60a5fa)',
            trackBackground:  options.trackBackground   ?? 'rgba(255,255,255,0.05)',
            thumbWidth:       options.thumbWidth        ?? 90,
            thumbHeight:      options.thumbHeight       ?? 60,
            thumbRadius:      options.thumbRadius       ?? 30,
            pressScale:       options.pressScale        ?? 1,
            value:            options.value             ?? 10,
            labelPosition:    options.labelPosition     ?? undefined!,
            labelSticky:      options.labelSticky       ?? false,
            labelDecimals:    options.labelDecimals     ?? 0,
            labelFont:        options.labelFont         ?? '600 13px/1 Inter,sans-serif',
            labelColor:       options.labelColor        ?? 'rgba(255,255,255,0.8)',
            labelGap:         options.labelGap          ?? 10,
            labelFormatter:   options.labelFormatter    ?? undefined!,
            onChange:         options.onChange          ?? (() => {}),
            onCommit:         options.onCommit          ?? (() => {}),
        };
        this.value = this.cfg.value;

        // Initialise spring at the at-rest thumb scale
        const restScale = this.cfg.thumbHeight / this.cfg.thumbWidth;
        this.spScale = new Spring(restScale, 2000, 80);

        this._buildDOM();
        this._buildFilter();
        this._bindEvents();
        this._updatePosition();
    }

    // ── DOM construction ─────────────────────────────────────────────────────

    /** Injects the full slider DOM into this.container. */
    private _buildDOM(): void {
        const { trackWidth, trackHeight, thumbWidth, thumbHeight, thumbRadius,
            trackFill, trackBackground, labelPosition, labelGap,
            labelFont, labelColor } = this.cfg;

        this.container.style.position = 'relative';

        const labelHTML = labelPosition ? `
          <div class="lg-slider-label" aria-live="polite" aria-atomic="true" style="
            position:absolute; pointer-events:none;
            font:${labelFont}; color:${labelColor};
            display:flex; align-items:center; justify-content:center;
            overflow:visible; line-height:1;
            white-space:nowrap; user-select:none;
            ${labelPosition === 'top'    ? `bottom:calc(100% + ${labelGap}px); left:0; width:100%;` : ''}
            ${labelPosition === 'bottom' ? `top:calc(100% + ${labelGap}px);    left:0; width:100%;` : ''}
            ${labelPosition === 'left'   ? `right:calc(100% + ${labelGap}px);  top:50%; transform:translateY(-50%);` : ''}
            ${labelPosition === 'right'  ? `left:calc(100% + ${labelGap}px);   top:50%; transform:translateY(-50%);` : ''}
          ">
            <div class="lg-slider-digits" style="display:flex; overflow:hidden; height:1.2em;"></div>
          </div>` : '';

        this.container.innerHTML = `
          ${labelHTML}
          <div class="lg-slider-track" style="
            display:inline-block; position:absolute;
            width:${trackWidth}px; height:${trackHeight}px;
            left:0; top:${(thumbHeight - trackHeight) / 2}px;
            background:${trackBackground};
            border-radius:${trackHeight}px;
            box-shadow:inset 0 2px 4px rgba(0,0,0,0.5);
          ">
            <div class="lg-slider-track-inner" style="
              width:100%; height:100%; overflow:hidden; border-radius:inherit;
            ">
              <div class="lg-slider-fill" style="
                height:100%; width:${this.value}%;
                background:${trackFill};
                border-radius:inherit;
                box-shadow:0 0 10px rgba(59,130,246,0.5);
              "></div>
            </div>
          </div>
          <div class="lg-slider-thumb" style="
            position:absolute;
            width:${thumbWidth}px; height:${thumbHeight}px;
            top:0; border-radius:${thumbRadius}px;
            transform-origin:center center;
            cursor:pointer; touch-action:none; user-select:none;
            background-color:rgba(255,255,255,1);
            box-shadow:0 3px 14px rgba(0,0,0,0.3);
            overflow:hidden; will-change:transform,background-color; z-index:10;
          ">
            <div class="lg-slider-thumb-clone" style="
              position:absolute; top:0; left:0; width:100%; height:100%;
              overflow:hidden; border-radius:inherit; z-index:1; opacity:0;
              will-change:opacity;
              ${LiquidGlassSlider.useBackdrop ? 'display:none;' : ''}
            ">
              <div class="lg-slider-thumb-clone-inner" style="
                position:absolute; top:0; left:0; pointer-events:none;
              "></div>
            </div>
            <div class="lg-slider-thumb-inner" style="
              position:absolute; top:0; left:0; width:100%; height:100%;
              border-radius:inherit; z-index:3; pointer-events:none;
            "></div>
            <svg style="width:0;height:0;position:absolute;" aria-hidden="true">
              <defs></defs>
            </svg>
          </div>`;

        this.container.style.width  = `${trackWidth}px`;
        this.container.style.height = `${thumbHeight}px`;

        this.track      = this.container.querySelector('.lg-slider-track')!;
        this.fill       = this.container.querySelector('.lg-slider-fill')!;
        this.thumb      = this.container.querySelector('.lg-slider-thumb')!;
        this.thumbInner = this.container.querySelector('.lg-slider-thumb-inner')!;
        this.cloneInner = this.container.querySelector('.lg-slider-thumb-clone-inner')!;
        this.labelEl    = this.container.querySelector('.lg-slider-label');
    }
    // ── Filter construction ──────────────────────────────────────────────────

    /**
     * Builds the SVG filter for this slider's thumb dimensions.
     * Runs async but the thumb is interactive immediately — filter
     * upgrades visually once the promise resolves.
     */
    private async _buildFilter(): Promise<void> {
        const { thumbWidth: W, thumbHeight: H, thumbRadius: R,
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha } = this.cfg;

        const opts = {
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha,
            backdrop: { blur: 0, saturation: 7, brightness: 1.0 },
            maxTilt: 0, reducedMotion: false,
            aberration: 0, magneticPull: 0,
        } as Required<Omit<LiquidGlassOptions, 'enableOrb'|'orbColor'|'enableMobileSupport'>>;

        const fakeEl = Object.assign(document.createElement('div'), {
            style: { borderRadius: `${R}px` },
            getBoundingClientRect: () => ({
                width: W, height: H, top: 0, left: 0, right: W, bottom: H, x: 0, y: 0,
                toJSON: () => {}
            }),
            getAttribute: () => null,
        }) as unknown as HTMLElement;

        this.filter = await buildGlassFilterAsync(fakeEl, opts);
        this.maxDisp = this.filter.maxDisp;
        this.filterId = this.filter.id;

        const svgDefs = this.thumb.querySelector('svg defs')!;
        svgDefs.parentElement!.replaceWith(this.filter.svg);

        if (LiquidGlassSlider.useBackdrop) {
            const bf = `url(#${this.filterId})`;
            this.thumbInner.style.backdropFilter = bf;
            (this.thumbInner.style as any).webkitBackdropFilter = bf;
        } else {
            this.cloneInner.style.filter = `url(#${this.filterId})`;
            this.cloneInner.style.background =
                getComputedStyle(this.container.parentElement || document.body).background;
        }

        // Kick the animation loop so the initial scale renders immediately
        this._kick();
    }
    // ── Label helpers ────────────────────────────────────────────────────────

    /** Returns the display string for a given value. */
    private _formatValue(v: number): string {
        if (this.cfg.labelFormatter) return this.cfg.labelFormatter(v);
        return v.toFixed(this.cfg.labelDecimals);
    }
    /**
     * Animates the drum-roll number change — Apple alarm clock style.
     * The drum contains two <span> elements (a, b). We treat them as
     * a circular pair: whichever is currently "live" exits, the other
     * enters, then they swap roles.
     *
     * direction > 0 → value increased → new number rolls in from bottom
     * direction < 0 → value decreased → new number rolls in from top
     */
    private _drumActive: 'a' | 'b' = 'a';

    /**
     * Odometer-style character diffing and animation.
     */
    private _updateDigits(newText: string, oldText: string, direction: number): void {
        if (!this.labelEl) return;
        const container = this.labelEl.querySelector('.lg-slider-digits') as HTMLElement;

        // 1. Handle structure rebuild if length changes
        if (newText.length !== oldText.length || container.children.length === 0) {
            this._rebuildDigitDrums(container, newText);
            return;
        }

        // 2. Animate only changing characters
        const drums = container.children;
        for (let i = 0; i < newText.length; i++) {
            if (newText[i] !== oldText[i]) {
                this._animateDrum(drums[i] as HTMLElement, newText[i], direction);
            }
        }
    }

    private _rebuildDigitDrums(container: HTMLElement, text: string): void {
        container.innerHTML = '';
        for (const char of text) {
            const drum = document.createElement('div');
            drum.className = 'lg-digit-drum';
            drum.dataset.active = 'a';
            drum.style.cssText = 'position:relative; display:flex; align-items:center; justify-content:center;';
            drum.innerHTML = `
                <span class="lg-ghost" style="visibility:hidden; height:0; overflow:hidden;">${char}</span>
                <span class="lg-a" style="position:absolute; width:100%; text-align:center;">${char}</span>
                <span class="lg-b" style="position:absolute; width:100%; text-align:center; opacity:0; transform:translateY(100%);"></span>
            `;
            container.appendChild(drum);
        }
    }

    private _animateDrum(drum: HTMLElement, char: string, direction: number): void {
        const DUR = 280;
        const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';

        const activeState = drum.dataset.active || 'a';
        const spanA = drum.querySelector('.lg-a') as HTMLElement;
        const spanB = drum.querySelector('.lg-b') as HTMLElement;
        const ghost = drum.querySelector('.lg-ghost') as HTMLElement;

        const incoming = activeState === 'a' ? spanB : spanA;
        const outgoing = activeState === 'a' ? spanA : spanB;

        ghost.textContent = char;
        incoming.textContent = char;

        // Reset incoming state
        incoming.style.transition = 'none';
        incoming.style.transform = direction > 0 ? 'translateY(100%)' : 'translateY(-100%)';
        incoming.style.opacity = '0';

        void incoming.offsetWidth; // Layout flush

        // Apply smooth transition
        const style = `transform ${DUR}ms ${EASE}, opacity ${DUR * 0.7}ms ease`;
        incoming.style.transition = style;
        incoming.style.transform = 'translateY(0)';
        incoming.style.opacity = '1';

        outgoing.style.transition = style;
        outgoing.style.transform = direction > 0 ? 'translateY(-100%)' : 'translateY(100%)';
        outgoing.style.opacity = '0';

        drum.dataset.active = activeState === 'a' ? 'b' : 'a';
    }
    /**
     * Positions the thumb and fill based on current value.
     * Also repositions the clone-world inner so the background
     * appears correctly offset inside the thumb's viewport.
     */
    /**
     * Positions the thumb and fill based on current value.
     * Updates the sticky label position and triggers drum roll when
     * the displayed integer/decimal changes.
     */
    private _updatePosition(): void {
        const { trackWidth, thumbWidth, thumbHeight, trackHeight,
            labelPosition, labelSticky } = this.cfg;
        const restScale = thumbHeight / thumbWidth;
        const scaledW   = thumbWidth  * restScale;
        const tx = scaledW / 2 + (this.value / 100) * (trackWidth - scaledW) - thumbWidth / 2;

        this.thumb.style.left = `${tx}px`;
        this.fill.style.width = `${this.value}%`;

        this.cfg.onChange(this.value);

        if (this.labelEl && labelSticky &&
            (labelPosition === 'top' || labelPosition === 'bottom')) {
            const thumbCentreX = tx + thumbWidth / 2;
            this.labelEl.style.width     = 'auto';
            this.labelEl.style.left      = `${thumbCentreX}px`;
            this.labelEl.style.transform = 'translateX(-50%)';
        }

        if (this.labelEl) {
            const newText   = this._formatValue(this.value);
            const newNum    = parseFloat(newText);
            const direction = newNum - this.prevDisplayValue;

            if (newText !== this.prevDisplayText) {
                this._updateDigits(newText, this.prevDisplayText, direction);
                this.prevDisplayText = newText;
                this.prevDisplayValue = newNum;
            }
        }

        if (!LiquidGlassSlider.useBackdrop) {
            const aR  = this.container.getBoundingClientRect();
            const cl  = (aR.width - trackWidth) / 2;
            const ct  = (aR.height - thumbHeight) / 2;
            this.cloneInner.style.width     = `${aR.width}px`;
            this.cloneInner.style.height    = `${aR.height}px`;
            this.cloneInner.style.transform = `translate(${-(cl + tx)}px, ${-ct}px)`;
            this.cloneInner.style.setProperty('--lg-track-left',  `${cl}px`);
            this.cloneInner.style.setProperty('--lg-track-top',   `${ct + (thumbHeight - trackHeight) / 2}px`);
            this.cloneInner.style.setProperty('--lg-fill-pct',    this.value.toString());
        }
    }
    // ── Spring loop ──────────────────────────────────────────────────────────

    private _kick(): void {
        if (!this.rafId) this.rafId = requestAnimationFrame(() => this._loop());
    }

    private _loop(): void {
        const dt = Math.min(0.032, 1 / 60);
        const sc = this.spScale.update(dt);
        const bo = this.spBrightness.update(dt);
        const sr = this.spRefr.update(dt);

        this.thumb.style.transform       = `scale(${sc})`;
        this.thumb.style.backgroundColor = `rgba(255,255,255,${bo})`;

        // Clone fades in as thumb background fades out (glass reveals background)
        const cloneEl = this.thumb.querySelector('.lg-slider-thumb-clone') as HTMLElement | null;
        if (cloneEl) cloneEl.style.opacity = String(1 - bo);

        // Drive the feDisplacementMap scale from the refraction spring
        if (this.filter?.mapElG) {
            const scale = (this.maxDisp * this.cfg.refractionScale * sr).toFixed(3);
            this.filter.mapElR?.setAttribute('scale', scale);
            this.filter.mapElG?.setAttribute('scale', scale);
            this.filter.mapElB?.setAttribute('scale', scale);
        }

        if (!this.spScale.isSettled() || !this.spBrightness.isSettled() || !this.spRefr.isSettled()) {
            this.rafId = requestAnimationFrame(() => this._loop());
        } else {
            this.rafId = null;
        }
    }

    // ── Pointer events ───────────────────────────────────────────────────────

    private _bindEvents(): void {
        const { trackWidth, thumbWidth, thumbHeight } = this.cfg;
        const restScale  = thumbHeight / thumbWidth;
        const pressScale = this.cfg.pressScale;

        const onDown = (clientX: number) => {
            this.isPressed  = true;
            this.dragStartX = clientX;
            this.spScale.setTarget(pressScale);
            this.spBrightness.setTarget(0.1);
            this.spRefr.setTarget(0.9);
            this._kick();
        };

        const onMove = (clientX: number) => {
            if (!this.isPressed) return;
            const scaledW  = thumbWidth * restScale;
            const trackRect = this.track.getBoundingClientRect();
            const x0        = trackRect.left + scaledW / 2;
            const usableW   = trackWidth - scaledW;
            const raw       = ((Math.max(x0, Math.min(x0 + usableW, clientX)) - x0) / usableW) * 100;
            this.value = Math.max(0, Math.min(100, raw));
            this._updatePosition();
        };

        const onUp = () => {
            if (!this.isPressed) return;
            this.isPressed = false;
            this.spScale.setTarget(restScale);
            this.spBrightness.setTarget(1);
            this.spRefr.setTarget(0.4);
            this.cfg.onCommit(this.value);
            this._kick();
        };

        this.thumb.addEventListener('pointerdown', e => {
            e.preventDefault();
            onDown(e.clientX);
        });
        window.addEventListener('pointermove', e => onMove(e.clientX));
        window.addEventListener('pointerup',   () => onUp());
        window.addEventListener('resize',      () => this._updatePosition());
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Programmatically set value 0–100 without triggering onCommit. */
    setValue(v: number): void {
        this.value = Math.max(0, Math.min(100, v));
        this._updatePosition();
    }

    /** Read current value. */
    getValue(): number { return this.value; }

    /** Tear down springs, cancel rAF, clear DOM. */
    destroy(): void {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.filter?.svg.remove();
        this.container.innerHTML = '';
    }
}
