import { resolveCharset } from './charsets.ts';
import { resolvePalette, type PaletteDef } from './color.ts';
import { MAX_CLEAR } from './limits.ts';
import type { BackgroundOptions, ClearInput, ClearZone, CursorMode, Mark, Theme } from './types.ts';

export const DEFAULT_FONT =
  'ui-monospace, "SFMono-Regular", "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, "Liberation Mono", monospace';

export interface ResolvedClearZone {
  element: Element;
  padding: number;
  feather: number;
}

export interface ResolvedOptions {
  cellSize: number;
  speed: number;
  glyphs: string[];
  mark: Mark;
  cursor: CursorMode | false;
  opacity: number;
  dotScale: number;
  font: string;
  palette: PaletteDef;
  theme: Theme;
  reducedMotion: boolean | undefined;
  maxPixelRatio: number;
  autoplay: boolean;
  clear: ResolvedClearZone[];
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, n));
}

const isZone = (v: unknown): v is ClearZone => typeof v === 'object' && v !== null && 'element' in v;

export function resolveClear(input: ClearInput | null | undefined): ResolvedClearZone[] {
  if (!input) return [];
  const list: ReadonlyArray<unknown> = Array.isArray(input) ? input : [input];
  const out: ResolvedClearZone[] = [];
  for (const item of list) {
    if (!item) continue;
    const zone: ClearZone = isZone(item) ? item : { element: item as Element };
    if (!zone.element) continue;
    out.push({
      element: zone.element,
      padding: num(zone.padding, 24, 0, 1000),
      feather: num(zone.feather, 56, 1, 1000),
    });
    if (out.length === MAX_CLEAR) break;
  }
  return out;
}

export function resolveCursor(value: BackgroundOptions['cursor'], presetDefault: CursorMode | false | undefined): CursorMode | false {
  if (value === false) return false;
  if (value === 'trail' || value === 'lantern') return value;
  if (value === true) return presetDefault || 'lantern';
  return presetDefault === undefined ? 'lantern' : presetDefault;
}

/** Merges caller options with the preset's defaults and clamps everything into range. */
export function resolveOptions(o: BackgroundOptions): ResolvedOptions {
  const d = o.preset?.defaults ?? {};
  const mark: Mark = o.mark === 'dot' || o.mark === 'glyph' ? o.mark : (d.mark ?? 'glyph');
  const theme: Theme = o.theme === 'light' || o.theme === 'dark' ? o.theme : 'auto';
  return {
    cellSize: num(o.cellSize, d.cellSize ?? 12, 4, 64),
    speed: num(o.speed, 1, 0, 5),
    glyphs: resolveCharset(o.charset, d.charset),
    mark,
    cursor: resolveCursor(o.cursor, d.cursor),
    opacity: num(o.opacity, 1, 0, 1),
    dotScale: num(o.dotScale, 0.9, 0.1, 1.4),
    font: typeof o.font === 'string' && o.font.trim() ? o.font : DEFAULT_FONT,
    palette: resolvePalette(o.palette, o.accent),
    theme,
    reducedMotion: typeof o.reducedMotion === 'boolean' ? o.reducedMotion : undefined,
    maxPixelRatio: num(o.maxPixelRatio, 2, 0.5, 4),
    autoplay: o.autoplay !== false,
    clear: resolveClear(o.clear),
  };
}
