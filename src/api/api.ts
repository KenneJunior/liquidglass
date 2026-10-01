/**
 * Liquid Glass public API and instance manager
 *
 * Handles:
 * - Global instance management
 * - Pointer event tracking (mouse/stylus follow)
 * - Device orientation tracking (mobile gyroscope)
 * - Ambient orb rendering
 * - Ripple effects creation
 * - Factory methods for creating surfaces, sliders, and switches
 */

import type {
  LiquidGlassOptions,
  RippleOptions, ShatterOptions,
  SliderOptions,
  SwitchOptions,
} from "../types/Types.ts";
import { LiquidGlassSurface } from "../components/surface.ts";
import { LiquidGlassSlider } from "../components/slider.ts";
import { LiquidGlassSwitch } from "../components/switch.ts";
import {ShatterEngine} from "../effects/ShaterEngine.ts";
import {MathUtils} from "../core/Mathutils.ts";
import {Spring} from "../core/Spring.ts";

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE OPTION TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Options for LiquidGlass.addMagneticSnap()
 */
export interface MagneticSnapOptions {
  /**
   * Pixel radius around each snap target within which the element
   * is attracted. Default: 80
   */
  threshold?: number;
  /**
   * Spring stiffness controlling how fast the element snaps.
   * Higher = snappier. Default: 600
   */
  stiffness?: number;
  /**
   * Spring damping. Higher = less overshoot. Default: 28
   */
  damping?: number;
  /**
   * How strongly the element is pulled toward a snap point.
   * 1.0 = full snap to centre, 0.5 = halfway. Default: 1.0
   */
  strength?: number;
  /**
   * Called when the element snaps onto a target, receives the
   * target element it snapped to.
   */
  onSnap?: (target: HTMLElement) => void;
  /**
   * Called when the element releases from a snap target.
   */
  onRelease?: (target: HTMLElement) => void;
}

/** Handle returned by addMagneticSnap() */
export interface MagneticSnapInstance {
  /** Stop all springs and remove event listeners. The element's position resets. */
  destroy(): void;
}

/**
 * Options for LiquidGlass.addGlowPulse()
 */
export interface GlowPulseOptions {
  /**
   * How many seconds for the light source to complete one full orbit
   * of the glass rim. Default: 4
   */
  period?: number;
  /**
   * How far the light source travels from its rest position (60°)
   * in degrees. Default: 60 (so the light sweeps 60°→120°→60°)
   */
  radius?: number;
  /**
   * Peak brightness of the specular highlight at the top of the pulse.
   * 0–1, mapped to feComponentTransfer slope. Default: 0.95
   */
  intensity?: number;
  /**
   * Tint colour applied to the specular highlight as a CSS rgba string.
   * Default: 'rgba(255,255,255,1)' (white)
   */
  color?: string;
  /**
   * If true, the pulse starts paused. Call instance.resume() to begin.
   * Default: false
   */
  paused?: boolean;
}

/** Handle returned by addGlowPulse() */
export interface GlowPulseInstance {
  /** Pause the animation — light source freezes at current angle. */
  pause(): void;
  /** Resume the animation from where it was paused. */
  resume(): void;
  /** Stop animation and restore the original static specular highlight. */
  destroy(): void;
}


/**
 * Main API for the Liquid Glass effects
 *
 * Static factory and event manager for initializing and controlling glass effects.
 * Handles:
 * - Global instance management
 * - Pointer event tracking (mouse/stylus follow)
 * - Device orientation tracking (mobile gyroscope)
 * - Ambient orb rendering
 * - Ripple effects creation
 * - Magnetic snap-to-zone interactions
 * - Animated specular glow pulse
 * - Physics-based glass shatter destruction
 *
 * Usage:
 * ```js
 * LiquidGlass.init('.glass');               // Enable on all .glass elements
 * LiquidGlass.addRipple(el, event);         // Ripple on click
 * LiquidGlass.addMagneticSnap(el, zones);   // Snap to docking zones
 * LiquidGlass.addGlowPulse(el);             // Orbiting specular light
 * LiquidGlass.addShatter(el);              // Shatter into physics shards
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
    if (document.getElementById("liquid-glass-base-styles")) return;
    const style = document.createElement("style");
    style.id = "liquid-glass-base-styles";
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
   *
   */
  static init(selector: string, options?: LiquidGlassOptions): void;
  /**
   * Initialize glass effects on matching elements
   *
   * @param selectors Array of CSS selectors for elements to enhance
   * @param options Configuration options (merged with CSS variables)
   *
   * @example
   * LiquidGlass.init(['.glass-card-1','glass-card-2','glass-card-3'], {
   *   refractiveIndex: 1.8,
   *   maxTilt: 12,
   *   enableOrb: true
   * });
   *
   */
  static init(selectors: string[], options?: LiquidGlassOptions): void;
  static init(selectorOrSelectors: string | string[], options: LiquidGlassOptions = {}) {
    // support both single selector and array of selectors
    if (Array.isArray(selectorOrSelectors)) {
      selectorOrSelectors.forEach((sel) => this.init(sel, options));
      return;
    }

    const selector = selectorOrSelectors;

    this.injectBaseStyles();
    document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
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
  static createOrb(color = "rgba(120,130,255,.13)") {
    const o = document.createElement("div");
    o.setAttribute("aria-hidden", "true");
    Object.assign(o.style, {
      position: "fixed",
      width: "360px",
      height: "360px",
      borderRadius: "50%",
      background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
      pointerEvents: "none",
      zIndex: "0",
      transform: "translate(-50%,-50%)",
      transition: "opacity .4s ease",
      opacity: "0",
      willChange: "left,top",
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
        const near =
            this._lx > rect.left - M &&
            this._lx < rect.right + M &&
            this._ly > rect.top - M &&
            this._ly < rect.bottom + M;

        if (near) {
          // Normalize coordinates to -1..1 range relative to element center
          const nx = MathUtils.clamp(
              (this._lx - (rect.left + rect.width / 2)) / (rect.width / 2),
              -1,
              1
          );
          const ny = MathUtils.clamp(
              (this._ly - (rect.top + rect.height / 2)) / (rect.height / 2),
              -1,
              1
          );
          surface.aim(nx, ny);
        } else {
          surface.rest();
        }
      });
    };

    // Track mouse movement (skip touch)
    document.addEventListener("pointermove", (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      this._lx = e.clientX;
      this._ly = e.clientY;

      if (this.orb) {
        this.orb.style.left = this._lx + "px";
        this.orb.style.top = this._ly + "px";
        this.orb.style.opacity = "1";
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
    document.addEventListener("pointerleave", () => {
      if (this.orb) this.orb.style.opacity = "0";
      this.instances.forEach((s) => s.rest());
    });
  }

  /**
   * Enable mobile device orientation support (gyroscope)
   * Allows glass effects to respond to device tilt
   */
  static enableMobileSupport() {
    window.addEventListener(
        "deviceorientation",
        (e: DeviceOrientationEvent) => {
          if (!e.gamma || !e.beta) return;
          // Normalize gamma (-90..90) and beta (-180..180) to -1..1
          const nx = MathUtils.clamp(e.gamma / 45, -1, 1);
          const ny = MathUtils.clamp(e.beta / 45, -1, 1);

          if (!this._raf) {
            this._raf = requestAnimationFrame(() => {
              this._raf = null;
              this.instances.forEach((surface) => surface.aim(nx, ny));
            });
          }
        }
    );
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
    const el =
        typeof container === "string"
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
    const el =
        typeof container === "string"
            ? document.querySelector<HTMLElement>(container)!
            : container;
    return new LiquidGlassSwitch(el, options);
  }

  /**
   * Emits a physically layered ripple from a click/tap point.
   *
   * Three simultaneous layers produce the glass-quality feel:
   *
   *  1. **Origin flash** — a tight, bright circle at the exact impact point
   *     that peaks at t=0 and vanishes in ~180ms. Simulates the moment of
   *     impact before energy has propagated outward.
   *
   *  2. **Refraction ring** — a thin, high-opacity annulus that races ahead
   *     of the fill wave. Models the leading edge of the pressure front where
   *     the refractive index discontinuity is sharpest — the same physics that
   *     produces the bright ring you see when a droplet hits still water.
   *     Implemented as a `radial-gradient` with a sharp transparent centre so
   *     the ring thins and fades as it expands.
   *
   *  3. **Fill wave** — the main expanding disc. Uses a two-stop gradient
   *     (opaque centre → transparent edge) so energy density appears to
   *     concentrate at the origin and dissipate outward — correct for a
   *     pressure wave in a 2D medium where intensity ∝ 1/r.
   *
   *  4. **Chromatic aberration halo** (optional) — a fourth layer: two
   *     concentric rings offset by ±1px in opposite colours (red/blue),
   *     matching the per-channel displacement used in the glass filter.
   *     Visible only at the wave front; negligible performance cost.
   *
   * All layers use `mix-blend-mode: screen` so they add light rather than
   * painting over the glass surface content.
   *
   * Returns a Promise that resolves when all DOM nodes have been cleaned up,
   * allowing callers to chain actions after the animation.
   *
   * @param element  Element to emit the ripple from
   * @param event    Pointer or mouse event that triggered the ripple.
   *                 Used for the origin position; the ripple always starts
   *                 at the exact (clientX, clientY) of the event.
   * @param options  Visual and timing parameters
   * @returns        Promise resolving when the animation is complete
   *
   * @example
   * element.addEventListener('click', async e => {
   *   await LiquidGlass.addRipple(element, e, {
   *     color:       'rgba(120, 160, 255, 0.35)',
   *     ringColor:   'rgba(200, 220, 255, 0.75)',
   *     aberration:  true,
   *     durationMs:  900,
   *   });
   *   console.log('ripple done');
   * });
   */
  static addRipple(
      element:  HTMLElement,
      event:    MouseEvent | PointerEvent,
      options:  RippleOptions = {}
  ): Promise<void> {
    return new Promise<void>(resolve => {

      // ── Resolve options ─────────────────────────────────────────────────
      const color            = options.color            ?? "rgba(255, 255, 255, 0.28)";
      const ringColor        = options.ringColor        ?? "rgba(255, 255, 255, 0.70)";
      const originFlash      = options.originFlash      ?? true;
      const originFlashColor = options.originFlashColor ?? "rgba(255, 255, 255, 0.92)";
      const sizeMultiplier   = options.sizeMultiplier   ?? 2.8;
      const durationMs       = options.durationMs       ?? 900;
      const blendMode        = options.blendMode        ?? "screen";
      const aberration       = options.aberration       ?? true;
      const easing           = options.easing           ?? "cubic-bezier(0.16, 1, 0.3, 1)";
      const startOp          = options.startOpacity     ?? 1;
      const endOp            = options.endOpacity       ?? 0;

      // ── Geometry ─────────────────────────────────────────────────────────
      const rect  = element.getBoundingClientRect();
      const ox    = event.clientX - rect.left;   // origin X, element-local
      const oy    = event.clientY - rect.top;    // origin Y, element-local
      // Max radius needed to reach the farthest corner from the click point
      const toCornerDist = Math.max(
          Math.hypot(ox,          oy),
          Math.hypot(rect.width - ox, oy),
          Math.hypot(ox,          rect.height - oy),
          Math.hypot(rect.width - ox, rect.height - oy)
      );
      const size  = toCornerDist * 2 * sizeMultiplier;

      // ── Shared layer styles ───────────────────────────────────────────────
      // All layers are absolute, centred on the click point, circular,
      // and use screen blend mode. Pointer-events disabled throughout.
      const baseStyle = (diameter: number): Partial<CSSStyleDeclaration> => ({
        position:      "absolute",
        width:         `${diameter}px`,
        height:        `${diameter}px`,
        borderRadius:  "50%",
        left:          `${ox - diameter / 2}px`,
        top:           `${oy - diameter / 2}px`,
        pointerEvents: "none",
        mixBlendMode:  blendMode as any,
        willChange:    "transform, opacity",
      });

      // ── Helper: create a layer, append it, and schedule cleanup ──────────
      // Each layer manages its own lifetime via animation.onfinish.
      // The shared `done` counter resolves the outer Promise once all
      // layers have cleaned up.
      const layerCount = 2 + (originFlash ? 1 : 0) + (aberration ? 1 : 0);
      let   doneCount  = 0;

      function finish() {
        doneCount++;
        if (doneCount >= layerCount) {
          options.onComplete?.();
          resolve();
        }
      }

      function spawnLayer(
          el:       HTMLElement,
          keyframes: Keyframe[],
          timing:   KeyframeAnimationOptions
      ): void {
        element.appendChild(el);
        const anim = el.animate(keyframes, timing);
        anim.onfinish = () => { el.remove(); finish(); };
      }

      // ── Layer 1 — Origin flash ────────────────────────────────────────────
      // Tight, bright burst at the exact click point. Peaks instantly (t=0),
      // vanishes fast so it doesn't compete with the expanding wave.
      if (originFlash) {
        const flashSize = Math.max(28, Math.min(rect.width, rect.height) * 0.18);
        const flash     = document.createElement("div");
        Object.assign(flash.style, {
          ...baseStyle(flashSize),
          background: `radial-gradient(circle,
            ${originFlashColor}  0%,
            rgba(255,255,255,0.28) 45%,
            transparent 70%
          )`,
          zIndex: "4",
        });
        spawnLayer(flash, [
          { transform: "scale(0)",   opacity: 1    },
          { transform: "scale(1.8)", opacity: 0.65, offset: 0.25 },
          { transform: "scale(3.2)", opacity: 0    },
        ], {
          duration: durationMs * 0.28,
          easing:   "cubic-bezier(0.0, 0.0, 0.2, 1)",
          fill:     "forwards",
        });
      }

      // ── Layer 2 — Refraction ring (leading edge) ──────────────────────────
      // A thin annulus that sprints ahead of the fill wave. The gradient has
      // a transparent centre and transparent exterior so only the ring itself
      // is visible — it thins and dims as it expands, correctly modelling
      // a spreading pressure wave losing intensity with 1/r.
      //
      // The ring's inner radius is 55% and outer is 72% of the total disc.
      // As scale increases the ring itself gets thinner in screen pixels,
      // which is physically correct — the wave front is thin relative to the
      // total expanded area at large radii.
      const ring = document.createElement("div");
      Object.assign(ring.style, {
        ...baseStyle(size),
        background: `radial-gradient(circle,
          transparent           0%,
          transparent           48%,
          rgba(255,255,255,0.04) 52%,
          ${ringColor}           60%,
          rgba(255,255,255,0.12) 66%,
          transparent           72%,
          transparent           100%
        )`,
        zIndex: "3",
      });
      spawnLayer(ring, [
        { transform: `scale(0)`,    opacity: startOp  },
        { transform: `scale(0.55)`, opacity: 1,        offset: 0.12 },
        { transform: `scale(1)`,    opacity: endOp    },
      ], {
        duration: durationMs,
        easing,
        fill: "forwards",
      });

      // ── Layer 3 — Fill wave ───────────────────────────────────────────────
      // The main expanding disc. Gradient is denser at centre (0%) and fully
      // transparent at 65% — this concentrates energy at the origin and
      // produces a natural falloff matching 1/r² intensity decay.
      // The animation uses two phases: fast initial expand (0→60%) then
      // deceleration to full size, matching how pressure waves slow as they
      // spread into a larger area.
      const fill = document.createElement("div");
      Object.assign(fill.style, {
        ...baseStyle(size),
        background: `radial-gradient(circle,
          ${color}              0%,
          rgba(255,255,255,0.06) 35%,
          rgba(255,255,255,0.02) 55%,
          transparent           65%
        )`,
        zIndex: "2",
      });
      spawnLayer(fill, [
        { transform: `scale(0)`,   opacity: startOp },
        // Fast burst to 60% — energy is highest near the origin
        { transform: `scale(0.6)`, opacity: startOp * 0.85, offset: 0.22 },
        // Decelerate — matches wave front losing energy as area grows
        { transform: `scale(1)`,   opacity: endOp           },
      ], {
        duration: durationMs * 1.1,   // slightly longer than ring so fill lingers
        easing:   "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "forwards",
      });

      // ── Layer 4 — Chromatic aberration halo ──────────────────────────────
      // Two offset rings in complementary colours (red leads, blue trails)
      // matching the per-channel R/B offset in the SVG glass filter.
      // The scale values are intentionally close to 1 so the rings appear
      // only at the very edge of the expanded wave — they're a finishing
      // detail, not a dominant feature.
      if (aberration) {
        const aber = document.createElement("div");
        Object.assign(aber.style, {
          ...baseStyle(size),
          background: `radial-gradient(circle,
            transparent                    0%,
            transparent                    60%,
            rgba(255, 60,  60,  0.14)      67%,
            transparent                    71%,
            transparent                    73%,
            rgba(60,  80,  255, 0.12)      78%,
            transparent                    83%
          )`,
          zIndex: "1",
        });
        spawnLayer(aber, [
          { transform: `scale(0)`,    opacity: 0 },
          { transform: `scale(0.55)`, opacity: 0,              offset: 0.18 },
          { transform: `scale(0.82)`, opacity: startOp * 0.6,  offset: 0.55 },
          { transform: `scale(1)`,    opacity: 0 },
        ], {
          duration: durationMs,
          easing:   "cubic-bezier(0.2, 1, 0.4, 1)",
          fill: "forwards",
        });
      }

    });
  }

  /**
   * Shatters a glass element into physics-driven shards.
   *
   * The fracture pattern is generated via a seeded Voronoi tessellation:
   * seed points are scattered over the element, then each point's cell
   * boundary is found by ray-casting in 24 directions and recording where
   * the ray crosses into a neighbour's territory. The resulting polygons
   * are applied as `clip-path` values so each shard shows the correct
   * slice of the element's visual.
   *
   * Each shard is animated by two `Spring` instances (X and Y translation)
   * and one rotation spring. Gravity accumulates on the Y velocity each
   * frame. When all springs settle the shards fade staggered and are removed.
   *
   * When `scattered: false` the shards stay near their origin — they tilt
   * and scale down slightly before fading, producing a "crumble" effects.
   *
   * @param element  Element to shatter, or a CSS selector string
   * @param event    The pointer/mouse event that triggered the shatter
   *                 (used to derive the impact origin when `options.origin`
   *                 is not set). Pass `null` to use the element centre.
   * @param options  Tuning parameters — see {@link ShatterOptions}
   * @returns        Promise that resolves when all shards have been removed
   *
   * @example
   * // Scattered shatter on click
   * btn.addEventListener('click', async e => {
   *   await LiquidGlass.addShatter(btn, e, { shardCount: 14, velocity: 520 });
   *   btn.remove();
   * });
   *
   * @example
   * // In-place crumble, no scatter
   * LiquidGlass.addShatter('#card', null, { scattered: false, shardCount: 18 });
   */
  static async addShatter(
      element: string | HTMLElement,
      event: MouseEvent | PointerEvent | null = null,
      options: ShatterOptions = {}
  ): Promise<void> {
    const el = typeof element === 'string' ? document.querySelector<HTMLElement>(element) : element;
    if (!el) return;

    return ShatterEngine.shatter(el, event, options);
  }
}