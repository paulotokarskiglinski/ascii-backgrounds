import type { Preset } from '../types.ts';

/** Streaks falling at three depths, each with a soft bright head and a shimmering tail. */
export const rain: Preset = {
  name: 'rain',
  defaults: { cellSize: 14, charset: 'rain', cursor: 'trail' },
  glsl: /* glsl */ `
vec2 field(vec2 p, vec2 res, float t) {
  vec2 cs = u_cellSize;
  float col = floor(p.x / cs.x);
  float row = floor(p.y / cs.y);
  float v = 0.0;
  float glow = 0.0;
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float h = hash12(vec2(col, fl * 17.0 + 3.0));
    // Far layers are denser, slower and dimmer; the near layer is sparse and bright.
    float density = L == 0 ? 0.5 : (L == 1 ? 0.32 : 0.17);
    float speed = mix(60.0, 130.0, h) * (0.55 + fl * 0.55);
    float len = mix(6.0, 22.0, hash12(vec2(col, fl + 5.0))) * cs.y * (0.7 + fl * 0.25);
    float gap = mix(80.0, 760.0, hash12(vec2(col, fl + 9.0)));
    float period = res.y + len + gap;
    float travel = t * speed + h * period * 7.0;
    float cycle = floor(travel / period);
    float head = mod(travel, period);
    if (hash12(vec2(col + cycle * 13.1, fl + 21.0)) > density) continue;
    float d = head - p.y;
    if (d < -cs.y * 2.0 || d > len) continue;

    float depth = 0.5 + 0.25 * fl;
    float u = clamp(d / len, 0.0, 1.0);
    // Tail fades with an ease-out so it thins rather than stopping at a hard end.
    float tail = pow(1.0 - u, 1.3) * step(0.0, d) * depth;
    // Cells in the tail flicker between nearby glyphs a few times a second.
    float shimmer = hash12(vec2(col * 1.7 + fl, row + floor(t * 8.0 + h * 20.0)));
    tail *= mix(0.7, 1.15, shimmer);
    // Soft head: brightest cell at the front with a short bloom around it.
    float hd = d / (cs.y * 0.9);
    float headK = exp(-hd * hd);
    v = max(v, max(tail, headK * (0.62 + 0.18 * fl)));
    glow = max(glow, headK * (0.25 + 0.3 * fl));
  }
  return vec2(clamp(v, 0.0, 1.0), glow);
}
`,
};
