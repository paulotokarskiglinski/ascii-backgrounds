import { MAX_POINTS } from '../limits.ts';
import { seeded } from '../random.ts';
import type { Preset, PresetContext } from '../types.ts';

const DROP_LIFE = 7;

/** Drops land and ring outward. Moving the pointer drops its own. */
export const ripple: Preset = {
  name: 'ripple',
  defaults: { cellSize: 12, charset: 'standard', cursor: 'trail' },
  glsl: /* glsl */ `
vec2 field(vec2 p, vec2 res, float t) {
  float h = 0.0;
  for (int k = 0; k < ${MAX_POINTS}; k++) {
    if (k >= u_ptCount) break;
    vec4 d = u_pts[k];
    float age = t - d.z;
    if (age < 0.0) continue;
    float x = length(p - d.xy) - age * 130.0;
    float env = exp(-x * x / 1400.0) * exp(-age * 0.42) * d.w;
    h += sin(x * 0.11) * env;
  }
  float base = fbm(p / 180.0 + vec2(t * 0.04, t * 0.03)) * 0.14;
  float v = clamp(base + abs(h) * 1.25, 0.0, 1.0);
  return vec2(v, clamp(h, 0.0, 1.0) * 0.55);
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
