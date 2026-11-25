/** How each cell is drawn: a character from the charset, or a dot sized by intensity. */
export type Mark = 'glyph' | 'dot';

/** Pointer response. `trail` lights cells along the pointer path; `lantern` reveals the field around it. */
export type CursorMode = 'trail' | 'lantern';

/** Which colour of a `{ light, dark }` pair to use. `auto` follows `prefers-color-scheme`. */
export type Theme = 'auto' | 'light' | 'dark';

/** A colour per theme. Any CSS colour works, including `var(--x)` and `currentColor`. */
export interface ThemedColor {
  light: string;
  dark: string;
}

export type ColorInput = string | ThemedColor;

/** An element the field stays quiet behind, e.g. a headline. */
export interface ClearZone {
  element: Element;
  /** Extra quiet space around the element, CSS px. Default 24. */
  padding?: number;
  /** Width of the soft edge, CSS px. Default 56. */
  feather?: number;
}

export type ClearInput = Element | ClearZone | ReadonlyArray<Element | ClearZone>;

/** Values a preset prefers when the caller does not set them. */
export interface PresetDefaults {
  cellSize?: number;
  charset?: string;
  mark?: Mark;
  cursor?: CursorMode | false;
}

/** Pointer position relative to the element's padding box, CSS px. */
export interface PresetPointer {
  x: number;
  y: number;
  inside: boolean;
}

/**
 * Passed to a preset's `tick` every rendered frame. A preset writes its
 * per-frame data into `points` / `segments` (4 floats per entry) and sets the counts.
 * The GLSL side reads them as `u_pts[i]` / `u_segs[i]` with `u_ptCount` / `u_segCount`.
 */
export interface PresetContext {
  /** Animation time in seconds, already scaled by `speed`. */
  time: number;
  /** Time since the last tick, scaled by `speed`. 0 for still frames. */
  dt: number;
  /** Field size in CSS px. */
  width: number;
  height: number;
  /** Cell size in CSS px. */
  cellSize: number;
  pointer: PresetPointer;
  points: Float32Array;
  pointCount: number;
  segments: Float32Array;
  segmentCount: number;
}

export interface PresetState {
  tick(ctx: PresetContext): void;
}

/**
 * A background look. `glsl` must define
 * `vec2 field(vec2 p, vec2 res, float t)` returning `(intensity, glow)` in 0..1
 * for the cell centred at `p` (CSS px, origin top-left) in a field of size `res`.
 */
export interface Preset {
  readonly name: string;
  readonly glsl: string;
  readonly defaults?: PresetDefaults;
  /** Optional CPU-side state, created once per mounted background. */
  create?(): PresetState;
}

export interface BackgroundOptions {
  /** The look to render. Import presets by name so unused ones are tree-shaken. */
  preset: Preset;
  /** Named palette (`graphite`, `ember`, ...), one CSS colour, or `{ light, dark }`. Default `graphite`. */
  palette?: string | ThemedColor;
  /** Highlight colour for the cursor, pulses and bright cells. Defaults to the palette's accent. */
  accent?: ColorInput;
  /** Which palette colour to use. Default `auto`. */
  theme?: Theme;
  /** Characters or dots. Default per preset. */
  mark?: Mark;
  /** Named charset or an ordered ramp from empty to dense, e.g. `' .:-=+*#%@'`. */
  charset?: string;
  /** Cell size in CSS px (4–64). Default per preset. */
  cellSize?: number;
  /** Animation speed multiplier, 0–5. Default 1. */
  speed?: number;
  /** Pointer response. `false` turns off all pointer and click response. Default per preset. */
  cursor?: boolean | CursorMode;
  /** Keep the field quiet behind these elements. Follows their layout. */
  clear?: ClearInput | null;
  /** 0–1. Default 1. */
  opacity?: number;
  /** Dot size relative to the cell when `mark: 'dot'`, 0.1–1.4. Default 0.9. */
  dotScale?: number;
  /** Font stack for glyphs. Default: a monospace stack. */
  font?: string;
  /** Hold a still frame. Default follows `prefers-reduced-motion`. */
  reducedMotion?: boolean;
  /** Upper bound for devicePixelRatio. Default 2. */
  maxPixelRatio?: number;
  /** Start animating as soon as the element is on screen. Default true. */
  autoplay?: boolean;
}

export type BackgroundUpdate = Partial<BackgroundOptions>;

/** A pulse position as fractions of the element size (0–1). */
export interface PulseAt {
  x: number;
  y: number;
  strength?: number;
}

/** A pulse from the centre of an element. */
export interface PulseFrom {
  element: Element;
  strength?: number;
}

export interface BackgroundHandle {
  /** False when WebGL2 is unavailable; the element is then left untouched and every method is a no-op. */
  readonly supported: boolean;
  /** The canvas inserted into the element, or null when unsupported. */
  readonly canvas: HTMLCanvasElement | null;
  readonly playing: boolean;
  /** Change options. Unspecified options keep their current values. */
  update(patch: BackgroundUpdate): void;
  /** Switch preset with a cross-fade (default 0.8 s). Other options are kept. */
  setPreset(preset: Preset, options?: { fade?: number }): void;
  /** Send a ring outward. With no argument, from the centre. */
  pulse(at?: PulseAt | PulseFrom): void;
  play(): void;
  pause(): void;
  /** Remove the canvas and restore the element's styles. */
  destroy(): void;
}
