import { buildFieldShader, GLYPH_SHADER, VERTEX_SHADER } from './glsl.ts';
import type { Preset } from './types.ts';

/** What the renderer needs from a mounted background. */
export interface FieldLike {
  /** Render if needed. Returns true while it wants more frames. */
  frame(dt: number): boolean;
  pointerDown(clientX: number, clientY: number): void;
  /** Theme or reduced-motion preference changed. */
  envChanged(): void;
}

export interface Program {
  program: WebGLProgram;
  uniform(name: string): WebGLUniformLocation | null;
}

export interface Atlas {
  key: string;
  texture: WebGLTexture;
  cols: number;
  count: number;
  refs: number;
  gen: number;
}

export interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
}

export interface FieldUniforms {
  width: number;
  height: number;
  cell: number;
  time: number;
  rtime: number;
  pointer: [number, number, number];
  cursorMode: number;
  cursorRadius: number;
  trail: Float32Array;
  pulses: Float32Array;
  pulseCount: number;
  clear: Float32Array;
  clearFeather: Float32Array;
  clearCount: number;
  points: Float32Array;
  pointCount: number;
  segments: Float32Array;
  segmentCount: number;
}

export interface GlyphUniforms {
  field: Target;
  prev: Target | null;
  mix: number;
  atlas: Atlas;
  cellPx: number;
  width: number;
  height: number;
  mark: number;
  dotScale: number;
  ink: readonly number[];
  accent: readonly number[];
  opacity: number;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('ascii-backgrounds: could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`ascii-backgrounds: shader failed to compile\n${log}`);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vertex);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragment);
  const program = gl.createProgram();
  if (!program) throw new Error('ascii-backgrounds: could not create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`ascii-backgrounds: program failed to link\n${log}`);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name) {
      let loc = cache.get(name);
      if (loc === undefined) {
        loc = gl.getUniformLocation(program, name);
        cache.set(name, loc);
      }
      return loc;
    },
  };
}

/**
 * One WebGL2 context and one animation loop for every background on the page.
 * Each background renders into the shared canvas, then is copied onto its own 2D canvas.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  /** Bumped whenever GPU resources are recreated (context restore). */
  gen = 0;
  maxSize = 4096;
  lost = false;
  readonly pointer = { x: 0, y: 0, active: false };
  readonly darkQuery: MediaQueryList | null;
  readonly motionQuery: MediaQueryList | null;

  private fields = new Set<FieldLike>();
  private fieldPrograms = new Map<string, Program>();
  private glyphProgram!: Program;
  private vao: WebGLVertexArrayObject | null = null;
  private atlases = new Map<string, Atlas>();
  private raf = 0;
  private last = 0;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const mq = (q: string) => (typeof matchMedia === 'function' ? matchMedia(q) : null);
    this.darkQuery = mq('(prefers-color-scheme: dark)');
    this.motionQuery = mq('(prefers-reduced-motion: reduce)');
    this.init();

    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.lost = true;
      if (this.raf) cancelAnimationFrame(this.raf);
      this.raf = 0;
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.lost = false;
      this.init();
      this.wake();
    });

    const env = () => {
      for (const f of this.fields) f.envChanged();
      this.wake();
    };
    this.darkQuery?.addEventListener?.('change', env);
    this.motionQuery?.addEventListener?.('change', env);

    const opts = { passive: true } as const;
    window.addEventListener('pointermove', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.active = true;
    }, opts);
    window.addEventListener('pointerdown', (e) => {
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.active = true;
      for (const f of this.fields) f.pointerDown(e.clientX, e.clientY);
    }, opts);
    const release = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') this.pointer.active = false;
    };
    window.addEventListener('pointerup', release, opts);
    window.addEventListener('pointercancel', release, opts);
    document.addEventListener('pointerout', (e) => {
      if (!e.relatedTarget) this.pointer.active = false;
    }, opts);
    document.addEventListener('visibilitychange', () => this.wake());
  }

  static create(): Renderer | null {
    if (typeof document === 'undefined' || typeof window === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'low-power',
    });
    if (!gl) return null;
    return new Renderer(canvas, gl);
  }

  private init(): void {
    const gl = this.gl;
    this.gen++;
    this.fieldPrograms.clear();
    this.atlases.clear();
    this.glyphProgram = link(gl, VERTEX_SHADER, GLYPH_SHADER);
    gl.useProgram(this.glyphProgram.program);
    gl.uniform1i(this.glyphProgram.uniform('u_field'), 0);
    gl.uniform1i(this.glyphProgram.uniform('u_prev'), 1);
    gl.uniform1i(this.glyphProgram.uniform('u_atlas'), 2);
    this.vao = gl.createVertexArray();
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const maxVp = (gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array)[0] ?? 4096;
    this.maxSize = Math.min(maxTex || 4096, maxVp, 4096);
  }

  // ---- fields and loop -------------------------------------------------

  add(field: FieldLike): void {
    this.fields.add(field);
    this.wake();
  }

  remove(field: FieldLike): void {
    this.fields.delete(field);
  }

  /** Make sure a frame is coming. Cheap to call often. */
  wake(): void {
    if (this.raf || this.lost || typeof requestAnimationFrame !== 'function') return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    this.raf = 0;
    if (this.lost) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    let again = false;
    for (const f of this.fields) {
      if (f.frame(dt)) again = true;
    }
    if (again && !this.raf) this.raf = requestAnimationFrame(this.frame);
  };

  // ---- resources -------------------------------------------------------

  /** Compiles (once) the field program for a preset. Throws with the GLSL log on error. */
  fieldProgram(preset: Preset): Program {
    let p = this.fieldPrograms.get(preset.glsl);
    if (!p) {
      p = link(this.gl, VERTEX_SHADER, buildFieldShader(preset.glsl));
      this.fieldPrograms.set(preset.glsl, p);
    }
    return p;
  }

  acquireAtlas(glyphs: string[], cellPx: number, font: string): Atlas {
    const key = `${cellPx}|${font}|${glyphs.join('\u0000')}`;
    const hit = this.atlases.get(key);
    if (hit) {
      hit.refs++;
      return hit;
    }
    const gl = this.gl;
    const count = glyphs.length;
    const cols = Math.min(16, count);
    const rows = Math.ceil(count / cols);
    const c = document.createElement('canvas');
    c.width = cols * cellPx;
    c.height = rows * cellPx;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('ascii-backgrounds: 2D canvas unavailable');
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.max(1, Math.round(cellPx * 0.92))}px ${font}`;
    glyphs.forEach((g, i) => {
      const x = (i % cols) * cellPx;
      const y = Math.floor(i / cols) * cellPx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, cellPx, cellPx);
      ctx.clip();
      ctx.fillText(g, x + cellPx / 2, y + cellPx / 2 + cellPx * 0.04);
      ctx.restore();
    });
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, c);
    this.texParams();
    const atlas: Atlas = { key, texture, cols, count, refs: 1, gen: this.gen };
    this.atlases.set(key, atlas);
    return atlas;
  }

  releaseAtlas(atlas: Atlas): void {
    if (atlas.gen !== this.gen) return;
    if (--atlas.refs > 0) return;
    this.atlases.delete(atlas.key);
    this.gl.deleteTexture(atlas.texture);
  }

  createTarget(cols: number, rows: number): Target {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, cols, rows);
    this.texParams();
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texture, framebuffer };
  }

  deleteTarget(t: Target): void {
    this.gl.deleteTexture(t.texture);
    this.gl.deleteFramebuffer(t.framebuffer);
  }

  private texParams(): void {
    const gl = this.gl;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---- drawing ---------------------------------------------------------

  /** Pass 1: one fragment per cell, writes (intensity, glow) into `target`. */
  drawField(program: Program, target: Target, cols: number, rows: number, u: FieldUniforms): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.viewport(0, 0, cols, rows);
    gl.useProgram(program.program);
    const U = (n: string) => program.uniform(n);
    gl.uniform2f(U('u_res'), u.width, u.height);
    gl.uniform1f(U('u_cell'), u.cell);
    gl.uniform1f(U('u_time'), u.time);
    gl.uniform1f(U('u_rtime'), u.rtime);
    gl.uniform3f(U('u_pointer'), u.pointer[0], u.pointer[1], u.pointer[2]);
    gl.uniform1i(U('u_cursorMode'), u.cursorMode);
    gl.uniform1f(U('u_cursorRadius'), u.cursorRadius);
    gl.uniform4fv(U('u_trail'), u.trail);
    gl.uniform4fv(U('u_pulses'), u.pulses);
    gl.uniform1i(U('u_pulseCount'), u.pulseCount);
    gl.uniform4fv(U('u_clear'), u.clear);
    gl.uniform1fv(U('u_clearFeather'), u.clearFeather);
    gl.uniform1i(U('u_clearCount'), u.clearCount);
    gl.uniform4fv(U('u_pts'), u.points);
    gl.uniform1i(U('u_ptCount'), u.pointCount);
    gl.uniform4fv(U('u_segs'), u.segments);
    gl.uniform1i(U('u_segCount'), u.segmentCount);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Pass 2: full resolution glyphs into the shared canvas. */
  drawGlyphs(u: GlyphUniforms): void {
    const gl = this.gl;
    this.ensureSize(u.width, u.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, u.width, u.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const p = this.glyphProgram;
    gl.useProgram(p.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, u.field.texture);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, (u.prev ?? u.field).texture);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, u.atlas.texture);
    gl.uniform1f(p.uniform('u_mix'), u.prev ? u.mix : 1);
    gl.uniform1f(p.uniform('u_cellPx'), u.cellPx);
    gl.uniform2f(p.uniform('u_res'), u.width, u.height);
    gl.uniform1i(p.uniform('u_glyphCount'), u.atlas.count);
    gl.uniform1i(p.uniform('u_atlasCols'), u.atlas.cols);
    gl.uniform1i(p.uniform('u_mark'), u.mark);
    gl.uniform1f(p.uniform('u_dotScale'), u.dotScale);
    gl.uniform3f(p.uniform('u_ink'), u.ink[0]!, u.ink[1]!, u.ink[2]!);
    gl.uniform3f(p.uniform('u_accent'), u.accent[0]!, u.accent[1]!, u.accent[2]!);
    gl.uniform1f(p.uniform('u_opacity'), u.opacity);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Copies the last `drawGlyphs` result onto a background's own canvas. */
  blit(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.clearRect(0, 0, width, height);
    // The viewport sits at the bottom-left of the shared canvas; image rows run top-down.
    ctx.drawImage(this.canvas, 0, this.canvas.height - height, width, height, 0, 0, width, height);
  }

  private ensureSize(width: number, height: number): void {
    const c = this.canvas;
    if (c.width >= width && c.height >= height) return;
    const round = (n: number) => Math.min(this.maxSize, Math.ceil(n / 256) * 256);
    c.width = Math.max(c.width, round(width));
    c.height = Math.max(c.height, round(height));
  }
}

let shared: Renderer | null | undefined;

/** The page-wide renderer, created on first use. Null when WebGL2 is unavailable. */
export function getRenderer(): Renderer | null {
  if (shared !== undefined) return shared;
  if (typeof document === 'undefined') return null;
  try {
    shared = Renderer.create();
  } catch (err) {
    console.error(err);
    shared = null;
  }
  return shared;
}

/** True when this browser can render backgrounds (WebGL2). Always false during SSR. */
export function isSupported(): boolean {
  return getRenderer() !== null;
}
