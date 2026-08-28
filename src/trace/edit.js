// @ts-check
// Hit-test and insert helpers for trace nodes.

/** @typedef {import('./coords.js').Pixel} Pixel */

/**
 * @param {Pixel[]} pixels
 * @param {Pixel} p
 * @param {number} radius
 */
export function hitPointIndex(pixels, p, radius) {
  let best = -1;
  let bestD = radius;
  for (let i = 0; i < pixels.length; i++) {
    const d = Math.hypot(pixels[i].x - p.x, pixels[i].y - p.y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Nearest point on the polyline, for inserting a node.
 * @param {Pixel[]} pixels
 * @param {Pixel} p
 * @returns {{ index: number, proj: Pixel, dist: number, t: number } | null}
 */
export function closestInsert(pixels, p) {
  if (pixels.length < 2) return null;
  let bestI = -1;
  let bestD = Infinity;
  let bestT = 0;
  /** @type {Pixel} */
  let bestProj = { x: p.x, y: p.y };
  for (let i = 0; i < pixels.length - 1; i++) {
    const a = pixels[i];
    const b = pixels[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(p.x - proj.x, p.y - proj.y);
    if (d < bestD) {
      bestD = d;
      bestI = i;
      bestT = t;
      bestProj = proj;
    }
  }
  if (bestI < 0 || bestT < 0.08 || bestT > 0.92) return null;
  return { index: bestI + 1, proj: bestProj, dist: bestD, t: bestT };
}

/**
 * @param {Pixel} p
 */
export function cycleJoin(p) {
  if (!p.joint && !p.smooth) {
    p.joint = true;
    p.smooth = false;
  } else if (p.joint && !p.smooth) {
    p.smooth = true;
  } else {
    p.joint = false;
    p.smooth = false;
  }
}
