/**
 * Liquid Glass public API and instance manager
 *
 * Handles:
 * - Global instance management
 * - Pointer event tracking (mouse/stylus follow)
 * - Device orientation tracking (mobile gyroscope)
 * - Ambient orb rendering
 * - Ripple effect creation
 * - Factory methods for creating surfaces, sliders, and switches
 */

import type { LiquidGlassOptions, RippleOptions, SliderOptions, SwitchOptions, FilterCacheResult } from "./Types.ts";
import { LiquidGlassSurface } from "./surface.ts";
import { LiquidGlassSlider } from "./slider.ts";
import { LiquidGlassSwitch } from "./switch.ts";
import { MathUtils } from "./utils.ts";

/**
 * Main API for the Liquid Glass effect
 *
 * Static factory and event manager for initializing and controlling glass effects.
 * Handles:
 * - Global instance management
 * - Pointer event tracking (mouse/stylus follow)
 * - Device orientation tracking (mobile gyroscope)
 * - Ambient orb rendering
 * - Ripple effect creation
 *
 * Usage:
 * ```
 * LiquidGlass.init('.glass');  // Enable on all .glass elements
 * LiquidGlass.addRipple(el, event);  // Add ripple on click
 * ```
 */
export class LiquidGlass {
    static instances = new Map<HTMLElement, LiquidGlassSurface>();
    static orb: HTMLElement | null = null;

    static isTracking = false;
    static isMobileTracking = false;

    static _lx = -9999;
    static _ly = -9999;
    static _raf: number | null = null;

    /**
     * Inject base CSS (animations, etc.) if not already present
     * Called automatically by init()
     */
    static injectBaseStyles() {
        if (document.getElementById('liquid-glass-base-styles')) return;
        const style = document.createElement('style');
        style.id = 'liquid-glass-base-styles';
        style.textContent = `
      @keyframes liquid-glass-ripple-anim {
        from { transform: scale(0); opacity: 1; }
        /* slightly overscale so the ripple feels bigger */
        to { transform: scale(1.2); opacity: 0; }
      }
    `;
        document.head.appendChild(style);
    }

    /**
     * Initialize glass effects on matching elements
     *
     * @param selector CSS selector for elements to enhance
     * @param options Configuration options (merged with CSS variables)
     *
     * @example
     * LiquidGlass.init('.glass-button', {
     *   refractiveIndex: 1.8,
     *   maxTilt: 12,
     *   enableOrb: true
     * });
     */
    static init(selector: string, options: LiquidGlassOptions = {
        backdrop: {
            blur: undefined,
            saturation: undefined,
            brightness: undefined,
            reducedMotion: undefined
        }
    }) {
        this.injectBaseStyles();
        document.querySelectorAll<HTMLElement>(selector).forEach(el => {
            if (!this.instances.has(el)) {
                this.instances.set(el, new LiquidGlassSurface(el, options));
            }
        });

        if (options.enableOrb !== false && !this.orb) {
            this.createOrb(options.orbColor);
        }

        // Set up pointer tracking only once globally
        if (!this.isTracking) {
            this.bindEvents();
            this.isTracking = true;
        }

        // Set up mobile device orientation tracking (only once)
        if (options.enableMobileSupport !== false && !this.isMobileTracking) {
            this.enableMobileSupport();
            this.isMobileTracking = true;
        }
    }

    /**
     * Create the ambient orb element
     * Follows the mouse cursor with a soft blur
     * @param color RGBA color string. Default: 'rgba(120,130,255,.13)'
     */
    static createOrb(color = 'rgba(120,130,255,.13)') {
        const o = document.createElement('div');
        o.setAttribute('aria-hidden', 'true');
        Object.assign(o.style, {
            position: 'fixed', width: '360px', height: '360px', borderRadius: '50%',
            background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
            pointerEvents: 'none', zIndex: '0',
            transform: 'translate(-50%,-50%)', transition: 'opacity .4s ease',
            opacity: '0', willChange: 'left,top'
        });
        document.body.appendChild(o);
        this.orb = o;
    }

    /**
     * Bind global pointer move and leave events
     * Updates all glass surfaces based on mouse position
     */
    static bindEvents() {
        const updateSurfaces = () => {
            this.instances.forEach((surface, el) => {
                const rect = el.getBoundingClientRect();
                const M = 100; // detection margin in pixels
                const near = this._lx > rect.left - M && this._lx < rect.right + M && this._ly > rect.top - M && this._ly < rect.bottom + M;

                if (near) {
                    // Normalize coordinates to -1..1 range relative to element center
                    const nx = MathUtils.clamp((this._lx - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
                    const ny = MathUtils.clamp((this._ly - (rect.top + rect.height / 2)) / (rect.height / 2), -1, 1);
                   surface.aim(nx, ny);
                } else {
                    surface.rest();
                }
            });
        };

        // Track mouse movement (skip touch)
        document.addEventListener('pointermove', (e: PointerEvent) => {
            if (e.pointerType === 'touch') return;
            this._lx = e.clientX;
            this._ly = e.clientY;

            if (this.orb) {
                this.orb.style.left = this._lx + 'px';
                this.orb.style.top = this._ly + 'px';
                this.orb.style.opacity = '1';
            }

            // Throttle updates with requestAnimationFrame
            if (!this._raf) {
                this._raf = requestAnimationFrame(() => {
                    this._raf = null;
                    updateSurfaces();
                });
            }
        });

        // Hide orb and rest surfaces when pointer leaves
        document.addEventListener('pointerleave', () => {
            if (this.orb) this.orb.style.opacity = '0';
            this.instances.forEach(s => s.rest());
        });
    }

    /**
     * Enable mobile device orientation support (gyroscope)
     * Allows glass effect to respond to device tilt
     */
    static enableMobileSupport() {
        window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
            if (!e.gamma || !e.beta) return;
            // Normalize gamma (-90..90) and beta (-180..180) to -1..1
            const nx = MathUtils.clamp(e.gamma / 45, -1, 1);
            const ny = MathUtils.clamp(e.beta / 45, -1, 1);

            if (!this._raf) {
                this._raf = requestAnimationFrame(() => {
                    this._raf = null;
                    this.instances.forEach(surface => surface.aim(nx, ny));
                });
            }
        });
    }

    /**
     * Create a LiquidGlassSlider inside `container`.
     *
     * The slider shares the global filter cache so if multiple sliders
     * happen to have identical dimensions and optics they reuse the same
     * baked displacement map.
     *
     * @example
     * const slider = LiquidGlass.createSlider('#my-container', {
     *   value: 30,
     *   onChange:  v => console.log('live:', v),
     *   onCommit:  v => console.log('committed:', v),
     * });
     */
    static createSlider(
        container: string | HTMLElement,
        options: SliderOptions = {}
    ): LiquidGlassSlider {
        const el = typeof container === 'string'
            ? document.querySelector<HTMLElement>(container)!
            : container;
        return new LiquidGlassSlider(el, options);
    }

    /**
     * Create a LiquidGlassSwitch inside `container`.
     *
     * @example
     * const toggle = LiquidGlass.createSwitch('#my-toggle', {
     *   checked:  false,
     *   colorOn:  [99, 102, 241],
     *   onChange: v => console.log('switched:', v),
     * });
     */
    static createSwitch(
        container: string | HTMLElement,
        options: SwitchOptions
    ): LiquidGlassSwitch {
        const el = typeof container === 'string'
            ? document.querySelector<HTMLElement>(container)!
            : container;
        return new LiquidGlassSwitch(el, options);
    }

    /**
     * Add a ripple effect emanating from a click/tap point
     *
     * @param element Element to add ripple to
     * @param event Mouse or pointer event with clientX/Y
     * @param options
     *
     * @example
     * element.addEventListener('click', (e) => {
     *   LiquidGlass.addRipple(element, e, 'rgba(100,150,255,.5)');
     * });
     */
    static addRipple(
        element: HTMLElement,
        event: MouseEvent | PointerEvent,
        options: RippleOptions = {}
    ): void {
        // 1. Establish strict defaults
        const color = options.color ?? 'rgba(255, 255, 255, 0.46)';
        const sizeMultiplier = options.sizeMultiplier ?? 2;
        const duration = options.durationMs ?? 1.2000;
        const easing = options.easing ?? 'cubic-bezier(.16, 1, .3, 1)';
        const startOp = options.startOpacity ?? 1;
        const endOp = options.endOpacity ?? 0;

        // 2. Calculate geometry
        const rect = element.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height) * sizeMultiplier;

        // 3. Construct DOM element
        const rip = document.createElement('span');
        Object.assign(rip.style, {
            position: 'absolute',
            width: `${size}px`,
            height: `${size}px`,
            borderRadius: '50%',
            left: `${event.clientX - rect.left - size / 2}px`,
            top: `${event.clientY - rect.top - size / 2}px`,
            background: `radial-gradient(circle, ${color} 0%, transparent 50%)`,
            pointerEvents: 'none',
            zIndex: '0' // Ensure it sits behind text if the container is relative
        });

        element.appendChild(rip);

        // 4. Execute dynamic Web Animation (No external CSS required)
        const animation = rip.animate([
            {transform: 'scale(0)', opacity: startOp},
            {transform: 'scale(1)', opacity: endOp}
        ], {
            duration: duration,
            easing: easing,
            fill: 'forwards'
        });

        // 5. Memory cleanup
        animation.onfinish = () => rip.remove();
    }

}
