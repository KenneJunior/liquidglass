/**
 * SVG filter builder for the glass effect
 *
 * Contains:
 * - GlassFilterBuilder: Class for building and caching SVG filters with displacement maps
 * - buildGlassFilterAsync: Convenience function using the class
 */

import type { LiquidGlassOptions, FilterCacheResult } from "../types/Types.ts";
import { MathUtils } from "../utils/utils.ts";

/**
 * Manages creation and caching of SVG glass filters.
 *
 * Handles:
 * - Unique filter ID generation
 * - Filter instance caching for performance
 * - SVG filter element lifecycle
 */
export class GlassFilterBuilder {
  private static _filterId = 0;
  private cache: Map<string, FilterCacheResult>;

  constructor() {
    this.cache = new Map();
  }

  /**
   * Generate a unique filter ID
   */
  private generateFilterId(): string {
    return `lq-filter-${++GlassFilterBuilder._filterId}`;
  }

  /**
   * Generate a cache key from element dimensions and properties
   */
  private generateCacheKey(
    W: number,
    H: number,
    R: number,
    opts: Required<
      Omit<LiquidGlassOptions, "enableOrb" | "orbColor" | "enableMobileSupport">
    >,
    maskUrl: string | null
  ): string {
    return `${W}_${H}_${R}_${opts.refractiveIndex}_${opts.glassThickness}_${
      opts.backdrop.blur
    }_${opts.backdrop.saturation}_${opts.backdrop.brightness}_${
      opts.aberration
    }_${maskUrl || "rect"}`;
  }

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
   * @return Promise resolving to the filter result with SVG and metadata
   */
  async buildFilter(
    el: HTMLElement,
    opts: Required<
      Omit<LiquidGlassOptions, "enableOrb" | "orbColor" | "enableMobileSupport">
    >
  ): Promise<FilterCacheResult> {
    const rect = el.getBoundingClientRect();
    const W = Math.round(rect.width) || 100;
    const H = Math.round(rect.height) || 100;
    const R = MathUtils.parseRadius(el, W, H);
    const maskUrl = el.getAttribute("data-lg-mask");

    const cacheKey = this.generateCacheKey(W, H, R, opts, maskUrl);

    // Return cached filter if available
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey)!;

    const id = this.generateFilterId();
    const result = await this.createFilterSVG(el, id, W, H, R, opts, maskUrl);

    this.cache.set(cacheKey, result);
    return result;
  }

  /**
   * Create the actual SVG filter element and return the result
   */
  private async createFilterSVG(
    el: HTMLElement,
    id: string,
    W: number,
    H: number,
    R: number,
    opts: Required<
      Omit<LiquidGlassOptions, "enableOrb" | "orbColor" | "enableMobileSupport">
    >,
    maskUrl: string | null
  ): Promise<FilterCacheResult> {
    const mapIdR = `${id}-map-r`;
    const mapIdG = `${id}-map-g`;
    const mapIdB = `${id}-map-b`;

    // Calculate the refraction profile for this glass configuration
    const profile = MathUtils.calculateDisplacementMap1D(
      opts.glassThickness,
      opts.bezelWidth,
      opts.refractiveIndex
    );
    const maxDisp = Math.max(...profile.map(Math.abs)) || 1;

    let dispData: ImageData;

    // Use custom mask if provided, otherwise use rounded rectangle shape
    if (maskUrl) {
      dispData = await this.createDisplacementFromMask(
        el,
        maskUrl,
        W,
        H,
        opts.bezelWidth,
        maxDisp
      );
    } else {
      dispData = MathUtils.calculateDisplacementMap2D(
        W,
        H,
        W,
        H,
        R,
        opts.bezelWidth,
        maxDisp,
        profile
      );
    }

    // Calculate specular (shine) highlight
    const specData = MathUtils.calculateSpecularHighlight(W, H, R);

    // Convert both maps to data URLs in parallel
    const [dispURL, specURL] = await Promise.all([
      MathUtils.imageDataToObjectURL(dispData),
      MathUtils.imageDataToObjectURL(specData),
    ]);

    // Build SVG filter with all effects
    const svg = this.createSVGElement(
      id,
      W,
      H,
      mapIdR,
      mapIdG,
      mapIdB,
      dispURL,
      specURL,
      maxDisp,
      opts
    );
    document.body.appendChild(svg);

    const result: FilterCacheResult = {
      id,
      maxDisp,
      mapElR: svg.querySelector(`#${mapIdR}`),
      mapElG: svg.querySelector(`#${mapIdG}`),
      mapElB: svg.querySelector(`#${mapIdB}`),
      offsetR: svg.querySelector(`#${id}-offset-r`),
      offsetB: svg.querySelector(`#${id}-offset-b`),
      svg,
    };

    return result;
  }

  /**
   * Create displacement data from a custom mask image
   */
  private async createDisplacementFromMask(
    el: HTMLElement,
    maskUrl: string,
    W: number,
    H: number,
    bezelWidth: number,
    maxDisp: number
  ): Promise<ImageData> {
    const maskImg = await MathUtils.loadImage(maskUrl);
    maskImg.width = W;
    maskImg.height = H;

    const dispData = MathUtils.calculateDisplacementFromAlpha(
      maskImg,
      W,
      H,
      bezelWidth,
      maxDisp
    );

    // Apply mask to element
    el.style.maskImage = `url('${maskUrl}')`;
    el.style.setProperty("--webkitMaskImage", `url('${maskUrl}')`);
    el.style.maskSize = "100% 100%";
    el.style.setProperty("--webkitMaskSize", "100% 100%");
    el.style.maskRepeat = "no-repeat";
    el.style.setProperty("--webkitMaskRepeat", "no-repeat");

    return dispData;
  }

  /**
   * Create the SVG element containing the filter definition
   */
  private createSVGElement(
    id: string,
    W: number,
    H: number,
    mapIdR: string,
    mapIdG: string,
    mapIdB: string,
    dispURL: string,
    specURL: string,
    maxDisp: number,
    opts: Required<
      Omit<LiquidGlassOptions, "enableOrb" | "orbColor" | "enableMobileSupport">
    >
  ): SVGSVGElement {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText =
      "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    svg.innerHTML = `
    <defs>
      <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="${
          opts.backdrop.blur
        }" result="blurred"/>
        <feImage href="${dispURL}" x="0" y="0" width="${W}" height="${H}" result="disp_map" preserveAspectRatio="none"/>

        <feColorMatrix in="blurred" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="red_channel"/>
        <feColorMatrix in="blurred" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="green_channel"/>
        <feColorMatrix in="blurred" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="blue_channel"/>

        <feOffset id="${id}-offset-r" in="disp_map" dx="${
      opts.aberration * 10
    }" dy="${opts.aberration * 10}" result="disp_map_r"/>
        <feOffset id="${id}-offset-b" in="disp_map" dx="${
      opts.aberration * -10
    }" dy="${opts.aberration * -10}" result="disp_map_b"/>

        <feDisplacementMap id="${mapIdR}" in="red_channel" in2="disp_map_r" scale="${
      maxDisp * opts.refractionScale
    }" xChannelSelector="R" yChannelSelector="G" result="red_disp"/>
        <feDisplacementMap id="${mapIdG}" in="green_channel" in2="disp_map" scale="${
      maxDisp * opts.refractionScale
    }" xChannelSelector="R" yChannelSelector="G" result="green_disp"/>
        <feDisplacementMap id="${mapIdB}" in="blue_channel" in2="disp_map_b" scale="${
      maxDisp * opts.refractionScale
    }" xChannelSelector="R" yChannelSelector="G" result="blue_disp"/>

        <feComposite in="red_disp" in2="green_disp" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg_combine"/>
        <feComposite in="blue_disp" in2="rg_combine" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="displaced"/>

        <feColorMatrix in="displaced" type="saturate" values="${
          opts.backdrop.saturation
        }" result="saturated"/>
        
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

    return svg;
  }

  /**
   * Clear the filter cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the current cache size
   */
  getCacheSize(): number {
    return this.cache.size;
  }
}

/**
 * Convenience function for building a glass filter using the class.
 * Creates a new GlassFilterBuilder instance and builds the filter.
 *
 * @param el The element to build a filter for
 * @param opts Required configuration options
 * @return Promise resolving to the filter result with SVG and metadata
 */
export async function buildGlassFilterAsync(
  el: HTMLElement,
  opts: Required<
    Omit<LiquidGlassOptions, "enableOrb" | "orbColor" | "enableMobileSupport">
  >
): Promise<FilterCacheResult> {
  const builder = new GlassFilterBuilder();
  return builder.buildFilter(el, opts);
}
