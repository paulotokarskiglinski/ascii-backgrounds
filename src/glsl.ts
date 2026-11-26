import { MAX_CLEAR, MAX_POINTS, MAX_PULSES, MAX_SEGMENTS, MAX_TRAIL } from './limits.ts';

/** One triangle covering the viewport; no vertex buffers needed. */
export const VERTEX_SHADER = /* glsl */ `#version 300 es
void main() {
  vec2 v = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Helpers available to every preset's GLSL. */
export const GLSL_COMMON = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// Gradient noise with a quintic fade, roughly -0.7..0.7. Smoother than value noise at low frequency.
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 ga = hash22(i) * 2.0 - 1.0;
  vec2 gb = hash22(i + vec2(1.0, 0.0)) * 2.0 - 1.0;
  vec2 gc = hash22(i + vec2(0.0, 1.0)) * 2.0 - 1.0;
  vec2 gd = hash22(i + vec2(1.0, 1.0)) * 2.0 - 1.0;
  float a = dot(ga, f);
  float b = dot(gb, f - vec2(1.0, 0.0));
  float c = dot(gc, f - vec2(0.0, 1.0));
  float d = dot(gd, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
// Three octaves of gradient noise, rotated between octaves to hide the lattice. Roughly -0.6..0.6.
float gfbm(vec2 p) {
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  float v = 0.5 * gnoise(p);
  p = m * p;
  v += 0.25 * gnoise(p);
  p = m * p;
  v += 0.125 * gnoise(p);
  return v * 1.6;
}
float sdSegment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}
`;

const FIELD_HEADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform vec2 u_res;          // field size, CSS px
uniform float u_cell;        // cell height, CSS px
uniform vec2 u_cellSize;     // cell width and height, CSS px (glyph cells are narrower than tall)
uniform float u_time;        // preset time (scaled by speed)
uniform float u_rtime;       // real time, for pointer effects
uniform vec3 u_pointer;      // lantern x, y, strength
uniform int u_cursorMode;    // 0 off, 1 trail, 2 lantern
uniform float u_cursorRadius;
uniform vec4 u_trail[${MAX_TRAIL}];     // x, y, age, alive
uniform vec4 u_pulses[${MAX_PULSES}];   // x, y, birth, strength
uniform int u_pulseCount;
uniform vec4 u_clear[${MAX_CLEAR}];     // cx, cy, half width, half height
uniform float u_clearFeather[${MAX_CLEAR}];
uniform int u_clearCount;
uniform vec4 u_pts[${MAX_POINTS}];
uniform int u_ptCount;
uniform vec4 u_segs[${MAX_SEGMENTS}];
uniform int u_segCount;

out vec4 outColor;
`;

const FIELD_MAIN = /* glsl */ `
void main() {
  // One fragment per cell. Row 0 is the top row of the element.
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 p = (cell + 0.5) * u_cellSize;
  vec2 f = field(p, u_res, u_time);
  float i = clamp(f.x, 0.0, 1.0);
  float glow = f.y;

  if (u_cursorMode == 1) {
    float r2 = u_cursorRadius * u_cursorRadius;
    float w = 0.0;
    for (int k = 0; k < ${MAX_TRAIL}; k++) {
      vec4 tr = u_trail[k];
      if (tr.w <= 0.0) continue;
      float life = 1.0 - tr.z / 0.9;
      if (life <= 0.0) continue;
      // Join each sample to the next one so fast strokes stay continuous.
      vec4 nx = k + 1 < ${MAX_TRAIL} ? u_trail[k + 1] : tr;
      float dist = nx.w > 0.0 ? sdSegment(p, tr.xy, nx.xy) : length(p - tr.xy);
      // Eased fade so the tail dissolves instead of blinking out.
      w = max(w, exp(-dist * dist / r2) * life * life * (3.0 - 2.0 * life));
    }
    i += w * (0.35 + 0.5 * i) * (1.0 - 0.4 * i);
    glow += w * 0.75;
  } else if (u_cursorMode == 2 && u_pointer.z > 0.001) {
    vec2 d = p - u_pointer.xy;
    // Gaussian falloff: no visible rim, the light just thins out.
    float k = exp(-dot(d, d) / (u_cursorRadius * u_cursorRadius * 0.3)) * u_pointer.z;
    i += k * (0.2 + 0.9 * i) * (1.0 - 0.45 * i);
    glow += k * k * 0.6;
  }

  for (int k = 0; k < ${MAX_PULSES}; k++) {
    if (k >= u_pulseCount) break;
    vec4 pl = u_pulses[k];
    float age = u_rtime - pl.z;
    if (age < 0.0) continue;
    float x = (length(p - pl.xy) - age * 520.0) / 34.0;
    float band = exp(-x * x) * exp(-age * 1.3) * pl.w;
    i += band * 0.75;
    glow += band;
  }

  float m = 1.0;
  for (int k = 0; k < ${MAX_CLEAR}; k++) {
    if (k >= u_clearCount) break;
    vec4 c = u_clear[k];
    float fe = u_clearFeather[k];
    float r = fe * 0.5;
    vec2 q = abs(p - c.xy) - c.zw + r;
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    m = min(m, smoothstep(0.0, fe, sd));
  }

  outColor = vec4(clamp(i * m, 0.0, 1.0), clamp(glow * m, 0.0, 1.0), 0.0, 1.0);
}
`;

/** Builds the per-cell field shader for a preset. */
export function buildFieldShader(presetGlsl: string): string {
  return `${FIELD_HEADER}\n${GLSL_COMMON}\n#line 1\n${presetGlsl}\n${FIELD_MAIN}`;
}

/** Draws every pixel: looks up its cell's intensity and stamps a glyph or a dot. */
export const GLYPH_SHADER = /* glsl */ `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D u_field;
uniform sampler2D u_prev;
uniform sampler2D u_atlas;
uniform float u_mix;
uniform vec2 u_cellPx;       // cell width and height, device px
uniform vec2 u_res;
uniform int u_glyphCount;
uniform int u_atlasCols;
uniform int u_mark;
uniform float u_dotScale;
uniform vec3 u_ink;
uniform vec3 u_accent;
uniform float u_opacity;

out vec4 outColor;

// 4x4 ordered-dither threshold in 0..1, fixed per cell so it never flickers.
const float BAYER[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
float bayer4(ivec2 c) {
  return (BAYER[(c.y & 3) * 4 + (c.x & 3)] + 0.5) / 16.0;
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec2 cellF = floor(px / u_cellPx);
  ivec2 cell = ivec2(cellF);
  vec2 local = px - cellF * u_cellPx;

  vec4 f = texelFetch(u_field, cell, 0);
  if (u_mix < 1.0) f = mix(texelFetch(u_prev, cell, 0), f, u_mix);
  float i = f.r;
  float glow = f.g;

  float cov = 0.0;
  if (i > 0.004) {
    if (u_mark == 0) {
      // Dither between the two nearest glyphs so gradients have no contour bands.
      float level = i * float(u_glyphCount - 1) + bayer4(cell);
      int idx = clamp(int(level), 0, u_glyphCount - 1);
      ivec2 tile = ivec2(idx % u_atlasCols, idx / u_atlasCols);
      cov = texelFetch(u_atlas, tile * ivec2(u_cellPx) + ivec2(local), 0).a;
    } else {
      float s = min(u_cellPx.x, u_cellPx.y);
      float r = 0.5 * s * u_dotScale * sqrt(i);
      float d = length(local - 0.5 * u_cellPx);
      cov = clamp(r - d + 0.5, 0.0, 1.0);
    }
  }

  // Faint cells are dim as well as sparse; this is where the depth comes from.
  float tone = mix(0.16, 1.0, smoothstep(0.0, 0.9, i));
  float g = smoothstep(0.0, 1.0, clamp(glow, 0.0, 1.0));
  float a = min(1.0, cov * u_opacity * tone * (1.0 + 0.45 * g));
  vec3 col = mix(u_ink, u_accent, g);
  outColor = vec4(col * a, a);
}
`;
