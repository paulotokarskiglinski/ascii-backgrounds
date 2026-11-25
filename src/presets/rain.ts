import type { Preset } from '../types.ts';

/** Streaks falling at three depths, each with a bright head and a fading tail. */
export const rain: Preset = {
  name: 'rain',
  defaults: { cellSize: 14, charset: 'rain', cursor: 'trail' },
  glsl: /* glsl */ `
vec2 field(vec2 p, vec2 res, float t) {
  float col = floor(p.x / u_cell);
  float v = 0.0;
  float glow = 0.0;
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float h = hash12(vec2(col, fl * 17.0 + 3.0));
    float density = L == 0 ? 0.55 : (L == 1 ? 0.35 : 0.2);
    float speed = mix(70.0, 140.0, h) * (0.55 + fl * 0.6);
    float len = mix(5.0, 20.0, hash12(vec2(col, fl + 5.0))) * u_cell * (0.7 + fl * 0.25);
    float gap = mix(60.0, 700.0, hash12(vec2(col, fl + 9.0)));
    float period = res.y + len + gap;
    float travel = t * speed + h * period * 7.0;
    float cycle = floor(travel / period);
    float head = mod(travel, period);
    float lit = step(hash12(vec2(col + cycle * 13.1, fl + 21.0)), density);
    float d = head - p.y;
    if (lit < 0.5 || d < 0.0 || d > len) continue;
    float bright = 0.5 + 0.25 * fl;
    float tail = pow(1.0 - d / len, 1.6);
    float isHead = step(d, u_cell);
    v = max(v, max(tail * bright, isHead * 0.98));
    glow = max(glow, isHead * (0.45 + 0.25 * fl));
  }
  v += noise(p / 11.0 + vec2(0.0, t * 0.5)) * 0.04;
  return vec2(clamp(v, 0.0, 1.0), glow);
}
`,
};
