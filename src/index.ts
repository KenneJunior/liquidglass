// ============================================================
// LIQUID GLASS LIBRARY (v4 - TypeScript Edition)
// ============================================================

export interface LiquidGlassOptions {
    refractiveIndex?: number;
    glassThickness?: number;
    bezelWidth?: number;
    refractionScale?: number;
    specularAlpha?: number;
    maxTilt?: number;
    reducedMotion?: boolean;
    enableOrb?: boolean;
    orbColor?: string;
    enableMobileSupport?: boolean;
}

interface FilterCacheResult {
    id: string;
    maxDisp: number;
    mapEl: SVGFEDisplacementMapElement | null;
    svg: SVGSVGElement;
}

class Spring {
    private value: number;
    private target: number;
    private velocity: number;
    private readonly stiffness: number;
    private readonly damping: number;

    constructor(v: number, s = 300, d = 20) {
        this.value = v;
        this.target = v;
        this.velocity = 0;
        this.stiffness = s;
        this.damping = d;
    }
    setTarget(t: number) { this.target = t; }
    update(dt: number) {
        const f = (this.target - this.value) * this.stiffness;
        const dmp = this.velocity * this.damping;
        this.velocity += (f - dmp) * dt;
        this.value += this.velocity * dt;
        return this.value;
    }
    isSettled() {
        return Math.abs(this.target - this.value) < 0.001 && Math.abs(this.velocity) < 0.001;
    }
}

// Math & Optics Utilities
const utils = {
    clamp: (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi),
    surfaceProfile: (x: number) => Math.pow(1 - Math.pow(1 - x, 4), 0.25),

    getCssVar: (el: HTMLElement, prop: string, fallback: number | boolean): any => {
        const val = getComputedStyle(el).getPropertyValue(prop).trim();
        return val !== '' ? parseFloat(val) : fallback;
    },

    loadImage: (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
        const img = new Image();
        if (src.startsWith('http')) img.crossOrigin = "Anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
    }),

    calculateDisplacementFromAlpha: (maskImg: HTMLImageElement, W: number, H: number, _bw: number, maxD: number) => {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return new ImageData(W, H);

        ctx.drawImage(maskImg, 0, 0, W, H);
        const srcData = ctx.getImageData(0, 0, W, H).data;
        const outImg = new ImageData(W, H);
        const outData = outImg.data;

        for (let i = 0; i < outData.length; i += 4) {
            outData[i] = outData[i + 1] = 128;
            outData[i + 3] = 255;
        }

        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                const idx = (y * W + x) * 4;
                const alpha = srcData[idx + 3];

                if (alpha > 0) {
                    const aTop = srcData[((y - 1) * W + x) * 4 + 3] || 0;
                    const aBot = srcData[((y + 1) * W + x) * 4 + 3] || 0;
                    const aLef = srcData[(y * W + (x - 1)) * 4 + 3] || 0;
                    const aRig = srcData[(y * W + (x + 1)) * 4 + 3] || 0;

                    const dX = (aLef - aRig) / 255;
                    const dY = (aTop - aBot) / 255;

                    outData[idx] = Math.max(0, Math.min(255, 128 + dX * 127 * (maxD || 1)));
                    outData[idx + 1] = Math.max(0, Math.min(255, 128 + dY * 127 * (maxD || 1)));
                }
            }
        }
        return outImg;
    },

    calculateDisplacementMap1D: (gt: number, bw: number, shapeFn: (arg0: number) => number, ri: number, samples = 128) => {
        const eta = 1 / ri;
        const result: number[] = [];
        for (let i = 0; i < samples; i++) {
            const x = i / samples;
            const y = shapeFn(x);
            const dx = 0.0001;
            const dy = (shapeFn(Math.min(1, x + dx)) - shapeFn(Math.max(0, x - dx))) / (2 * dx);
            const mag = Math.sqrt(dy * dy + 1);
            const nx = -dy / mag, ny = -1 / mag;
            const cosI = ny;
            const k = 1 - eta * eta * (1 - cosI * cosI);
            if (k < 0) result.push(0);
            else {
                const sqrtk = Math.sqrt(k);
                const rf0 = -(eta * cosI + sqrtk) * nx;
                const rf1 = eta - (eta * cosI + sqrtk) * ny;
                result.push(rf1 !== 0 ? rf0 * ((y * bw + gt) / rf1) : 0);
            }
        }
        return result;
    },

    calculateDisplacementMap2D: (cW: number, cH: number, oW: number, oH: number, rad: number, bw: number, maxD: number, profile: number[]) => {
        const img = new ImageData(cW, cH);
        const data = img.data;
        for (let i = 0; i < data.length; i += 4) {
            data[i] = data[i + 1] = 128;
            data[i + 3] = 255;
        }
        const rSq = rad * rad, rp1Sq = (rad + 1) ** 2, rmBwSq = Math.max(0, rad - bw) ** 2;
        const wB = oW - rad * 2, hB = oH - rad * 2;
        const oX = (cW - oW) / 2, oY = (cH - oH) / 2;
        const safeMaxD = maxD || 1;

        for (let y1 = 0; y1 < oH; y1++) {
            for (let x1 = 0; x1 < oW; x1++) {
                let cx = 0, cy = 0;
                if (x1 < rad) cx = x1 - rad;
                else if (x1 >= oW - rad) cx = x1 - rad - wB;
                if (y1 < rad) cy = y1 - rad;
                else if (y1 >= oH - rad) cy = y1 - rad - hB;

                const dSq = cx * cx + cy * cy;
                if (dSq <= rp1Sq && dSq >= rmBwSq) {
                    const dist = Math.sqrt(dSq);
                    const op = dSq < rSq ? 1 : 1 - (dist - rad) / (Math.sqrt(rp1Sq) - rad);
                    const bIdx = Math.floor(Math.max(0, Math.min(1, (rad - dist) / bw)) * (profile.length - 1));
                    const dVal = profile[bIdx] || 0;
                    const dX = (-(dist > 0 ? cx / dist : 0) * dVal) / safeMaxD;
                    const dY = (-(dist > 0 ? cy / dist : 0) * dVal) / safeMaxD;
                    const idx = ((oY + y1) * cW + oX + x1) * 4;
                    data[idx] = Math.max(0, Math.min(255, 128 + dX * 127 * op));
                    data[idx + 1] = Math.max(0, Math.min(255, 128 + dY * 127 * op));
                }
            }
        }
        return img;
    },

    calculateSpecularHighlight: (oW: number, oH: number, rad: number) => {
        const img = new ImageData(oW, oH);
        const data = img.data;
        const light = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)];
        const rSq = rad * rad, rp1Sq = (rad + 1) ** 2, rmSSq = Math.max(0, (rad - 1.5) ** 2);

        for (let y1 = 0; y1 < oH; y1++) {
            for (let x1 = 0; x1 < oW; x1++) {
                let cx = 0, cy = 0;
                if (x1 < rad) cx = x1 - rad;
                else if (x1 >= oW - rad) cx = x1 - rad - (oW - rad * 2);
                if (y1 < rad) cy = y1 - rad;
                else if (y1 >= oH - rad) cy = y1 - rad - (oH - rad * 2);

                const dSq = cx * cx + cy * cy;
                if (dSq <= rp1Sq && dSq >= rmSSq) {
                    const dist = Math.sqrt(dSq);
                    const op = dSq < rSq ? 1 : 1 - (dist - rad) / (Math.sqrt(rp1Sq) - rad);
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
    },

    imageDataToObjectURL: (d: ImageData): Promise<string> => {
        return new Promise(resolve => {
            const c = document.createElement("canvas");
            c.width = d.width;
            c.height = d.height;
            c.getContext("2d")?.putImageData(d, 0, 0);
            c.toBlob(blob => resolve(URL.createObjectURL(blob as Blob)), "image/png");
        });
    }
};

let _filterId = 0;

async function buildGlassFilterAsync(
    el: HTMLElement,
    opts: Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>,
    cacheMap: Map<string, FilterCacheResult>
): Promise<FilterCacheResult> {
    const rect = el.getBoundingClientRect();
    const W = Math.round(rect.width) || 440;
    const H = Math.round(rect.height) || 260;
    const R = parseInt(getComputedStyle(el).borderRadius) || 26;
    const maskUrl = el.getAttribute('data-lg-mask');

    const cacheKey = `${W}_${H}_${R}_${opts.refractiveIndex}_${opts.glassThickness}_${maskUrl || 'rect'}`;

    if (cacheMap.has(cacheKey)) return cacheMap.get(cacheKey)!;

    const id = `lq-filter-${++_filterId}`;
    const mapId = `${id}-map`;

    const profile = utils.calculateDisplacementMap1D(opts.glassThickness, opts.bezelWidth, utils.surfaceProfile, opts.refractiveIndex);
    const maxDisp = Math.max(...profile.map(Math.abs)) || 1;

    let dispData: ImageData;

    if (maskUrl) {
        const maskImg = await utils.loadImage(maskUrl);
        maskImg.width = W;
        maskImg.height = H;

        dispData = utils.calculateDisplacementFromAlpha(maskImg, W, H, opts.bezelWidth, maxDisp);

        el.style.maskImage = `url('${maskUrl}')`;
        el.style.webkitMaskImage = `url('${maskUrl}')`;
        el.style.maskSize = '100% 100%';
        el.style.webkitMaskSize = '100% 100%';
        el.style.maskRepeat = 'no-repeat';
        el.style.webkitMaskRepeat = 'no-repeat';
    } else {
        dispData = utils.calculateDisplacementMap2D(W, H, W, H, R, opts.bezelWidth, maxDisp, profile);
    }

    const specData = utils.calculateSpecularHighlight(W, H, R);
    const [dispURL, specURL] = await Promise.all([
        utils.imageDataToObjectURL(dispData),
        utils.imageDataToObjectURL(specData)
    ]);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;";
    svg.innerHTML = `
    <defs>
      <filter id="${id}" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
        <feGaussianBlur in="SourceGraphic" stdDeviation="0.6" result="blurred"/>
        <feImage href="${dispURL}" x="0" y="0" width="${W}" height="${H}" result="disp_map" preserveAspectRatio="none"/>
        <feDisplacementMap id="${mapId}" in="blurred" in2="disp_map" scale="${maxDisp * opts.refractionScale}" xChannelSelector="R" yChannelSelector="G" result="displaced"/>
        <feColorMatrix in="displaced" type="saturate" values="1.35" result="saturated"/>
        <feImage href="${specURL}" x="0" y="0" width="${W}" height="${H}" result="specular" preserveAspectRatio="none"/>
        <feComponentTransfer in="specular" result="spec_faded">
          <feFuncA type="linear" slope="${opts.specularAlpha}"/>
        </feComponentTransfer>
        <feBlend in="spec_faded" in2="saturated" mode="screen"/>
      </filter>
    </defs>`;

    document.body.appendChild(svg);

    const result: FilterCacheResult = { id, maxDisp, mapEl: svg.querySelector(`#${mapId}`), svg };
    cacheMap.set(cacheKey, result);
    return result;
}

export class LiquidGlassSurface {
    private el: HTMLElement;
    private cacheMap: Map<string, FilterCacheResult>;
    private jsOptions: LiquidGlassOptions;
    private _af: number | null;
    private lastTime: number;
    private opts!: Required<Omit<LiquidGlassOptions, 'enableOrb' | 'orbColor' | 'enableMobileSupport'>>;
    private sp: {
        tiltX: Spring;
        tiltY: Spring;
        shadowY: Spring;
        shadowBlur: Spring;
        shadowA: Spring;
        refrScale: Spring;
    };
    private _inner?: HTMLDivElement;
    private _filter?: FilterCacheResult;
    private _resizeObserver?: ResizeObserver;
    private _lastW?: number;
    private _lastH?: number;

    constructor(el: HTMLElement, jsOptions: LiquidGlassOptions = {}, cacheMap: Map<string, FilterCacheResult>) {
        this.el = el;
        this.cacheMap = cacheMap;
        this.jsOptions = jsOptions;
        this._af = null;
        this.lastTime = performance.now();

        this.syncCssVariables();

        const motionScale = this.opts.reducedMotion ? 50 : 1;
        this.sp = {
            tiltX: new Spring(0, 280 / motionScale, 22),
            tiltY: new Spring(0, 280 / motionScale, 22),
            shadowY: new Spring(4, 380 / motionScale, 26),
            shadowBlur: new Spring(12, 380 / motionScale, 26),
            shadowA: new Spring(0.12, 200 / motionScale, 18),
            refrScale: new Spring(1, 380 / motionScale, 26),
        };

        this._setupResizeObserver();
        this._initAsync();
    }

    syncCssVariables() {
        this.opts = {
            refractiveIndex: utils.getCssVar(this.el, '--lg-refractive-index', this.jsOptions.refractiveIndex || 1.6),
            glassThickness: utils.getCssVar(this.el, '--lg-glass-thickness', this.jsOptions.glassThickness || 120),
            bezelWidth: utils.getCssVar(this.el, '--lg-bezel-width', this.jsOptions.bezelWidth || 28),
            refractionScale: utils.getCssVar(this.el, '--lg-refraction-scale', this.jsOptions.refractionScale || 1.2),
            specularAlpha: utils.getCssVar(this.el, '--lg-specular-alpha', this.jsOptions.specularAlpha || 0.75),
            maxTilt: utils.getCssVar(this.el, '--lg-max-tilt', this.jsOptions.maxTilt || 7),
            reducedMotion: this.jsOptions.reducedMotion ?? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        };
    }

    async _initAsync() {
        this._filter = await buildGlassFilterAsync(this.el, this.opts, this.cacheMap);
        this._buildInner();
        this.el.style.transformStyle = 'preserve-3d';
        this.el.style.willChange = 'transform';
        const bf = `url(#${this._filter.id})`;
        this.el.style.backdropFilter = bf;
        this.el.style.setProperty('--lg-backdrop-filter', bf);
    }

    private _buildInner() {
        if (this.el.querySelector('.liquid-glass-inner')) return;
        const d = document.createElement('div');
        d.className = 'liquid-glass-inner';
        d.setAttribute('aria-hidden', 'true');
        Object.assign(d.style, {
            position: 'absolute', inset: '0', borderRadius: 'inherit',
            pointerEvents: 'none', zIndex: '2',
            background: 'linear-gradient(135deg, rgba(255,255,255,0.20) 0%, rgba(255,255,255,0.04) 40%, rgba(255,255,255,0.00) 60%, rgba(255,255,255,0.07) 100%)',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(0,0,0,0.10)',
        });
        this.el.appendChild(d);
        this._inner = d;
    }

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

    async _rebuild() {
        this.syncCssVariables();
        this._filter = await buildGlassFilterAsync(this.el, this.opts, this.cacheMap);
        const bf = `url(#${this._filter.id})`;
        this.el.style.backdropFilter = bf;
        this.el.style.setProperty('--lg-backdrop-filter', bf);
    }

    aim(nx: number, ny: number) {
        this.syncCssVariables();

        if (this.opts.reducedMotion) {
            this.el.style.transform = `perspective(900px) rotateX(${ny * -this.opts.maxTilt}deg) rotateY(${nx * this.opts.maxTilt}deg)`;
            const sy = 12 + Math.abs(ny) * 14, sb = 18 + Math.abs(ny) * 22, sa = 0.18 + Math.abs(ny) * 0.14;
            this.el.style.boxShadow = `0 ${sy}px ${sb}px rgba(0,0,0,${sa})`;
            if (this._filter?.mapEl) {
                const rs = 1 + Math.sqrt(nx * nx + ny * ny) * 0.22;
                this._filter.mapEl.setAttribute('scale', (this._filter.maxDisp * this.opts.refractionScale * rs).toString());
            }
            return;
        }

        this.sp.tiltX.setTarget(ny * -this.opts.maxTilt);
        this.sp.tiltY.setTarget(nx * this.opts.maxTilt);
        this.sp.shadowY.setTarget(12 + Math.abs(ny) * 14);
        this.sp.shadowBlur.setTarget(18 + Math.abs(ny) * 22);
        this.sp.shadowA.setTarget(0.18 + Math.abs(ny) * 0.14);
        this.sp.refrScale.setTarget(1 + Math.sqrt(nx * nx + ny * ny) * 0.22);
        this._kick();
    }

    rest() {
        if (this.opts.reducedMotion) {
            this.el.style.transform = `perspective(900px) rotateX(0deg) rotateY(0deg)`;
            this.el.style.boxShadow = `0 4px 12px rgba(0,0,0,0.12)`;
            if (this._filter?.mapEl) {
                this._filter.mapEl.setAttribute('scale', (this._filter.maxDisp * this.opts.refractionScale).toString());
            }
            return;
        }

        this.sp.tiltX.setTarget(0);
        this.sp.tiltY.setTarget(0);
        this.sp.shadowY.setTarget(4);
        this.sp.shadowBlur.setTarget(12);
        this.sp.shadowA.setTarget(0.12);
        this.sp.refrScale.setTarget(1);
        this._kick();
    }

    private _kick() {
        if (!this._af && this._filter) {
            this._af = requestAnimationFrame(ts => this._loop(ts));
        }
    }

    private _loop(ts?: number) {
        const now = ts || performance.now();
        const dt = Math.min((now - this.lastTime) / 1000, 0.032);
        this.lastTime = now;

        const rx = this.sp.tiltX.update(dt), ry = this.sp.tiltY.update(dt);
        const sy = this.sp.shadowY.update(dt), sb = this.sp.shadowBlur.update(dt), sa = this.sp.shadowA.update(dt);
        const rs = this.sp.refrScale.update(dt);

        this.el.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
        this.el.style.boxShadow = `0 ${sy}px ${sb}px rgba(0,0,0,${sa})`;

        if (this._filter?.mapEl) {
            this._filter.mapEl.setAttribute('scale', (this._filter.maxDisp * this.opts.refractionScale * rs).toString());
        }

        if (!Object.values(this.sp).every(s => s.isSettled())) {
            this._af = requestAnimationFrame(ts => this._loop(ts));
        } else {
            this._af = null;
        }
    }

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

    static injectBaseStyles() {
        if (document.getElementById('liquid-glass-base-styles')) return;
        const style = document.createElement('style');
        style.id = 'liquid-glass-base-styles';
        style.textContent = `
      @keyframes liquid-glass-ripple-anim {
        from { transform: scale(0); opacity: 1; }
        to { transform: scale(1); opacity: 0; }
      }
    `;
        document.head.appendChild(style);
    }

    static init(selector: string, options: LiquidGlassOptions = {}) {
        this.injectBaseStyles();
        document.querySelectorAll<HTMLElement>(selector).forEach(el => {
            if (!this.instances.has(el)) {
                this.instances.set(el, new LiquidGlassSurface(el, options, this.filterCache));
            }
        });

        if (options.enableOrb !== false && !this.orb) {
            this.createOrb(options.orbColor);
        }

        if (!this.isTracking) {
            this.bindEvents();
            this.isTracking = true;
        }

        if (options.enableMobileSupport !== false && !this.isMobileTracking) {
            this.enableMobileSupport();
            this.isMobileTracking = true;
        }
    }

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

    static bindEvents() {
        const updateSurfaces = () => {
            this.instances.forEach((surface, el) => {
                const rect = el.getBoundingClientRect();
                const M = 100;
                const near = this._lx > rect.left - M && this._lx < rect.right + M && this._ly > rect.top - M && this._ly < rect.bottom + M;

                if (near) {
                    const nx = utils.clamp((this._lx - (rect.left + rect.width / 2)) / (rect.width / 2), -1, 1);
                    const ny = utils.clamp((this._ly - (rect.top + rect.height / 2)) / (rect.height / 2), -1, 1);
                    surface.aim(nx, ny);
                } else {
                    surface.rest();
                }
            });
        };

        document.addEventListener('pointermove', (e: PointerEvent) => {
            if (e.pointerType === 'touch') return;
            this._lx = e.clientX;
            this._ly = e.clientY;

            if (this.orb) {
                this.orb.style.left = this._lx + 'px';
                this.orb.style.top = this._ly + 'px';
                this.orb.style.opacity = '1';
            }

            if (!this._raf) {
                this._raf = requestAnimationFrame(() => {
                    this._raf = null;
                    updateSurfaces();
                });
            }
        });

        document.addEventListener('pointerleave', () => {
            if (this.orb) this.orb.style.opacity = '0';
            this.instances.forEach(s => s.rest());
        });
    }

    static enableMobileSupport() {
        window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
            if (!e.gamma || !e.beta) return;
            const nx = utils.clamp(e.gamma / 45, -1, 1);
            const ny = utils.clamp(e.beta / 45, -1, 1);

            if (!this._raf) {
                this._raf = requestAnimationFrame(() => {
                    this._raf = null;
                    this.instances.forEach(surface => surface.aim(nx, ny));
                });
            }
        });
    }

    static addRipple(element: Element, event: MouseEvent | PointerEvent, color = 'rgba(255,255,255,.26)') {
        const r = element.getBoundingClientRect();
        const size = Math.max(r.width, r.height) * 2;
        const rip = document.createElement('span');
        Object.assign(rip.style, {
            position: 'absolute',
            width: size + 'px', height: size + 'px', borderRadius: '50%',
            left: (event.clientX - r.left - size / 2) + 'px',
            top: (event.clientY - r.top - size / 2) + 'px',
            background: color, transform: 'scale(0)',
            animation: 'liquid-glass-ripple-anim .55s cubic-bezier(.16,1,.3,1) forwards',
            pointerEvents: 'none'
        });
        element.appendChild(rip);
        rip.addEventListener('animationend', () => rip.remove(), { once: true });
    }
}