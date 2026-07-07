# Liquid Glass

A physically accurate glass UI component library. Every surface bends light using Snell's Law, every interaction is driven by damped harmonic oscillators, and every visual is composited through a real SVG filter pipeline — not CSS tricks.

---

## Table of Contents

- [What it actually does](#what-it-actually-does)
- [How the physics works](#how-the-physics-works)
  - [Snell's Law displacement](#snells-law-displacement)
  - [Spring oscillator](#spring-oscillator)
  - [SVG filter pipeline](#svg-filter-pipeline)
  - [Dual render path](#dual-render-path)
- [Getting started](#getting-started)
- [Glass surfaces — `LiquidGlass.init()`](#glass-surfaces--liquidglassinit)
  - [Options reference](#options-reference)
  - [CSS variable overrides](#css-variable-overrides)
  - [Ripple effect](#ripple-effect)
- [Slider — `LiquidGlass.createSlider()`](#slider--liquidglasscreateslider)
  - [Slider options reference](#slider-options-reference)
  - [Slider instance API](#slider-instance-api)
  - [Value label and digit drum](#value-label-and-digit-drum)
- [Switch — `LiquidGlass.createSwitch()`](#switch--liquidglasscreateswitch)
  - [Switch options reference](#switch-options-reference)
  - [Icon system](#icon-system)
  - [Switch instance API](#switch-instance-api)
- [Architecture deep dive](#architecture-deep-dive)
  - [Filter cache](#filter-cache)
  - [Spring internals](#spring-internals)
  - [Geometry calculations](#geometry-calculations)
  - [Clone-world fallback](#clone-world-fallback)
- [Playground](#playground)
- [Browser support](#browser-support)
- [Design constraints and known limits](#design-constraints-and-known-limits)

---

## What it actually does

Most "glassmorphism" libraries apply `backdrop-filter: blur()` and call it done. This library does something different.

Each glass surface runs a Snell's Law simulation: 128 rays are traced through a virtual convex glass slab. The angle each ray bends is computed per-pixel from the surface normal using the physics equation `n₁ sin θ₁ = n₂ sin θ₂`. The signed displacement values are baked into an RG `ImageData` canvas (R channel = horizontal displacement, G channel = vertical displacement) and fed into an SVG `feDisplacementMap` filter. A second ImageData encodes a physically-based specular highlight using a Blinn `cos(θ)` dot product against a fixed 60° light vector. Both images are composited through a full SVG filter chain that runs on the GPU.

All interactive properties — tilt, shadow depth, refraction scale, track colour, thumb brightness — are driven by damped harmonic oscillators rather than CSS transitions. This produces the characteristic overshoot-and-settle motion that makes interactions feel physically grounded.

---

## How the physics works

### Snell's Law displacement

The displacement profile is computed once per surface at initialisation time by `calculateDisplacementMap1D`.

```text
For each of 128 sample points across the glass rim:
  1. Evaluate the convex surface height  y = profile(x)
  2. Compute the surface normal using a centred finite difference
  3. Apply Snell's law:  k = 1 - (n_air/n_glass)² · (1 - cos²θ_i)
  4. If k < 0 → total internal reflection → displacement = 0
  5. Otherwise, compute the refracted ray direction [rf_x, rf_z]
  6. Project the ray to a pixel displacement: disp = rf_x · (y·bezelWidth + glassThickness) / rf_z
  7. Clamp to [-glassThickness, +glassThickness] to prevent runaway values
```

The resulting `Float32Array` is then mapped to 2D by `calculateDisplacementMap2D`, which walks every pixel inside the bezel ring of the rounded rectangle, looks up the profile value for that pixel's normalised distance from the edge (using bilinear interpolation between profile samples), and writes the signed displacement as an RG pixel value centred on `(128, 128)`.

The 2D map is baked into a canvas `ImageData`, converted to a data URL, and referenced by a `feImage` element inside the SVG filter. This baking happens once; the map never changes. What changes at runtime is the `scale` attribute of the `feDisplacementMap` element, which is driven by the refraction spring.

### Spring oscillator

Every animated property is an instance of the `Spring` class:

```text
velocity += (force - velocity · damping) · dt
value    += velocity · dt

where force = (target - value) · stiffness
```

This is Hooke's Law with damping — the standard equation for a damped harmonic oscillator. The `isSettled()` check stops the rAF loop once both displacement and velocity are below 0.001, preventing unnecessary frames when nothing is moving.

Spring presets used across components:

| Property                | Stiffness                  | Damping | Character                 |
|-------------------------|----------------------------|---------|---------------------------|
| Thumb position (switch) | 1000                       | 80      | Smooth, slight overshoot  |
| Scale squish (both)     | 2000                       | 80      | Snappy, minimal overshoot |
| Brightness (both)       | 2000                       | 80      | Snappy                    |
| Track colour (switch)   | 1000                       | 80      | Smooth                    |
| Refraction pulse (both) | 100                        | 10      | Bouncy, visible overshoot |
| Tilt (surface)          | configurable via `maxTilt` | —       | Smooth                    |

### SVG filter pipeline

Each glass element has its own inline `<svg>` containing a `<filter>`:

```text
SourceGraphic
  → feGaussianBlur (stdDeviation configurable, default 0.6)
  → feDisplacementMap (scale driven by refraction spring)
  → feColorMatrix type="saturate"
  → feBlend mode="screen" with specular feImage
```

The specular highlight (`feImage`) is a separately baked canvas where each border pixel has its brightness set to the `cos(θ)` dot product of that pixel's outward normal against a fixed 60° light direction. This creates a physically plausible catch-light on the top-left rim that doesn't move with the cursor — it's a property of the glass geometry, not the lighting environment.

For the slider and switch, three separate `feDisplacementMap` elements handle R, G, and B channels independently with slight offsets between them. This produces chromatic aberration — the subtle colour fringing visible at the glass edges that makes it look like real optics.

### Dual render path

`backdrop-filter: url(#filterId)` only works reliably in Chrome. For all other browsers the library uses the clone-world pattern:

**Chrome path:** The `thumbInner` div receives `backdrop-filter: url(#filterId)`. The browser composites whatever is behind the element through the SVG filter in a single GPU pass.

**Clone-world path:** A `.clone-inner` div holds a pixel-accurate copy of the background scene, sized and positioned via `transform: translate()` so the visible portion perfectly aligns with the element's viewport. The SVG filter is applied to this clone div as a regular CSS `filter`. The clone's transform is recomputed every frame in the spring loop as the element moves.

Detection:

```ts
const t = document.createElement('div');
t.style.backdropFilter = 'url(#test)';
useBackdrop = !!(window as any).chrome && t.style.backdropFilter.includes('url');
```

This is computed once per class and cached as a static field.

---

## Getting started

```html
<!-- 1. Import the module -->
<script type="module">
  import { LiquidGlass } from './src/index.js';

  // 2. Apply to any element
  LiquidGlass.init('.my-card');
</script>
```

```css
/* 3. Your element needs position:relative and overflow:hidden */
.my-card {
  position: relative;
  overflow: hidden;
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.18);
}
```

The library injects its own `<svg>` filter and inner shell div. It does not modify your element's existing styles other than adding `will-change: transform` and `transform-style: preserve-3d`.

---

## Glass surfaces — `LiquidGlass.init()`

Applies the full glass effect to every element matching a CSS selector. Each element gets its own `LiquidGlassSurface` instance which manages the filter, the spring loop, and pointer tracking independently.

```ts
LiquidGlass.init(selector: string, options?: LiquidGlassOptions): void
```

```js
LiquidGlass.init('.my-glass-card', {
  refractiveIndex: 1.9,
  glassThickness:  120,
  bezelWidth:      40,
  refractionScale: 1.6,
  maxTilt:         8,
  aberration:      0.8,
  magneticPull:    5,
  backdrop: {
    blur:       0,
    saturation: 2.0,
    brightness: 0.5,
  },
  enableOrb: true,
  orbColor:  'rgba(120,130,255,0.13)',
});
```

### Options reference

#### Glass optics

| Option            | Type     | Default | Description                                                                                                                                                                      |
|-------------------|----------|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `refractiveIndex` | `number` | `1.9`   | Index of refraction of the glass. Real-world: crown glass ≈ 1.52, flint glass ≈ 1.9, diamond ≈ 2.42. Higher values bend light more aggressively.                                 |
| `glassThickness`  | `number` | `120`   | Virtual depth of the glass slab in pixels. Increasing this increases the maximum displacement distance a refracted ray can travel.                                               |
| `bezelWidth`      | `number` | `40`    | Width of the rim transition zone in pixels. This is how far from the edge the refraction ramps up from zero to its peak. Wider values produce a softer, more gradual glass edge. |
| `refractionScale` | `number` | `1.6`   | Global multiplier applied to the `feDisplacementMap scale` attribute. Use this to exaggerate or reduce the entire displacement without changing the physics profile.             |
| `specularAlpha`   | `number` | `0.75`  | Opacity of the `feComponentTransfer` specular highlight layer. `0` = no specular, `1` = full intensity.                                                                          |
| `aberration`      | `number` | `0.8`   | Controls the channel offset between the R, G, and B displacement maps that produces chromatic aberration. `0` = clean, `2` = heavy colour fringing.                              |

#### Backdrop

Configured as a nested object:

```js
backdrop: {
  blur:       0,    // Gaussian blur behind the glass (stdDeviation). 0 = sharp refraction.
  saturation: 2.0,  // feColorMatrix saturation of the displaced backdrop.
  brightness: 0.5,  // Brightness of the backdrop content.
}
```

#### Interaction

| Option                | Type      | Default                    | Description                                                                                                                                              |
|-----------------------|-----------|----------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `maxTilt`             | `number`  | `8`                        | Maximum rotation in degrees on hover. `0` disables tilt entirely.                                                                                        |
| `magneticPull`        | `number`  | `5`                        | How strongly the surface element is attracted toward the cursor. The element translates slightly toward the pointer position proportional to this value. |
| `enableOrb`           | `boolean` | `true`                     | Whether to show the radial gradient orb that follows the cursor.                                                                                         |
| `orbColor`            | `string`  | `'rgba(120,130,255,0.13)'` | CSS colour for the pointer orb radial gradient.                                                                                                          |
| `enableMobileSupport` | `boolean` | `true`                     | Whether to enable `deviceorientation` events so the tilt effect works by physically tilting the device on mobile.                                        |

### CSS variable overrides

All optical properties can be overridden per-element using CSS custom properties. This lets you set global defaults in `:root` and override for specific shapes without passing separate options objects.

```css
:root {
  --lg-refractive-index: 1.9;
  --lg-glass-thickness:  120;
  --lg-bezel-width:      40;
  --lg-refraction-scale: 1.6;
  --lg-max-tilt:         8;
  --lg-blur:             0;
  --lg-saturation:       2.0;
  --lg-brightness:       0.5;
  --lg-aberration:       0.8;
  --lg-magnetic-pull:    5;
}

/* Override just for the circular variant */
.my-glass-card--circle {
  --lg-refractive-index: 2.2;
  --lg-bezel-width:      60;
}
```

CSS variables take precedence over the options object when both are present.

### Ripple effect

```ts
LiquidGlass.addRipple(element, event, options?): void
```

```js
element.addEventListener('click', e => {
  LiquidGlass.addRipple(element, e, {
    color:          'rgba(255,255,255,0.6)',
    sizeMultiplier: 4,
    durationMs:     4000,
    easing:         'cubic-bezier(0.16, 1, 0.3, 1)',
    startOpacity:   1,
    endOpacity:     0,
  });
});
```

| Option           | Type     | Default                        | Description                                                                                                                         |
|------------------|----------|--------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|
| `color`          | `string` | `'rgba(255,255,255,0.46)'`     | Colour of the ripple radial gradient centre.                                                                                        |
| `sizeMultiplier` | `number` | `2`                            | Ripple diameter as a multiple of the element's largest dimension. `4` produces a ripple that extends well beyond the element edges. |
| `durationMs`     | `number` | `1200`                         | Animation duration in milliseconds.                                                                                                 |
| `easing`         | `string` | `'cubic-bezier(0.16,1,0.3,1)'` | CSS easing function for the ripple scale animation.                                                                                 |
| `startOpacity`   | `number` | `1`                            | Initial opacity of the ripple.                                                                                                      |
| `endOpacity`     | `number` | `0`                            | Final opacity of the ripple.                                                                                                        |

---

## Slider — `LiquidGlass.createSlider()`

A physics-driven glass thumb that slides along a filled track. The thumb is a real glass surface with its own Snell's Law displacement map. Dragging triggers a scale squish spring. The value readout animates with an odometer-style digit drum.

```ts
LiquidGlass.createSlider(container: string | HTMLElement, options?: SliderOptions): LiquidGlassSlider
```

```js
const slider = LiquidGlass.createSlider('#my-container', {
  value:         30,
  trackWidth:    330,
  labelPosition: 'top',
  labelSticky:   true,
  labelFormatter: v => `${Math.round(v)}%`,
  onChange:  v => console.log('live:',      v),
  onCommit:  v => console.log('committed:', v),
});
```

### Slider options reference

#### Glass optics

| Option            | Type     | Default | Description                                                                                                                                                                                      |
|-------------------|----------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `refractiveIndex` | `number` | `1.45`  | Refractive index of the thumb glass. Slightly lower than surface default for a subtler look on small elements.                                                                                   |
| `glassThickness`  | `number` | `80`    | Virtual glass slab depth for the thumb.                                                                                                                                                          |
| `bezelWidth`      | `number` | `16`    | Rim transition width for the thumb.                                                                                                                                                              |
| `refractionScale` | `number` | `1.2`   | Global refraction multiplier. This value is also modulated by the refraction spring — it increases when the thumb is pressed, creating the effect that squishing glass makes it bend light more. |
| `specularAlpha`   | `number` | `0.4`   | Specular highlight opacity on the thumb rim.                                                                                                                                                     |

#### Track

| Option            | Type     | Default                                    | Description                                                                                                        |
|-------------------|----------|--------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `trackWidth`      | `number` | `330`                                      | Total width of the slider track in pixels.                                                                         |
| `trackHeight`     | `number` | `18`                                       | Height of the track bar in pixels.                                                                                 |
| `trackFill`       | `string` | `'linear-gradient(90deg,#3b82f6,#60a5fa)'` | Any valid CSS `background` value for the filled portion of the track. Accepts gradients, solid colours, or images. |
| `trackBackground` | `string` | `'rgba(255,255,255,0.05)'`                 | Background colour of the unfilled track portion.                                                                   |

#### Thumb

| Option        | Type     | Default | Description                                                                                                                                                                          |
|---------------|----------|---------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `thumbWidth`  | `number` | `90`    | Width of the glass thumb pill in pixels.                                                                                                                                             |
| `thumbHeight` | `number` | `60`    | Height of the glass thumb pill in pixels. The aspect ratio `thumbHeight / thumbWidth` becomes the resting scale applied via `transform: scale()`.                                    |
| `thumbRadius` | `number` | `30`    | Corner radius of the thumb in pixels. `thumbHeight / 2` produces a perfect pill shape.                                                                                               |
| `pressScale`  | `number` | `1`     | The scale target when the thumb is pressed. Values below `1` produce the squish-on-press effect. The actual animation is spring-driven so the transition always overshoots slightly. |

#### Value

| Option  | Type     | Default | Description                       |
|---------|----------|---------|-----------------------------------|
| `value` | `number` | `10`    | Initial value on the 0–100 range. |

#### Value label

| Option           | Type                                     | Default                         | Description                                                                                                                                                                                                          |
|------------------|------------------------------------------|---------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `labelPosition`  | `'top' \| 'bottom' \| 'left' \| 'right'` | —                               | Which side of the track to render the value label. Omit entirely to show no label. `'left'` and `'right'` are always fixed. `'top'` and `'bottom'` can be sticky.                                                    |
| `labelSticky`    | `boolean`                                | `false`                         | When `true` and `labelPosition` is `'top'` or `'bottom'`, the label follows the thumb horizontally as it slides. When `false`, the label is centred over the full track width.                                       |
| `labelDecimals`  | `number`                                 | `0`                             | Number of decimal places shown. `0` = whole numbers, `1` = one decimal, etc. Ignored when `labelFormatter` is set.                                                                                                   |
| `labelFont`      | `string`                                 | `'600 13px/1 Inter,sans-serif'` | CSS `font` shorthand applied to the label element.                                                                                                                                                                   |
| `labelColor`     | `string`                                 | `'rgba(255,255,255,0.8)'`       | Label text colour.                                                                                                                                                                                                   |
| `labelGap`       | `number`                                 | `10`                            | Gap in pixels between the label and the track edge (for `top`/`bottom`) or the container edge (for `left`/`right`).                                                                                                  |
| `labelFormatter` | `(value: number) => string`              | —                               | Custom formatter function. Receives the raw `0–100` value and returns the display string. When provided, overrides `labelDecimals`. Examples: `v => \`${Math.round(v)}%\`` or `v => \`${(v * 0.5).toFixed(1)} dB\``. |

#### Callbacks

| Option     | Type                      | Description                                                                                                                                        |
|------------|---------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|
| `onChange` | `(value: number) => void` | Called on every animation frame during drag with the current live value. Use for real-time updates like driving a CSS property or audio gain node. |
| `onCommit` | `(value: number) => void` | Called once on `pointerup` with the final settled value. Use for saving preferences, network calls, or anything that should not fire at 60 fps.    |

### Slider instance API

```ts
slider.setValue(50);    // Animate to 50 without triggering onCommit
slider.getValue();      // Returns the current value as a number
slider.destroy();       // Cancel rAF, remove SVG filter, clear DOM
```

### Value label and digit drum

When `labelPosition` is set, each digit of the displayed value is rendered in its own isolated drum cell. The drum mechanism:

- Each cell contains three spans: a ghost (invisible, holds layout width), slot A, and slot B
- On every value change, the formatted string is diffed character by character
- Only cells whose character actually changed are animated — static digits never move
- The incoming slot slides in from above or below depending on the direction of change
- Direction is determined per-character, not globally — so a wrap-around like `9→0` while incrementing correctly animates upward (the old digit exits the top, the new one enters from the bottom)
- When the string length changes (e.g. `9→10`), all drums are rebuilt cleanly

The drum animation duration is 240ms with `cubic-bezier(0.16,1,0.3,1)`. This matches the spring ease used for tilt and scale across the library, keeping all motion feeling cohesive.

---

## Switch — `LiquidGlass.createSwitch()`

A physics-driven glass toggle with drag-to-slide, rubber-band overshoot at the ends, and per-state icon cross-fade.

```ts
LiquidGlass.createSwitch(container: string | HTMLElement, options?: SwitchOptions): LiquidGlassSwitch
```

```js
const toggle = LiquidGlass.createSwitch('#my-toggle', {
  checked:      false,
  colorOn:      [99, 102, 241, 0.5],  // indigo with 50% alpha
  colorOff:     [255, 255, 255, 0.05],
  iconOff:      '<i class="fa-solid fa-moon"></i>',
  iconOn:       '<i class="fa-solid fa-sun"></i>',
  iconColorOff: '#8A8A98',
  iconColorOn:  '#ffffff',
  iconSize:     20,
  onChange:     v => console.log('switched:', v),
});
```

### Switch options reference

#### Glass optics

| Option            | Type     | Default | Description                                                             |
|-------------------|----------|---------|-------------------------------------------------------------------------|
| `refractiveIndex` | `number` | `1.5`   | Refractive index of the thumb glass.                                    |
| `glassThickness`  | `number` | `47`    | Virtual glass slab depth for the thumb.                                 |
| `bezelWidth`      | `number` | `19`    | Rim transition width for the thumb.                                     |
| `refractionScale` | `number` | `1.2`   | Global refraction multiplier, driven by the refraction spring on press. |
| `specularAlpha`   | `number` | `0.5`   | Specular highlight opacity on the thumb rim.                            |

#### Track geometry

| Option        | Type     | Default | Description                                                                                                      |
|---------------|----------|---------|------------------------------------------------------------------------------------------------------------------|
| `trackWidth`  | `number` | `160`   | Outer width of the switch track in pixels.                                                                       |
| `trackHeight` | `number` | `67`    | Outer height of the switch track in pixels. The track border-radius is always `trackHeight / 2` (fully rounded). |

#### Thumb geometry

| Option        | Type     | Default | Description                                                                                                                                           |
|---------------|----------|---------|-------------------------------------------------------------------------------------------------------------------------------------------------------|
| `thumbWidth`  | `number` | `146`   | Width of the glass thumb in pixels. The thumb is wider than the track and overflows it — this is by design, matching the original demo.html geometry. |
| `thumbHeight` | `number` | `92`    | Height of the glass thumb in pixels.                                                                                                                  |
| `thumbRadius` | `number` | `46`    | Corner radius of the thumb in pixels.                                                                                                                 |

#### Colours

Colours are specified as 4-element `[R, G, B, A]` arrays where A is `0.0–1.0`. The spring loop interpolates all four channels independently frame-by-frame, producing smooth RGBA transitions without CSS.

| Option     | Type                               | Default                 | Description                                                                                                                                               |
|------------|------------------------------------|-------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `colorOff` | `[number, number, number, number]` | `[255, 255, 255, 0.05]` | Track background colour when the switch is fully OFF.                                                                                                     |
| `colorOn`  | `[number, number, number, number]` | `[139, 92, 246, 0.5]`   | Track background colour when the switch is fully ON. During drag, the colour follows `thumbRatio` so it transitions continuously as the thumb is dragged. |

#### Icons

| Option         | Type     | Default     | Description                                                                                                                                                                             |
|----------------|----------|-------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `iconOff`      | `string` | `''`        | HTML string rendered on the thumb when the switch is OFF. Accepts any inline HTML. See [Icon system](#icon-system) for examples.                                                        |
| `iconOn`       | `string` | `''`        | HTML string rendered on the thumb when the switch is ON.                                                                                                                                |
| `iconColorOff` | `string` | `'#8A8A98'` | CSS colour applied to the OFF icon container. Works as `color` for font icons and fills for SVG icons that use `currentColor`.                                                          |
| `iconColorOn`  | `string` | `'#ffffff'` | CSS colour applied to the ON icon container.                                                                                                                                            |
| `iconSize`     | `number` | `20`        | Applied as `font-size` in pixels on the icon container. For font icons this sets their size directly. For inline SVGs, set `width` and `height` using `em` units to inherit this value. |

#### State and callbacks

| Option     | Type                         | Default | Description                                                                                                                                |
|------------|------------------------------|---------|--------------------------------------------------------------------------------------------------------------------------------------------|
| `checked`  | `boolean`                    | `true`  | Initial state. Springs are seeded at this value so there is no entry animation.                                                            |
| `onChange` | `(checked: boolean) => void` | —       | Fired when the switch commits to a new state. This is after the user releases the pointer. During a drag, no callbacks fire until release. |

### Icon system

Icons are passed as raw HTML strings so you can use any icon library without imposing a dependency:

```js
// Font Awesome 6
iconOff: '<i class="fa-solid fa-moon"></i>',
iconOn:  '<i class="fa-solid fa-sun"></i>',

// Lucide (inline SVG — use currentColor and em sizing)
iconOff: `<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>`,

// Emoji
iconOff: '🌙',
iconOn:  '☀️',

// Plain text
iconOff: 'OFF',
iconOn:  'ON',
```

Icons are cross-faded and scale-animated by the `tc` (track colour) spring. As the thumb travels from OFF to ON:
- The OFF icon fades from `opacity:1` to `opacity:0` and scales from `scale(1)` to `scale(0.8)`
- The ON icon fades from `opacity:0` to `opacity:1` and scales from `scale(0.8)` to `scale(1)`

Both animations are driven by the same spring value, keeping their motion perfectly coupled to the track colour transition. The slight scale bounce adds physical pop that feels connected to the thumb's momentum.

Swap icons at runtime without rebuilding the switch:

```js
toggle.setIcons(
  '<i class="fa-solid fa-wifi"></i>',
  '<i class="fa-solid fa-wifi"></i>'
);
```

### Switch instance API

```ts
toggle.setChecked(true);    // Animate to new state
toggle.isChecked();         // Returns current boolean state
toggle.setIcons(off, on);   // Swap icon HTML strings at runtime
toggle.destroy();           // Cancel rAF, remove SVG filter, clear DOM
```

#### Drag behaviour

The switch supports both tap-to-toggle and drag-to-slide:

- **Tap** (drag distance < 4px): simple toggle, same as clicking
- **Drag**: thumb follows the pointer. The final checked state is determined by whether `thumbRatio > 0.5` at release
- **Rubber-band**: dragging past the ends is allowed with exponential compression (`overshoot / 22`), giving the ends a physical boundary feel without a hard stop
- **Track click**: clicking anywhere on the track outside the thumb also toggles

---

## Architecture deep dive

### Filter cache

`buildGlassFilterAsync` is expensive — it runs the 1D and 2D displacement calculations synchronously before constructing the SVG filter. Results are cached by a key derived from the element's pixel dimensions, border radius, and optical parameters:

```
key = `${W}x${H}r${R}_n${refractiveIndex}_t${glassThickness}_b${bezelWidth}`
```

If two elements share the same geometry and optics, they share the same baked filter. The cache is held on `LiquidGlass.filterCache` as a static `Map<string, FilterCacheResult>`. All factory methods (`init`, `createSlider`, `createSwitch`) pass this shared cache automatically.

Because the filter is async, there is a brief window between construction and filter availability. During this window, the component is fully interactive — springs run, pointer events work — but the glass refraction is not yet visible. The filter upgrades visually once the promise resolves. An `isDestroyed` guard prevents the async callback from writing to a cleared DOM if `destroy()` is called while the filter is building.

### Spring internals

The `Spring` class is a minimal implementation of a critically-damped harmonic oscillator with variable stiffness and damping. It integrates with semi-implicit Euler (velocity updated before position), which is stable at typical game-loop time steps.

```ts
class Spring {
  update(dt: number): number {
    const force = (target - value) * stiffness;
    const damp  = velocity * damping;
    velocity += (force - damp) * dt;
    value    += velocity * dt;
    return value;
  }
}
```

`dt` is clamped to `1/30` (≈ 32ms) so that a tab in the background or a slow frame doesn't cause the spring to overshoot catastrophically on resume. The `isSettled()` check uses `0.001` as the threshold for both displacement and velocity. The rAF loop stops as soon as all springs on a surface have settled, consuming zero CPU when the UI is idle.

### Geometry calculations

The switch thumb position is derived from two precomputed constants that must be recalculated whenever dimensions change (e.g. on window resize):

```text
restScale = thumbHeight / thumbWidth

ro (restOffset) = ((1 - restScale) * thumbWidth) / 2
tr (thumbTravel) = trackWidth - trackHeight - (thumbWidth - thumbHeight) * restScale

tx = -ro + (trackHeight - thumbHeight * restScale) / 2 + xr * tr
```

This formula is ported verbatim from the original Pebble & Void demo.html. `xr` is the position spring value (0 = fully off, 1 = fully on). `sc` (the scale spring) is intentionally not mixed into `tx` — it only drives `transform:scale()`. Mixing scale into the position calculation would cause the thumb to drift left as it grows, which looks wrong.

### Clone-world fallback

On non-Chrome browsers, each glass thumb contains:

```text
.lg-switch-thumb (or .lg-slider-thumb)
  └─ .clone-layer                    ← overflow:hidden clips the filter output
       └─ .clone-inner               ← sized to match the parent scene
                                        filter: url(#filterId) applied here
```

Every frame, the `_loop` method computes the offset between the container's viewport position and the clone-inner's origin and applies it as a `translate()` transform. This keeps the clone perfectly registered with the actual background. The clone's `background` is set to `getComputedStyle(container.parentElement).background` at filter-build time, capturing the scene's background gradient or image.

---

## Playground

Open `index.html` in the repository for a live devtools panel that lets you tweak every parameter in real time. The playground runs three tabs:

**Surface** — all glass optical and backdrop parameters, orb toggle, ripple configuration. Changes rebuild the glass filter and update all three shape variants (pill, circle, square) live.

**Slider** — track dimensions, thumb dimensions, label position/sticky/decimals/colour, glass optics. All changes rebuild the slider instance.

**Switch** — track/thumb dimensions, ON colour picker, label text and colours, checked initial state, glass optics.

The **Export code** button generates the exact `LiquidGlass.init()` / `createSlider()` / `createSwitch()` call matching the current panel state, ready to copy into your project.

All controls are debounced (320–400ms) before triggering a rebuild to avoid thrashing during continuous slider drags.

---

## Browser support

| Feature                           | Chrome | Firefox       | Safari                  | Edge   |
|-----------------------------------|--------|---------------|-------------------------|--------|
| Glass refraction (SVG filter)     | ✅ Full | ✅ Full        | ✅ Full                  | ✅ Full |
| `backdrop-filter: url()` path     | ✅ Yes  | ❌ Clone-world | ❌ Clone-world           | ✅ Yes  |
| Spring physics loop               | ✅      | ✅             | ✅                       | ✅      |
| Mobile tilt (`deviceorientation`) | ✅      | ✅             | ✅ (requires permission) | ✅      |
| Chromatic aberration              | ✅ Full | ✅ Full        | ✅ Full                  | ✅ Full |

The clone-world fallback produces visually identical output to the `backdrop-filter` path on static backgrounds. On animated backgrounds (video, canvas, CSS animations), the clone may lag by one frame since it mirrors the background at style-read time rather than at composite time.

---

## Design constraints and known limits

**One filter per element.** Each glass surface bakes its own displacement map at its own dimensions. If you resize a surface element dynamically (not via window resize), call `surface.rebuild()` or `destroy()` + re-initialise to regenerate the filter at the new size.

**Background must be visible behind the element.** The glass refraction bends the backdrop content. If the element has a fully opaque `background-color`, there is nothing to refract and the effect is invisible. The recommended base style is `background: rgba(255,255,255,0.08)` or similar low-opacity value.

**`overflow:hidden` on the container prevents the orb.** The pointer-follow orb is positioned fixed to the body. If your page clips fixed-position children (e.g. via `transform` on a parent), the orb will not be visible. Disable it with `enableOrb: false` in that case.

**High `refractiveIndex` values clip at total internal reflection.** At `n > ~2.0` a significant portion of the rim samples hit the total-internal-reflection condition (`k < 0`) and are set to zero displacement. This manifests as a flat un-refracted band inside the bezel. This is physically correct behaviour — it is not a bug.

**The filter cache is static.** Filters are never evicted from `LiquidGlass.filterCache`. In an application that creates many uniquely-sized glass elements over time, the cache will grow unboundedly. For long-running SPAs, call `LiquidGlass.filterCache.clear()` when you know old surfaces will not be recreated.

**Calling `destroy()` on a surface instance does not remove it from `LiquidGlass.instances`.** This means the global pointer loop will still call `surface.aim()` on destroyed instances. In practice this is harmless (the spring setTarget calls are no-ops on a settled surface with no rAF running), but for correctness in high-churn applications, also call `LiquidGlass.instances.delete(element)` after `destroy()`.
