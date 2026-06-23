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
 * Configuration options for LiquidGlass surfaces
 *
 * All properties are optional and will fall back to sensible defaults or CSS variables.
 */
export interface LiquidGlassOptions {
    /** Refractive index of the glass material (affects refraction intensity). Default: 1.6 */
    refractiveIndex?: number;

    /** Virtual glass thickness in pixels (affects displacement map). Default: 120 */
    glassThickness?: number;

    backdrop:{
        /** Amount of background blur (stdDeviation for feGaussianBlur). Default: 0.6 */
        blur?: number;

        /** Color saturation multiplier (1 = normal, >1 = vibrant). Default: 1.35 */
        saturation?: number;

        /** Brightness multiplier (1 = normal, <1 = darker, >1 = brighter). Default: 1.0 */
        brightness?: number;

        /** Respect system prefers-reduced-motion setting. Default: false */
        reducedMotion?: boolean;
    }
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

    /** Enable the ambient orb effect following the pointer. Default: true */
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
interface FilterCacheResult {
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
    /** The color of the ripple gradient. */
    color?: string;
    /** How large the ripple grows relative to the element's size. Default: 4 */
    sizeMultiplier?: number;
    /** Animation duration in milliseconds. Default: 4000 */
    durationMs?: number;
    /** CSS easing function. Default: 'cubic-bezier(.16,1,.3,1)' */
    easing?: string;
    /** Starting opacity of the ripple. Default: 1 */
    startOpacity?: number;
    /** Ending opacity of the ripple. Default: 0 */
    endOpacity?: number;
}

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
    setTarget(t: number):void { this.target = t; }

    public getTarget(): number { return this.target; }
    public getValue(): number { return this.value; }
    /**
     * Update the spring for a time step
     * @param dt Delta time in seconds (typically 0.016 for 60fps)
     * @return Current value after this frame
     */
    update(dt: number):number {
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
class MathUtils  {
    /**
     * Clamp a value between min and max bounds
     * @param v Value to clamp
     * @param lo Lower bound (inclusive)
     * @param hi Upper bound (inclusive)
     * @return Clamped value
     */
    public static clamp (v: number, lo: number, hi: number):number{
        return Math.min(Math.max(v, lo), hi);
    }

    /**
     * Calculate a smooth surface profile curve
     * Used to shape the glass curvature from flat edges to rounded corners.
     * @param x Input from 0 to 1
     * @return Smoothly curved value from 0 to 1
     */
    public static surfaceProfile (x: number): number {
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
    public static loadImage (src: string): Promise<HTMLImageElement> {
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
    public static calculateDisplacementFromAlpha (maskImg: HTMLImageElement, W: number, H: number, _bw: number, maxD: number):ImageData
        {
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
     * @param shapeFn Function defining surface profile (0->1)
     * @param ri Refractive index of glass
     * @param samples Number of sample points. Default: 128
     * @return Array of displacement values for each sample
     */
    public static calculateDisplacementMap1D (gt: number, bw: number,  ri: number, samples = 128) {
        const eta = 1 / ri; // relative refractive index
        const result: number[] = [];

        for (let i = 0; i < samples; i++) {
            const x = i / samples;
            const y = this.surfaceProfile(x);

            // Approximate surface normal via finite differences
            const dx = 0.0001;
            const dy = (this.surfaceProfile(Math.min(1, x + dx)) - this.surfaceProfile(Math.max(0, x - dx))) / (2 * dx);
            const mag = Math.sqrt(dy * dy + 1);
            const nx = -dy / mag, ny = -1 / mag; // surface normal

            // Apply Snell's law: n1 * sin(i) = n2 * sin(t)
            const cosI = ny;
            const k = 1 - eta * eta * (1 - cosI * cosI);

            if (k < 0) {
                // Total internal reflection: no refraction
                result.push(0);
            } else {
                // Calculate refracted ray direction and displacement
                const sqrtk = Math.sqrt(k);
                const rf0 = -(eta * cosI + sqrtk) * nx;
                const rf1 = eta - (eta * cosI + sqrtk) * ny;
                result.push(rf1 !== 0 ? rf0 * ((y * bw + gt) / rf1) : 0);
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
    public static calculateDisplacementMap2D (cW: number, cH: number, oW: number, oH: number, rad: number, bw: number, maxD: number, profile: number[])  {
        const img = new ImageData(cW, cH);
        const data = img.data;

        // Initialize with neutral displacement
        for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i + 1] = 128;
            data[i + 3] = 255;
        }

        // Precompute frequently used values
        const rSq = rad * rad, rp1Sq = (rad + 1) ** 2, rmBwSq = Math.max(0, rad - bw) ** 2;
        const wB = oW - rad * 2, hB = oH - rad * 2;
        const oX = (cW - oW) / 2, oY = (cH - oH) / 2;
        const safeMaxD = maxD || 1;

        // Rasterize the glass shape
        for (let y1 = 0; y1 < oH; y1++) {
            for (let x1 = 0; x1 < oW; x1++) {
                let cx = 0, cy = 0;

                // Distance from nearest corner (handles rounded corners)
                if (x1 < rad) cx = x1 - rad;
                else if (x1 >= oW - rad) cx = x1 - rad - wB;
                if (y1 < rad) cy = y1 - rad;
                else if (y1 >= oH - rad) cy = y1 - rad - hB;

                const dSq = cx * cx + cy * cy;

                // Only process pixels in bezel zone (edge of glass)
                if (dSq <= rp1Sq && dSq >= rmBwSq) {
                    const dist = Math.sqrt(dSq);
                    const op = dSq < rSq ? 1 : 1 - (dist - rad) / (Math.sqrt(rp1Sq) - rad); // opacity

                    // Sample the 1D profile to get displacement magnitude
                    const bIdx = Math.floor(Math.max(0, Math.min(1, (rad - dist) / bw)) * (profile.length - 1));
                    const dVal = profile[bIdx] || 0;

                    // Convert displacement to X,Y components (pointing outward from edge)
                    const dX = (-(dist > 0 ? cx / dist : 0) * dVal) / safeMaxD;
                    const dY = (-(dist > 0 ? cy / dist : 0) * dVal) / safeMaxD;

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
    public static calculateSpecularHighlight (oW: number, oH: number, rad: number)  {
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
    public static imageDataToObjectURL (d: ImageData): Promise<string>  {
        return new Promise(resolve => {
            const c = document.createElement("canvas");
            c.width = d.width;
            c.height = d.height;
            c.getContext("2d",{willReadFrequently:true})?.putImageData(d, 0, 0);
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
    const R =MathUtils.parseRadius(el, W, H);
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
    const profile = MathUtils.calculateDisplacementMap1D(opts.glassThickness, opts.bezelWidth,  opts.refractiveIndex);
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
        el.style.setProperty('--webkitMaskImage',`url('${maskUrl}')`);
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
export class LiquidGlassSurface {
    private readonly el: HTMLElement;
    private readonly cacheMap: Map<string, FilterCacheResult>;
    private jsOptions: LiquidGlassOptions;
    private _af: number | null; // animation frame request ID
    private lastTime: number;
    private opts!: Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>;
    private sp: {
        tiltX: Spring;
        tiltY: Spring;
        lightX: Spring;
        lightY: Spring;
        shadowY: Spring;
        shadowBlur: Spring;
        shadowA: Spring;
        refrScale: Spring;
        transX: Spring;
        transY: Spring;
    };
    private _inner?: HTMLDivElement; // shine gradient overlay
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
            aberration:MathUtils.getCssVar(this.el, '--lg-aberration', this.jsOptions.aberration ?? 0.05),
            magneticPull: MathUtils.getCssVar(this.el, '--lg-magnetic-pull', this.jsOptions.magneticPull ?? 15),
            backdrop:{
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
            this.el.style.transform = `perspective(900px) translate3d(${nx * this.opts.magneticPull}px, ${ny * this.opts.magneticPull}px, 0) rotateX(${ny * -this.opts.maxTilt}deg) rotateY(${nx * this.opts.maxTilt}deg)`;            const sy = 12 + Math.abs(ny) * 14, sb = 18 + Math.abs(ny) * 22, sa = 0.18 + Math.abs(ny) * 0.14;
            this.el.style.boxShadow = `0 ${sy}px ${sb}px rgba(0,0,0,${sa})`;
            if (this._filter?.mapElG) {
                if (this._filter?.mapElG) {
                    const baseScale = this._filter.maxDisp * this.opts.refractionScale * (1 + Math.sqrt(nx * nx + ny * ny) * 0.22);
                    this._filter.mapElR?.setAttribute('scale', (baseScale * (1 - this.opts.aberration)).toString());
                    this._filter.mapElG?.setAttribute('scale', baseScale.toString());
                    this._filter.mapElB?.setAttribute('scale', (baseScale * (1 + this.opts.aberration)).toString());
                }  }
            return;
        }

        // Set spring targets for smooth animation
        this.sp.tiltX.setTarget(ny * -this.opts.maxTilt);
        this.sp.tiltY.setTarget(nx * this.opts.maxTilt);
        this.sp.transX.setTarget(nx * this.opts.magneticPull);
        this.sp.transY.setTarget(ny * this.opts.magneticPull);
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
            this.el.style.transform = `perspective(900px) translate3d(0px, 0px, 0) rotateX(0deg) rotateY(0deg)`;            this.el.style.boxShadow = `0 4px 12px rgba(0,0,0,0.12)`;
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
        const dt = Math.min((now - this.lastTime) / 1000, 0.032); // cap at 32ms
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

        this.el.style.transform = `perspective(900px) translate3d(${tx}px, ${ty}px, 0) rotateX(${rx}deg) rotateY(${ry}deg)`;
        this.el.style.boxShadow = `0 ${sy}px ${sb}px rgba(0,0,0,${sa})`;

        if (this._inner) {
            this._inner.style.setProperty('--lg-spot-x', `${lx}%`);
            this._inner.style.setProperty('--lg-spot-y', `${ly}%`);
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

    static _lx = -9999; // last mouse X
    static _ly = -9999; // last mouse Y
    static _raf: number | null = null; // animation frame ID

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
            { transform: 'scale(0)', opacity: startOp },
            { transform: 'scale(1)', opacity: endOp }
        ], {
            duration: duration,
            easing: easing,
            fill: 'forwards'
        });

        // 5. Memory cleanup
        animation.onfinish = () => rip.remove();
    }
}