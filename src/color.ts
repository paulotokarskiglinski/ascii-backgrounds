import type { ColorInput, ThemedColor } from './types.ts';

/** RGB with channels in 0..1. */
export type RGB = [number, number, number];

export interface PaletteDef {
  ink: ThemedColor;
  accent: ThemedColor;
}

/** Built-in palettes. `ink` draws the field, `accent` lights the cursor, pulses and bright cells. */
export const palettes = {
  graphite: { ink: { light: '#3a3d45', dark: '#a9adb8' }, accent: { light: '#0b0c10', dark: '#ffffff' } },
  ember: { ink: { light: '#b4532a', dark: '#d9733e' }, accent: { light: '#6e2207', dark: '#ffd27a' } },
  ocean: { ink: { light: '#1f5f8b', dark: '#3f95cc' }, accent: { light: '#082f4d', dark: '#b4f1ff' } },
  moss: { ink: { light: '#3f6b3a', dark: '#73a85f' }, accent: { light: '#1b3517', dark: '#e6ffb8' } },
  violet: { ink: { light: '#5b4bd1', dark: '#8a7cff' }, accent: { light: '#24168f', dark: '#f2ccff' } },
  phosphor: { ink: { light: '#2b7a3d', dark: '#2fd65c' }, accent: { light: '#0d4219', dark: '#d8ffe0' } },
  mono: { ink: { light: '#000000', dark: '#ffffff' }, accent: { light: '#000000', dark: '#ffffff' } },
} satisfies Record<string, PaletteDef>;

export type PaletteName = keyof typeof palettes;

export const DEFAULT_PALETTE: PaletteName = 'graphite';

const themed = (c: ColorInput): ThemedColor => (typeof c === 'string' ? { light: c, dark: c } : { light: c.light, dark: c.dark });

/** Resolves the `palette` and `accent` options into ink and accent colours per theme. */
export function resolvePalette(palette?: string | ThemedColor, accent?: ColorInput): PaletteDef {
  let def: PaletteDef;
  if (palette === undefined) {
    def = palettes[DEFAULT_PALETTE];
  } else if (typeof palette === 'string' && Object.prototype.hasOwnProperty.call(palettes, palette)) {
    def = palettes[palette as PaletteName];
  } else {
    const ink = themed(palette);
    def = { ink, accent: ink };
  }
  return { ink: { ...def.ink }, accent: accent === undefined ? { ...def.accent } : themed(accent) };
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Parses hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`) and `rgb()` / `rgba()`.
 * Returns null for anything else; the browser path handles the rest.
 */
export function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      return [0, 1, 2].map((i) => parseInt(hex[i]! + hex[i]!, 16) / 255) as RGB;
    }
    if (hex.length === 6 || hex.length === 8) {
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
    }
    return null;
  }
  const m = /^rgba?\((.*)\)$/.exec(s);
  if (m) {
    const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length < 3) return null;
    const out = parts.map((p) => {
      const n = parseFloat(p);
      if (!Number.isFinite(n)) return NaN;
      return clamp01(p.endsWith('%') ? n / 100 : n / 255);
    });
    return out.some(Number.isNaN) ? null : (out as RGB);
  }
  return null;
}

let probe: CanvasRenderingContext2D | null = null;

/** Resolves any CSS colour in the browser, including `var(--x)` and `currentColor` relative to `host`. */
export function colorToRGB(input: string, host?: Element, depth = 0): RGB {
  const s = input.trim();
  const fallback: RGB = [0.5, 0.5, 0.5];
  if (depth > 8) return fallback;

  const parsed = parseColor(s);
  if (parsed) return parsed;

  if (typeof getComputedStyle !== 'undefined' && host) {
    const v = /^var\(\s*(--[^,\s)]+)\s*(?:,\s*(.+))?\)$/.exec(s);
    if (v) {
      const value = getComputedStyle(host).getPropertyValue(v[1]!).trim() || (v[2] ?? '').trim();
      return value ? colorToRGB(value, host, depth + 1) : fallback;
    }
    if (s.toLowerCase() === 'currentcolor') {
      return colorToRGB(getComputedStyle(host).color, host, depth + 1);
    }
  }

  if (typeof document === 'undefined') return fallback;
  if (!probe) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    probe = c.getContext('2d', { willReadFrequently: true });
    if (!probe) return fallback;
  }
  // Paint one pixel so every colour syntax the browser knows (names, hsl, oklch, ...) is resolved.
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = s;
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  const a = d[3]! / 255 || 1;
  return [d[0]! / 255 / a, d[1]! / 255 / a, d[2]! / 255 / a].map(clamp01) as RGB;
}
