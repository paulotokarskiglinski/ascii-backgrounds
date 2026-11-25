import { writeClearZones, type ClearBox } from './clear.ts';
import { colorToRGB, type RGB } from './color.ts';
import { MAX_CLEAR, MAX_POINTS, MAX_PULSES, MAX_SEGMENTS, MAX_TRAIL } from './limits.ts';
import { resolveOptions, type ResolvedOptions } from './options.ts';
import { getRenderer, type Atlas, type FieldLike, type Renderer, type Target } from './renderer.ts';
import type {
  BackgroundHandle,
  BackgroundOptions,
  BackgroundUpdate,
  Preset,
  PresetContext,
  PresetState,
  PulseAt,
  PulseFrom,
} from './types.ts';

const TRAIL_LIFE = 0.9;
const PULSE_LIFE = 2.6;
const CURSOR_RADIUS = { trail: 34, lantern: 170 } as const;

interface Layer {
  preset: Preset;
  state: PresetState | null;
  ctx: PresetContext;
}

function makeLayer(preset: Preset): Layer {
  return {
    preset,
    state: preset.create ? preset.create() : null,
    ctx: {
      time: 0,
      dt: 0,
      width: 0,
      height: 0,
      cellSize: 12,
      pointer: { x: 0, y: 0, inside: false },
      points: new Float32Array(MAX_POINTS * 4),
      pointCount: 0,
      segments: new Float32Array(MAX_SEGMENTS * 4),
      segmentCount: 0,
    },
  };
}

class Field implements FieldLike, BackgroundHandle {
  readonly supported = true;
  readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly r: Renderer;
  private readonly ctx2d: CanvasRenderingContext2D;
  private user: BackgroundOptions;
  private opts: ResolvedOptions;
  private layer: Layer;
  private prev: Layer | null = null;
  private fadeStart = 0;
  private fadeDuration = 0;

  private time = 0;
  private rtime = 0;
  private _playing: boolean;
  private visible = false;
  private destroyed = false;
  private broken = false;
  private needsRender = true;
  private layoutDirty = true;

  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private W = 0;
  private H = 0;
  private cellPx = 0;
  private cols = 0;
  private rows = 0;

  private gen = -1;
  private targets: Target[] = [];
  private atlas: Atlas | null = null;

  private ink: RGB = [0.5, 0.5, 0.5];
  private accent: RGB = [1, 1, 1];

  private pointerLocal = { x: 0, y: 0, inside: false };
  private trail: { x: number; y: number; t: number }[] = [];
  private pulses: { x: number; y: number; t: number; s: number }[] = [];
  private lantern = { x: 0, y: 0, s: 0 };
  private readonly trailBuf = new Float32Array(MAX_TRAIL * 4);
  private readonly pulseBuf = new Float32Array(MAX_PULSES * 4);
  private readonly clearBuf = new Float32Array(MAX_CLEAR * 4);
  private readonly featherBuf = new Float32Array(MAX_CLEAR);

  private readonly saved: { position: string; isolation: string };
  private readonly resizeObserver: ResizeObserver | null;
  private readonly intersectionObserver: IntersectionObserver | null;

  constructor(host: HTMLElement, options: BackgroundOptions, renderer: Renderer) {
    this.host = host;
    this.r = renderer;
    this.user = { ...options };
    this.opts = resolveOptions(this.user);
    this.r.fieldProgram(options.preset); // fail fast on GLSL errors
    this.layer = makeLayer(options.preset);
    this._playing = this.opts.autoplay;

    const canvas = document.createElement('canvas');
    canvas.className = 'ascii-background';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none;z-index:-1;border-radius:inherit;';
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('ascii-backgrounds: 2D canvas unavailable');
    this.canvas = canvas;
    this.ctx2d = ctx;

    this.saved = { position: host.style.position, isolation: host.style.isolation };
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.style.isolation = 'isolate';
    host.prepend(canvas);

    this.updateColors();

    this.resizeObserver =
      typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            this.layoutDirty = true;
            this.needsRender = true;
            this.r.wake();
          })
        : null;
    this.resizeObserver?.observe(host);
    this.observeClear();

    if (typeof IntersectionObserver === 'function') {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          const e = entries[entries.length - 1];
          if (!e) return;
          this.visible = e.isIntersecting;
          if (this.visible) this.r.wake();
        },
        { rootMargin: '100px' },
      );
      this.intersectionObserver.observe(host);
    } else {
      this.intersectionObserver = null;
      this.visible = true;
    }

    this.r.add(this);
  }

  // ---- public handle ---------------------------------------------------

  get playing(): boolean {
    return this._playing;
  }

  update(patch: BackgroundUpdate): void {
    if (this.destroyed) return;
    const { preset, ...rest } = patch;
    this.user = { ...this.user, ...rest };
    if (preset && preset !== this.layer.preset) {
      this.setPreset(preset);
      return;
    }
    this.applyOptions();
  }

  setPreset(preset: Preset, options: { fade?: number } = {}): void {
    if (this.destroyed || preset === this.layer.preset) return;
    this.r.fieldProgram(preset); // throws on GLSL errors, before anything changes
    const fade = typeof options.fade === 'number' && Number.isFinite(options.fade) ? Math.max(0, options.fade) : 0.8;
    const animate = fade > 0 && this.visible && this.isAnimating() && this.gen === this.r.gen;
    this.prev = animate ? this.layer : null;
    this.fadeStart = this.rtime;
    this.fadeDuration = fade;
    this.layer = makeLayer(preset);
    this.user = { ...this.user, preset };
    this.applyOptions();
  }

  pulse(at?: PulseAt | PulseFrom): void {
    if (this.destroyed) return;
    const w = this.cssW || this.host.clientWidth;
    const h = this.cssH || this.host.clientHeight;
    let x = w / 2;
    let y = h / 2;
    if (at && 'element' in at) {
      const o = this.origin();
      const rect = at.element.getBoundingClientRect();
      x = rect.left + rect.width / 2 - o.x;
      y = rect.top + rect.height / 2 - o.y;
    } else if (at) {
      x = at.x * w;
      y = at.y * h;
    }
    this.addPulse(x, y, at?.strength ?? 1);
    this.r.wake();
  }

  play(): void {
    if (this.destroyed) return;
    this._playing = true;
    this.r.wake();
  }

  pause(): void {
    this._playing = false;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.r.remove(this);
    this.freeGpu();
    this.canvas.remove();
    this.host.style.position = this.saved.position;
    this.host.style.isolation = this.saved.isolation;
  }

  // ---- renderer callbacks ----------------------------------------------

  envChanged(): void {
    this.updateColors();
    this.needsRender = true;
  }

  pointerDown(clientX: number, clientY: number): void {
    if (this.destroyed || !this.visible || this.opts.cursor === false || !this.isAnimating()) return;
    const o = this.origin();
    const x = clientX - o.x;
    const y = clientY - o.y;
    if (x >= 0 && y >= 0 && x <= this.host.clientWidth && y <= this.host.clientHeight) this.addPulse(x, y, 1);
  }

  frame(dt: number): boolean {
    if (this.destroyed || this.broken || !this.visible) return false;
    if ((window.devicePixelRatio || 1) !== this.lastDpr) this.layoutDirty = true;
    const animating = this.isAnimating();
    if (!animating && !this.needsRender && !this.layoutDirty) return false;
    this.needsRender = false;
    try {
      this.render(animating ? dt : 0);
    } catch (err) {
      this.broken = true;
      console.error(err);
      return false;
    }
    return animating;
  }

  // ---- internals -------------------------------------------------------

  private lastDpr = 0;

  private isAnimating(): boolean {
    return this._playing && !this.reducedMotion() && !(typeof document !== 'undefined' && document.hidden);
  }

  private reducedMotion(): boolean {
    return this.opts.reducedMotion ?? this.r.motionQuery?.matches ?? false;
  }

  private applyOptions(): void {
    const before = this.opts;
    this.opts = resolveOptions(this.user);
    if (before.cellSize !== this.opts.cellSize || before.maxPixelRatio !== this.opts.maxPixelRatio) {
      this.layoutDirty = true;
    }
    if (this.opts.cursor !== before.cursor) {
      this.trail.length = 0;
      this.lantern.s = 0;
    }
    this.updateColors();
    this.observeClear();
    this.needsRender = true;
    this.r.wake();
  }

  private updateColors(): void {
    const theme =
      this.opts.theme === 'auto' ? (this.r.darkQuery?.matches ? 'dark' : 'light') : this.opts.theme;
    this.ink = colorToRGB(this.opts.palette.ink[theme], this.host);
    this.accent = colorToRGB(this.opts.palette.accent[theme], this.host);
  }

  private observeClear(): void {
    if (!this.resizeObserver) return;
    this.resizeObserver.disconnect();
    this.resizeObserver.observe(this.host);
    for (const z of this.opts.clear) this.resizeObserver.observe(z.element);
  }

  /** Top-left of the padding box in client coordinates (where the canvas sits). */
  private origin(rect: DOMRect = this.host.getBoundingClientRect()): { x: number; y: number } {
    return { x: rect.left + this.host.clientLeft, y: rect.top + this.host.clientTop };
  }

  private addPulse(x: number, y: number, s: number): void {
    this.pulses.push({ x, y, t: this.rtime, s });
    if (this.pulses.length > MAX_PULSES) this.pulses.shift();
  }

  private layout(): void {
    this.layoutDirty = false;
    const r = this.r;
    const cssW = this.host.clientWidth;
    const cssH = this.host.clientHeight;
    const deviceRatio = window.devicePixelRatio || 1;
    this.lastDpr = deviceRatio;
    let dpr = Math.min(deviceRatio, this.opts.maxPixelRatio);
    dpr = Math.min(dpr, r.maxSize / Math.max(cssW, cssH, 1));
    const cellPx = Math.max(2, Math.round(this.opts.cellSize * dpr));
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    this.cssW = cssW;
    this.cssH = cssH;
    this.dpr = dpr;
    this.cellPx = cellPx;
    this.W = W;
    this.H = H;
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
  }

  /** Creates or resizes GPU resources to match the layout, charset and font. */
  private syncGpu(): void {
    const r = this.r;
    if (this.gen !== r.gen) {
      // Context was restored (or first run): old handles are gone.
      this.targets = [];
      this.atlas = null;
      this.cols = this.rows = 0;
      this.gen = r.gen;
    }
    const cols = Math.max(1, Math.ceil(this.W / this.cellPx));
    const rows = Math.max(1, Math.ceil(this.H / this.cellPx));
    if (cols !== this.cols || rows !== this.rows || this.targets.length === 0) {
      for (const t of this.targets) r.deleteTarget(t);
      this.targets = [r.createTarget(cols, rows), r.createTarget(cols, rows)];
      this.cols = cols;
      this.rows = rows;
    }
    const key = `${this.cellPx}|${this.opts.font}|${this.opts.glyphs.join('\u0000')}`;
    if (!this.atlas || this.atlas.key !== key) {
      const next = r.acquireAtlas(this.opts.glyphs, this.cellPx, this.opts.font);
      if (this.atlas) r.releaseAtlas(this.atlas);
      this.atlas = next;
    }
  }

  private freeGpu(): void {
    if (this.gen !== this.r.gen) return;
    for (const t of this.targets) this.r.deleteTarget(t);
    this.targets = [];
    if (this.atlas) this.r.releaseAtlas(this.atlas);
    this.atlas = null;
  }

  private render(dt: number): void {
    const r = this.r;
    if (r.lost) return;
    if (this.layoutDirty) this.layout();
    if (this.W === 0 || this.H === 0) return;
    this.syncGpu();

    if (this.time === 0 && this.reducedMotion()) this.time = 8; // a settled still frame
    this.time += dt * this.opts.speed;
    this.rtime += dt;

    const rect = this.host.getBoundingClientRect();
    const origin = this.origin(rect);
    this.updatePointer(origin, dt);

    // Pulses
    this.pulses = this.pulses.filter((p) => this.rtime - p.t < PULSE_LIFE);
    this.pulseBuf.fill(0);
    this.pulses.forEach((p, i) => this.pulseBuf.set([p.x, p.y, p.t, p.s], i * 4));

    // Clear zones
    const zones: ClearBox[] = this.opts.clear.map((z) => {
      const b = z.element.getBoundingClientRect();
      return { rect: { left: b.left, top: b.top, width: b.width, height: b.height }, padding: z.padding, feather: z.feather };
    });
    const clearCount = writeClearZones(origin, zones, this.clearBuf, this.featherBuf);

    // Cross-fade
    let mix = 1;
    if (this.prev) {
      mix = this.fadeDuration > 0 ? (this.rtime - this.fadeStart) / this.fadeDuration : 1;
      if (mix >= 1 || dt === 0) {
        mix = 1;
        this.prev = null;
      }
    }

    const cellCss = this.cellPx / this.dpr;
    const cursor = this.opts.cursor;
    const pointer = cursor === false ? { x: 0, y: 0, inside: false } : this.pointerLocal;
    const drawLayer = (layer: Layer, target: Target) => {
      const c = layer.ctx;
      c.time = this.time;
      c.dt = dt * this.opts.speed;
      c.width = this.W / this.dpr;
      c.height = this.H / this.dpr;
      c.cellSize = cellCss;
      c.pointer = { ...pointer };
      layer.state?.tick(c);
      r.drawField(r.fieldProgram(layer.preset), target, this.cols, this.rows, {
        width: c.width,
        height: c.height,
        cell: cellCss,
        time: this.time,
        rtime: this.rtime,
        pointer: [this.lantern.x, this.lantern.y, this.lantern.s],
        cursorMode: cursor === 'trail' ? 1 : cursor === 'lantern' ? 2 : 0,
        cursorRadius: cursor ? CURSOR_RADIUS[cursor] : 1,
        trail: this.trailBuf,
        pulses: this.pulseBuf,
        pulseCount: this.pulses.length,
        clear: this.clearBuf,
        clearFeather: this.featherBuf,
        clearCount,
        points: c.points,
        pointCount: Math.min(c.pointCount, MAX_POINTS),
        segments: c.segments,
        segmentCount: Math.min(c.segmentCount, MAX_SEGMENTS),
      });
    };

    const [main, back] = this.targets as [Target, Target];
    drawLayer(this.layer, main);
    if (this.prev) drawLayer(this.prev, back);

    r.drawGlyphs({
      field: main,
      prev: this.prev ? back : null,
      mix,
      atlas: this.atlas!,
      cellPx: this.cellPx,
      width: this.W,
      height: this.H,
      mark: this.opts.mark === 'dot' ? 1 : 0,
      dotScale: this.opts.dotScale,
      ink: this.ink,
      accent: this.accent,
      opacity: this.opts.opacity,
    });
    r.blit(this.ctx2d, this.W, this.H);
  }

  private updatePointer(origin: { x: number; y: number }, dt: number): void {
    const p = this.r.pointer;
    const x = p.x - origin.x;
    const y = p.y - origin.y;
    const inside = p.active && x >= 0 && y >= 0 && x <= this.cssW && y <= this.cssH;
    this.pointerLocal = { x, y, inside };
    const cursor = this.opts.cursor;

    if (cursor === 'trail') {
      if (inside && dt > 0) {
        const last = this.trail[this.trail.length - 1];
        if (!last || Math.hypot(x - last.x, y - last.y) > 5) {
          this.trail.push({ x, y, t: this.rtime });
          if (this.trail.length > MAX_TRAIL) this.trail.shift();
        }
      }
      this.trail = this.trail.filter((s) => this.rtime - s.t < TRAIL_LIFE);
      this.trailBuf.fill(0);
      this.trail.forEach((s, i) => this.trailBuf.set([s.x, s.y, this.rtime - s.t, 1], i * 4));
    } else {
      this.trailBuf.fill(0);
    }

    if (cursor === 'lantern') {
      const l = this.lantern;
      const k = 1 - Math.exp(-dt * 10);
      if (inside) {
        if (l.s < 0.02) {
          l.x = x;
          l.y = y;
        }
        l.x += (x - l.x) * k;
        l.y += (y - l.y) * k;
        l.s += (1 - l.s) * k * 0.6;
      } else {
        l.s += (0 - l.s) * k * 0.5;
      }
    } else {
      this.lantern.s = 0;
    }
  }
}

/** Returned when WebGL2 is missing or during SSR: every method is a no-op. */
class Inert implements BackgroundHandle {
  readonly supported = false;
  readonly canvas = null;
  readonly playing = false;
  update(): void {}
  setPreset(): void {}
  pulse(): void {}
  play(): void {}
  pause(): void {}
  destroy(): void {}
}

/**
 * Draws an animated ASCII background behind `element`'s content.
 *
 * ```ts
 * const bg = background('#hero', { preset: swell, clear: document.querySelector('#hero h1') });
 * bg.destroy();
 * ```
 */
export function background(element: HTMLElement | string, options: BackgroundOptions): BackgroundHandle {
  if (!options || !options.preset || typeof options.preset.glsl !== 'string') {
    throw new TypeError('ascii-backgrounds: options.preset is required (e.g. `import { swell } from "ascii-backgrounds"`)');
  }
  if (typeof document === 'undefined') return new Inert();
  const host = typeof element === 'string' ? document.querySelector<HTMLElement>(element) : element;
  if (!host) throw new TypeError(`ascii-backgrounds: element not found: ${String(element)}`);
  const renderer = getRenderer();
  if (!renderer) return new Inert();
  return new Field(host, options, renderer);
}
