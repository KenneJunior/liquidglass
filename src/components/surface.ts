/**
 * Per-element glass surface class
 *
 * Manages all aspects of a glass effect on one DOM element:
 * - Animation state (spring-based physics)
 * - SVG filter attachment and updates
 * - Resize observation and recomputation
 * - 3D tilt transforms based on pointer position
 * - Inner shine layer rendering
 */

import type { LiquidGlassOptions, FilterCacheResult } from "../types/Types.ts";
import { Spring, MathUtils } from "../utils/utils.ts";
import { buildGlassFilterAsync } from "./filters.ts";

/**
 * A single glass surface instance
 *
 * Manages all aspects of a glass effect on one DOM element:
 * - Animation state (spring-based physics)
 * - SVG filter attachment and updates
 * - Resize observation and recomputation
 * - 3D tilt transforms based on pointer position
 * - Inner shine layer rendering
 *
 * Each instance is cached in LiquidGlass.instances for lifecycle management.
 */
export class LiquidGlassSurface {
  private readonly el: HTMLElement;
  private jsOptions: LiquidGlassOptions;
  private _af: number | null;
  private lastTime: number;
  private opts!: Required<
    Omit<LiquidGlassOptions, "enableOrb" | "orbColor" | "enableMobileSupport">
  >;
  private sp: {
    tiltX: Spring;
    tiltY: Spring;
    lightX: Spring;
    lightY: Spring;
    contentX: Spring;
    contentY: Spring;
    shadowY: Spring;
    shadowBlur: Spring;
    shadowA: Spring;
    refrScale: Spring;
    transX: Spring;
    transY: Spring;
  };
  private _inner?: HTMLDivElement;
  private _filter?: FilterCacheResult;
  private _resizeObserver?: ResizeObserver;
  private _lastW?: number;
  private _lastH?: number;

  /**
   * Create and initialize a glass surface on an element
   * @param el DOM element to apply effect to
   * @param jsOptions Configuration options (will be merged with CSS variables)
   */
  constructor(
    el: HTMLElement,
    jsOptions: LiquidGlassOptions = {
      backdrop: {
        blur: undefined,
        saturation: undefined,
        brightness: undefined,
        reducedMotion: undefined,
      },
    }
  ) {
    this.el = el;
    this.jsOptions = jsOptions;
    this._af = null;
    this.lastTime = performance.now();

    this.syncCssVariables();

    // Scale animation speeds based on reduced-motion preference
    const motionScale = this.opts.reducedMotion ? 50 : 1;
    this.sp = {
      tiltX: new Spring(0, 280 / motionScale, 22),
      tiltY: new Spring(0, 280 / motionScale, 22),
      transX: new Spring(0, 250 / motionScale, 24),
      transY: new Spring(0, 250 / motionScale, 24),
      lightX: new Spring(50, 300 / motionScale, 26),
      lightY: new Spring(-20, 300 / motionScale, 26),
      contentX: new Spring(0, 10 / motionScale, 24),
      contentY: new Spring(0, 20 / motionScale, 24),
      shadowY: new Spring(4, 380 / motionScale, 26),
      shadowBlur: new Spring(12, 380 / motionScale, 26),
      shadowA: new Spring(0.12, 200 / motionScale, 18),
      refrScale: new Spring(1, 380 / motionScale, 26),
    };

    this._setupResizeObserver();
    this._initAsync();
  }

  /**
   * Sync configuration from CSS variables and options
   *
   * Reads CSS custom properties (--lg-*) first, falling back to JS options,
   * then to built-in defaults. Allows runtime customization via CSS.
   */
  syncCssVariables() {
    this.opts = {
      refractiveIndex: MathUtils.getCssVar(
        this.el,
        "--lg-refractive-index",
        this.jsOptions.refractiveIndex || 1.6
      ),
      glassThickness: MathUtils.getCssVar(
        this.el,
        "--lg-glass-thickness",
        this.jsOptions.glassThickness || 120
      ),
      bezelWidth: MathUtils.getCssVar(
        this.el,
        "--lg-bezel-width",
        this.jsOptions.bezelWidth || 28
      ),
      refractionScale: MathUtils.getCssVar(
        this.el,
        "--lg-refraction-scale",
        this.jsOptions.refractionScale || 1.2
      ),
      specularAlpha: MathUtils.getCssVar(
        this.el,
        "--lg-specular-alpha",
        this.jsOptions.specularAlpha || 0.75
      ),
      maxTilt: MathUtils.getCssVar(
        this.el,
        "--lg-max-tilt",
        this.jsOptions.maxTilt || 7
      ),
      reducedMotion:
        this.jsOptions.reducedMotion ??
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      aberration: MathUtils.getCssVar(
        this.el,
        "--lg-aberration",
        this.jsOptions.aberration ?? 0.05
      ),
      magneticPull: MathUtils.getCssVar(
        this.el,
        "--lg-magnetic-pull",
        this.jsOptions.magneticPull ?? 15
      ),
      backdrop: {
        blur: MathUtils.getCssVar(
          this.el,
          "--lg-blur",
          this.jsOptions.backdrop?.blur ?? 6
        ),
        saturation: MathUtils.getCssVar(
          this.el,
          "--lg-saturation",
          this.jsOptions.backdrop?.saturation ?? 1.35
        ),
        brightness: MathUtils.getCssVar(
          this.el,
          "--lg-brightness",
          this.jsOptions.backdrop?.brightness ?? 1.0
        ),
      },
    };
  }

  /**
   * Async initialization: build filter and layer
   * Called after constructor to allow async filter building
   */
  async _initAsync() {
    this._filter = await buildGlassFilterAsync(this.el, this.opts);
    this._buildInner();
    this.el.style.transformStyle = "preserve-3d";
    this.el.style.willChange = "transform";
    const bf = `url(#${this._filter.id})`;
    this.el.style.backdropFilter = bf;
    this.el.style.setProperty("-webkit-backdrop-filter", bf);
  }

  /**
   * Build the inner shine layer (gradient + shadow)
   * Adds a decorative overlay that enhances the glass appearance
   */
  private _buildInner() {
    if (this.el.querySelector(".liquid-glass-inner")) return;
    const d = document.createElement("div");
    d.className = "liquid-glass-inner";
    d.setAttribute("aria-hidden", "true");
    Object.assign(d.style, {
      position: "absolute",
      inset: "0",
      borderRadius: "inherit",
      pointerEvents: "none",
      zIndex: "2",
      background:
        "radial-gradient(circle at var(--lg-spot-x, 50%) var(--lg-spot-y, -20%), rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 20%, transparent 80%)",
      boxShadow:
        "inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(0,0,0,0.10)",
      mixBlendMode: "color-dodge",
    });
    this.el.appendChild(d);
    this._inner = d;
  }

  /**
   * Set up resize observer to rebuild filter when element size changes
   */
  private _setupResizeObserver() {
    this._resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (
          this._lastW !== entry.contentRect.width ||
          this._lastH !== entry.contentRect.height
        ) {
          if (this._lastW !== undefined) this._rebuild();
          this._lastW = entry.contentRect.width;
          this._lastH = entry.contentRect.height;
        }
      }
    });
    this._resizeObserver.observe(this.el);
  }

  /**
   * Rebuild the filter when element is resized
   * Regenerates displacement and specular maps for new dimensions
   */
  async _rebuild() {
    this.syncCssVariables();
    this._filter = await buildGlassFilterAsync(this.el, this.opts);
    const bf = `url(#${this._filter.id})`;
    this.el.style.backdropFilter = bf;
    this.el.style.setProperty("--lg-backdrop-filter", bf);
  }

  /**
   * Aim the glass effect toward a point
   *
   * Sets spring targets for 3D tilt, shadow, and refraction intensity.
   * Normalized coordinates: (-1, -1) = top-left, (1, 1) = bottom-right
   *
   * @param nx Normalized X position (-1 to 1)
   * @param ny Normalized Y position (-1 to 1)
   */
  aim(nx: number, ny: number) {
    this.syncCssVariables();

    // Reduced motion mode: apply changes instantly
    if (this.opts.reducedMotion) {
      this.el.style.transform = `perspective(900px) translate3d(${
        nx * this.opts.magneticPull
      }px, ${ny * this.opts.magneticPull}px, 0) rotateX(${
        ny * -this.opts.maxTilt
      }deg) rotateY(${nx * this.opts.maxTilt}deg)`;
      const sy = 12 + Math.abs(ny) * 14,
        sb = 18 + Math.abs(ny) * 22,
        sa = 0.18 + Math.abs(ny) * 0.14;
      this.el.style.boxShadow = `0 ${sy}px ${sb}px rgba(0,0,0,${sa})`;
      if (this._filter?.mapElG) {
        if (this._filter?.mapElG) {
          const baseScale =
            this._filter.maxDisp *
            this.opts.refractionScale *
            (1 + Math.sqrt(nx * nx + ny * ny) * 0.22);
          this._filter.mapElR?.setAttribute(
            "scale",
            (baseScale * (1 - this.opts.aberration)).toString()
          );
          this._filter.mapElG?.setAttribute("scale", baseScale.toString());
          this._filter.mapElB?.setAttribute(
            "scale",
            (baseScale * (1 + this.opts.aberration)).toString()
          );
        }
      }
      return;
    }

    // Set spring targets for smooth animation
    this.sp.tiltX.setTarget(ny * -this.opts.maxTilt);
    this.sp.tiltY.setTarget(nx * this.opts.maxTilt);
    this.sp.transX.setTarget(nx * this.opts.magneticPull);
    this.sp.transY.setTarget(ny * this.opts.magneticPull);
    this.sp.contentX.setTarget(-nx * 5);
    this.sp.contentY.setTarget(-ny * 5);
    this.sp.lightX.setTarget(50 + nx * 60);
    this.sp.lightY.setTarget(50 + ny * 60);
    this.sp.shadowY.setTarget(12 + Math.abs(ny) * 14);
    this.sp.shadowBlur.setTarget(18 + Math.abs(ny) * 22);
    this.sp.shadowA.setTarget(0.18 + Math.abs(ny) * 0.14);
    this.sp.refrScale.setTarget(1 + Math.sqrt(nx * nx + ny * ny) * 0.22);
    this._kick();
  }

  /**
   * Reset the glass effect to rest position
   * Animate back to neutral tilt, default shadow, and normal refraction
   */
  rest() {
    if (this.opts.reducedMotion) {
      this.el.style.transform = `perspective(900px) translate3d(0px, 0px, 0) rotateX(0deg) rotateY(0deg)`;
      this.el.style.boxShadow = `0 4px 12px rgba(0,0,0,0.12)`;
      if (this._filter?.mapElG) {
        const baseScale = this._filter.maxDisp * this.opts.refractionScale;
        this._filter.mapElR?.setAttribute(
          "scale",
          (baseScale * (1 - this.opts.aberration)).toString()
        );
        this._filter.mapElG?.setAttribute("scale", baseScale.toString());
        this._filter.mapElB?.setAttribute(
          "scale",
          (baseScale * (1 + this.opts.aberration)).toString()
        );
      }
      return;
    }

    this.sp.tiltX.setTarget(0);
    this.sp.tiltY.setTarget(0);
    this.sp.transX.setTarget(0);
    this.sp.transY.setTarget(0);
    this.sp.lightX.setTarget(50);
    this.sp.lightY.setTarget(-20);
    this.sp.contentX.setTarget(0);
    this.sp.contentY.setTarget(0);
    this.sp.shadowY.setTarget(4);
    this.sp.shadowBlur.setTarget(12);
    this.sp.shadowA.setTarget(0.12);
    this.sp.refrScale.setTarget(1);
    this._kick();
  }

  /**
   * Start animation loop if not already running
   * Uses requestAnimationFrame for smooth 60fps updates
   */
  private _kick() {
    if (!this._af && this._filter) {
      this._af = requestAnimationFrame((ts) => this._loop(ts));
    }
  }

  /**
   * Animation frame loop: update all springs and apply to DOM
   * Implements the main update-and-render cycle
   */
  private _loop(ts?: number) {
    const now = ts || performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.032);
    this.lastTime = now;

    // Update all spring animations
    const rx = this.sp.tiltX.update(dt),
      ry = this.sp.tiltY.update(dt);
    const sy = this.sp.shadowY.update(dt),
      sb = this.sp.shadowBlur.update(dt),
      sa = this.sp.shadowA.update(dt);
    const rs = this.sp.refrScale.update(dt);

    // Apply 3D transforms
    const tx = this.sp.transX.update(dt);
    const ty = this.sp.transY.update(dt);

    const lx = this.sp.lightX.update(dt);
    const ly = this.sp.lightY.update(dt);

    const cx = this.sp.contentX.update(dt);
    const cy = this.sp.contentY.update(dt);

    this.el.style.transform = `perspective(900px) translate3d(${tx}px, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg)`;
    this.el.style.boxShadow = `0 ${sy}px ${sb}px rgba(0,0,0,${sa})`;

    if (this._inner) {
      this._inner.style.setProperty("--lg-spot-x", `${lx}%`);
      this._inner.style.setProperty("--lg-spot-y", `${ly}%`);
      this._inner.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
    }
    if (this._filter?.mapElG) {
      const baseScale = this._filter.maxDisp * this.opts.refractionScale * rs;

      // Keep the scale equal for all channels
      this._filter.mapElR?.setAttribute("scale", baseScale.toString());
      this._filter.mapElG?.setAttribute("scale", baseScale.toString());
      this._filter.mapElB?.setAttribute("scale", baseScale.toString());

      // We multiply it by 'rs' (refraction scale) so it gets slightly stronger on hover.
      const baseShift = 12 * this.opts.aberration * rs;

      // We still add a tiny fraction of the 3D tilt (ry, rx) so the light
      // feels like it bends with the mouse movement, but it won't disappear.
      const shiftX = baseShift + ry * this.opts.aberration * 0.3;
      const shiftY = baseShift + rx * this.opts.aberration * 0.3;

      this._filter.offsetR?.setAttribute("dx", shiftX.toString());
      this._filter.offsetR?.setAttribute("dy", shiftY.toString());

      this._filter.offsetB?.setAttribute("dx", (-shiftX).toString());
      this._filter.offsetB?.setAttribute("dy", (-shiftY).toString());
    }
    if (!Object.values(this.sp).every((s) => s.isSettled())) {
      this._af = requestAnimationFrame((ts) => this._loop(ts));
    } else {
      this._af = null;
    }
  }

  /**
   * Clean up and destroy this glass instance
   * Cancels animations, removes DOM changes, disconnects observers
   */
  destroy() {
    if (this._af) cancelAnimationFrame(this._af);
    if (this._resizeObserver) this._resizeObserver.disconnect();
    this._inner?.remove();
    this.el.style.backdropFilter = "";
    this.el.style.setProperty("--lg-backdrop-filter", "");
    this.el.style.transform = "";
    this.el.style.boxShadow = "";
  }
}
