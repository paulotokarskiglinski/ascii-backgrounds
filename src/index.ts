export { background } from './background.ts';
export { isSupported } from './renderer.ts';
export { charsets, resolveCharset, type CharsetName } from './charsets.ts';
export { palettes, type PaletteName, type PaletteDef } from './color.ts';
export { swell } from './presets/swell.ts';
export { ripple } from './presets/ripple.ts';
export { rain } from './presets/rain.ts';
export { constellation } from './presets/constellation.ts';
export { GLSL_COMMON } from './glsl.ts';
export { MAX_POINTS, MAX_SEGMENTS } from './limits.ts';
export type {
  BackgroundHandle,
  BackgroundOptions,
  BackgroundUpdate,
  ClearInput,
  ClearZone,
  ColorInput,
  CursorMode,
  Mark,
  Preset,
  PresetContext,
  PresetDefaults,
  PresetPointer,
  PresetState,
  PulseAt,
  PulseFrom,
  Theme,
  ThemedColor,
} from './types.ts';

import type { Preset } from './types.ts';

/** Identity helper that type-checks a custom preset. */
export function definePreset(preset: Preset): Preset {
  return preset;
}
