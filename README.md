# ascii-backgrounds

Animated ASCII backgrounds for any element. WebGL2, zero dependencies, about 12 kB gzipped.

```ts
import { background, swell } from 'ascii-backgrounds';

const bg = background('#hero', {
  preset: swell,
  clear: document.querySelector('#hero h1'), // keep the headline readable
});
```

- **Four presets:** `swell`, `ripple`, `rain`, `constellation`, or [write your own](#custom-presets) in a few lines of GLSL.
- **Characters or dots**, any charset, named palettes with light/dark variants.
- **Pointer response:** a trail, a lantern that reveals the field, and click pulses.
- **Clear zones** keep the field quiet behind your content and follow its layout.
- **Cheap:** one WebGL2 context and one animation loop for every background on the page. Pauses off screen and in hidden tabs. Holds a still frame for `prefers-reduced-motion`.
- **Safe to import anywhere:** no DOM access at import time (SSR-friendly), tree-shakable presets, and a no-op handle where WebGL2 is missing.

## Install

```sh
npm i ascii-backgrounds
```

Or with a script tag:

```html
<script src="https://unpkg.com/ascii-backgrounds"></script>
<script>
  AsciiBackgrounds.background('#hero', { preset: AsciiBackgrounds.rain });
</script>
```

## How it sits in the page

`background(element, options)` inserts a `<canvas>` as the element's first child, absolutely positioned to fill its padding box with `z-index: -1`. The element gets `isolation: isolate` (and `position: relative` if it was `static`), so the canvas paints above the element's own background but below its content. `destroy()` removes the canvas and restores both styles.

## Options

| Option | Type | Default | |
|---|---|---|---|
| `preset` | `Preset` | — (required) | `swell`, `ripple`, `rain`, `constellation` or your own |
| `palette` | name, CSS colour, or `{ light, dark }` | `'graphite'` | Named: `graphite`, `ember`, `ocean`, `moss`, `violet`, `phosphor`, `mono` |
| `accent` | CSS colour or `{ light, dark }` | palette's accent | Colour for the cursor, pulses and bright cells |
| `theme` | `'auto' \| 'light' \| 'dark'` | `'auto'` | `auto` follows `prefers-color-scheme` |
| `mark` | `'glyph' \| 'dot'` | per preset | |
| `charset` | name or string | per preset | A ramp from empty to dense, e.g. `' .:-=+*#%@'`. Named: `standard`, `minimal`, `detailed`, `blocks`, `braille`, `dots`, `binary`, `lines`, `rain`, `code`, `letters`, `kana` |
| `cellSize` | number (4–64) | per preset | Cell height in CSS px. Glyph cells are about 0.6× as wide, like monospace text; dot cells are square |
| `speed` | number (0–5) | `1` | |
| `cursor` | `boolean \| 'trail' \| 'lantern'` | per preset | `false` turns off all pointer and click response |
| `clear` | element, `{ element, padding?, feather? }`, or an array (max 4) | none | Quiet zones; `padding` defaults to 24, `feather` to 56 |
| `opacity` | number (0–1) | `1` | |
| `dotScale` | number (0.1–1.4) | `0.9` | Dot size with `mark: 'dot'` |
| `font` | CSS font family | monospace stack | Used to draw glyphs |
| `reducedMotion` | boolean | system setting | `true` holds a still frame |
| `maxPixelRatio` | number | `2` | Caps devicePixelRatio for big screens |
| `autoplay` | boolean | `true` | |

Colours accept any CSS colour, including `oklch(...)`, `var(--brand)` and `currentColor` (resolved against the element). If your site switches theme with a class instead of `prefers-color-scheme`, pass `theme` yourself and call `bg.update({ theme })` when it changes.

## Handle

```ts
const bg = background(el, { preset: swell });

bg.update({ palette: 'ember', speed: 2 }); // change anything; the rest is kept
bg.setPreset(rain);                         // cross-fades (0.8 s), keeps options
bg.setPreset(rain, { fade: 0 });            // or cuts
bg.pulse();                                 // ring from the centre
bg.pulse({ x: 0.2, y: 0.8 });               // fractions of the element size
bg.pulse({ element: button });              // from an element's centre
bg.pause();
bg.play();
bg.destroy();

bg.supported; // false without WebGL2: the element is untouched and every method is a no-op
bg.canvas;    // the inserted canvas
```

`isSupported()` tells you up front whether WebGL2 is available.

## Frameworks

There is nothing framework-specific: mount in an effect and destroy on cleanup.

```tsx
// React
useEffect(() => {
  const bg = background(ref.current!, { preset: swell, clear: titleRef.current });
  return () => bg.destroy();
}, []);
```

```ts
// Vue
onMounted(() => (bg = background(el.value, { preset: swell })));
onBeforeUnmount(() => bg?.destroy());
```

```svelte
<!-- Svelte -->
<script>
  import { background, swell } from 'ascii-backgrounds';
  const ascii = (node, opts) => {
    const bg = background(node, opts);
    return { update: (o) => bg.update(o), destroy: () => bg.destroy() };
  };
</script>
<section use:ascii={{ preset: swell }}>…</section>
```

## Custom presets

A preset is a GLSL function evaluated once per cell. It gets the cell centre `p` and field size `res` in CSS px (origin top-left) and the time `t` in seconds, and returns `(intensity, glow)` in 0..1. Intensity picks the glyph (or dot size); glow blends toward the accent colour.

```ts
import { background, definePreset } from 'ascii-backgrounds';

const tide = definePreset({
  name: 'tide',
  defaults: { cellSize: 10, charset: 'blocks', cursor: 'lantern' },
  glsl: `
    vec2 field(vec2 p, vec2 res, float t) {
      float v = 0.5 + 0.5 * sin(p.x / 60.0 + t) * cos(p.y / 45.0 - t * 0.7);
      return vec2(v * fbm(p / 200.0 + t * 0.05), 0.0);
    }
  `,
});

background('#hero', { preset: tide });
```

Available helpers: `hash11`, `hash12`, `hash22`, `noise` and `fbm` (value noise), `gnoise` and `gfbm` (smoother gradient noise, roughly −0.6…0.6), `sdSegment`, and the uniforms `u_cell` (cell height in CSS px), `u_cellSize` (cell width and height), `u_time` and `u_res`. Return intensity as a smooth 0–1 value and leave quiet areas at 0: the renderer dithers between neighbouring glyphs and fades faint cells, so soft gradients look best.

For things the GPU can't easily do per cell (particles, simulations), add a `create()` that returns a `tick(ctx)` function. It runs on the CPU each frame and can write up to 48 points (`ctx.points`, 4 floats each) and 80 segments (`ctx.segments`), which the shader reads as `u_pts[i]` / `u_ptCount` and `u_segs[i]` / `u_segCount`. See [`src/presets/constellation.ts`](src/presets/constellation.ts) for an example.

Shader errors are thrown from `background()` / `setPreset()` with the compiler log.

## Browser support

Any browser with WebGL2: Chrome/Edge 56+, Firefox 51+, Safari 15+. Elsewhere `supported` is `false` and nothing changes on the page.

## Development

Requires Node 22.18+ (runs the TypeScript tests directly).

```sh
npm install
npm run dev        # build, then serve the playground at http://localhost:5173
npm test           # unit tests (node:test)
npm run typecheck
npm run build      # dist/: ESM + .d.ts (tsc) and ascii-backgrounds.min.js (esbuild, IIFE)
```

The published package has no runtime dependencies; `typescript` and `esbuild` are dev-only.

### Publishing

```sh
npm login
npm publish        # prepublishOnly runs typecheck, tests and build
```

## License

MIT
