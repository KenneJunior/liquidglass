# 💧 Liquid Glass Engine

A high-performance, framework-agnostic TypeScript library for simulating physical light refraction, liquid surface tension, and mass-spring kinetics directly in the browser DOM.

Unlike standard "glassmorphism" (which is often just a static `backdrop-filter`), the **Liquid Glass Engine** dynamically calculates **Signed Distance Fields (SDF)** and applies **Snell’s Law** to refract background content. This results in the illusion of a tangible, liquid-filled material that reacts to user input.

---

## 🚀 Why Liquid Glass?

* **Physically Informed**: Uses real-time pixel displacement maps to simulate how light *actually* bends when passing through a medium.
* **Geometric Intelligence**: Automatically parses CSS `border-radius` to determine the refraction boundary—seamlessly supporting rectangles, perfect circles, and capsules.
* **Kinetics Engine**: Features a spring-based physics model for organic squish, stretch, and tilt, eliminating "static" UI feel.
* **Optimized Performance**: Automatically caches generated SVG filters to keep memory consumption low and frame rates high, even with multiple interactive elements.

---

## ✨ Features

* **Real-time Optical Refraction**: Calculates 1D and 2D displacement maps natively to bend light around complex geometry.
* **Universal Geometry**: Automatically handles Standard Rectangles, Perfect Circles, Pill/Capsule shapes, and **Arbitrary SVG Blobs**.
* **Mass-Spring Kinetics**: Built-in physics engine (stiffness/damping) for organic squish, stretch, and tilt interactions.
* **Declarative CSS Hooks**: Drive the engine purely through CSS variables (e.g., `--lg-refractive-index: 1.6;`).
* **Optimized Caching**: Automatically caches filter signatures to prevent memory leaks and redundant re-calculations.
---
## 🛠 Installation

You can integrate the library by importing the core `LiquidGlassSurface` class:

```typescript
import { LiquidGlassSurface } from './path/to/liquid-glass';
```

## 🚀 Quick Start

1.  **Include the Engine**: Include the `LiquidGlassSurface` class in your project.
2.  **Define your element**:
    ```html
    <div class="glass-element" style="border-radius: 20px; width: 300px; height: 150px;">
    </div>
    ```
3.  **Initialize**:
    ```javascript
    const el = document.querySelector('.glass-element');
    const surface = new LiquidGlassSurface(el);

    // Add interactivity
    el.addEventListener('pointermove', (e) => {
        const rect = el.getBoundingClientRect();
        const nx = (e.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
        const ny = (e.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
        surface.aim(nx, ny); 
     document.querySelectorAll('.glass-element').forEach(card => {
        card.addEventListener('click', (e) => {
            LiquidGlass.addRipple(card, e);
        });
    });
    });
    ```
    OR
4. **Use the built-in auto-aim**:
    ```javascript
    LiquidGlass.init('.glass-element');    
   document.querySelectorAll('.glass-element').forEach(card => {
        card.addEventListener('click', (e) => {
            LiquidGlass.addRipple(card, e);
        });
    });
   ```

## ⚙️ Customization (CSS Variables)

You can customize the optics of any element without touching the JavaScript:

| Variable                | Description                          | Default |
|:------------------------|:-------------------------------------|:--------|
| `--lg-refractive-index` | The intensity of the light bending   | `1.6`   |
| `--lg-glass-thickness`  | The 'depth' of the glass             | `120`   |
| `--lg-bezel-width`      | The width of the edge refraction     | `28`    |
| `--lg-refraction-scale` | Multiplier for the distortion effect | `1.2`   |
| `--lg-max-tilt`         | Degrees of rotation when aiming      | `7`     |

## 🎨 Advanced Masking
To use a custom shape, simply add the `data-lg-mask` attribute to your element pointing to an SVG path or image:
```html
<div class="glass-element" data-lg-mask="path/to/mask.svg"></div>
```
## 🧩 Compatibility
The Liquid Glass Engine is designed to work in modern browsers that support:
* CSS Variables
* CSS Backdrop Filters
* Pointer Events
* Canvas or WebGL for rendering (depending on the implementation)

## 🔎 Troubleshooting
If you encounter issues:
* Refraction not rendering? Ensure the element has a background color with some opacity (e.g.,` rgba(255,255,255,0.05)`).
`backdrop-filter` requires a non-opaque surface to calculate the underlying blur.
* Performance issues? Check if multiple elements are using the engine simultaneously. Consider throttling pointer events
or reducing the number of active surfaces.Also, If you have many elements, ensure they are not all using custom
`data-lg-mask` files, as this prevents SVG cache sharing 
* Motion sickness? The library respects the system-wide `prefers-reduced-motion` media query automatically.
You can also force it via `new LiquidGlassSurface(el, { reducedMotion: true })`.
## 📜 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details
