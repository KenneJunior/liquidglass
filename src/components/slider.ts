/**
 * LiquidGlassSlider  — Refined
 *
 * Physics-driven glass slider thumb with spring animations,
 * odometer digit roll, and dual render path (backdrop-filter / clone-world).
 */

import type {
  SliderOptions,
  FilterCacheResult,
  LiquidGlassOptions,
} from "../types/Types.ts";
import { Spring } from "../utils/utils.ts";
import { buildGlassFilterAsync } from "./filters.ts";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/** Spring that drives the thumb scale squish on press. k=2000 d=80 matches demo.html */
const SP_SCALE = [2000, 80] as const;
const SP_BRIGHTNESS = [2000, 80] as const;
const SP_REFR = [100, 10] as const;

/** Digit roll animation — 240ms spring ease matches the library's motion language */
const DRUM_DUR = 240;
const DRUM_EASE = "cubic-bezier(0.16,1,0.3,1)";

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Applies a map of CSS property/value pairs to an element's style.
 * Centralises all inline-style writes so they are easy to audit.
 */
function css(el: HTMLElement, props: Partial<CSSStyleDeclaration>): void {
  Object.assign(el.style, props);
}

/**
 * Determines the correct roll direction for a single character transition.
 *
 * Rules:
 *  • If both chars are digits, compare their numeric values.
 *    Special case: 9→0 with overall direction +1 is still a forward roll (upward exit).
 *  • For non-digit chars (decimal point, minus), fall back to the global direction.
 */
function charDirection(
  newChar: string,
  oldChar: string,
  globalDir: number
): number {
  const n = parseInt(newChar, 10);
  const o = parseInt(oldChar, 10);
  if (!isNaN(n) && !isNaN(o)) {
    if (n === o) return 0;
    // Wrap-around: 9→0 with globalDir>0 is forward; 0→9 with globalDir<0 is backward
    if (globalDir > 0 && o === 9 && n === 0) return 1;
    if (globalDir < 0 && o === 0 && n === 9) return -1;
    return n > o ? 1 : -1;
  }
  return globalDir;
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDER CLASS
// ─────────────────────────────────────────────────────────────────────────────

export class LiquidGlassSlider {
  // ── Config ───────────────────────────────────────────────────────────────
  private readonly cfg: Required<SliderOptions>;

  // ── State ─────────────────────────────────────────────────────────────────
  private value: number;
  private isPressed = false;
  private isDestroyed = false; // guards async _buildFilter callback

  // ── Springs ───────────────────────────────────────────────────────────────
  private spScale: Spring;
  private spBrightness: Spring;
  private spRefr: Spring;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  private track!: HTMLElement;
  private fill!: HTMLElement;
  private thumb!: HTMLElement;
  private thumbInner!: HTMLElement;
  private cloneInner!: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private digitsEl: HTMLElement | null = null;

  // ── Filter ────────────────────────────────────────────────────────────────
  private filter?: FilterCacheResult;
  private filterId?: string;
  private maxDisp = 0;
  private rafId: number | null = null;

  // ── Digit roll state ──────────────────────────────────────────────────────
  private prevDisplayText = "";

  // ── Feature detection ─────────────────────────────────────────────────────
  private static _useBackdrop: boolean | null = null;
  private static get useBackdrop(): boolean {
    if (this._useBackdrop === null) {
      const t = document.createElement("div");
      t.style.backdropFilter = "url(#test)";
      this._useBackdrop =
        !!(window as any).chrome && t.style.backdropFilter.includes("url");
    }
    return this._useBackdrop;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CONSTRUCTOR
  // ─────────────────────────────────────────────────────────────────────────

  constructor(
    private readonly container: HTMLElement,
    options: SliderOptions = {}
  ) {
    this.cfg = {
      refractiveIndex: options.refractiveIndex ?? 1.45,
      glassThickness: options.glassThickness ?? 80,
      bezelWidth: options.bezelWidth ?? 16,
      refractionScale: options.refractionScale ?? 1.2,
      specularAlpha: options.specularAlpha ?? 0.4,
      trackWidth: options.trackWidth ?? 330,
      trackHeight: options.trackHeight ?? 18,
      trackFill: options.trackFill ?? "linear-gradient(90deg,#3b82f6,#60a5fa)",
      trackBackground: options.trackBackground ?? "rgba(255,255,255,0.05)",
      thumbWidth: options.thumbWidth ?? 90,
      thumbHeight: options.thumbHeight ?? 60,
      thumbRadius: options.thumbRadius ?? 30,
      pressScale: options.pressScale ?? 1,
      value: options.value ?? 10,
      labelPosition: options.labelPosition ?? undefined!,
      labelSticky: options.labelSticky ?? false,
      labelDecimals: options.labelDecimals ?? 0,
      labelFont: options.labelFont ?? "600 13px/1 Inter,sans-serif",
      labelColor: options.labelColor ?? "rgba(255,255,255,0.8)",
      labelGap: options.labelGap ?? 10,
      labelFormatter: options.labelFormatter ?? undefined!,
      onChange: options.onChange ?? (() => {}),
      onCommit: options.onCommit ?? (() => {}),
    };
    this.value = this.cfg.value;

    // Springs start at their resting values so there is no entry animation
    const restScale = this.cfg.thumbHeight / this.cfg.thumbWidth;
    this.spScale = new Spring(restScale, ...SP_SCALE);
    this.spBrightness = new Spring(1, ...SP_BRIGHTNESS);
    this.spRefr = new Spring(0.4, ...SP_REFR);

    this._buildDOM();
    this._buildFilter(); // async — upgrades visually once resolved
    this._bindEvents();
    this._updatePosition();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // § 1  DOM CONSTRUCTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Injects the slider's DOM into this.container.
   *
   * Layer order (bottom → top):
   *   1. .lg-slider-track              — filled progress bar
   *   2. .lg-slider-thumb              — white glass pill (positioning anchor)
   *      ├─ .lg-slider-thumb-clone     — clone-world background (non-Chrome path)
   *      │   └─ .lg-slider-thumb-clone-inner
   *      ├─ .lg-slider-thumb-inner     — receives backdrop-filter or CSS filter
   *      └─ <svg>                      — empty; replaced by _buildFilter()
   *   3. .lg-slider-label (optional)   — injected AFTER innerHTML so it is never wiped
   */
  private _buildDOM(): void {
    const {
      trackWidth,
      trackHeight,
      thumbWidth,
      thumbHeight,
      thumbRadius,
      trackFill,
      trackBackground,
    } = this.cfg;

    // Container sizing
    // Container must be at least as wide as thumbWidth so the thumb never clips.
    const containerW = Math.max(trackWidth, thumbWidth);
    const containerH = thumbHeight;

    css(this.container, {
      position: "relative",
      width: `${containerW}px`,
      height: `${containerH}px`,
      // Prevent host-page box-sizing from corrupting our pixel maths
      boxSizing: "content-box",
    });

    // Track is vertically centred inside the container
    const trackTop = (containerH - trackHeight) / 2;

    this.container.innerHTML = `
          <div class="lg-slider-track" style="
            position:absolute; box-sizing:border-box;
            width:${trackWidth}px; height:${trackHeight}px;
            left:0; top:${trackTop}px;
            background:${trackBackground};
            border-radius:${trackHeight / 2}px;
            box-shadow:inset 0 2px 4px rgba(0,0,0,0.5);
            pointer-events:none;
          ">
            <div class="lg-slider-track-inner" style="
              width:100%; height:100%;
              overflow:hidden; border-radius:inherit; box-sizing:border-box;
            ">
              <div class="lg-slider-fill" style="
                height:100%; width:${this.value}%;
                background:${trackFill};
                border-radius:inherit;
                box-shadow:0 0 10px rgba(59,130,246,0.5);
                transition:width 0.04s linear;
              "></div>
            </div>
          </div>

          <div class="lg-slider-thumb" style="
            position:absolute; box-sizing:border-box;
            width:${thumbWidth}px; height:${thumbHeight}px;
            top:0; left:0;
            border-radius:${thumbRadius}px;
            transform-origin:center center;
            cursor:grab;
            touch-action:none; user-select:none;
            background-color:rgba(255,255,255,1);
            box-shadow:
              0 4px 16px rgba(0,0,0,0.30),
              0 1px 3px  rgba(0,0,0,0.20),
              inset 0 1px 0 rgba(255,255,255,0.60);
            overflow:hidden;
            will-change:transform,background-color,left;
            z-index:10;
            isolation:isolate;
          ">
            <div class="lg-slider-thumb-clone" style="
              position:absolute; inset:0; box-sizing:border-box;
              overflow:hidden; border-radius:inherit;
              z-index:1; opacity:0; will-change:opacity;
              ${LiquidGlassSlider.useBackdrop ? "display:none;" : ""}
            ">
              <div class="lg-slider-thumb-clone-inner" style="
                position:absolute; top:0; left:0;
                pointer-events:none; box-sizing:border-box;
              "></div>
            </div>

            <div class="lg-slider-thumb-inner" style="
              position:absolute; inset:0; box-sizing:border-box;
              border-radius:inherit; z-index:3; pointer-events:none;
            "></div>

            <svg style="position:absolute;width:0;height:0;overflow:hidden;"
                 aria-hidden="true">
              <defs></defs>
            </svg>
          </div>`;

    // Cache refs
    this.track = this.container.querySelector(".lg-slider-track")!;
    this.fill = this.container.querySelector(".lg-slider-fill")!;
    this.thumb = this.container.querySelector(".lg-slider-thumb")!;
    this.thumbInner = this.container.querySelector(".lg-slider-thumb-inner")!;
    this.cloneInner = this.container.querySelector(
      ".lg-slider-thumb-clone-inner"
    )!;

    // Label injected separately — never wiped by innerHTML
    this._buildLabel();
  }

  /**
   * Builds the optional value label and digit-drum container.
   * Called after _buildDOM so it appends to the container rather
   * than being part of the innerHTML string (which would get wiped).
   */
  private _buildLabel(): void {
    const { labelPosition, labelGap, labelFont, labelColor } = this.cfg;
    if (!labelPosition) return;

    const label = document.createElement("div");
    label.className = "lg-slider-label";
    label.setAttribute("aria-live", "polite");
    label.setAttribute("aria-atomic", "true");

    // Positional styles — calculated per-side
    const baseStyle: Partial<CSSStyleDeclaration> = {
      position: "absolute",
      pointerEvents: "none",
      font: labelFont,
      color: labelColor,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      userSelect: "none",
      whiteSpace: "nowrap",
      zIndex: "20",
    };

    if (labelPosition === "top") {
      Object.assign(baseStyle, {
        bottom: `calc(100% + ${labelGap}px)`,
        left: "0",
        width: "100%",
      });
    } else if (labelPosition === "bottom") {
      Object.assign(baseStyle, {
        top: `calc(100% + ${labelGap}px)`,
        left: "0",
        width: "100%",
      });
    } else if (labelPosition === "left") {
      Object.assign(baseStyle, {
        right: `calc(100% + ${labelGap}px)`,
        top: "50%",
        transform: "translateY(-50%)",
      });
    } else if (labelPosition === "right") {
      Object.assign(baseStyle, {
        left: `calc(100% + ${labelGap}px)`,
        top: "50%",
        transform: "translateY(-50%)",
      });
    }
    css(label, baseStyle);

    // Digit drum container — overflow:hidden clips the rolling chars
    const digits = document.createElement("div");
    digits.className = "lg-slider-digits";
    css(digits, {
      display: "flex",
      alignItems: "center",
      overflow: "hidden",
      lineHeight: "1",
    });

    label.appendChild(digits);
    this.container.appendChild(label);

    this.labelEl = label;
    this.digitsEl = digits;

    // Seed with the initial value — no animation on first paint
    const initial = this._formatValue(this.value);
    this._rebuildDigitDrums(initial);
    this.prevDisplayText = initial;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // § 2  SVG FILTER
  // ─────────────────────────────────────────────────────────────────────────

  private async _buildFilter(): Promise<void> {
    const {
      thumbWidth: W,
      thumbHeight: H,
      thumbRadius: R,
      glassThickness,
      bezelWidth,
      refractiveIndex,
      refractionScale,
      specularAlpha,
    } = this.cfg;

    const opts = {
      glassThickness,
      bezelWidth,
      refractiveIndex,
      refractionScale,
      specularAlpha,
      backdrop: { blur: 0, saturation: 7, brightness: 1.0 },
      maxTilt: 0,
      reducedMotion: false,
      aberration: 0,
      magneticPull: 0,
    } as Required<
      Omit<LiquidGlassOptions, "enableOrb" | "orbColor" | "enableMobileSupport">
    >;

    // Fake element so buildGlassFilterAsync reads the thumb's exact dimensions
    const fakeEl = Object.assign(document.createElement("div"), {
      style: { borderRadius: `${R}px` },
      getBoundingClientRect: () => ({
        width: W,
        height: H,
        top: 0,
        left: 0,
        right: W,
        bottom: H,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      getAttribute: () => null,
    }) as unknown as HTMLElement;

    const result = await buildGlassFilterAsync(fakeEl, opts);

    // Guard: if destroy() was called while the filter was building, discard
    if (this.isDestroyed) {
      result.svg.remove();
      return;
    }

    this.filter = result;
    this.maxDisp = result.maxDisp;
    this.filterId = result.id;

    // Replace the empty <svg> placeholder inside the thumb
    const placeholder = this.thumb.querySelector("svg");
    if (placeholder) placeholder.replaceWith(result.svg);
    else this.thumb.appendChild(result.svg);

    // Wire the filter to the rendering path
    if (LiquidGlassSlider.useBackdrop) {
      const ref = `url(#${this.filterId})`;
      this.thumbInner.style.backdropFilter = ref;
      (this.thumbInner.style as any).webkitBackdropFilter = ref;
    } else {
      this.cloneInner.style.filter = `url(#${this.filterId})`;
      this.cloneInner.style.background = getComputedStyle(
        this.container.parentElement ?? document.body
      ).background;
    }

    this._kick();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // § 3  DIGIT DRUM ENGINE
  // ─────────────────────────────────────────────────────────────────────────

  /** Returns the display string for the current value. */
  private _formatValue(v: number): string {
    return this.cfg.labelFormatter
      ? this.cfg.labelFormatter(v)
      : v.toFixed(this.cfg.labelDecimals);
  }

  /**
   * Builds a fresh set of per-character drum cells from scratch.
   * Called on first render and whenever the number of characters changes
   * (e.g. 9 → 10, or 99 → 100).
   *
   * Each drum cell contains:
   *   .lg-ghost  — invisible spacer that gives the cell its natural width
   *   .lg-a      — slot A (one of the two alternating visible spans)
   *   .lg-b      — slot B
   *
   * The ghost span is the key to correct cell sizing: it always holds the
   * current character so the cell is exactly as wide as that character,
   * while .lg-a and .lg-b are absolutely positioned on top of it.
   */
  private _rebuildDigitDrums(text: string): void {
    if (!this.digitsEl) return;
    this.digitsEl.innerHTML = "";

    for (const char of text) {
      const drum = document.createElement("div");
      drum.className = "lg-digit-drum";
      drum.dataset.active = "a";

      css(drum, {
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden", // clips the rolling spans
        lineHeight: "1.2",
      });

      // Ghost: invisible, holds layout width, never animated
      const ghost = document.createElement("span");
      ghost.className = "lg-ghost";
      ghost.textContent = char;
      css(ghost, {
        visibility: "hidden",
        pointerEvents: "none",
        userSelect: "none",
        display: "block",
      });

      // Slot A — starts visible with the current character
      const spanA = document.createElement("span");
      spanA.className = "lg-a";
      spanA.textContent = char;
      css(spanA, {
        position: "absolute",
        width: "100%",
        textAlign: "center",
        top: "0",
        left: "0",
      });

      // Slot B — starts off-screen below (ready for upward entry)
      const spanB = document.createElement("span");
      spanB.className = "lg-b";
      css(spanB, {
        position: "absolute",
        width: "100%",
        textAlign: "center",
        top: "0",
        left: "0",
        opacity: "0",
        transform: "translateY(100%)",
      });

      drum.appendChild(ghost);
      drum.appendChild(spanA);
      drum.appendChild(spanB);
      this.digitsEl.appendChild(drum);
    }
  }

  /**
   * Diffs newText against oldText character by character and animates
   * only the drums whose character has actually changed.
   *
   * If the string length changes a full rebuild is cheaper and cleaner
   * than trying to add/remove individual drums with animations in flight.
   */
  private _updateDigits(
    newText: string,
    oldText: string,
    globalDir: number
  ): void {
    if (!this.digitsEl) return;

    // Length changed (e.g. 9→10) — rebuild all drums instantly then return
    if (newText.length !== oldText.length) {
      this._rebuildDigitDrums(newText);
      return;
    }

    const drums = this.digitsEl.querySelectorAll<HTMLElement>(".lg-digit-drum");

    for (let i = 0; i < newText.length; i++) {
      const nc = newText[i];
      const oc = oldText[i];
      if (nc === oc) continue; // no change — skip
      this._animateDrum(drums[i], nc, oc, globalDir);
    }
  }

  /**
   * Animates a single drum cell from oldChar → newChar.
   *
   * Uses per-character direction so a wrap-around (9→0 while value
   * is increasing) still rolls in the correct direction.
   *
   * The drum alternates between slot-A and slot-B each animation so
   * rapid updates never interrupt a settled state.
   */
  private _animateDrum(
    drum: HTMLElement,
    newChar: string,
    oldChar: string,
    globalDir: number
  ): void {
    const dir = charDirection(newChar, oldChar, globalDir);
    const ghost = drum.querySelector<HTMLElement>(".lg-ghost")!;
    const spanA = drum.querySelector<HTMLElement>(".lg-a")!;
    const spanB = drum.querySelector<HTMLElement>(".lg-b")!;
    const isALive = (drum.dataset.active ?? "a") === "a";
    const incoming = isALive ? spanB : spanA;
    const outgoing = isALive ? spanA : spanB;

    // Update ghost so the cell width matches the new character
    ghost.textContent = newChar;

    // Position incoming off-screen in the entry direction
    const inStart = dir >= 0 ? "100%" : "-100%";
    const outEnd = dir >= 0 ? "-100%" : "100%";

    // Cut incoming to start position without transition
    incoming.style.transition = "none";
    incoming.style.transform = `translateY(${inStart})`;
    incoming.style.opacity = "0";
    incoming.textContent = newChar;

    // Force layout so the browser registers the start state
    void incoming.offsetWidth;

    const transition = `transform ${DRUM_DUR}ms ${DRUM_EASE}, opacity ${
      DRUM_DUR * 0.5
    }ms ease`;
    incoming.style.transition = transition;
    incoming.style.transform = "translateY(0)";
    incoming.style.opacity = "1";

    outgoing.style.transition = transition;
    outgoing.style.transform = `translateY(${outEnd})`;
    outgoing.style.opacity = "0";

    // Swap active slot
    drum.dataset.active = isALive ? "b" : "a";
  }

  // ─────────────────────────────────────────────────────────────────────────
  // § 4  POSITION + LABEL UPDATE
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Repositions the thumb and fill bar for the current value.
   * Also handles:
   *   • Sticky label following the thumb (top/bottom positions only)
   *   • Triggering the digit drum when the formatted text changes
   *   • Repositioning the clone-world inner (non-backdrop-filter path)
   */
  private _updatePosition(): void {
    const {
      trackWidth,
      thumbWidth,
      thumbHeight,
      trackHeight,
      labelPosition,
      labelSticky,
    } = this.cfg;

    // ── Thumb X ──────────────────────────────────────────────────────────
    // The thumb is scaled by restScale via transform:scale(), so its
    // visual width is thumbWidth * restScale. The usable travel distance
    // is trackWidth - scaledThumbWidth; the thumb centre maps linearly.
    const restScale = thumbHeight / thumbWidth;
    const scaledW = thumbWidth * restScale;
    const usableW = trackWidth - scaledW;
    const tx = scaledW / 2 + (this.value / 100) * usableW - thumbWidth / 2;

    this.thumb.style.left = `${tx}px`;
    this.fill.style.width = `${this.value}%`;

    this.cfg.onChange(this.value);

    // ── Sticky label ──────────────────────────────────────────────────────
    if (
      this.labelEl &&
      labelSticky &&
      (labelPosition === "top" || labelPosition === "bottom")
    ) {
      // Centre the label's midpoint over the thumb centre
      const thumbCentreX = tx + thumbWidth / 2;
      this.labelEl.style.width = "auto";
      this.labelEl.style.left = `${thumbCentreX}px`;
      this.labelEl.style.transform = "translateX(-50%)";
    }

    // ── Digit drum ────────────────────────────────────────────────────────
    if (this.labelEl && this.digitsEl) {
      const newText = this._formatValue(this.value);
      const globalDir = this.value - parseFloat(this.prevDisplayText || "0");

      if (newText !== this.prevDisplayText) {
        this._updateDigits(newText, this.prevDisplayText, globalDir);
        this.prevDisplayText = newText;
      }
    }

    // ── Clone-world offset ────────────────────────────────────────────────
    if (!LiquidGlassSlider.useBackdrop) {
      const aR = this.container.getBoundingClientRect();
      const cl = (aR.width - trackWidth) / 2;
      const ct = (aR.height - thumbHeight) / 2;
      css(this.cloneInner, {
        width: `${aR.width}px`,
        height: `${aR.height}px`,
        transform: `translate(${-(cl + tx)}px, ${-ct}px)`,
      });
      this.cloneInner.style.setProperty("--lg-track-left", `${cl}px`);
      this.cloneInner.style.setProperty(
        "--lg-track-top",
        `${ct + (thumbHeight - trackHeight) / 2}px`
      );
      this.cloneInner.style.setProperty("--lg-fill-pct", `${this.value}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // § 5  SPRING LOOP
  // ─────────────────────────────────────────────────────────────────────────

  private _kick(): void {
    if (!this.rafId && !this.isDestroyed) {
      this.rafId = requestAnimationFrame(() => this._loop());
    }
  }

  private _loop(): void {
    const dt = Math.min(0.032, 1 / 60);
    const sc = this.spScale.update(dt);
    const bo = this.spBrightness.update(dt);
    const sr = this.spRefr.update(dt);

    // Scale + brightness applied directly on the thumb element
    this.thumb.style.transform = `scale(${sc})`;
    this.thumb.style.backgroundColor = `rgba(255,255,255,${bo.toFixed(3)})`;

    // Clone opacity is the inverse of the thumb's white fill:
    // 0 brightness → fully glass → clone fully visible
    const cloneEl = this.thumb.querySelector<HTMLElement>(
      ".lg-slider-thumb-clone"
    );
    if (cloneEl) cloneEl.style.opacity = (1 - bo).toFixed(3);

    // Dynamic refraction scale — glass bends more when pressed
    if (this.filter) {
      const scale = (this.maxDisp * this.cfg.refractionScale * sr).toFixed(3);
      this.filter.mapElR?.setAttribute("scale", scale);
      this.filter.mapElG?.setAttribute("scale", scale);
      this.filter.mapElB?.setAttribute("scale", scale);
    }

    const settled =
      this.spScale.isSettled() &&
      this.spBrightness.isSettled() &&
      this.spRefr.isSettled();

    this.rafId =
      settled || this.isDestroyed
        ? null
        : requestAnimationFrame(() => this._loop());
  }

  // ─────────────────────────────────────────────────────────────────────────
  // § 6  POINTER EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  private _bindEvents(): void {
    const { trackWidth, thumbWidth, thumbHeight } = this.cfg;
    const restScale = thumbHeight / thumbWidth;
    const pressScale = this.cfg.pressScale;

    // ── Down ─────────────────────────────────────────────────────────────
    const onDown = (_clientX: number) => {
      if (this.isDestroyed) return;
      this.isPressed = true;
      this.thumb.style.cursor = "grabbing";
      this.spScale.setTarget(pressScale);
      this.spBrightness.setTarget(0.08);
      this.spRefr.setTarget(0.9);
      this._kick();
    };

    // ── Move ─────────────────────────────────────────────────────────────
    const onMove = (clientX: number) => {
      if (!this.isPressed || this.isDestroyed) return;
      const scaledW = thumbWidth * restScale;
      const trackRect = this.track.getBoundingClientRect();
      const x0 = trackRect.left + scaledW / 2;
      const usableW = trackWidth - scaledW;
      const clamped = Math.max(x0, Math.min(x0 + usableW, clientX));
      this.value = ((clamped - x0) / usableW) * 100;
      this._updatePosition();
    };

    // ── Up ───────────────────────────────────────────────────────────────
    const onUp = () => {
      if (!this.isPressed || this.isDestroyed) return;
      this.isPressed = false;
      this.thumb.style.cursor = "grab";
      this.spScale.setTarget(restScale);
      this.spBrightness.setTarget(1);
      this.spRefr.setTarget(0.4);
      this.cfg.onCommit(this.value);
      this._kick();
    };

    // Pointer events — capture on thumb, global move/up
    this.thumb.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.thumb.setPointerCapture(e.pointerId);
      onDown(e.clientX);
    });
    this.thumb.addEventListener("pointermove", (e) => onMove(e.clientX));
    this.thumb.addEventListener("pointerup", () => onUp());
    this.thumb.addEventListener("pointercancel", () => onUp());

    window.addEventListener("resize", () => {
      if (!this.isDestroyed) this._updatePosition();
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // § 7  PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────

  /** Set value 0–100 programmatically. Does not trigger onCommit. */
  setValue(v: number): void {
    if (this.isDestroyed) return;
    this.value = Math.max(0, Math.min(100, v));
    this._updatePosition();
  }

  /** Read the current value. */
  getValue(): number {
    return this.value;
  }

  /** Tear down: cancel rAF, remove SVG filter, clear DOM. */
  destroy(): void {
    this.isDestroyed = true;
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.filter?.svg.remove();
    this.container.innerHTML = "";
  }
}
