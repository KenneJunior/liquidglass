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
export class LiquidGlassSwitch {
    private readonly cfg: Required<SwitchOptions>;

    // ── State ────────────────────────────────────────────────────────────────
    private checked: boolean;
    private isPressed = false;
    private dragStartX = 0;
    private thumbRatio: number;   // 0=off, 1=on — updated during drag

    // ── Springs ──────────────────────────────────────────────────────────────
    // xr and tc are position/colour springs that run even when not pressed.
    // sc, bo, sr are press-response springs.
    private spXr = new Spring(1, 1000, 80);  // thumb position ratio 0–1
    private spSc = new Spring(0.65, 2000, 80);  // scale
    private spBo = new Spring(1, 2000, 80);  // brightness
    private spTc = new Spring(1, 1000, 80);  // track colour 0=off, 1=on
    private spSr = new Spring(0.4, 100, 10);  // refraction scale

    // ── DOM refs ─────────────────────────────────────────────────────────────
    private track!: HTMLElement;
    private thumb!: HTMLElement;
    private thumbInner!: HTMLElement;
    private cloneInner!: HTMLElement;
    private _labelEl:    HTMLElement | null = null;

    // ── Filter ───────────────────────────────────────────────────────────────
    private filter?: FilterCacheResult;
    private filterId?: string;
    private maxDisp = 0;
    private rafId: number | null = null;

    // ── Geometry cache (computed once after DOM is ready) ────────────────────
    private geo!: {
        thumbTravel: number;  // px the thumb centre can travel
        restOffset: number;  // px offset at scale rest that keeps thumb centred
    };

    private static get useBackdrop(): boolean {
        const t = document.createElement('div');
        t.style.backdropFilter = 'url(#test)';
        return !!(window as any).chrome && t.style.backdropFilter.includes('url');
    }

    constructor(
        private readonly container: HTMLElement,
        options: SwitchOptions = {},
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
            colorOff:        options.colorOff         ?? 'rgba(255,255,255,0.05)',
            colorOn:         options.colorOn          ?? [139, 92, 246],
            checked:         options.checked          ?? true,
            label:           options.label            ?? undefined!,
            labelColorOff:   options.labelColorOff    ?? 'rgba(255,255,255,0.35)',
            labelColorOn:    options.labelColorOn     ?? 'rgba(255,255,255,0.90)',
            labelFont:       options.labelFont        ?? '600 13px/1 Inter,sans-serif',
            onChange:        options.onChange         ?? (() => {}),
        };
        this.checked      = this.cfg.checked;
        this.thumbRatio   = this.checked ? 1 : 0;

        // Start springs at their settled values so there's no initial animation
        this.spXr.setTarget(this.thumbRatio);
        this.spTc.setTarget(this.thumbRatio);

        this._buildDOM();
        this._computeGeo();
        this._buildFilter();
        this._bindEvents();
        this._kick(); // paint the initial position
    }

    // ── DOM construction ─────────────────────────────────────────────────────

    private _buildDOM(): void {
        const { trackWidth, trackHeight, thumbWidth, thumbHeight, thumbRadius } = this.cfg;

        this.container.style.position = 'relative';
        this.container.innerHTML = `
          <div class="lg-switch-track" style="
            display:inline-block; position:relative;
            width:${trackWidth}px; height:${trackHeight}px;
            background-color:rgba(255,255,255,0.05);
            border-radius:${trackHeight}px;
            cursor:pointer;
            box-shadow:inset 0 2px 10px rgba(0,0,0,0.5);
            border:1px solid rgba(255,255,255,0.05);
            overflow:visible;
          ">
            <div class="lg-switch-thumb" style="
              position:absolute;
              width:${thumbWidth}px; height:${thumbHeight}px;
              border-radius:${thumbRadius}px;
              top:${trackHeight / 2}px;
              transform:translateY(-50%) scale(0.65);
              transform-origin:center center;
              cursor:pointer; touch-action:none; user-select:none;
              background-color:rgba(255,255,255,1);
              box-shadow:0 10px 30px rgba(0,0,0,0.5);
              overflow:hidden;
              will-change:transform,left,background-color,box-shadow;
              z-index:10;              
            ">

              <div class="lg-switch-thumb-clone" style="
                position:absolute; top:0; left:0; width:100%; height:100%;
                overflow:hidden; border-radius:inherit; z-index:1; opacity:0;
                will-change:opacity;
                ${LiquidGlassSwitch.useBackdrop ? 'display:none;' : ''}
              ">
                <div class="lg-switch-thumb-clone-inner" style="
                  position:absolute; top:0; left:0; pointer-events:none;
                "></div>
              </div>
              <div class="lg-switch-thumb-inner" style="
                position:absolute; top:0; left:0; width:100%; height:100%;
                border-radius:inherit; z-index:3; pointer-events:none;
              "></div>
              <svg style="width:0;height:0;position:absolute;" aria-hidden="true">
                <defs></defs>
              </svg>
            </div>
          </div>`;

        this.track      = this.container.querySelector('.lg-switch-track')!;
        this.thumb      = this.container.querySelector('.lg-switch-thumb')!;
        this.thumbInner = this.container.querySelector('.lg-switch-thumb-inner')!;
        this.cloneInner = this.container.querySelector('.lg-switch-thumb-clone-inner')!;

        // ── Label / logo ─────────────────────────────────────────────────────
        // Injected after innerHTML so it lands inside .lg-switch-track but
        // above the thumb in z-order. pointer-events:none so it never
        // intercepts drag events.
        const { label, labelColorOff, labelColorOn, labelFont, checked } = this.cfg;
        if (label !== undefined && label !== null) {
            const wrapper = document.createElement('div');
            wrapper.className = 'lg-switch-label';
            Object.assign(wrapper.style, {
                position:      'absolute',
                inset:         '0',
                display:       'flex',
                alignItems:    'center',
                justifyContent:'center',
                pointerEvents: 'none',
                zIndex:        '5',
                font:          labelFont,
                color:         checked ? labelColorOn : labelColorOff,
                transition:    'color 300ms ease',
                userSelect:    'none',
            });
            if (typeof label === 'string') {
                wrapper.textContent = label;
            } else {
                wrapper.appendChild(label);
            }
            this.track.appendChild(wrapper);
            this._labelEl = wrapper;
        }
    }
    /** Computes geometry constants that depend on final CSS layout. */
    private _computeGeo(): void {
        const {trackWidth, trackHeight, thumbWidth, thumbHeight} = this.cfg;
        const restScale = thumbHeight / thumbWidth;
        const ro = ((1 - restScale) * thumbWidth) / 2;
        const tr = trackWidth - trackHeight - (thumbWidth - thumbHeight) * restScale;
        this.geo = {thumbTravel: tr, restOffset: ro};
    }

    // ── Filter construction ──────────────────────────────────────────────────

    private async _buildFilter(): Promise<void> {
        const { thumbWidth: W, thumbHeight: H, thumbRadius: R,
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha } = this.cfg;

        const opts = {
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha,
            backdrop: { blur: 0.2, saturation: 6, brightness: 1.0 },
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

        this.filter   = await buildGlassFilterAsync(fakeEl, opts);
        this.maxDisp  = this.filter.maxDisp;
        this.filterId = this.filter.id;

        const svgDefs = this.thumb.querySelector('svg defs')!;
        svgDefs.parentElement!.replaceWith(this.filter.svg);

        if (LiquidGlassSwitch.useBackdrop) {
            const bf = `url(#${this.filterId})`;
            this.thumbInner.style.backdropFilter = bf;
            (this.thumbInner.style as any).webkitBackdropFilter = bf;
        } else {
            this.cloneInner.style.filter = `url(#${this.filterId})`;
            this.cloneInner.style.background =
                getComputedStyle(this.container.parentElement || document.body).background;
        }
    }

    // ── Spring loop ──────────────────────────────────────────────────────────

    private _kick(): void {
        if (!this.rafId) this.rafId = requestAnimationFrame(() => this._loop());
    }

    private _loop(): void {
        const dt = Math.min(0.032, 1 / 60);
        const {trackWidth, trackHeight, thumbWidth, thumbHeight} = this.cfg;
        const {thumbTravel, restOffset} = this.geo;

        // Settle springs that don't depend on press state every frame
        if (!this.isPressed) {
            this.spXr.setTarget(this.checked ? 1 : 0);
        }
        this.spTc.setTarget(
            this.isPressed
                ? (this.thumbRatio > 0.5 ? 1 : 0)
                : (this.checked ? 1 : 0)
        );

        const xr = this.spXr.update(dt);
        const sc = this.spSc.update(dt);
        const bo = this.spBo.update(dt);
        const tc = this.spTc.update(dt);
        const sr = this.spSr.update(dt);

        // Thumb X position — port of demo.html:
        //   tx = -ro + (th - h * sr) / 2 + xr * tr
        // where th=trackHeight, h=thumbHeight, sr=restScale (constant).
        // sc is NOT used here — it only drives transform:scale(), not left.
        const restScale = this.cfg.thumbHeight / this.cfg.thumbWidth;
        const tx = -restOffset + (this.cfg.trackHeight - this.cfg.thumbHeight * restScale) / 2 + xr * thumbTravel;
        this.thumb.style.left = `${tx}px`;
        this.thumb.style.transform = `translateY(-50%) scale(${sc})`;
        this.thumb.style.backgroundColor = `rgba(255,255,255,${bo})`;
        this.thumb.style.boxShadow = this.isPressed
            ? '0 4px 22px rgba(0,0,0,0.1),inset 2px 7px 24px rgba(0,0,0,0.09),inset -2px -7px 24px rgba(255,255,255,0.09)'
            : '0 10px 30px rgba(0,0,0,0.5)';

        // Clone fades in when thumb turns glass
        const cloneEl = this.thumb.querySelector('.lg-switch-thumb-clone') as HTMLElement | null;
        if (cloneEl) cloneEl.style.opacity = String(1 - bo);

        // Track colour interpolation: off colour → on colour
        const [or, og, ob] = this.cfg.colorOn;
        const r = Math.round(255 + (or - 255) * tc);
        const g = Math.round(255 + (og - 255) * tc);
        const b = Math.round(255 + (ob - 255) * tc);
        const a = 0.05 + 0.45 * tc;
        this.track.style.backgroundColor = `rgba(${r},${g},${b},${a})`;

        // Displacement scale
        if (this.filter?.mapElG) {
            const scale = (this.maxDisp * this.cfg.refractionScale * sr).toFixed(3);
            this.filter.mapElR?.setAttribute('scale', scale);
            this.filter.mapElG?.setAttribute('scale', scale);
            this.filter.mapElB?.setAttribute('scale', scale);
        }

        // Clone-world repositioning (non-backdrop-filter path)
        if (!LiquidGlassSwitch.useBackdrop) {
            const aR = this.container.getBoundingClientRect();
            const cl = (aR.width - trackWidth) / 2;
            const ct = (aR.height - trackHeight) / 2;
            this.cloneInner.style.width = `${aR.width}px`;
            this.cloneInner.style.height = `${aR.height}px`;
            this.cloneInner.style.transform =
                `translate(${-(cl + tx)}px, ${-(ct + (trackHeight / 2 - thumbHeight / 2))}px)`;
            this.cloneInner.style.setProperty('--lg-switch-track-color', `rgba(${r},${g},${b},${a})`);
            this.cloneInner.style.setProperty('--lg-track-left', `${cl}px`);
            this.cloneInner.style.setProperty('--lg-track-top', `${ct}px`);
        }

        const settled = this.spXr.isSettled() && this.spSc.isSettled() &&
            this.spBo.isSettled() && this.spTc.isSettled() && this.spSr.isSettled();
        this.rafId = settled ? null : requestAnimationFrame(() => this._loop());
    }

    // ── Pointer events ───────────────────────────────────────────────────────

    private _bindEvents(): void {
        const onDown = (clientX: number) => {
            this.isPressed = true;
            this.dragStartX = clientX;
            this.thumbRatio = this.checked ? 1 : 0;
            this.spSc.setTarget(0.9);
            this.spBo.setTarget(0.1);
            this.spSr.setTarget(0.9);
            this._kick();
        };

        const onMove = (clientX: number) => {
            if (!this.isPressed) return;
            const {thumbTravel} = this.geo;
            const base = this.checked ? 1 : 0;
            const ratio = base + (clientX - this.dragStartX) / thumbTravel;
            // Rubber-band: allow slight overshoot, then compress
            const clamped = Math.min(1, Math.max(0, ratio));
            const overshoot = ratio < 0 ? -ratio : ratio > 1 ? ratio - 1 : 0;
            this.thumbRatio = clamped + (ratio < 0 ? 1 : -1) * overshoot / 22;
            this.spXr.setTarget(this.thumbRatio);
            this._kick();
        };

        const onUp = (clientX: number) => {
            if (!this.isPressed) return;
            this.isPressed = false;
            // Snap: small movement = toggle, large movement = follow position
            const wasDrag = Math.abs(clientX - this.dragStartX) >= 4;
            this.checked = wasDrag ? this.thumbRatio > 0.5 : !this.checked;
            this.spSc.setTarget(this.cfg.thumbHeight / this.cfg.thumbWidth);
            this.spBo.setTarget(1);
            this.spSr.setTarget(0.4);
            this.cfg.onChange(this.checked);
            this._kick();
        };

        // Thumb — primary drag target
        this.thumb.addEventListener('mousedown', e => {
            e.preventDefault();
            e.stopPropagation();
            onDown(e.clientX);
        });
        this.thumb.addEventListener('touchstart', e => {
            e.preventDefault();
            e.stopPropagation();
            onDown(e.touches[0].clientX);
        }, {passive: false});

        window.addEventListener('mousemove', e => onMove(e.clientX));
        window.addEventListener('touchmove', e => {
            if (this.isPressed) {
                e.stopPropagation();
                onMove(e.touches[0].clientX);
            }
        }, {passive: false});
        window.addEventListener('mouseup', e => onUp(e.clientX));
        window.addEventListener('touchend', e => onUp(e.changedTouches?.[0]?.clientX ?? this.dragStartX));

        // Track — click anywhere to toggle
        this.track.addEventListener('click', e => {
            if (e.target === this.track) {
                this.checked = !this.checked;
                this._kick();
            }
        });

        window.addEventListener('resize', () => {
            this._computeGeo();
            this._kick();
        });
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Programmatically set checked state (animates). */
    setChecked(v: boolean): void {
        this.checked = v;
        this._kick();
    }

    /** Read current checked state. */
    isChecked(): boolean {
        return this.checked;
    }

    /** Tear down. */
    destroy(): void {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.filter?.svg.remove();
        this.container.innerHTML = '';
    }
}
