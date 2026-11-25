import test from 'node:test';
import assert from 'node:assert/strict';
import { writeClearZones } from '../src/clear.ts';
import { buildFieldShader } from '../src/glsl.ts';
import { MAX_POINTS, MAX_SEGMENTS } from '../src/limits.ts';
import { swell } from '../src/presets/swell.ts';
import { ripple } from '../src/presets/ripple.ts';
import { rain } from '../src/presets/rain.ts';
import { constellation } from '../src/presets/constellation.ts';

const all = [swell, ripple, rain, constellation];

function ctx(over = {}) {
  return {
    time: 0,
    dt: 1 / 60,
    width: 1200,
    height: 700,
    cellSize: 12,
    pointer: { x: 0, y: 0, inside: false },
    points: new Float32Array(MAX_POINTS * 4),
    pointCount: 0,
    segments: new Float32Array(MAX_SEGMENTS * 4),
    segmentCount: 0,
    ...over,
  };
}

test('every preset defines field() and builds a full shader', () => {
  for (const p of all) {
    assert.match(p.glsl, /vec2\s+field\s*\(\s*vec2\s+p\s*,\s*vec2\s+res\s*,\s*float\s+t\s*\)/, p.name);
    const src = buildFieldShader(p.glsl);
    assert.ok(src.startsWith('#version 300 es'), p.name);
    assert.ok(src.includes('void main()'), p.name);
    // No JS number leaked into GLSL as an integer where a float is required.
    assert.ok(!/smoothstep\(\d+,/.test(src), p.name);
  }
});

// GLSL ES 3.00 reserved words that are easy to pick as variable names by accident.
const RESERVED = ['active', 'input', 'output', 'filter', 'common', 'partition', 'sample', 'smooth', 'flat',
  'patch', 'superp', 'class', 'union', 'enum', 'public', 'static', 'extern', 'external', 'interface',
  'long', 'short', 'double', 'half', 'fixed', 'unsigned', 'inline', 'noinline', 'cast', 'namespace',
  'using', 'goto', 'template', 'this', 'resource', 'buffer', 'shared', 'coherent', 'volatile', 'restrict'];

test('presets do not declare reserved GLSL identifiers', () => {
  const decl = new RegExp(`\\b(?:float|int|vec[234]|ivec[234]|bool|mat[234])\\s+(${RESERVED.join('|')})\\b`);
  for (const p of all) assert.ok(!decl.test(p.glsl), `${p.name}: ${p.glsl.match(decl)?.[1]}`);
});

test('ripple keeps drops inside limits and reacts to the pointer', () => {
  const state = ripple.create();
  const c = ctx();
  for (let i = 0; i < 2000; i++) {
    c.time = i / 60;
    state.tick(c);
    assert.ok(c.pointCount <= MAX_POINTS);
  }
  const before = c.pointCount;
  c.pointer = { x: 50, y: 50, inside: true };
  state.tick(c);
  assert.ok(c.pointCount >= Math.min(before + 1, MAX_POINTS) || c.pointCount === MAX_POINTS);
  const last = c.pointCount - 1;
  assert.equal(c.points[last * 4], 50);
  assert.equal(c.points[last * 4 + 1], 50);
});

test('constellation scales with area and only links nearby points', () => {
  const state = constellation.create();
  const c = ctx();
  for (let i = 0; i < 300; i++) {
    c.time = i / 60;
    state.tick(c);
  }
  assert.equal(c.pointCount, Math.min(MAX_POINTS, Math.round((1200 * 700) / 22000)));
  assert.ok(c.segmentCount <= MAX_SEGMENTS);
  for (let i = 0; i < c.segmentCount; i++) {
    const [ax, ay, bx, by] = c.segments.subarray(i * 4, i * 4 + 4);
    assert.ok(Math.hypot(ax - bx, ay - by) < 170.001);
  }
  const small = ctx({ width: 100, height: 100 });
  constellation.create().tick(small);
  assert.equal(small.pointCount, 10);
});

test('clear zones are written relative to the origin with padding', () => {
  const boxes = new Float32Array(16);
  const feathers = new Float32Array(4);
  const n = writeClearZones(
    { x: 100, y: 50 },
    [
      { rect: { left: 200, top: 150, width: 300, height: 80 }, padding: 10, feather: 40 },
      { rect: { left: 0, top: 0, width: 0, height: 0 }, padding: 10, feather: 40 },
    ],
    boxes,
    feathers,
  );
  assert.equal(n, 1);
  assert.deepEqual(Array.from(boxes.subarray(0, 4)), [250, 140, 160, 50]);
  assert.equal(feathers[0], 40);
});
