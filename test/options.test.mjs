import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions, resolveCursor, resolveClear } from '../src/options.ts';
import { swell } from '../src/presets/swell.ts';
import { rain } from '../src/presets/rain.ts';

test('preset defaults fill unset options', () => {
  const o = resolveOptions({ preset: rain });
  assert.equal(o.cellSize, 14);
  assert.deepEqual(o.glyphs, Array.from(' .:;|!1'));
  assert.equal(o.cursor, 'trail');
  assert.equal(o.mark, 'glyph');
  assert.equal(o.speed, 1);
  assert.equal(o.opacity, 1);
  assert.equal(o.autoplay, true);
});

test('caller options win over preset defaults', () => {
  const o = resolveOptions({ preset: rain, cellSize: 20, charset: 'blocks', cursor: false, mark: 'dot' });
  assert.equal(o.cellSize, 20);
  assert.deepEqual(o.glyphs, Array.from(' ░▒▓█'));
  assert.equal(o.cursor, false);
  assert.equal(o.mark, 'dot');
});

test('numbers are clamped and junk falls back to defaults', () => {
  const o = resolveOptions({ preset: swell, cellSize: 1000, speed: -3, opacity: 7, dotScale: NaN });
  assert.equal(o.cellSize, 64);
  assert.equal(o.speed, 0);
  assert.equal(o.opacity, 1);
  assert.equal(o.dotScale, 0.9);
});

test('cursor resolution', () => {
  assert.equal(resolveCursor(undefined, 'trail'), 'trail');
  assert.equal(resolveCursor(undefined, false), false);
  assert.equal(resolveCursor(undefined, undefined), 'lantern');
  assert.equal(resolveCursor(true, false), 'lantern');
  assert.equal(resolveCursor(true, 'trail'), 'trail');
  assert.equal(resolveCursor('lantern', 'trail'), 'lantern');
  assert.equal(resolveCursor(false, 'trail'), false);
});

test('clear zones accept elements, zone objects and arrays, capped at 4', () => {
  const el = { tagName: 'H1' };
  assert.deepEqual(resolveClear(el), [{ element: el, padding: 24, feather: 56 }]);
  assert.deepEqual(resolveClear({ element: el, padding: 0, feather: 10 }), [{ element: el, padding: 0, feather: 10 }]);
  assert.equal(resolveClear([el, el, el, el, el, el]).length, 4);
  assert.deepEqual(resolveClear(null), []);
});
