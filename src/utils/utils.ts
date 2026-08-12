/**
 * Mathematical and Spring utility classes
 *
 * Contains:
 * - Spring: Physics-based spring animator for smooth animations
 * - MathUtils: Optical calculations, displacement maps, image processing
 */

/**
 * Physics-based spring animation utility
 *
 * Implements a damped spring oscillator that smoothly animates toward a target value.
 * Used for all tilt, shadow, and refraction animations to create natural, fluid motion.
 *
 * @example
 * const spring = new Spring(0, 300, 20); // value=0, stiffness=300, damping=20
 * spring.setTarget(10); // animate toward 10
 * let value = spring.update(0.016); // update with 16ms delta
 * while (!spring.isSettled()) {
 *   value = spring.update(0.016);
 * }
 */
export class Spring {
  private value: number;
  private target: number;
  private velocity: number;
  private readonly stiffness: number;
  private readonly damping: number;

  /**
   * Create a new spring animator
   * @param v Initial value
   * @param s Stiffness coefficient (higher = faster, less bouncy). Default: 300
   * @param d Damping coefficient (higher = less oscillation). Default: 20
   */
  constructor(v: number, s = 300, d = 20) {
    this.value = v;
    this.target = v;
    this.velocity = 0;
    this.stiffness = s;
    this.damping = d;
  }

  /**
   * Set the target value to animate toward
   * @param t New target value
   */
  setTarget(t: number): void {
    this.target = t;
  }

  public getTarget(): number {
    return this.target;
  }

  public getValue(): number {
    return this.value;
  }

  /**
   * Update the spring for a time step
   * @param dt Delta time in seconds (typically 0.016 for 60fps)
   * @return Current value after this frame
   */
  update(dt: number): number {
    const f: number = (this.target - this.value) * this.stiffness;
    const dmp: number = this.velocity * this.damping;
    this.velocity += (f - dmp) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  /**
   * Check if the spring has essentially stopped oscillating
   * @return True if value and velocity are both very close to 0
   */
  isSettled(): boolean {
    return (
      Math.abs(this.target - this.value) < 0.001 &&
      Math.abs(this.velocity) < 0.001
    );
  }
}

/**
 * Mathematical and optical utility functions
 *
 * Contains calculations for:
 * - Physics-based glass refraction using Snell's law
 * - 2D displacement maps for realistic glass edges
 * - Specular (shininess) highlights for glass reflection
 * - Image processing for mask-based effects
 * - CSS variable parsing and image loading
 *
 * These utilities handle all the optics calculations needed for the glass effect.
 */
export class MathUtils {
  /**
   * Clamp a value between min and max bounds
   * @param v Value to clamp
   * @param lo Lower bound (inclusive)
   * @param hi Upper bound (inclusive)
   * @return Clamped value
   */
  public static clamp(v: number, lo: number, hi: number): number {
    return Math.min(Math.max(v, lo), hi);
  }

  /**
   * Calculate a smooth surface profile curve
   * Used to shape the glass curvature from flat edges to rounded corners.
   * @param x Input from 0 to 1
   * @return Smoothly curved value from 0 to 1
   */
  public static surfaceProfile(x: number): number {
    return Math.pow(1 - Math.pow(1 - x, 4), 0.25);
  }

  /**
   * Retrieve a CSS custom property (--variable) value from an element
   * @param el Element to get the property from
   * @param prop CSS property name (e.g., '--lg-max-tilt')
   * @param fallback Default value if property not found or invalid
   * @return Parsed number value or fallback
   */
  public static getCssVar(
    el: HTMLElement,
    prop: string,
    fallback: number | boolean
  ): any {
    const val = getComputedStyle(el).getPropertyValue(prop).trim();
    return val !== "" ? parseFloat(val) : fallback;
  }

  /**
   * Intelligently parses border-radius to handle px, %, and massive capsule radii
   * ensuring math doesn't break for circles and pills.
   * @param el Element with border-radius style
   * @param width Element width in pixels
   * @param height Element height in pixels
   * @return Effective radius in pixels
   */
  public static parseRadius(
    el: HTMLElement,
    width: number,
    height: number
  ): number {
    const raw = getComputedStyle(el).borderRadius;
    let r = parseInt(raw) || 26;
    if (raw.includes("%")) {
      r = (r / 100) * Math.min(width, height);
    }
    return Math.min(r, Math.min(width, height) / 2);
  }

  /**
   * Load an image with CORS support for cross-origin images
   * @param src Image URL (http/https URLs get CORS enabled)
   * @return Promise resolving to the loaded HTMLImageElement
   */
  public static loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (src.startsWith("http")) img.crossOrigin = "Anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  /**
   * Calculate displacement map from a mask image's alpha channel
   *
   * Extracts normal vectors from alpha gradients to create a displacement map.
   * This allows custom mask shapes (via data-lg-mask attribute) to control
   * where the glass effect is applied and how it distorts.
   *
   * @param maskImg Loaded mask image
   * @param W Canvas width
   * @param H Canvas height
   * @param _bw Bezel width (for context)
   * @param maxD Maximum displacement magnitude for scaling
   * @return ImageData containing normalized displacement vectors (R=X, G=Y)
   */
  public static calculateDisplacementFromAlpha(
    maskImg: HTMLImageElement,
    W: number,
    H: number,
    _bw: number,
    maxD: number
  ): ImageData {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return new ImageData(W, H);

    // Draw the mask and extract pixel data
    ctx.drawImage(maskImg, 0, 0, W, H);
    const srcData = ctx.getImageData(0, 0, W, H).data;
    const outImg = new ImageData(W, H);
    const outData = outImg.data;

    // Initialize with neutral displacement (128 = no offset)
    for (let i = 0; i < outData.length; i += 4) {
      outData[i] = outData[i + 1] = 128;
      outData[i + 3] = 255;
    }

    // Calculate displacement from alpha gradients using Sobel-like edge detection
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const idx = (y * W + x) * 4;
        const alpha = srcData[idx + 3];

        if (alpha > 0) {
          // Sample neighbors
          const aTop = srcData[((y - 1) * W + x) * 4 + 3] || 0;
          const aBot = srcData[((y + 1) * W + x) * 4 + 3] || 0;
          const aLef = srcData[(y * W + (x - 1)) * 4 + 3] || 0;
          const aRig = srcData[(y * W + (x + 1)) * 4 + 3] || 0;

          // Compute gradients (normalized -1 to 1)
          const dX = (aLef - aRig) / 255;
          const dY = (aTop - aBot) / 255;

          // Encode as normalized displacement (127 = -1, 128 = 0, 255 = +1)
          outData[idx] = Math.max(
            0,
            Math.min(255, 128 + dX * 127 * (maxD || 1))
          );
          outData[idx + 1] = Math.max(
            0,
            Math.min(255, 128 + dY * 127 * (maxD || 1))
          );
        }
      }
    }
    return outImg;
  }

  /**
   * Calculate 1D refraction profile using Snell's law
   *
   * Computes how much light refracts at each point along the glass surface,
   * accounting for surface curvature, glass thickness, and refractive index.
   * Results are used to create the 2D displacement map.
   *
   * @param gt Glass thickness at peak
   * @param bw Bezel (edge transition) width
   * @param ri Refractive index of glass
   * @param samples Number of sample points. Default: 128
   * @return Float32Array of displacement values for contiguous memory mapping
   * */
  public static calculateDisplacementMap1D(
    gt: number,
    bw: number,
    ri: number,
    samples = 128
  ): Float32Array {
    const eta = 1 / ri;
    const etaSq = eta * eta;

    const result = new Float32Array(samples);
    const dxOffset = 0.0001;

    for (let i = 0; i < samples; i++) {
      const x = i / samples;
      const y = this.surfaceProfile(x);

      const xPlus = Math.min(1, x + dxOffset);
      const xMinus = Math.max(0, x - dxOffset);
      const actualDx = xPlus - xMinus;

      // Failsafe for zero-width delta (should only theoretically happen if samples = 1)
      if (actualDx <= 0) continue;

      const dy =
        (this.surfaceProfile(xPlus) - this.surfaceProfile(xMinus)) / actualDx;
      const dySq = dy * dy;

      // 3. Optimized Trigonometry
      // cos^2(i) is equivalent to ny^2 = 1 / (dy^2 + 1)
      const cosISq = 1 / (dySq + 1);

      // Apply Snell's law: k = 1 - eta^2 * sin^2(i)
      const k = 1 - etaSq * (1 - cosISq);

      // If k < 0, Total Internal Reflection occurs.
      // Float32Array defaults to 0, so we only compute if k >= 0.
      if (k >= 0) {
        const mag = Math.sqrt(dySq + 1);
        const nx = -dy / mag;
        const ny = -1 / mag; // This is cos(i)

        const sqrtk = Math.sqrt(k);
        const c = eta * ny + sqrtk;

        // Calculate refracted ray direction components
        const rf0 = -c * nx;
        const rf1 = eta - c * ny;

        // Project ray to the back of the glass layer
        if (rf1 !== 0) {
          result[i] = rf0 * ((y * bw + gt) / rf1);
        }
      }
    }

    return result;
  }

  /**
   * Calculate 2D displacement map for a rounded rectangle glass effect
   *
   * Creates a displacement map showing how much each pixel refracts,
   * accounting for the glass shape, curvature, and thickness profile.
   * Used as the primary displacement map for the SVG filter.
   *
   * @param cW Canvas/output width
   * @param cH Canvas/output height
   * @param oW Object (glass) width
   * @param oH Object (glass) height
   * @param rad Border radius (corner curvature)
   * @param bw Bezel width (edge transition zone)
   * @param maxD Maximum displacement magnitude
   * @param profile 1D displacement profile array
   * @return ImageData with displacement vectors (R=X, G=Y, both normalized)
   */
  public static calculateDisplacementMap2D(
    cW: number,
    cH: number,
    oW: number,
    oH: number,
    rad: number,
    bw: number,
    maxD: number,
    profile: Float32Array
  ): ImageData {
    const img = new ImageData(cW, cH);

    // 1. High-speed 32-bit memory initialization
    // 0xFF808080 represents A=255, B=128, G=128, R=128 (Neutral Vector)
    // This is magnitudes faster than iterating i+=4 through the Uint8ClampedArray
    const view32 = new Uint32Array(img.data.buffer);
    view32.fill(0xff808080);

    const data = img.data;

    // Precalculate geometric constants
    const rSq = rad * rad;
    const rp1Sq = (rad + 1) * (rad + 1);
    const rmBwSq = Math.max(0, rad - bw);
    const rmBwSq2 = rmBwSq * rmBwSq;

    const wB = oW - rad * 2;
    const hB = oH - rad * 2;
    const oX = (cW - oW) / 2;
    const oY = (cH - oH) / 2;
    const safeMaxD = maxD || 1;
    const profileLen = profile.length - 1;

    for (let y1 = 0; y1 < oH; y1++) {
      for (let x1 = 0; x1 < oW; x1++) {
        let cx = 0,
          cy = 0;

        // Distance from nearest corner/focal point
        if (x1 < rad) cx = x1 - rad;
        else if (x1 >= oW - rad) cx = x1 - rad - wB;

        if (y1 < rad) cy = y1 - rad;
        else if (y1 >= oH - rad) cy = y1 - rad - hB;

        const dSq = cx * cx + cy * cy;

        if (dSq <= rp1Sq && dSq >= rmBwSq2) {
          const dist = Math.sqrt(dSq);

          // 2. Algebraically reduced anti-aliasing
          const op = dSq < rSq ? 1 : 1 - (dist - rad);

          // 3. Linear Interpolation (Lerp) for sub-array precision
          const exactIdx =
            Math.max(0, Math.min(1, (rad - dist) / bw)) * profileLen;
          const idxLow = Math.floor(exactIdx);
          const idxHigh = Math.min(idxLow + 1, profileLen);
          const fraction = exactIdx - idxLow;

          const dVal =
            profile[idxLow] * (1 - fraction) + profile[idxHigh] * fraction;

          const distNorm = dist > 0 ? 1 / dist : 0;
          const dX = (-cx * distNorm * dVal) / safeMaxD;
          const dY = (-cy * distNorm * dVal) / safeMaxD;

          const idx = ((oY + y1) * cW + oX + x1) * 4;

          data[idx] = Math.max(0, Math.min(255, 128 + dX * 127 * op));
          data[idx + 1] = Math.max(0, Math.min(255, 128 + dY * 127 * op));
        }
      }
    }
    return img;
  }

  /**
   * Calculate specular (shine) highlight for glass reflection
   *
   * Creates a bright spot simulating light reflecting off the glass surface.
   * Positioned top-left with falloff toward bottom-right for a natural look.
   *
   * @param oW Object width
   * @param oH Object height
   * @param rad Border radius
   * @return ImageData with specular intensity (R=G=B=intensity, A=alpha)
   */
  public static calculateSpecularHighlight(
    oW: number,
    oH: number,
    rad: number
  ) {
    const img = new ImageData(oW, oH);
    const data = img.data;
    const light = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)]; // light direction
    const rSq = rad * rad,
      rp1Sq = (rad + 1) ** 2,
      rmSSq = Math.max(0, (rad - 1.5) ** 2);

    for (let y1 = 0; y1 < oH; y1++) {
      for (let x1 = 0; x1 < oW; x1++) {
        let cx = 0,
          cy = 0;

        // Distance from nearest corner
        if (x1 < rad) cx = x1 - rad;
        else if (x1 >= oW - rad) cx = x1 - rad - (oW - rad * 2);
        if (y1 < rad) cy = y1 - rad;
        else if (y1 >= oH - rad) cy = y1 - rad - (oH - rad * 2);

        const dSq = cx * cx + cy * cy;

        // Process only pixels near the edge
        if (dSq <= rp1Sq && dSq >= rmSSq) {
          const dist = Math.sqrt(dSq);
          const op =
            dSq < rSq ? 1 : 1 - (dist - rad) / (Math.sqrt(rp1Sq) - rad);

          // Dot product with light direction
          const dp = Math.abs(
            (dist > 0 ? cx / dist : 0) * light[0] +
              (dist > 0 ? -cy / dist : 0) * light[1]
          );
          const ef = Math.max(0, Math.min(1, (rad - dist) / 1.5));
          const cf = dp * Math.sqrt(1 - (1 - ef) ** 2);
          const c = Math.min(255, 255 * cf);

          const idx = (y1 * oW + x1) * 4;
          data[idx] = data[idx + 1] = data[idx + 2] = c;
          data[idx + 3] = Math.min(255, c * cf * op);
        }
      }
    }
    return img;
  }

  /**
   * Convert ImageData to a data URL (blob URL)
   * Useful for embedding canvas images in SVG filters
   * @param d ImageData to convert
   * @return Promise resolving to an object URL (blob:// path)
   */
  public static imageDataToObjectURL(d: ImageData): Promise<string> {
    return new Promise((resolve) => {
      const c = document.createElement("canvas");
      c.width = d.width;
      c.height = d.height;
      c.getContext("2d", { willReadFrequently: true })?.putImageData(d, 0, 0);
      c.toBlob(
        (blob) => resolve(URL.createObjectURL(blob as Blob)),
        "image/png"
      );
    });
  }
}
