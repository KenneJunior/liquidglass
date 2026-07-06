/**
 * Liquid Glass Switch widget
 *
 * A physics-driven glass toggle switch with spring-based animations
 */

import type { SwitchOptions, FilterCacheResult, LiquidGlassOptions } from "./Types.ts";
import { Spring } from "./utils.ts";
import { buildGlassFilterAsync } from "./filters.ts";

/**
 * A physics-driven glass toggle switch.
 *
 * Architecture:
 *    Five springs mirror demo.html exactly:
 *       xr   — thumb X travel (position along track)
 *       sc   — scale squish on press
 *       bo   — thumb white background brightness
 *       tc   — track colour interpolation (off → on colour)
 *       sr   — displacement map scale pulse
 *   • Supports both click-to-toggle and drag-to-slide with
 *     a rubber-band overshoot when dragged past the ends.
 *   • Dual render path: backdrop-filter url() on Chrome, clone-world fallback.
 *
 * DOM structure injected into `container`:
 * ``` html
 *   .lg-switch-track                 ← tap target + colour container
 *     .lg-switch-thumb               ← glass element
 *       .lg-switch-thumb-clone
 *         .lg-switch-thumb-clone-inner
 *       .lg-switch-thumb-inner       ← backdrop-filter or filter target
 *       <svg> … filter …
 *  ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL CONFIG TYPE
// Extends the public SwitchOptions with the RGBA array colour model used
// internally for physics interpolation, and with the icon fields.
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// SPRING PRESETS  (stiffness, damping)
// ─────────────────────────────────────────────────────────────────────────────
    const SP_POS    = [1000, 80]  as const;  // xr  — thumb position
    const SP_SCALE  = [2000, 80]  as const;  // sc  — scale squish
    const SP_BRIGHT = [2000, 80]  as const;  // bo  — brightness
    const SP_COLOR  = [1000, 80]  as const;  // tc  — track colour
    const SP_REFR   = [100,  10]  as const;  // sr  — refraction pulse

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function css(el: HTMLElement, props: Partial<CSSStyleDeclaration>): void {
    Object.assign(el.style, props);
}

/** Normalise a colour input to a 4-element RGBA tuple. */
function toRGBA(raw: unknown, fallback: [number,number,number,number]): [number,number,number,number] {
    if (Array.isArray(raw) && raw.length >= 3) {
        return [
            Number(raw[0]) || 0,
            Number(raw[1]) || 0,
            Number(raw[2]) || 0,
            raw.length >= 4 ? Number(raw[3]) : fallback[3],
        ];
    }
    return fallback;
}

// ─────────────────────────────────────────────────────────────────────────────
// SWITCH CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class LiquidGlassSwitch {
    // ── Config ────────────────────────────────────────────────────────────────
    private readonly cfg: SwitchOptions;

    // ── State ─────────────────────────────────────────────────────────────────
    private checked:     boolean;
    private isPressed    = false;
    private isDestroyed  = false;
    private dragStartX   = 0;
    /** 0 = fully OFF, 1 = fully ON — updated continuously during drag */
    private thumbRatio:  number;

    // ── Springs ───────────────────────────────────────────────────────────────
    private spXr: Spring;  // thumb X position ratio 0–1
    private spSc: Spring;  // scale squish
    private spBo: Spring;  // brightness (1 = white, 0 = transparent/glass)
    private spTc: Spring;  // track colour interpolation 0–1
    private spSr: Spring;  // refraction displacement scale

    // ── DOM refs ──────────────────────────────────────────────────────────────
    private track!:       HTMLElement;
    private thumb!:       HTMLElement;
    private thumbClone!:  HTMLElement;   // cached — no querySelector in loop
    private thumbInner!:  HTMLElement;
    private cloneInner!:  HTMLElement;
    private iconOffEl!:   HTMLElement;
    private iconOnEl!:    HTMLElement;

    // ── Filter ────────────────────────────────────────────────────────────────
    private filter?:   FilterCacheResult;
    private filterId?: string;
    private maxDisp    = 0;
    private rafId:     number | null = null;

    // ── Geometry ──────────────────────────────────────────────────────────────
    private geo!: { thumbTravel: number; restOffset: number; };

    // ── Feature detection — computed once, never re-evaluated ─────────────────
    private static _useBackdrop: boolean | null = null;
    private static get useBackdrop(): boolean {
        if (this._useBackdrop === null) {
            const t = document.createElement('div');
            t.style.backdropFilter = 'url(#test)';
            this._useBackdrop =
                !!(window as any).chrome && t.style.backdropFilter.includes('url');
        }
        return this._useBackdrop;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONSTRUCTOR
    // ─────────────────────────────────────────────────────────────────────────

    constructor(
        private readonly container: HTMLElement,
        options: SwitchOptions
    ) {
        this.cfg = {
            refractiveIndex: options.refractiveIndex ?? 1.5,
            glassThickness:  options.glassThickness  ?? 47,
            bezelWidth:      options.bezelWidth       ?? 19,
            refractionScale: options.refractionScale  ?? 1.2,
            specularAlpha:   options.specularAlpha    ?? 0.5,
            trackWidth:      options.trackWidth       ?? 160,
            trackHeight:     options.trackHeight      ?? 67,
            thumbWidth:      options.thumbWidth       ?? 146,
            thumbHeight:     options.thumbHeight      ?? 92,
            thumbRadius:     options.thumbRadius      ?? 46,
            colorOff:        toRGBA(options.colorOff, [255, 255, 255, 0.05]),
            colorOn:         toRGBA(options.colorOn,  [139, 92,  246, 0.50]),
            checked:         options.checked          ?? true,
            iconOff:         options.iconOff          ?? '',
            iconOn:          options.iconOn           ?? '',
            iconColorOff:    options.iconColorOff     ?? '#8A8A98',
            iconColorOn:     options.iconColorOn      ?? '#ffffff',
            iconSize:        options.iconSize         ?? 20,
            onChange:        options.onChange         ?? (() => {}),
        };

        this.checked    = this.cfg.checked;
        this.thumbRatio = this.checked ? 1 : 0;

        const restScale = this.cfg.thumbHeight / this.cfg.thumbWidth;

        // Initialise all springs at their settled starting values so
        // there is no entry animation on first paint
        this.spXr = new Spring(this.thumbRatio, ...SP_POS);
        this.spSc = new Spring(restScale,       ...SP_SCALE);
        this.spBo = new Spring(1,               ...SP_BRIGHT);
        this.spTc = new Spring(this.thumbRatio,  ...SP_COLOR);
        this.spSr = new Spring(0.4,             ...SP_REFR);

        this.spXr.setTarget(this.thumbRatio);
        this.spTc.setTarget(this.thumbRatio);

        this._buildDOM();
        this._computeGeo();
        this._buildFilter();   // async — upgrades visually once resolved
        this._bindEvents();
        this._kick();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // § 1  DOM CONSTRUCTION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Injects the switch DOM into this.container.
     *
     * Layer order inside .lg-switch-thumb (bottom → top):
     *   1. .lg-switch-thumb-clone      — clone-world background (non-Chrome)
     *   2. .lg-switch-thumb-inner      — receives backdrop-filter or CSS filter
     *   3. .lg-switch-icons            — OFF + ON icon pair, cross-faded by tc spring
     *   4. <svg>                       — placeholder; replaced by _buildFilter()
     *
     * The track and thumb have box-sizing:border-box forced so host-page
     * stylesheets using * { box-sizing: border-box } don't corrupt px maths.
     */
    private _buildDOM(): void {
        const {
            trackWidth, trackHeight,
            thumbWidth, thumbHeight, thumbRadius,
            iconOff, iconOn, iconColorOff, iconColorOn, iconSize,
        } = this.cfg;

        // Initial icon visibility: set correctly before first _loop tick
        // so both icons are never simultaneously visible on first paint
        const iconOffOpacity = this.checked ? '0' : '1';
        const iconOnOpacity  = this.checked ? '1' : '0';
        const iconOffScale   = this.checked ? '0.8' : '1';
        const iconOnScale    = this.checked ? '1'   : '0.8';

        css(this.container, {
            position:  'relative',
            display:   'inline-block',
            boxSizing: 'content-box',
        });

        this.container.innerHTML = `
          <div class="lg-switch-track" style="
            display:inline-block; position:relative; box-sizing:border-box;
            width:${trackWidth}px; height:${trackHeight}px;
            border-radius:${trackHeight / 2}px;
            cursor:pointer; overflow:visible;
            box-shadow:inset 0 2px 10px rgba(0,0,0,0.5);
            border:1px solid rgba(255,255,255,0.06);
            will-change:background-color;
          ">
            <div class="lg-switch-thumb" style="
              position:absolute; box-sizing:border-box;
              width:${thumbWidth}px; height:${thumbHeight}px;
              border-radius:${thumbRadius}px;
              top:${trackHeight / 2}px;
              transform:translateY(-50%) scale(${this.cfg.thumbHeight / this.cfg.thumbWidth});
              transform-origin:center center;
              cursor:grab; touch-action:none; user-select:none;
              background-color:rgba(255,255,255,1);
              box-shadow:
                0 10px 30px rgba(0,0,0,0.5),
                inset 0 1px 0 rgba(255,255,255,0.6);
              overflow:hidden;
              will-change:transform,left,background-color,box-shadow;
              z-index:10;
              isolation:isolate;
            ">
              <div class="lg-switch-thumb-clone" style="
                position:absolute; inset:0; box-sizing:border-box;
                overflow:hidden; border-radius:inherit;
                z-index:1; opacity:0; will-change:opacity;
                ${LiquidGlassSwitch.useBackdrop ? 'display:none;' : ''}
              ">
                <div class="lg-switch-thumb-clone-inner" style="
                  position:absolute; top:0; left:0;
                  pointer-events:none; box-sizing:border-box;
                "></div>
              </div>

              <div class="lg-switch-thumb-inner" style="
                position:absolute; inset:0; box-sizing:border-box;
                border-radius:inherit; z-index:3; pointer-events:none;
              "></div>

              <div class="lg-switch-icons" style="
                position:absolute; inset:0; box-sizing:border-box;
                display:flex; align-items:center; justify-content:center;
                z-index:20; pointer-events:none;
                font-size:${iconSize}px; line-height:1;
              ">
                <div class="lg-icon-off" style="
                  position:absolute;
                  display:flex; align-items:center; justify-content:center;
                  color:${iconColorOff};
                  opacity:${iconOffOpacity};
                  transform:scale(${iconOffScale});
                  transition:none;
                  will-change:opacity,transform;
                ">${iconOff}</div>

                <div class="lg-icon-on" style="
                  position:absolute;
                  display:flex; align-items:center; justify-content:center;
                  color:${iconColorOn};
                  opacity:${iconOnOpacity};
                  transform:scale(${iconOnScale});
                  transition:none;
                  will-change:opacity,transform;
                ">${iconOn}</div>
              </div>

              <svg style="position:absolute;width:0;height:0;overflow:hidden;"
                   aria-hidden="true">
                <defs></defs>
              </svg>
            </div>
          </div>`;

        this.track      = this.container.querySelector('.lg-switch-track')!;
        this.thumb      = this.container.querySelector('.lg-switch-thumb')!;
        this.thumbClone = this.container.querySelector('.lg-switch-thumb-clone')!;
        this.thumbInner = this.container.querySelector('.lg-switch-thumb-inner')!;
        this.cloneInner = this.container.querySelector('.lg-switch-thumb-clone-inner')!;
        this.iconOffEl  = this.container.querySelector('.lg-icon-off')!;
        this.iconOnEl   = this.container.querySelector('.lg-icon-on')!;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // § 2  GEOMETRY
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Computes the two geometry constants used by _loop to position the thumb.
     *
     * Ported verbatim from demo.html (Pebble & Void):
     *   ro = ((1 - restScale) * thumbWidth) / 2
     *   tr = trackWidth - trackHeight - (thumbWidth - thumbHeight) * restScale
     */
    private _computeGeo(): void {
        const { trackWidth, trackHeight, thumbWidth, thumbHeight } = this.cfg;
        const restScale = thumbHeight / thumbWidth;
        const ro = ((1 - restScale) * thumbWidth) / 2;
        const tr = trackWidth - trackHeight - (thumbWidth - thumbHeight) * restScale;
        this.geo = { thumbTravel: tr, restOffset: ro };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // § 3  SVG FILTER
    // ─────────────────────────────────────────────────────────────────────────

    private async _buildFilter(): Promise<void> {
        const {
            thumbWidth: W, thumbHeight: H, thumbRadius: R,
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha,
        } = this.cfg;

        const opts = {
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha,
            backdrop: { blur: 0.2, saturation: 6, brightness: 1.0 },
            maxTilt: 0, reducedMotion: false, aberration: 0, magneticPull: 0,
        } as Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>;

        const fakeEl = Object.assign(document.createElement('div'), {
            style:                { borderRadius: `${R}px` },
            getBoundingClientRect: () => ({
                width: W, height: H, top: 0, left: 0,
                right: W, bottom: H, x: 0, y: 0,
                toJSON: () => ({}),
            }),
            getAttribute: () => null,
        }) as unknown as HTMLElement;

        const result = await buildGlassFilterAsync(fakeEl, opts);

        // Guard: destroy() may have been called while the filter was building
        if (this.isDestroyed) {
            result.svg.remove();
            return;
        }

        this.filter   = result;
        this.maxDisp  = result.maxDisp;
        this.filterId = result.id;

        // Replace the empty <svg> placeholder inside the thumb
        const placeholder = this.thumb.querySelector('svg');
        if (placeholder) placeholder.replaceWith(result.svg);
        else this.thumb.appendChild(result.svg);

        if (LiquidGlassSwitch.useBackdrop) {
            const ref = `url(#${this.filterId})`;
            this.thumbInner.style.backdropFilter          = ref;
            (this.thumbInner.style as any).webkitBackdropFilter = ref;
        } else {
            this.cloneInner.style.filter = `url(#${this.filterId})`;
            this.cloneInner.style.background =
                getComputedStyle(this.container.parentElement ?? document.body).background;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // § 4  SPRING LOOP
    // ─────────────────────────────────────────────────────────────────────────

    private _kick(): void {
        if (!this.rafId && !this.isDestroyed) {
            this.rafId = requestAnimationFrame(() => this._loop());
        }
    }

    private _loop(): void {
        const dt = Math.min(0.032, 1 / 60);
        const { trackWidth, trackHeight, thumbWidth, thumbHeight } = this.cfg;
        const { thumbTravel, restOffset } = this.geo;

        // ── Spring targets ────────────────────────────────────────────────────
        // Position and colour springs settle toward checked state when not dragging
        if (!this.isPressed) {
            this.spXr.setTarget(this.checked ? 1 : 0);
        }
        // Track colour leads the thumb during drag; snaps to final state on release
        this.spTc.setTarget(
            this.isPressed
                ? (this.thumbRatio > 0.5 ? 1 : 0)
                : (this.checked ? 1 : 0)
        );

        // ── Advance springs ───────────────────────────────────────────────────
        const xr = this.spXr.update(dt);
        const sc = this.spSc.update(dt);
        const bo = this.spBo.update(dt);
        const tc = this.spTc.update(dt);
        const sr = this.spSr.update(dt);

        // ── Thumb position ────────────────────────────────────────────────────
        // Ported from demo.html: tx = -ro + (th - h * restScale) / 2 + xr * tr
        // sc drives transform:scale() only — never mixed into the left calculation
        const restScale = thumbHeight / thumbWidth;
        const tx = -restOffset
            + (trackHeight - thumbHeight * restScale) / 2
            + xr * thumbTravel;

        this.thumb.style.left      = `${tx}px`;
        this.thumb.style.transform = `translateY(-50%) scale(${sc.toFixed(4)})`;
        this.thumb.style.backgroundColor = `rgba(255,255,255,${bo.toFixed(3)})`;
        this.thumb.style.boxShadow = this.isPressed
            ? '0 4px 22px rgba(0,0,0,0.10),'  +
            'inset 2px 7px 24px rgba(0,0,0,0.09),' +
            'inset -2px -7px 24px rgba(255,255,255,0.09)'
            : '0 10px 30px rgba(0,0,0,0.50),'  +
            'inset 0 1px 0 rgba(255,255,255,0.60)';

        // ── Clone opacity — inverse of thumb brightness ────────────────────────
        // bo=1 (opaque white) → clone invisible; bo=0 (glass) → clone fully visible
        this.thumbClone.style.opacity = (1 - bo).toFixed(3);

        // ── Track colour ──────────────────────────────────────────────────────
        // Both off and on colours are full RGBA tuples — interpolated per channel
        const [offR, offG, offB, offA] = this.cfg.colorOff;
        const [onR,  onG,  onB,  onA ] = this.cfg.colorOn;
        const r = Math.round(offR + (onR - offR) * tc);
        const g = Math.round(offG + (onG - offG) * tc);
        const b = Math.round(offB + (onB - offB) * tc);
        const a = (offA + (onA - offA) * tc).toFixed(3);
        this.track.style.backgroundColor = `rgba(${r},${g},${b},${a})`;

        // ── Icon cross-fade ───────────────────────────────────────────────────
        // OFF fades out / shrinks as tc → 1; ON fades in / grows as tc → 1
        // The slight scale bounce (0.8 → 1.0) adds visual pop aligned with
        // the spring overshoot so icons feel physically connected to the motion
        this.iconOffEl.style.opacity   = (1 - tc).toFixed(3);
        this.iconOffEl.style.transform = `scale(${(0.8 + 0.2 * (1 - tc)).toFixed(3)})`;
        this.iconOnEl.style.opacity    = tc.toFixed(3);
        this.iconOnEl.style.transform  = `scale(${(0.8 + 0.2 * tc).toFixed(3)})`;

        // ── Refraction scale ──────────────────────────────────────────────────
        if (this.filter) {
            const scale = (this.maxDisp * this.cfg.refractionScale * sr).toFixed(3);
            this.filter.mapElR?.setAttribute('scale', scale);
            this.filter.mapElG?.setAttribute('scale', scale);
            this.filter.mapElB?.setAttribute('scale', scale);
        }

        // ── Clone-world offset ────────────────────────────────────────────────
        if (!LiquidGlassSwitch.useBackdrop) {
            const aR = this.container.getBoundingClientRect();
            const cl = (aR.width  - trackWidth)  / 2;
            const ct = (aR.height - trackHeight)  / 2;
            css(this.cloneInner, {
                width:     `${aR.width}px`,
                height:    `${aR.height}px`,
                transform: `translate(${-(cl + tx)}px,${-(ct + (trackHeight / 2 - thumbHeight / 2))}px)`,
            });
            this.cloneInner.style.setProperty('--lg-switch-track-color', `rgba(${r},${g},${b},${a})`);
            this.cloneInner.style.setProperty('--lg-track-left', `${cl}px`);
            this.cloneInner.style.setProperty('--lg-track-top',  `${ct}px`);
        }

        // ── Loop control ──────────────────────────────────────────────────────
        const settled =
            this.spXr.isSettled() && this.spSc.isSettled() &&
            this.spBo.isSettled() && this.spTc.isSettled() && this.spSr.isSettled();

        this.rafId = (settled || this.isDestroyed)
            ? null
            : requestAnimationFrame(() => this._loop());
    }

    // ─────────────────────────────────────────────────────────────────────────
    // § 5  POINTER EVENTS
    // ─────────────────────────────────────────────────────────────────────────

    private _bindEvents(): void {
        const restScale = this.cfg.thumbHeight / this.cfg.thumbWidth;

        // ── Down ─────────────────────────────────────────────────────────────
        const onDown = (clientX: number) => {
            if (this.isDestroyed) return;
            this.isPressed   = true;
            this.dragStartX  = clientX;
            this.thumbRatio  = this.checked ? 1 : 0;
            this.thumb.style.cursor = 'grabbing';
            this.spSc.setTarget(0.9);
            this.spBo.setTarget(0.08);
            this.spSr.setTarget(0.9);
            this._kick();
        };

        // ── Move ─────────────────────────────────────────────────────────────
        const onMove = (clientX: number) => {
            if (!this.isPressed || this.isDestroyed) return;
            const base     = this.checked ? 1 : 0;
            const raw      = base + (clientX - this.dragStartX) / this.geo.thumbTravel;
            const clamped  = Math.min(1, Math.max(0, raw));
            // Rubber-band: allow slight overshoot, compress exponentially
            const overshoot = raw < 0 ? -raw : raw > 1 ? raw - 1 : 0;
            this.thumbRatio = clamped + (raw < 0 ? 1 : -1) * overshoot / 22;
            this.spXr.setTarget(this.thumbRatio);
            this._kick();
        };

        // ── Up ───────────────────────────────────────────────────────────────
        const onUp = (clientX: number) => {
            if (!this.isPressed || this.isDestroyed) return;
            this.isPressed = false;
            this.thumb.style.cursor = 'grab';
            // A drag < 4px is treated as a tap → simple toggle
            const wasDrag  = Math.abs(clientX - this.dragStartX) >= 4;
            this.checked   = wasDrag ? this.thumbRatio > 0.5 : !this.checked;
            this.spSc.setTarget(restScale);
            this.spBo.setTarget(1);
            this.spSr.setTarget(0.4);
            this.cfg.onChange(this.checked);
            this._kick();
        };

        // ── Pointer events with capture ───────────────────────────────────────
        // Using pointer events + setPointerCapture instead of global
        // mouse/touch listeners so events are scoped to this thumb and
        // automatically cleaned up on pointercancel/pointerup.
        this.thumb.addEventListener('pointerdown', e => {
            e.preventDefault();
            e.stopPropagation();
            this.thumb.setPointerCapture(e.pointerId);
            onDown(e.clientX);
        });
        this.thumb.addEventListener('pointermove',   e => onMove(e.clientX));
        this.thumb.addEventListener('pointerup',     e => onUp(e.clientX));
        this.thumb.addEventListener('pointercancel', e => onUp(e.clientX));

        // ── Track tap — toggle when clicking outside the thumb ────────────────
        // Check composedPath so clicks that bubble up from track children
        // (other than the thumb itself) are correctly handled
        this.track.addEventListener('click', e => {
            if (this.isDestroyed || this.isPressed) return;
            const path = e.composedPath() as EventTarget[];
            // Only toggle if the click originated outside the thumb subtree
            if (!path.includes(this.thumb)) {
                this.checked = !this.checked;
                this.cfg.onChange(this.checked);
                this._kick();
            }
        });

        window.addEventListener('resize', () => {
            if (!this.isDestroyed) {
                this._computeGeo();
                this._kick();
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // § 6  PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────

    /** Animate to a new checked state programmatically. */
    setChecked(v: boolean): void {
        if (this.isDestroyed) return;
        this.checked = v;
        this._kick();
    }

    /** Read the current checked state. */
    isChecked(): boolean { return this.checked; }

    /**
     * Swap the icon markup at runtime without rebuilding the whole switch.
     * Useful for async icon loading (e.g. swapping a spinner for a checkmark).
     */
    setIcons(iconOff: string, iconOn: string): void {
        if (this.isDestroyed) return;
        this.iconOffEl.innerHTML = iconOff;
        this.iconOnEl.innerHTML  = iconOn;
    }

    /** Tear down: cancel rAF, remove SVG filter, clear DOM. */
    destroy(): void {
        this.isDestroyed = true;
        if (this.rafId) { cancelAnimationFrame(this.rafId); this.rafId = null; }
        this.filter?.svg.remove();
        this.container.innerHTML = '';
    }
}