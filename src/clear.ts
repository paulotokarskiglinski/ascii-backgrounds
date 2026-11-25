export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ClearBox {
  rect: Box;
  padding: number;
  feather: number;
}

/**
 * Writes clear zones as `(centerX, centerY, halfWidth, halfHeight)` relative to `origin`
 * into `boxes` (4 floats each) and their feathers into `feathers`. Empty rects are skipped.
 * Returns how many zones were written.
 */
export function writeClearZones(origin: { x: number; y: number }, zones: ClearBox[], boxes: Float32Array, feathers: Float32Array): number {
  const max = Math.min(feathers.length, Math.floor(boxes.length / 4));
  let n = 0;
  for (const z of zones) {
    if (n >= max) break;
    const { rect, padding, feather } = z;
    if (rect.width <= 0 && rect.height <= 0) continue;
    boxes[n * 4] = rect.left - origin.x + rect.width / 2;
    boxes[n * 4 + 1] = rect.top - origin.y + rect.height / 2;
    boxes[n * 4 + 2] = rect.width / 2 + padding;
    boxes[n * 4 + 3] = rect.height / 2 + padding;
    feathers[n] = Math.max(1, feather);
    n++;
  }
  return n;
}
