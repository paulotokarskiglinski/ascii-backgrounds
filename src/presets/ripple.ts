import { MAX_POINTS } from '../limits.ts';
import { seeded } from '../random.ts';
import type { Preset, PresetContext } from '../types.ts';

const DROP_LIFE = 7;

/** Drops land and spread outward as lit wave packets. Moving the pointer drops its own. */
export const ripple: Preset = {
  name: 'ripple',
  defaults: { cellSize: 12, charset: 'standard', cursor: 'trail' },
  glsl: /* glsl */ `
vec2 field(vec2 p, vec2 res, float t) {
  float h = 0.0;
  vec2 grad = vec2(0.0);
  for (int k = 0; k < ${MAX_POINTS}; k++) {
    if (k >= u_ptCount) break;
    vec4 d = u_pts[k];
    float age = t - d.z;
    if (age < 0.0) continue;
    vec2 dp = p - d.xy;
    float r = length(dp);
    float x = r - age * 120.0;
    if (x > 60.0) continue;
    // The packet spreads and its wavelength stretches as it travels, like real water.
    float sigma = 34.0 + age * 26.0;
    float kw = 0.13 / (1.0 + age * 0.12);
    float amp = d.w * exp(-age * 0.3) * smoothstep(0.0, 0.25, age) / sqrt(1.0 + r / 140.0);
    float env = exp(-x * x / (sigma * sigma)) * amp;
    float s = sin(kw * x);
    h += s * env;
    float dh = (kw * cos(kw * x) - 2.0 * x / (sigma * sigma) * s) * env;
    grad += dh * dp / max(r, 1.0);
  }
  // Calm surface between drops: a faint, slowly drifting sheen with open gaps.
  float sheen = gfbm(p / 280.0 + vec2(t * 0.035, -t * 0.025));
  float base = smoothstep(-0.05, 0.55, sheen) * 0.2;

  // Light from the upper left: slopes facing it brighten, slopes facing away darken.
  float slope = dot(grad, normalize(vec2(-0.55, -0.85))) * 12.0;
  float crest = max(h, 0.0);
  float trough = clamp(-h, 0.0, 1.0);
  float v = base * (1.0 - 0.7 * trough) + 1.05 * crest + 0.25 * trough + 0.8 * max(slope, 0.0) - 0.3 * max(-slope, 0.0);
  float glow = smoothstep(0.3, 0.8, crest + max(slope, 0.0) * 0.6) * 0.6;
  return vec2(clamp(v, 0.0, 1.0), glow);
}
`,
  create() {
    const rand = seeded(0x51);
    type Drop = { x: number; y: number; birth: number; amp: number };
    let drops: Drop[] = [];
    let next = 0;
    let started = false;
    let lastPointer: { x: number; y: number } | null = null;

    return {
      tick(ctx: PresetContext) {
        const { time: t, width: w, height: h } = ctx;
        if (!started) {
          started = true;
          // Seed drops in the past so the first frame is already rippling.
          for (let i = 0; i < 6; i++) drops.push({ x: rand() * w, y: rand() * h, birth: t - rand() * 5, amp: 0.5 + rand() * 0.5 });
          next = t + 0.3;
        }
        if (t >= next) {
          drops.push({ x: rand() * w, y: rand() * h, birth: t, amp: 0.45 + rand() * 0.55 });
          next = t + 0.5 + rand() * 1.3;
        }
        const p = ctx.pointer;
        if (p.inside) {
          if (!lastPointer || Math.hypot(p.x - lastPointer.x, p.y - lastPointer.y) > 70) {
            drops.push({ x: p.x, y: p.y, birth: t, amp: 0.9 });
            lastPointer = { x: p.x, y: p.y };
          }
        } else {
          lastPointer = null;
        }
        drops = drops.filter((d) => t - d.birth < DROP_LIFE);
        if (drops.length > MAX_POINTS) drops = drops.slice(drops.length - MAX_POINTS);
        drops.forEach((d, i) => ctx.points.set([d.x, d.y, d.birth, d.amp], i * 4));
        ctx.pointCount = drops.length;
      },
    };
  },
};
