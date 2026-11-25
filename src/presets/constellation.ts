import { MAX_POINTS, MAX_SEGMENTS } from '../limits.ts';
import { seeded } from '../random.ts';
import type { Preset, PresetContext } from '../types.ts';

const LINK = 170;
const POINTER_LINK = 160;

/** Wandering points that link up with lines when they drift close. The pointer links to nearby points. */
export const constellation: Preset = {
  name: 'constellation',
  defaults: { cellSize: 12, charset: 'standard', cursor: 'lantern' },
  glsl: /* glsl */ `
vec2 field(vec2 p, vec2 res, float t) {
  float v = 0.0;
  float g = 0.0;
  for (int k = 0; k < ${MAX_SEGMENTS}; k++) {
    if (k >= u_segCount) break;
    vec4 s = u_segs[k];
    float len = length(s.zw - s.xy);
    float fade = 1.0 - smoothstep(${(LINK * 0.45).toFixed(1)},${LINK.toFixed(1)}, len);
    float d = sdSegment(p, s.xy, s.zw);
    v = max(v, (1.0 - smoothstep(0.0, u_cell * 0.95, d)) * fade * 0.55);
  }
  for (int k = 0; k < ${MAX_POINTS}; k++) {
    if (k >= u_ptCount) break;
    vec4 q = u_pts[k];
    vec2 d = p - q.xy;
    float core = exp(-dot(d, d) / (q.z * q.z)) * q.w;
    v = max(v, core);
    g = max(g, core * 0.8);
  }
  v += fbm(p / 90.0 + t * 0.02) * 0.07;
  return vec2(clamp(v, 0.0, 1.0), g);
}
`,
  create() {
    const rand = seeded(0xc0ffee);
    type Star = { x: number; y: number; vx: number; vy: number; phase: number };
    const stars: Star[] = [];
    let w0 = 0;
    let h0 = 0;

    const spawn = (w: number, h: number): Star => {
      const a = rand() * Math.PI * 2;
      const s = 8 + rand() * 16;
      return { x: rand() * w, y: rand() * h, vx: Math.cos(a) * s, vy: Math.sin(a) * s, phase: rand() * Math.PI * 2 };
    };

    return {
      tick(ctx: PresetContext) {
        const { width: w, height: h, dt, time } = ctx;
        if (w0 && h0 && (w !== w0 || h !== h0)) {
          for (const s of stars) {
            s.x *= w / w0;
            s.y *= h / h0;
          }
        }
        w0 = w;
        h0 = h;

        const target = Math.max(10, Math.min(MAX_POINTS, Math.round((w * h) / 22000)));
        while (stars.length < target) stars.push(spawn(w, h));
        stars.length = target;

        const m = 30;
        for (const s of stars) {
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          if (s.x < -m) s.x = w + m;
          else if (s.x > w + m) s.x = -m;
          if (s.y < -m) s.y = h + m;
          else if (s.y > h + m) s.y = -m;
        }

        const radius = ctx.cellSize * 1.3;
        stars.forEach((s, i) => {
          const twinkle = 0.65 + 0.35 * Math.sin(time * 0.9 + s.phase);
          ctx.points.set([s.x, s.y, radius, twinkle], i * 4);
        });
        ctx.pointCount = stars.length;

        let n = 0;
        const seg = ctx.segments;
        const push = (ax: number, ay: number, bx: number, by: number) => {
          if (n >= MAX_SEGMENTS) return;
          seg.set([ax, ay, bx, by], n * 4);
          n++;
        };
        const p = ctx.pointer;
        if (p.inside) {
          for (const s of stars) {
            if (Math.hypot(s.x - p.x, s.y - p.y) < POINTER_LINK) push(p.x, p.y, s.x, s.y);
          }
        }
        for (let i = 0; i < stars.length; i++) {
          const a = stars[i]!;
          for (let j = i + 1; j < stars.length; j++) {
            const b = stars[j]!;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            if (dx * dx + dy * dy < LINK * LINK) push(a.x, a.y, b.x, b.y);
          }
        }
        ctx.segmentCount = n;
      },
    };
  },
};
