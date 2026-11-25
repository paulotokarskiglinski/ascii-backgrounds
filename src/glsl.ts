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
uniform float u_cell;        // cell size, CSS px
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
  vec2 p = (cell + 0.5) * u_cell;
  vec2 f = field(p, u_res, u_time);
  float i = f.x;
  float glow = f.y;

  if (u_cursorMode == 1) {
    float r2 = u_cursorRadius * u_cursorRadius;
    for (int k = 0; k < ${MAX_TRAIL}; k++) {
      vec4 tr = u_trail[k];
      if (tr.w <= 0.0) continue;
      float life = 1.0 - tr.z / 0.9;
      if (life <= 0.0) continue;
      vec2 d = p - tr.xy;
      float w = exp(-dot(d, d) / r2) * life * life;
      i += w * 0.55;
      glow += w * 0.9;
    }
  } else if (u_cursorMode == 2 && u_pointer.z > 0.001) {
    float d = length(p - u_pointer.xy);
    float k = 1.0 - smoothstep(0.0, u_cursorRadius, d);
    k = k * k * u_pointer.z;
    i = i * (1.0 + 1.6 * k) + 0.32 * k;
    glow += k * 0.85;
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
uniform float u_cellPx;
uniform vec2 u_res;
uniform int u_glyphCount;
uniform int u_atlasCols;
uniform int u_mark;
uniform float u_dotScale;
uniform vec3 u_ink;
uniform vec3 u_accent;
uniform float u_opacity;

out vec4 outColor;

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
      int idx = min(u_glyphCount - 1, int(i * float(u_glyphCount)));
      ivec2 tile = ivec2(idx % u_atlasCols, idx / u_atlasCols);
      cov = texelFetch(u_atlas, tile * int(u_cellPx) + ivec2(local), 0).a;
    } else {
      float r = 0.5 * u_cellPx * u_dotScale * sqrt(i);
      float d = length(local - 0.5 * u_cellPx);
      cov = clamp(r - d + 0.5, 0.0, 1.0);
    }
  }

  float a = cov * u_opacity * mix(0.5, 1.0, i);
  a = min(1.0, a * (1.0 + 0.6 * glow));
  vec3 col = mix(u_ink, u_accent, clamp(glow, 0.0, 1.0));
  outColor = vec4(col * a, a);
}
`;
