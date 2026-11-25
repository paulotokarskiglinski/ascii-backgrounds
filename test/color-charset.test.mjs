import test from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, resolvePalette, palettes } from '../src/color.ts';
import { resolveCharset, charsets } from '../src/charsets.ts';

const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);

test('parses hex colours', () => {
  assert.ok(close(parseColor('#fff'), [1, 1, 1]));
  assert.ok(close(parseColor('#FF0000'), [1, 0, 0]));
  assert.ok(close(parseColor('#00ff0080'), [0, 1, 0]));
  assert.ok(close(parseColor('#0f08'), [0, 1, 0]));
  assert.equal(parseColor('#12345'), null);
  assert.equal(parseColor('#zzz'), null);
});

test('parses rgb() in comma and space syntax', () => {
  assert.ok(close(parseColor('rgb(255, 128, 0)'), [1, 128 / 255, 0]));
  assert.ok(close(parseColor('rgba(0,0,255,0.5)'), [0, 0, 1]));
  assert.ok(close(parseColor('rgb(100% 0% 50% / 0.3)'), [1, 0, 0.5]));
  assert.equal(parseColor('rgb(1, 2)'), null);
});

test('leaves other syntaxes to the browser', () => {
  assert.equal(parseColor('rebeccapurple'), null);
  assert.equal(parseColor('oklch(70% 0.1 200)'), null);
});

test('palette resolution', () => {
  assert.deepEqual(resolvePalette(), palettes.graphite);
  assert.deepEqual(resolvePalette('ember'), palettes.ember);
  assert.deepEqual(resolvePalette('#123456'), {
    ink: { light: '#123456', dark: '#123456' },
    accent: { light: '#123456', dark: '#123456' },
  });
  const p = resolvePalette({ light: '#000', dark: '#fff' }, '#f00');
  assert.deepEqual(p.ink, { light: '#000', dark: '#fff' });
  assert.deepEqual(p.accent, { light: '#f00', dark: '#f00' });
});

test('palette resolution does not hand out the shared objects', () => {
  const p = resolvePalette('ocean');
  p.ink.light = 'x';
  assert.notEqual(palettes.ocean.ink.light, 'x');
});

test('charset resolution', () => {
  assert.deepEqual(resolveCharset('blocks'), Array.from(charsets.blocks));
  assert.deepEqual(resolveCharset(' .oO'), [' ', '.', 'o', 'O']);
  assert.deepEqual(resolveCharset('#'), [' ', '#']);
  assert.deepEqual(resolveCharset(undefined, 'binary'), Array.from(charsets.binary));
  assert.deepEqual(resolveCharset(''), Array.from(charsets.standard));
  assert.equal(resolveCharset('x'.repeat(1000)).length, 256);
});

test('charset splits by code point, not UTF-16 unit', () => {
  assert.deepEqual(resolveCharset(' ⠁⣿'), [' ', '⠁', '⣿']);
  assert.deepEqual(resolveCharset(' 𝔸𝔹'), [' ', '𝔸', '𝔹']);
});
