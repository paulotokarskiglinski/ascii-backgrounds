import type { Preset } from '../types.ts';

/** Slow rolling swells over a fine grid: broad warped crests that rise and sink, calmer in the middle. */
export const swell: Preset = {
  name: 'swell',
  defaults: { cellSize: 12, charset: 'standard', cursor: 'lantern' },
  glsl: /* glsl */ `
vec2 field(vec2 p, vec2 res, float t) {
  vec2 q = p / 460.0;

  // Slow domain warp: two layers drifting in different directions bend everything below.
  vec2 w = vec2(gfbm(q * 1.1 + vec2(0.0, t * 0.030)),
                gfbm(q * 1.1 + vec2(4.7, 1.9) - vec2(t * 0.024, 0.0)));
  vec2 qw = q + 0.6 * w;

  // Broad swells that rise and sink in place.
  float body = gfbm(qw * 1.5 + vec2(t * 0.045, -t * 0.03));

  // Long rolling crests travelling across the swells, bent by the warp.
  float roll = sin(dot(p, vec2(0.32, 1.0)) / 62.0 + w.x * 4.0 - t * 0.55);
  float roll2 = sin(dot(p, vec2(-0.85, 0.5)) / 95.0 + w.y * 3.0 - t * 0.33);
  float rolls = 0.5 + 0.5 * (0.65 * roll + 0.35 * roll2);

  float h = body + 0.3 * (rolls - 0.5);
  // Soft knee: the low half falls to nothing, which leaves calm open water between swells.
  float v = smoothstep(-0.12, 0.78, h);
  v *= mix(0.55, 1.0, rolls);

  // Quieter in the middle, where content usually sits.
  vec2 c = (p - 0.5 * res) / max(res.x, res.y);
  float calm = smoothstep(0.05, 0.5, length(c * vec2(1.0, 1.6)));
  v *= mix(0.3, 1.0, calm);

  // A whisper of fine texture inside lit areas only, so empty water stays empty.
  v += (gnoise(p / 9.0 + vec2(t * 0.6, 0.0)) * 0.06) * smoothstep(0.05, 0.3, v);

  float glow = smoothstep(0.75, 1.0, v) * calm * 0.35;
  return vec2(clamp(v, 0.0, 1.0), glow);
}
`,
};
