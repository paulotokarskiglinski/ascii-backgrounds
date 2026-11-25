import type { Preset } from '../types.ts';

/** Slow rolling wave crests over a fine grid, calmer in the middle. */
export const swell: Preset = {
  name: 'swell',
  defaults: { cellSize: 12, charset: 'standard', cursor: 'lantern' },
  glsl: /* glsl */ `
vec2 field(vec2 p, vec2 res, float t) {
  vec2 q = p / 240.0;
  float warp = fbm(q * 0.9 + vec2(t * 0.035, -t * 0.025));
  float phase = p.y / 34.0 + p.x / 150.0 + warp * 5.5 - t * 0.85;
  float crest = pow(0.5 + 0.5 * sin(phase), 3.0);
  float swellAmp = 0.5 + 0.5 * sin(q.x * 2.1 + t * 0.3 + warp * 2.0);
  float v = crest * mix(0.35, 1.0, swellAmp);

  vec2 c = (p - 0.5 * res) / max(res.x, res.y);
  float calm = smoothstep(0.04, 0.45, length(c * vec2(1.0, 1.5)));
  v *= mix(0.22, 1.0, calm);

  float grain = noise(p / 7.0 + t * 0.7) * 0.06;
  float glow = pow(crest, 8.0) * swellAmp * calm * 0.45;
  return vec2(clamp(v * 0.92 + grain, 0.0, 1.0), glow);
}
`,
};
