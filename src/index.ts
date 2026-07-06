//todo what i want to add next is that we should make such that we will be able to add maybe like a text or logo on the
// switch while on the slider we will choose the location we want it to show the value be it at the buttom top write or
// left or top if its at the top or bottom we can choose if we want it to be sticky like follow the thumb of the slider
// as it slides throug the slide and even the way the number changes should be stylish like if we slide to increase the
// number should be moving from top to butom like 1,2,3,4,5 almost like how a number change when you scroll your clock
// on the apple alarm

import type {LiquidGlassOptions, RippleOptions, SliderOptions, SwitchOptions, FilterCacheResult} from "./Types.ts";

/**
 * ============================================================
 * LIQUID GLASS LIBRARY (v4 - TypeScript Edition)
 * ============================================================
 *
 * A high-performance glass morphism (glassmorphism) effect library that uses SVG filters
 * to create realistic refractive glass surfaces with physics-based animations.
 *
 * Features:
 * - Real-time refraction and displacement mapping using SVG filters
 * - Physics-based spring animations for smooth pointer following
 * - Responsive design with resize observer support
 * - GPU-accelerated 3D transforms and backdrop filters
 * - Mobile device orientation support for gyroscope-based interactions
 * - Reduced motion preference detection for accessibility
 * - Optional ripple effect with customizable appearance
 * - CSS variable configuration for runtime customization
 * - Filter caching for improved performance with multiple elements
 *
 * @example
 * // Initialize with default settings
 * LiquidGlass.init('.glass-effect');
 *
 * // Initialize with custom options
 * LiquidGlass.init('.glass-effect', {
 *   refractiveIndex: 1.8,
 *   glassThickness: 150,
 *   maxTilt: 10
 * });
 *
 * // Add a ripple effect on click
 * element.addEventListener('click', (e) => {
 *   LiquidGlass.addRipple(element, e);
 * });
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
class Spring {
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
        return Math.abs(this.target - this.value) < 0.001 && Math.abs(this.velocity) < 0.001;
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
class MathUtils {
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
    public static getCssVar(el: HTMLElement, prop: string, fallback: number | boolean): any {
        const val = getComputedStyle(el).getPropertyValue(prop).trim();
        return val !== '' ? parseFloat(val) : fallback;
    }

    /**
     * Intelligently parses border-radius to handle px, %, and massive capsule radii
     * ensuring math doesn't break for circles and pills.
     * @param el Element with border-radius style
     * @param width Element width in pixels
     * @param height Element height in pixels
     * @return Effective radius in pixels
     */
    public static parseRadius(el: HTMLElement, width: number, height: number): number {
        const raw = getComputedStyle(el).borderRadius;
        let r = parseInt(raw) || 26;
        if (raw.includes('%')) {
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
            if (src.startsWith('http')) img.crossOrigin = "Anonymous";
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = src;
        })
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
    public static calculateDisplacementFromAlpha(maskImg: HTMLImageElement, W: number, H: number, _bw: number, maxD: number): ImageData {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', {willReadFrequently: true});
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
                    outData[idx] = Math.max(0, Math.min(255, 128 + dX * 127 * (maxD || 1)));
                    outData[idx + 1] = Math.max(0, Math.min(255, 128 + dY * 127 * (maxD || 1)));
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
    public static calculateDisplacementMap1D(gt: number, bw: number, ri: number, samples = 128): Float32Array {
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

            const dy = (this.surfaceProfile(xPlus) - this.surfaceProfile(xMinus)) / actualDx;
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
                const c = (eta * ny) + sqrtk;

                // Calculate refracted ray direction components
                const rf0 = -c * nx;
                const rf1 = eta - (c * ny);

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
        cW: number, cH: number,
        oW: number, oH: number,
        rad: number, bw: number,
        maxD: number,
        profile: Float32Array
    ): ImageData {
        const img = new ImageData(cW, cH);

        // 1. High-speed 32-bit memory initialization
        // 0xFF808080 represents A=255, B=128, G=128, R=128 (Neutral Vector)
        // This is magnitudes faster than iterating i+=4 through the Uint8ClampedArray
        const view32 = new Uint32Array(img.data.buffer);
        view32.fill(0xFF808080);

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
                let cx = 0, cy = 0;

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
                    const exactIdx = Math.max(0, Math.min(1, (rad - dist) / bw)) * profileLen;
                    const idxLow = Math.floor(exactIdx);
                    const idxHigh = Math.min(idxLow + 1, profileLen);
                    const fraction = exactIdx - idxLow;

                    const dVal = (profile[idxLow] * (1 - fraction)) + (profile[idxHigh] * fraction);

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
    public static calculateSpecularHighlight(oW: number, oH: number, rad: number) {
        const img = new ImageData(oW, oH);
        const data = img.data;
        const light = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)]; // light direction
        const rSq = rad * rad, rp1Sq = (rad + 1) ** 2, rmSSq = Math.max(0, (rad - 1.5) ** 2);

        for (let y1 = 0; y1 < oH; y1++) {
            for (let x1 = 0; x1 < oW; x1++) {
                let cx = 0, cy = 0;

                // Distance from nearest corner
                if (x1 < rad) cx = x1 - rad;
                else if (x1 >= oW - rad) cx = x1 - rad - (oW - rad * 2);
                if (y1 < rad) cy = y1 - rad;
                else if (y1 >= oH - rad) cy = y1 - rad - (oH - rad * 2);

                const dSq = cx * cx + cy * cy;

                // Process only pixels near the edge
                if (dSq <= rp1Sq && dSq >= rmSSq) {
                    const dist = Math.sqrt(dSq);
                    const op = dSq < rSq ? 1 : 1 - (dist - rad) / (Math.sqrt(rp1Sq) - rad);

                    // Dot product with light direction
                    const dp = Math.abs((dist > 0 ? cx / dist : 0) * light[0] + (dist > 0 ? -cy / dist : 0) * light[1]);
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
        return new Promise(resolve => {
            const c = document.createElement("canvas");
            c.width = d.width;
            c.height = d.height;
            c.getContext("2d", {willReadFrequently: true})?.putImageData(d, 0, 0);
            c.toBlob(blob => resolve(URL.createObjectURL(blob as Blob)), "image/png");
        });
    }
}

let _filterId = 0;

/**
 * Build an SVG filter for the glass effect
 *
 * Asynchronously creates a complete SVG filter with:
 * 1. Gaussian blur for soft input
 * 2. Displacement map using precomputed refraction data
 * 3. Color saturation boost for glass vibrancy
 * 4. Specular highlight for shine
 * 5. Screen blend for final composition
 *
 * Results are cached to avoid rebuilding identical filters.
 *
 * @param el The element to build a filter for
 * @param opts Required configuration options
 * @param cacheMap Filter cache to check/store in
 * @return Promise resolving to the filter result with SVG and metadata
 */
async function buildGlassFilterAsync(
    el: HTMLElement,
    opts: Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>,
    cacheMap: Map<string, FilterCacheResult>
): Promise<FilterCacheResult> {
    const rect = el.getBoundingClientRect();
    const W = Math.round(rect.width) || 100;
    const H = Math.round(rect.height) || 100;
    const R = MathUtils.parseRadius(el, W, H);
    const maskUrl = el.getAttribute('data-lg-mask');

    // Create cache key from element dimensions and properties
    const cacheKey = `${W}_${H}_${R}_${opts.refractiveIndex}_${opts.glassThickness}_${opts.backdrop.blur}_${opts.backdrop.saturation}_${opts.backdrop.brightness}_${opts.aberration}_${maskUrl || 'rect'}`;

    // Return cached filter if available
    if (cacheMap.has(cacheKey)) return cacheMap.get(cacheKey)!;

    const id = `lq-filter-${++_filterId}`;
    const mapIdR = `${id}-map-r`;
    const mapIdG = `${id}-map-g`;
    const mapIdB = `${id}-map-b`;
    // Calculate the refraction profile for this glass configuration
    const profile = MathUtils.calculateDisplacementMap1D(opts.glassThickness, opts.bezelWidth, opts.refractiveIndex);
    const maxDisp = Math.max(...profile.map(Math.abs)) || 1;

    let dispData: ImageData;

    // Use custom mask if provided, otherwise use rounded rectangle shape
    if (maskUrl) {
        const maskImg = await MathUtils.loadImage(maskUrl);
        maskImg.width = W;
        maskImg.height = H;

        dispData = MathUtils.calculateDisplacementFromAlpha(maskImg, W, H, opts.bezelWidth, maxDisp);

        // Apply mask to element
        el.style.maskImage = `url('${maskUrl}')`;
        el.style.setProperty('--webkitMaskImage', `url('${maskUrl}')`);
        el.style.maskSize = '100% 100%';
        el.style.setProperty('--webkitMaskSize', '100% 100%');
        el.style.maskRepeat = 'no-repeat';
        el.style.setProperty('--webkitMaskRepeat', 'no-repeat');
    } else {
        dispData = MathUtils.calculateDisplacementMap2D(W, H, W, H, R, opts.bezelWidth, maxDisp, profile);
    }

    // Calculate specular (shine) highlight
    const specData = MathUtils.calculateSpecularHighlight(W, H, R);

    // Convert both maps to data URLs in parallel
    const [dispURL, specURL] = await Promise.all([
        MathUtils.imageDataToObjectURL(dispData),
        MathUtils.imageDataToObjectURL(specData)
    ]);

    // Build SVG filter with all effects
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    svg.innerHTML = `
    <defs>
      <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${opts.backdrop.blur}" result="blurred"/>
        <feImage href="${dispURL}" x="0" y="0" width="${W}" height="${H}" result="disp_map" preserveAspectRatio="none"/>

        <feColorMatrix in="blurred" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red_channel"/>
        <feColorMatrix in="blurred" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green_channel"/>
        <feColorMatrix in="blurred" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue_channel"/>

        <feOffset id="${id}-offset-r" in="disp_map" dx="${opts.aberration * 10}" dy="${opts.aberration * 10}" result="disp_map_r"/>
        <feOffset id="${id}-offset-b" in="disp_map" dx="${opts.aberration * -10}" dy="${opts.aberration * -10}" result="disp_map_b"/>

        <feDisplacementMap id="${mapIdR}" in="red_channel" in2="disp_map_r" scale="${maxDisp * opts.refractionScale}" xChannelSelector="R" yChannelSelector="G" result="red_disp"/>
        <feDisplacementMap id="${mapIdG}" in="green_channel" in2="disp_map" scale="${maxDisp * opts.refractionScale}" xChannelSelector="R" yChannelSelector="G" result="green_disp"/>
        <feDisplacementMap id="${mapIdB}" in="blue_channel" in2="disp_map_b" scale="${maxDisp * opts.refractionScale}" xChannelSelector="R" yChannelSelector="G" result="blue_disp"/>

        <feComposite in="red_disp" in2="green_disp" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg_combine"/>
        <feComposite in="blue_disp" in2="rg_combine" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="displaced"/>

        <feColorMatrix in="displaced" type="saturate" values="${opts.backdrop.saturation}" result="saturated"/>
        
        <feComponentTransfer in="saturated" result="brightened">
            <feFuncR type="linear" slope="${opts.backdrop.brightness}"/>
            <feFuncG type="linear" slope="${opts.backdrop.brightness}"/>
            <feFuncB type="linear" slope="${opts.backdrop.brightness}"/>
        </feComponentTransfer>

        <feImage href="${specURL}" x="0" y="0" width="${W}" height="${H}" result="specular" preserveAspectRatio="none"/>
        <feComponentTransfer in="specular" result="spec_faded">
          <feFuncA type="linear" slope="${opts.specularAlpha}"/>
        </feComponentTransfer>
        <feBlend in="spec_faded" in2="brightened" mode="screen"/>
      </filter>
    </defs>`;

    document.body.appendChild(svg);

    //  the return object to grab the new elements
    const result: FilterCacheResult = {
        id,
        maxDisp,
        mapElR: svg.querySelector(`#${mapIdR}`),
        mapElG: svg.querySelector(`#${mapIdG}`),
        mapElB: svg.querySelector(`#${mapIdB}`),
        offsetR: svg.querySelector(`#${id}-offset-r`),
        offsetB: svg.querySelector(`#${id}-offset-b`),
        svg
    };
    cacheMap.set(cacheKey, result);
    return result;
}

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
class LiquidGlassSurface {
    private readonly el: HTMLElement;
    private readonly cacheMap: Map<string, FilterCacheResult>;
    private jsOptions: LiquidGlassOptions;
    private _af: number | null;
    private lastTime: number;
    private opts!: Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>;
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
     * @param cacheMap Shared filter cache
     */
    constructor(el: HTMLElement, jsOptions: LiquidGlassOptions = {
        backdrop: {
            blur: undefined,
            saturation: undefined,
            brightness: undefined,
            reducedMotion: undefined
        }
    }, cacheMap: Map<string, FilterCacheResult>) {
        this.el = el;
        this.cacheMap = cacheMap;
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
            contentX: new Spring(0, 300 / motionScale, 24),
            contentY: new Spring(0, 300 / motionScale, 24),
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
            refractiveIndex: MathUtils.getCssVar(this.el, '--lg-refractive-index', this.jsOptions.refractiveIndex || 1.6),
            glassThickness: MathUtils.getCssVar(this.el, '--lg-glass-thickness', this.jsOptions.glassThickness || 120),
            bezelWidth: MathUtils.getCssVar(this.el, '--lg-bezel-width', this.jsOptions.bezelWidth || 28),
            refractionScale: MathUtils.getCssVar(this.el, '--lg-refraction-scale', this.jsOptions.refractionScale || 1.2),
            specularAlpha: MathUtils.getCssVar(this.el, '--lg-specular-alpha', this.jsOptions.specularAlpha || 0.75),
            maxTilt: MathUtils.getCssVar(this.el, '--lg-max-tilt', this.jsOptions.maxTilt || 7),
            reducedMotion: this.jsOptions.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches,
            aberration: MathUtils.getCssVar(this.el, '--lg-aberration', this.jsOptions.aberration ?? 0.05),
            magneticPull: MathUtils.getCssVar(this.el, '--lg-magnetic-pull', this.jsOptions.magneticPull ?? 15),
            backdrop: {
                blur: MathUtils.getCssVar(this.el, '--lg-blur', this.jsOptions.backdrop?.blur ?? 6),
                saturation: MathUtils.getCssVar(this.el, '--lg-saturation', this.jsOptions.backdrop?.saturation ?? 1.35),
                brightness: MathUtils.getCssVar(this.el, '--lg-brightness', this.jsOptions.backdrop?.brightness ?? 1.0),
            }
        };
    }

    /**
     * Async initialization: build filter and layer
     * Called after constructor to allow async filter building
     */
    async _initAsync() {
        this._filter = await buildGlassFilterAsync(this.el, this.opts, this.cacheMap);
        this._buildInner();
        this.el.style.transformStyle = 'preserve-3d';
        this.el.style.willChange = 'transform';
        const bf = `url(#${this._filter.id})`;
        this.el.style.backdropFilter = bf;
        this.el.style.setProperty('-webkit-backdrop-filter', bf);
    }

    /**
     * Build the inner shine layer (gradient + shadow)
     * Adds a decorative overlay that enhances the glass appearance
     */
    private _buildInner() {
        if (this.el.querySelector('.liquid-glass-inner')) return;
        const d = document.createElement('div');
        d.className = 'liquid-glass-inner';
        d.setAttribute('aria-hidden', 'true');
        Object.assign(d.style, {
            position: 'absolute', inset: '0', borderRadius: 'inherit',
            pointerEvents: 'none', zIndex: '2',
            background: 'radial-gradient(circle at var(--lg-spot-x, 50%) var(--lg-spot-y, -20%), rgba(255,255,255,0.2) 0%, rgba(255,255,255,0.05) 20%, transparent 80%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(0,0,0,0.10)',
            mixBlendMode: 'color-dodge',
        });
        this.el.appendChild(d);
        this._inner = d;
    }

    /**
     * Set up resize observer to rebuild filter when element size changes
     */
    private _setupResizeObserver() {
        this._resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                if (this._lastW !== entry.contentRect.width || this._lastH !== entry.contentRect.height) {
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
        this._filter = await buildGlassFilterAsync(this.el, this.opts, this.cacheMap);
        const bf = `url(#${this._filter.id})`;
        this.el.style.backdropFilter = bf;
        this.el.style.setProperty('--lg-backdrop-filter', bf);
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
            this.el.style.transform = `perspective(900px) translate3d(${nx * this.opts.magneticPull}px, ${ny * this.opts.magneticPull}px, 0) rotateX(${ny * -this.opts.maxTilt}deg) rotateY(${nx * this.opts.maxTilt}deg)`;
            const sy = 12 + Math.abs(ny) * 14, sb = 18 + Math.abs(ny) * 22, sa = 0.18 + Math.abs(ny) * 0.14;
            this.el.style.boxShadow = `0 ${sy}px ${sb}px rgba(0,0,0,${sa})`;
            if (this._filter?.mapElG) {
                if (this._filter?.mapElG) {
                    const baseScale = this._filter.maxDisp * this.opts.refractionScale * (1 + Math.sqrt(nx * nx + ny * ny) * 0.22);
                    this._filter.mapElR?.setAttribute('scale', (baseScale * (1 - this.opts.aberration)).toString());
                    this._filter.mapElG?.setAttribute('scale', baseScale.toString());
                    this._filter.mapElB?.setAttribute('scale', (baseScale * (1 + this.opts.aberration)).toString());
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
        this.sp.lightX.setTarget(50 + nx * 60)
        this.sp.lightY.setTarget(50 + ny * 60)
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
                this._filter.mapElR?.setAttribute('scale', (baseScale * (1 - this.opts.aberration)).toString());
                this._filter.mapElG?.setAttribute('scale', baseScale.toString());
                this._filter.mapElB?.setAttribute('scale', (baseScale * (1 + this.opts.aberration)).toString());
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
            this._af = requestAnimationFrame(ts => this._loop(ts));
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
        const rx = this.sp.tiltX.update(dt), ry = this.sp.tiltY.update(dt);
        const sy = this.sp.shadowY.update(dt), sb = this.sp.shadowBlur.update(dt), sa = this.sp.shadowA.update(dt);
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
            this._inner.style.setProperty('--lg-spot-x', `${lx}%`);
            this._inner.style.setProperty('--lg-spot-y', `${ly}%`);
            this._inner.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
        }
        if (this._filter?.mapElG) {
            const baseScale = this._filter.maxDisp * this.opts.refractionScale * rs;

            // Keep the scale equal for all channels
            this._filter.mapElR?.setAttribute('scale', baseScale.toString());
            this._filter.mapElG?.setAttribute('scale', baseScale.toString());
            this._filter.mapElB?.setAttribute('scale', baseScale.toString());

            // We multiply it by 'rs' (refraction scale) so it gets slightly stronger on hover.
            const baseShift = 12 * this.opts.aberration * rs;

            // We still add a tiny fraction of the 3D tilt (ry, rx) so the light
            // feels like it bends with the mouse movement, but it won't disappear.
            const shiftX = baseShift + (ry * this.opts.aberration * 0.3);
            const shiftY = baseShift + (rx * this.opts.aberration * 0.3);

            this._filter.offsetR?.setAttribute('dx', shiftX.toString());
            this._filter.offsetR?.setAttribute('dy', shiftY.toString());

            this._filter.offsetB?.setAttribute('dx', (-shiftX).toString());
            this._filter.offsetB?.setAttribute('dy', (-shiftY).toString());
        }
        if (!Object.values(this.sp).every(s => s.isSettled())) {
            this._af = requestAnimationFrame(ts => this._loop(ts));
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
        this.el.style.backdropFilter = '';
        this.el.style.setProperty('--lg-backdrop-filter', '');
        this.el.style.transform = '';
        this.el.style.boxShadow = '';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIQUID GLASS SLIDER
// ─────────────────────────────────────────────────────────────────────────────

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
 *   .lg-slider-track
 *     .lg-slider-track-inner
 *       .lg-slider-fill
 *     .lg-slider-thumb               ← glass element
 *       .lg-slider-thumb-clone       ← clone-world fallback
 *         .lg-slider-thumb-clone-inner
 *       .lg-slider-thumb-inner       ← receives backdrop-filter or filter
 *       <svg> … filter definition …
 */
export class LiquidGlassSlider {
    // ── Resolved configuration ───────────────────────────────────────────────
    private readonly cfg: Required<SliderOptions>;
    private readonly filterCache: Map<string, FilterCacheResult>;

    // ── State ────────────────────────────────────────────────────────────────
    private value: number;         // 0–100
    private isPressed = false;
    // @ts-ignore
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
        options: SliderOptions = {},
        filterCache: Map<string, FilterCacheResult> = new Map()
    ) {
        // Merge with defaults — every field guaranteed non-optional from here on
        this.cfg = {
            refractiveIndex: options.refractiveIndex ?? 1.45,
            glassThickness: options.glassThickness ?? 80,
            bezelWidth: options.bezelWidth ?? 16,
            refractionScale: options.refractionScale ?? 1.2,
            specularAlpha: options.specularAlpha ?? 0.4,
            trackWidth: options.trackWidth ?? 330,
            trackHeight: options.trackHeight ?? 18,
            trackFill: options.trackFill ?? 'linear-gradient(90deg,#3b82f6,#60a5fa)',
            trackBackground: options.trackBackground ?? 'rgba(255,255,255,0.05)',
            thumbWidth: options.thumbWidth ?? 90,
            thumbHeight: options.thumbHeight ?? 60,
            thumbRadius: options.thumbRadius ?? 30,
            pressScale: options.pressScale ?? 1,   // full-size on press (squish via spring)
            value: options.value ?? 10,
            onChange: options.onChange ?? (() => {
            }),
            onCommit: options.onCommit ?? (() => {
            }),
        };
        this.filterCache = filterCache;
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
        const {
            trackWidth, trackHeight, thumbWidth, thumbHeight, thumbRadius,
            trackFill, trackBackground
        } = this.cfg;

        this.container.style.position = 'relative';
        this.container.innerHTML = `
          <div class="lg-slider-track" style="
            display:inline-block; 
            position:absolute;
            width:${trackWidth}px;
            height:${trackHeight}px;
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

        this.container.style.width = `${trackWidth}px`;
        this.container.style.height = `${thumbHeight}px`;

        this.track = this.container.querySelector('.lg-slider-track')!;
        this.fill = this.container.querySelector('.lg-slider-fill')!;
        this.thumb = this.container.querySelector('.lg-slider-thumb')!;
        this.thumbInner = this.container.querySelector('.lg-slider-thumb-inner')!;
        this.cloneInner = this.container.querySelector('.lg-slider-thumb-clone-inner')!;
    }

    // ── Filter construction ──────────────────────────────────────────────────

    /**
     * Builds the SVG filter for this slider's thumb dimensions.
     * Runs async but the thumb is interactive immediately — filter
     * upgrades visually once the promise resolves.
     */
    private async _buildFilter(): Promise<void> {
        const {
            thumbWidth: W, thumbHeight: H, thumbRadius: R,
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha
        } = this.cfg;

        // Synthesise a minimal opts object compatible with buildGlassFilterAsync
        const opts = {
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha,
            backdrop: {blur: 0, saturation: 7, brightness: 1.0},
            maxTilt: 0, reducedMotion: false,
            aberration: 0, magneticPull: 0,
        } as Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>;

        // Temporarily fake el.getBoundingClientRect so buildGlassFilterAsync
        // reads the exact thumb dimensions, not the container's.
        const fakeEl = Object.assign(document.createElement('div'), {
            style: {borderRadius: `${R}px`},
            getBoundingClientRect: () => ({
                width: W, height: H, top: 0, left: 0, right: W, bottom: H, x: 0, y: 0,
                toJSON: () => {
                }
            }),
            getAttribute: () => null,
        }) as unknown as HTMLElement;

        this.filter = await buildGlassFilterAsync(fakeEl, opts, this.filterCache);
        this.maxDisp = this.filter.maxDisp;
        this.filterId = this.filter.id;

        // Wire the filter to the SVG element already in the DOM
        const svgDefs = this.thumb.querySelector('svg defs')!;
        svgDefs.parentElement!.replaceWith(this.filter.svg);

        if (LiquidGlassSlider.useBackdrop) {
            const bf = `url(#${this.filterId})`;
            this.thumbInner.style.backdropFilter = bf;
            (this.thumbInner.style as any).webkitBackdropFilter = bf;
        } else {
            this.cloneInner.style.filter = `url(#${this.filterId})`;
            // Clone-world background must mirror the slider's parent scene
            this.cloneInner.style.background =
                getComputedStyle(this.container.parentElement || document.body).background;
        }

        // Kick the animation loop so the initial scale renders immediately
        this._kick();
    }

    // ── Position / clone sync ────────────────────────────────────────────────

    /**
     * Positions the thumb and fill based on current value.
     * Also repositions the clone-world inner so the background
     * appears correctly offset inside the thumb's viewport.
     */
    private _updatePosition(): void {
        const {trackWidth, thumbWidth, thumbHeight, trackHeight} = this.cfg;
        const restScale = thumbHeight / thumbWidth;
        const scaledW = thumbWidth * restScale;
        const tx = scaledW / 2 + (this.value / 100) * (trackWidth - scaledW) - thumbWidth / 2;

        this.thumb.style.left = `${tx}px`;
        this.fill.style.width = `${this.value}%`;

        this.cfg.onChange(this.value);

        if (!LiquidGlassSlider.useBackdrop) {
            const aR = this.container.getBoundingClientRect();
            const cl = (aR.width - trackWidth) / 2;
            const ct = (aR.height - thumbHeight) / 2;
            this.cloneInner.style.width = `${aR.width}px`;
            this.cloneInner.style.height = `${aR.height}px`;
            this.cloneInner.style.transform = `translate(${-(cl + tx)}px, ${-ct}px)`;
            // Track geometry replicated on the clone via CSS custom properties
            this.cloneInner.style.setProperty('--lg-track-left', `${cl}px`);
            this.cloneInner.style.setProperty('--lg-track-top', `${ct + (thumbHeight - trackHeight) / 2}px`);
            this.cloneInner.style.setProperty('--lg-fill-pct', this.value.toString());
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

        this.thumb.style.transform = `scale(${sc})`;
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
        const {trackWidth, thumbWidth, thumbHeight} = this.cfg;
        const restScale = thumbHeight / thumbWidth;
        const pressScale = this.cfg.pressScale;

        const onDown = (clientX: number) => {
            this.isPressed = true;
            this.dragStartX = clientX;
            this.spScale.setTarget(pressScale);
            this.spBrightness.setTarget(0.1);
            this.spRefr.setTarget(0.9);
            this._kick();
        };

        const onMove = (clientX: number) => {
            if (!this.isPressed) return;
            const scaledW = thumbWidth * restScale;
            const trackRect = this.track.getBoundingClientRect();
            const x0 = trackRect.left + scaledW / 2;
            const usableW = trackWidth - scaledW;
            const raw = ((Math.max(x0, Math.min(x0 + usableW, clientX)) - x0) / usableW) * 100;
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
        window.addEventListener('pointerup', () => onUp());
        window.addEventListener('resize', () => this._updatePosition());
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /** Programmatically set value 0–100 without triggering onCommit. */
    setValue(v: number): void {
        this.value = Math.max(0, Math.min(100, v));
        this._updatePosition();
    }

    /** Read current value. */
    getValue(): number {
        return this.value;
    }

    /** Tear down springs, cancel rAF, clear DOM. */
    destroy(): void {
        if (this.rafId) cancelAnimationFrame(this.rafId);
        this.filter?.svg.remove();
        this.container.innerHTML = '';
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// LIQUID GLASS SWITCH
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A physics-driven glass toggle switch.
 *
 * Architecture:
 *   • Five springs mirror demo.html exactly:
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
 *   .lg-switch-track                 ← tap target + colour container
 *     .lg-switch-thumb               ← glass element
 *       .lg-switch-thumb-clone
 *         .lg-switch-thumb-clone-inner
 *       .lg-switch-thumb-inner       ← backdrop-filter or filter target
 *       <svg> … filter …
 */
export class LiquidGlassSwitch {
    private readonly cfg: Required<SwitchOptions>;
    private readonly filterCache: Map<string, FilterCacheResult>;

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
        filterCache: Map<string, FilterCacheResult> = new Map()
    ) {
        this.cfg = {
            refractiveIndex: options.refractiveIndex ?? 1.5,
            glassThickness: options.glassThickness ?? 47,
            bezelWidth: options.bezelWidth ?? 19,
            refractionScale: options.refractionScale ?? 1.2,
            specularAlpha: options.specularAlpha ?? 0.5,
            trackWidth: options.trackWidth ?? 160,
            trackHeight: options.trackHeight ?? 67,
            thumbWidth: options.thumbWidth ?? 146,
            thumbHeight: options.thumbHeight ?? 92,
            thumbRadius: options.thumbRadius ?? 46,
            colorOff: options.colorOff ?? 'rgba(255,255,255,0.05)',
            colorOn: options.colorOn ?? [139, 92, 246],
            checked: options.checked ?? true,
            onChange: options.onChange ?? (() => {
            }),
        };
        this.filterCache = filterCache;
        this.checked = this.cfg.checked;
        this.thumbRatio = this.checked ? 1 : 0;

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
        const {trackWidth, trackHeight, thumbWidth, thumbHeight, thumbRadius} = this.cfg;

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

        this.track = this.container.querySelector('.lg-switch-track')!;
        this.thumb = this.container.querySelector('.lg-switch-thumb')!;
        this.thumbInner = this.container.querySelector('.lg-switch-thumb-inner')!;
        this.cloneInner = this.container.querySelector('.lg-switch-thumb-clone-inner')!;
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
        const {
            thumbWidth: W, thumbHeight: H, thumbRadius: R,
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha
        } = this.cfg;

        const opts = {
            glassThickness, bezelWidth, refractiveIndex,
            refractionScale, specularAlpha,
            backdrop: {blur: 0.2, saturation: 6, brightness: 1.0},
            maxTilt: 0, reducedMotion: false,
            aberration: 0, magneticPull: 0,
        } as Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>;

        const fakeEl = Object.assign(document.createElement('div'), {
            style: {borderRadius: `${R}px`},
            getBoundingClientRect: () => ({
                width: W, height: H, top: 0, left: 0, right: W, bottom: H, x: 0, y: 0,
                toJSON: () => {
                }
            }),
            getAttribute: () => null,
        }) as unknown as HTMLElement;

        this.filter = await buildGlassFilterAsync(fakeEl, opts, this.filterCache);
        this.maxDisp = this.filter.maxDisp;
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
    static filterCache = new Map<string, FilterCacheResult>();
    static orb: HTMLElement | null = null;

    // FIX: Set these back to false so the bind functions actually run
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
                this.instances.set(el, new LiquidGlassSurface(el, options, this.filterCache));
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
        return new LiquidGlassSlider(el, options, this.filterCache);
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
        options: SwitchOptions = {}
    ): LiquidGlassSwitch {
        const el = typeof container === 'string'
            ? document.querySelector<HTMLElement>(container)!
            : container;
        return new LiquidGlassSwitch(el, options, this.filterCache);
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