import type {ShatterOptions} from "../types/Types.ts";
import {MathUtils} from "../core/Mathutils.ts";
import {Spring} from "../core/Spring.ts";

export class ShatterEngine {
    public static async shatter(
        element: HTMLElement,
        event: MouseEvent | PointerEvent | null,
        options: ShatterOptions = {}
    ): Promise<void> {
        const opts = ShatterEngine._applyDefaults(options);
        const rect = element.getBoundingClientRect();
        const impact = ShatterEngine._calculateImpactPoint(event, opts, rect);

        ShatterEngine._triggerImpactFlash(rect, impact, opts);

        if (opts.hideOrigin) {
            element.style.visibility = 'hidden';
            element.style.pointerEvents = 'none';
        }

        const container = ShatterEngine._createContainer(rect);
        const cs = getComputedStyle(element);

        const seeds = ShatterEngine._generateVoronoiSeeds(rect.width, rect.height, opts.shardCount, impact);
        const polygons = ShatterEngine._calculateVoronoiPolygons(seeds, rect.width, rect.height);
        const shards = ShatterEngine._initializeShards(seeds, polygons, impact, rect, cs, container, opts);

        await ShatterEngine._runPhysicsLoop(shards, impact, rect, container, opts);

        if (opts.hideOrigin) {
            element.style.visibility = '';
            element.style.pointerEvents = '';
        }
        opts.onComplete?.();
    }

    private static _applyDefaults(options: ShatterOptions): Required<ShatterOptions> {
        return {
            shardCount: Math.max(3, options.shardCount ?? 12),
            scattered: options.scattered ?? true,
            velocity: options.velocity ?? 480,
            gravity: options.gravity ?? 900,
            damping: options.damping ?? 14,
            spinMax: options.spinMax ?? 55,
            fadeDelay: options.fadeDelay ?? 320,
            fadeDuration: options.fadeDuration ?? 380,
            edgeShimmer: options.edgeShimmer ?? true,
            edgeShimmerColor: options.edgeShimmerColor ?? 'rgba(255,255,255,0.55)',
            hideOrigin: options.hideOrigin ?? true,
            easing: options.easing ?? 'cubic-bezier(0.16, 1, 0.3, 1)',
            origin: options.origin,
            onComplete: options.onComplete
        } as Required<ShatterOptions>;
    }

    private static _calculateImpactPoint(event: MouseEvent | PointerEvent | null, opts: ShatterOptions, rect: DOMRect): {
        x: number,
        y: number
    } {
        return {
            x: opts.origin?.x ?? (event ? event.clientX - rect.left : rect.width / 2),
            y: opts.origin?.y ?? (event ? event.clientY - rect.top : rect.height / 2)
        };
    }

    // ── DOM Manipulation ──────────────────────────────────────────────────

    private static _triggerImpactFlash(rect: DOMRect, impact: {
        x: number,
        y: number
    }, opts: Required<ShatterOptions>): void {
        const flash = document.createElement('div');
        Object.assign(flash.style, {
            position: 'fixed',
            top: `${rect.top + impact.y - 60}px`,
            left: `${rect.left + impact.x - 60}px`,
            width: '120px', height: '120px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.75) 0%, transparent 70%)',
            pointerEvents: 'none', zIndex: '10000',
            mixBlendMode: 'screen', willChange: 'opacity,transform',
        });
        document.body.appendChild(flash);
        flash.animate(
            [{opacity: 1, transform: 'scale(0.4)'}, {opacity: 0, transform: 'scale(2.8)'}],
            {duration: 320, easing: opts.easing, fill: 'forwards'}
        ).onfinish = () => flash.remove();
    }

    private static _createContainer(rect: DOMRect): HTMLDivElement {
        const container = document.createElement('div');
        Object.assign(container.style, {
            position: 'fixed',
            top: `${rect.top}px`, left: `${rect.left}px`,
            width: `${rect.width}px`, height: `${rect.height}px`,
            pointerEvents: 'none', zIndex: '9999',
            overflow: 'visible', willChange: 'contents',
        });
        document.body.appendChild(container);
        return container;
    }

// ── Mathematical Tessellation ─────────────────────────────────────────

    private static _generateVoronoiSeeds(W: number, H: number, shardCount: number, impact: {
        x: number,
        y: number
    }): [number, number][] {
        const rng = MathUtils._mkRng(0xdeadbeef ^ (W * 1000 + H) | 0);
        const seeds: [number, number][] = [[impact.x, impact.y]];
        const cols = Math.ceil(Math.sqrt(shardCount * (W / H)));
        const rows = Math.ceil(shardCount / cols);
        const minDistanceSq = (Math.min(W, H) / shardCount) ** 2 * 0.25;

        for (let r = 0; r < rows && seeds.length < shardCount; r++) {
            for (let c = 0; c < cols && seeds.length < shardCount; c++) {
                const bx = ((c + 0.5) / cols) * W;
                const by = ((r + 0.5) / rows) * H;
                const sx = Math.max(2, Math.min(W - 2, bx + (rng() - 0.5) * (W / cols) * 0.75));
                const sy = Math.max(2, Math.min(H - 2, by + (rng() - 0.5) * (H / rows) * 0.75));

                const tooClose = seeds.some(([ex, ey]) => (sx - ex) ** 2 + (sy - ey) ** 2 < minDistanceSq);
                if (!tooClose) seeds.push([sx, sy]);
            }
        }
        return seeds;
    }

    private static _calculateVoronoiPolygons(seeds: [number, number][], W: number, H: number): string[] {
        const RAY_DIR = 24;
        return seeds.map(([sx, sy], si) => {
            const verts: [number, number][] = [];
            for (let ri = 0; ri < RAY_DIR; ri++) {
                const ang = (ri / RAY_DIR) * Math.PI * 2;
                const dx = Math.cos(ang), dy = Math.sin(ang);
                let t = 1;
                const max = Math.hypot(W, H) + 2;

                while (t < max) {
                    const px = sx + dx * t, py = sy + dy * t;
                    if (px < 0 || px > W || py < 0 || py > H) break;

                    const myD2 = (px - sx) ** 2 + (py - sy) ** 2;
                    if (seeds.some((seed, j) => j !== si && ((px - seed[0]) ** 2 + (py - seed[1]) ** 2 < myD2))) {
                        break;
                    }
                    t += 3;
                }
                verts.push([Math.max(0, Math.min(W, sx + dx * (t - 1.5))), Math.max(0, Math.min(H, sy + dy * (t - 1.5)))]);
            }
            return `polygon(${verts.map(([vx, vy]) => `${((vx / W) * 100).toFixed(2)}% ${((vy / H) * 100).toFixed(2)}%`).join(', ')})`;
        });
    }

// ── Physics Generation ────────────────────────────────────────────────

    private static _initializeShards(
        seeds: [number, number][], polygons: string[], impact: { x: number, y: number },
        rect: DOMRect, cs: CSSStyleDeclaration, container: HTMLDivElement, opts: Required<ShatterOptions>
    ): any[] {
        const rng = MathUtils._mkRng(0xdeadbeef ^ (rect.width * 1000 + rect.height) | 0);

        return seeds.map(([sx, sy], i) => {
            const dx = sx - impact.x, dy = sy - impact.y;
            const dist = Math.hypot(dx, dy) || 1;
            const angle = Math.atan2(dy, dx) + (rng() - 0.5) * 0.6;

            const speedFactor = opts.scattered ? MathUtils.clamp(1 - dist / Math.hypot(rect.width, rect.height) * 0.6, 0.35, 1.05) : 0;
            const speed = opts.scattered ? opts.velocity * speedFactor * (0.65 + rng() * 0.65) : 0;
            const mass = 1 / (speedFactor + 0.3);
            const shardDamping = opts.damping * mass;

            const spX = new Spring(0, 280, shardDamping);
            const spY = new Spring(0, 280, shardDamping);
            const spRot = new Spring(0, 180, shardDamping * 1.5);

            if (opts.scattered) {
                spX.setTarget(Math.cos(angle) * speed * 0.55);
                spY.setTarget(Math.sin(angle) * speed * 0.55);
                spRot.setTarget((rng() - 0.5) * opts.spinMax * 2);
            } else {
                spX.setTarget((rng() - 0.5) * 8);
                spY.setTarget(4 + rng() * 10);
                spRot.setTarget((rng() - 0.5) * 6);
            }

            const div = document.createElement('div');
            const shimmer = opts.edgeShimmer
                ? `inset 0 0 0 1px ${opts.edgeShimmerColor}, inset 1px 1px 3px rgba(255,255,255,0.28), inset -1px -1px 3px rgba(0,0,0,0.18), 0 4px 18px rgba(0,0,0,0.22)`
                : '0 4px 18px rgba(0,0,0,0.22)';

            Object.assign(div.style, {
                position: 'absolute',
                inset: '0',
                width: `${rect.width}px`,
                height: `${rect.height}px`,
                background: cs.backgroundColor,
                backgroundImage: cs.backgroundImage !== 'none' ? cs.backgroundImage : '',
                backgroundSize: `${rect.width}px ${rect.height}px`,
                backgroundPosition: '0 0',
                borderRadius: cs.borderRadius,
                border: cs.border,
                backdropFilter: cs.backdropFilter !== 'none' ? cs.backdropFilter : '',
                clipPath: polygons[i],
                boxShadow: shimmer,
                willChange: 'transform, opacity',
                transformOrigin: 'center center',
                transform: i === 0 ? 'scale(1.04)' : 'scale(1)',
            });

            container.appendChild(div);
            return {div, spX, spY, spRot, gravVel: 0, done: false, seedX: sx, seedY: sy};
        });
    }

    // ── Animation Loop ────────────────────────────────────────────────────

    private static _runPhysicsLoop(shards: any[], impact: {
        x: number,
        y: number
    }, rect: DOMRect, container: HTMLDivElement, opts: Required<ShatterOptions>): Promise<void> {
        return new Promise(resolve => {
            let lastTs = performance.now();
            let settled = false;

            const loop = (ts: number) => {
                const dt = Math.min((ts - lastTs) / 1000, 0.032);
                lastTs = ts;
                let allSettled = true;

                shards.forEach(s => {
                    if (s.done) return;
                    if (opts.scattered) {
                        s.gravVel += opts.gravity * dt;
                        s.spY.setTarget(s.spY.getTarget() + s.gravVel * dt);
                    }

                    const x = s.spX.update(dt), y = s.spY.update(dt), rot = s.spRot.update(dt);
                    const scl = opts.scattered
                        ? 1 - Math.hypot(x, y) / (Math.hypot(rect.width, rect.height) * 2.5)
                        : 0.94 + (s.spX.isSettled() ? 0 : 0.06 * (1 - Math.abs(rot) / opts.spinMax));

                    s.div.style.transform = `translate(${x.toFixed(2)}px, ${y.toFixed(2)}px) rotate(${rot.toFixed(2)}deg) scale(${Math.max(0.1, scl).toFixed(4)})`;

                    if (!s.spX.isSettled() || !s.spY.isSettled() || !s.spRot.isSettled()) allSettled = false;
                });

                if (!allSettled) {
                    requestAnimationFrame(loop);
                } else if (!settled) {
                    settled = true;
                    let completed = 0;

                    shards.forEach((s, i) => {
                        if (s.done) {
                            completed++;
                            return;
                        }
                        const dist = Math.hypot(s.seedX - impact.x, s.seedY - impact.y);
                        const stagger = opts.scattered ? (dist / Math.hypot(rect.width, rect.height)) * 120 : i * 22;

                        setTimeout(() => {
                            s.div.style.transition = `opacity ${opts.fadeDuration}ms ease, filter ${opts.fadeDuration}ms ease`;
                            s.div.style.opacity = '0';
                            s.div.style.filter = 'blur(2px)';
                            setTimeout(() => {
                                s.div.remove();
                                s.done = true;
                                if (++completed === shards.length) {
                                    container.remove();
                                    resolve();
                                }
                            }, opts.fadeDuration);
                        }, opts.fadeDelay + stagger);
                    });
                }
            };
            requestAnimationFrame(loop);
        });
    }
}
