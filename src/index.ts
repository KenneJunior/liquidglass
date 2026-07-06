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

export { LiquidGlass } from './api.ts';
export { LiquidGlassSlider } from './slider.ts';
export { LiquidGlassSwitch } from './switch.ts';
export { LiquidGlassSurface } from './surface.ts';

export { Spring, MathUtils } from './utils.ts';
export { buildGlassFilterAsync } from './filters.ts';
