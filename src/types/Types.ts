/**
 * Configuration options for LiquidGlass surfaces
 *
 * All properties are optional and will fall back to sensible defaults or CSS variables.
 */
export interface LiquidGlassOptions {
  /** Refractive index of the glass material (affects refraction intensity). Default: 1.6 */
  refractiveIndex?: number;

  /** Virtual glass thickness in pixels (affects displacement map). Default: 120 */
  glassThickness?: number;

  backdrop?: {
    /** Amount of background blur (stdDeviation for feGaussianBlur). Default: 0.6 */
    blur?: number;

    /** Color saturation multiplier (1 = normal, >1 = vibrant). Default: 1.35 */
    saturation?: number;

    /** Brightness multiplier (1 = normal, <1 = darker, >1 = brighter). Default: 1.0 */
    brightness?: number;

    /** Respect system prefers-reduced-motion setting. Default: false */
    reducedMotion?: boolean;
  };
  /** Width of the glass bezel/border in pixels. Default: 28 */
  bezelWidth?: number;

  /** Global scale multiplier for refraction intensity. Default: 1.2 */
  refractionScale?: number;

  /** Alpha (opacity) value for the specular highlight (0-1). Default: 0.75 */
  specularAlpha?: number;

  /** Maximum tilt angle in degrees when tilting based on pointer. Default: 7 */
  maxTilt?: number;

  /** Respect system prefers-reduced-motion setting. Default: false */
  reducedMotion?: boolean;

  /** Enable the ambient orb effects following the pointer. Default: true */
  enableOrb?: boolean;

  /** Color of the orb as an rgba() string. Default: 'rgba(120,130,255,.13)' */
  orbColor?: string;

  /** Enable mobile device orientation (gyroscope) support. Default: true */
  enableMobileSupport?: boolean;

  /** Intensity of the RGB split / Chromatic Aberration. Default: 0.05 */
  aberration?: number;
  /** Maximum distance in pixels the element will move towards the cursor. Default: 15 */
  magneticPull?: number;
}

/**
 * Internal result of a built/cached glass filter
 * Used to track SVG filter elements and their properties
 */
export interface FilterCacheResult {
  /** Unique ID of the SVG filter element */
  id: string;

  /** Maximum displacement magnitude from the displacement map */
  maxDisp: number;

  /** Reference to the feDisplacementMap element for runtime scale updates */
  mapElR: SVGFEDisplacementMapElement | null;
  mapElG: SVGFEDisplacementMapElement | null;
  mapElB: SVGFEDisplacementMapElement | null;

  offsetR: SVGFEOffsetElement | null;
  offsetB: SVGFEOffsetElement | null;

  /** Reference to the SVG element containing the filter definition */
  svg: SVGSVGElement;
}


export interface RippleOptions {
  /**
   * Colour of the main radial fill expanding from the origin.
   * Accepts any CSS colour string.
   * Default: 'rgba(255, 255, 255, 0.28)'
   */
  color?: string;

  /**
   * Colour of the bright refraction ring that races ahead of the fill.
   * This is the "edge of the pressure wave" — should be lighter/more opaque
   * than `color`. Default: 'rgba(255, 255, 255, 0.70)'
   */
  ringColor?: string;

  /**
   * Whether to show a sharp specular flash at the exact click point
   * at t=0, simulating the impact moment before the wave expands.
   * Default: true
   */
  originFlash?: boolean;

  /**
   * Colour of the origin flash. Default: 'rgba(255, 255, 255, 0.90)'
   */
  originFlashColor?: string;

  /**
   * How large the ripple grows relative to the element's longest dimension.
   * 2.0 = fills the element exactly, 3.0 = overflows the edges.
   * Default: 2.8
   */
  sizeMultiplier?: number;

  /**
   * Total animation duration in milliseconds. Default: 900
   */
  durationMs?: number;

  /**
   * CSS mix-blend-mode applied to the ripple layer.
   * 'screen' adds light — correct for glass. 'normal' composites flatly.
   * Default: 'screen'
   */
  blendMode?: string;

  /**
   * Whether to render a thin chromatic aberration ring just outside
   * the main wave front — a faint red/blue split matching the library's
   * glass surfaces. Default: true
   */
  aberration?: boolean;

  /**
   * Easing function for the expand animation.
   * Default: 'cubic-bezier(0.16, 1, 0.3, 1)'
   */
  easing?: string;

  /**
   * Starting opacity of the ripple fill. Default: 1
   */
  startOpacity?: number;

  /**
   * Ending opacity of the ripple fill. Default: 0
   */
  endOpacity?: number;

  /**
   * Called when the animation fully completes and all DOM nodes
   * have been cleaned up.
   */
  onComplete?: () => void;
}


/**
 * Configuration for LiquidGlassSlider.
 *
 * Glass physics params fall back to the same defaults as LiquidGlassOptions
 * so sliders feel visually consistent with hover surfaces out of the box.
 */
export interface SliderOptions {
  // ── Glass optics ────────────────────────────────────────────────────────
  /** Refractive index. Default: 1.45 */
  refractiveIndex?: number;
  /** Virtual glass slab depth in px. Default: 80 */
  glassThickness?: number;
  /** Rim transition width in px. Default: 16 */
  bezelWidth?: number;
  /** Global refraction multiplier. Default: 1.2 */
  refractionScale?: number;
  /** Specular highlight opacity 0–1. Default: 0.4 */
  specularAlpha?: number;

  // ── Track geometry ───────────────────────────────────────────────────────
  /** Track total width in px. Default: 330 */
  trackWidth?: number;
  /** Track height in px. Default: 18 */
  trackHeight?: number;
  /** Track fill colour (any CSS gradient or colour). Default: linear-gradient(90deg,#3b82f6,#60a5fa) */
  trackFill?: string;
  /** Track background colour. Default: rgba(255,255,255,0.05) */
  trackBackground?: string;

  // ── Thumb geometry ───────────────────────────────────────────────────────
  /** Thumb width in px. Default: 90 */
  thumbWidth?: number;
  /** Thumb height in px. Default: 60 */
  thumbHeight?: number;
  /** Thumb corner radius in px. Default: 30 */
  thumbRadius?: number;

  // ── Press behaviour ──────────────────────────────────────────────────────
  /** Scale the thumb springs to on press (squish). Default: 0.6 */
  pressScale?: number;

  // ── Initial value ────────────────────────────────────────────────────────
  /** Starting value 0–100. Default: 10 */
  value?: number;

  // ── Value label ──────────────────────────────────────────────────────────
  /**
   * Where to render the live value readout relative to the track.
   * Omit to show no label.
   */
  labelPosition?: "top" | "bottom" | "left" | "right";
  /**
   * When true and labelPosition is 'top' or 'bottom', the label
   * follows the thumb horizontally as it slides — like a tooltip.
   * When false (default) the label stays fixed at the container edge.
   */
  labelSticky?: boolean;
  /**
   * How many decimal places to show. Default: 0 (whole numbers).
   * Set to 1 or 2 for fractional display.
   */
  labelDecimals?: number;
  /** CSS for the label text. Default: '13px/1 Inter,sans-serif' */
  labelFont?: string;
  /** Label text colour. Default: 'rgba(255,255,255,0.8)' */
  labelColor?: string;
  /** Gap between label and track/thumb in px. Default: 10 */
  labelGap?: number;
  /**
   * Optional formatter — receives the raw value and returns the
   * string to display. Overrides labelDecimals when provided.
   * @example  formatter: v => `${Math.round(v)}%`
   */
  labelFormatter?: (value: number) => string;

  // ── Callbacks ────────────────────────────────────────────────────────────
  /** Called every frame while dragging with the live value 0–100. */
  onChange?: (value: number) => void;
  /** Called once on pointerup with the final committed value. */
  onCommit?: (value: number) => void;
}

/**
 * Configuration for LiquidGlassSwitch.
 */
export interface SwitchOptions {
  // ── Glass optics ────────────────────────────────────────────────────────
  /** Default: 1.5 */
  refractiveIndex: number;
  /** Default: 47 */
  glassThickness: number;
  /** Default: 19 */
  bezelWidth: number;
  /** Default: 1.2 */
  refractionScale: number;
  /** Default: 0.5 */
  specularAlpha: number;

  // ── Track geometry ───────────────────────────────────────────────────────
  /** Track outer width in px. Default: 160 */
  trackWidth: number;
  /** Track outer height in px. Default: 67 */
  trackHeight: number;

  // ── Thumb geometry ───────────────────────────────────────────────────────
  /** Thumb width in px. Default: 146 */
  thumbWidth: number;
  /** Thumb height in px. Default: 92 */
  thumbHeight: number;
  /** Thumb corner radius in px. Default: 46 */
  thumbRadius: number;

  /**
   * [R, G, B, A] for the OFF track tint.
   * Default: [255, 255, 255, 0.05]
   */
  colorOff: [number, number, number, number];
  /**
   * [R, G, B, A] for the ON track tint rendered at variable alpha.
   * Default: [139, 92, 246, 0.5]
   */
  colorOn: [number, number, number, number];
  checked: boolean;
  /**
   * HTML string for the OFF-state icon rendered on the thumb.
   * Accepts any inline HTML: SVG markup, a Font Awesome <i> tag,
   * a Lucide <svg>, an emoji, plain text, etc.
   *
   * @example '<i class="fa-solid fa-moon"></i>'
   * @example '<svg viewBox="0 0 24 24">…</svg>'
   */
  iconOff: string;
  /**
   * HTML string for the ON-state icon rendered on the thumb.
   * Same format as iconOff.
   *
   * @example '<i class="fa-solid fa-sun"></i>'
   */
  iconOn: string;
  iconColorOff: string;
  iconColorOn: string;
  /** Size of the icon in px. Applied as font-size (works for both font icons and SVGs via em). */
  iconSize: number;
  // ── Callbacks ────────────────────────────────────────────────────────────
  /** Fired when the switch commits to a new checked state on release. */
  onChange: (checked: boolean) => void;
}

// ---------- Effect------------------//
/**
 * Options for LiquidGlass.addShatter()
 */
export interface ShatterOptions {
  /**
   * Number of shards to break the element into.
   * More shards = finer, more intricate fracture pattern.
   * Diminishing returns above ~20; DOM cost scales linearly.
   * Default: 12
   */
  shardCount?: number;

  /**
   * Controls whether the shards fly outward (scattered) or
   * crumble in-place (not scattered).
   *
   * - `true`  (default) — each shard launches with a velocity vector
   *   pointing away from the impact point, decelerates under damping,
   *   and drifts downward under gravity. Ideal for dramatic destruction.
   *
   * - `false` — shards stay roughly where they are. They rotate slightly,
   *   scale down a fraction, then fade. Ideal for a subtle "crumble"
   *   effects where you don't want shards leaving the element's footprint.
   *
   * Default: true
   */
  scattered?: boolean;

  /**
   * Initial launch speed in px/s for each shard (scattered mode only).
   * Each shard gets a randomised fraction of this value so they don't
   * all travel the same distance. Default: 480
   */
  velocity?: number;

  /**
   * Downward acceleration in px/s² (scattered mode only).
   * 0 = no gravity, shards fly in straight lines.
   * Default: 900
   */
  gravity?: number;

  /**
   * Spring damping applied to each shard's translation springs.
   * Higher = shards decelerate faster, less overshoot.
   * Default: 14
   */
  damping?: number;

  /**
   * Maximum rotation applied to each shard in degrees.
   * Each shard gets a random value in [-spinMax, +spinMax].
   * Default: 55
   */
  spinMax?: number;

  /**
   * Point of impact (relative to the element's top-left corner)
   * from which the fracture pattern radiates and shards launch.
   * If omitted, defaults to the element's centre.
   * @example { x: 20, y: 30 }  // near top-left corner
   */
  origin?: { x: number; y: number };

  /**
   * Duration in ms each shard waits after the physics animation
   * settles before beginning its fade-out.
   * Staggered per-shard by +0..30ms so they don't all vanish at once.
   * Default: 320
   */
  fadeDelay?: number;

  /**
   * Duration of each shard's opacity fade-out in ms. Default: 380
   */
  fadeDuration?: number;

  /**
   * Whether to paint a refraction-edge shimmer on each shard's
   * cut edges, simulating the way broken glass catches light.
   * Implemented as a thin inset box-shadow on each shard div.
   * Default: true
   */
  edgeShimmer?: boolean;

  /**
   * CSS colour of the edge shimmer. Default: 'rgba(255,255,255,0.55)'
   */
  edgeShimmerColor?: string;

  /**
   * Whether to hide the original element immediately before shattering.
   * Set to false if you want to handle element removal yourself.
   * Default: true
   */
  hideOrigin?: boolean;

  /**
   * Easing function for the physics animation (CSS easing string).
   * Applied to the Web Animations API keyframe, not spring-driven motion.
   * The spring drives position; this easing is applied to the CSS filter
   * brightness pulse that flashes on impact.
   * Default: 'cubic-bezier(0.16, 1, 0.3, 1)'
   */
  easing?: string;

  /**
   * Callback fired once all shards have faded out and been removed.
   */
  onComplete?: () => void;
}