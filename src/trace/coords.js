// @ts-check
// Pixel clicks → (axial d, radius r) inches. Origin/axis come from
// three-point end centers (extreme + two sides). d increases toward the foot.

/**
 * @typedef {{ x: number, y: number, joint?: boolean, smooth?: boolean, spanType?: 'line' | 'arc' | 'spline' }} Pixel
 * @typedef {{ d: number, r: number }} ProfilePt
 * @typedef {{
 *   origin: Pixel,
 *   axis: Pixel,
 *   inchesPerPixel: number,
 * }} AxisScale
 */

/** @param {Pixel} a @param {Pixel} b */
export function pixelDist(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Center of an end from the extreme (high/low spot) and the two sides.
 * Sides do not have to sit at the same height as the extreme: we take the
 * station of the extreme and the midline between the sides.
 * @param {Pixel} extreme
 * @param {Pixel} sideA
 * @param {Pixel} sideB
 * @returns {Pixel}
 */
export function endCenter(extreme, sideA, sideB) {
  const mx = (sideA.x + sideB.x) / 2;
  const my = (sideA.y + sideB.y) / 2;
  const dx = sideB.x - sideA.x;
  const dy = sideB.y - sideA.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: mx, y: my };
  const ux = dx / len;
  const uy = dy / len;
  const along = (extreme.x - mx) * ux + (extreme.y - my) * uy;
  return {
    x: extreme.x - along * ux,
    y: extreme.y - along * uy,
  };
}

/**
 * @param {Pixel} origin
 * @param {Pixel} axis
 * @param {number} knownInches distance origin→axis in inches
 * @returns {AxisScale | null}
 */
export function axisScaleFromLength(origin, axis, knownInches) {
  const px = pixelDist(origin, axis);
  if (px < 1e-6 || !(knownInches > 0)) return null;
  return { origin, axis, inchesPerPixel: knownInches / px };
}

/**
 * @param {Pixel} origin
 * @param {Pixel} axis
 * @param {Pixel} a
 * @param {Pixel} b
 * @param {number} knownInches distance a→b in inches
 * @returns {AxisScale | null}
 */
export function axisScaleFromSpan(origin, axis, a, b, knownInches) {
  const px = pixelDist(a, b);
  if (px < 1e-6 || !(knownInches > 0)) return null;
  return { origin, axis, inchesPerPixel: knownInches / px };
}

/**
 * @param {AxisScale} scale
 * @param {Pixel} p
 * @returns {ProfilePt}
 */
export function pixelToProfile(scale, p) {
  const dx = scale.axis.x - scale.origin.x;
  const dy = scale.axis.y - scale.origin.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const vx = p.x - scale.origin.x;
  const vy = p.y - scale.origin.y;
  const d = (vx * ux + vy * uy) * scale.inchesPerPixel;
  const r = Math.abs(vx * -uy + vy * ux) * scale.inchesPerPixel;
  return { d, r };
}

/**
 * @param {AxisScale} scale
 * @param {ProfilePt} p
 * @param {boolean} [mirror]
 * @returns {Pixel}
 */
export function profileToPixel(scale, p, mirror = false) {
  const dx = scale.axis.x - scale.origin.x;
  const dy = scale.axis.y - scale.origin.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const pxPerIn = 1 / scale.inchesPerPixel;
  const side = mirror ? -1 : 1;
  return {
    x: scale.origin.x + ux * p.d * pxPerIn + -uy * side * p.r * pxPerIn,
    y: scale.origin.y + uy * p.d * pxPerIn + ux * side * p.r * pxPerIn,
  };
}

/**
 * @param {AxisScale} scale
 * @param {Pixel[]} pixels
 * @returns {{ points: ProfilePt[], breaks: number[], smoothBreaks: number[] }}
 */
export function traceToProfile(scale, pixels) {
  /** @type {ProfilePt[]} */
  const points = [];
  /** @type {number[]} */
  const breaks = [];
  /** @type {number[]} */
  const smoothBreaks = [];
  for (const p of pixels) {
    const pr = pixelToProfile(scale, p);
    if (points.length) {
      const prev = points[points.length - 1];
      if (Math.hypot(pr.d - prev.d, pr.r - prev.r) <= 1e-6) {
        if ((p.joint || p.smooth) && points.length > 1) {
          breaks.push(points.length - 1);
          if (p.smooth) smoothBreaks.push(points.length - 1);
        }
        continue;
      }
    }
    points.push(pr);
    if (p.joint || p.smooth) {
      breaks.push(points.length - 1);
      if (p.smooth) smoothBreaks.push(points.length - 1);
    }
  }
  const last = points.length - 1;
  const keep = (arr) => [...new Set(arr.filter((i) => i > 0 && i < last))];
  return {
    points,
    breaks: keep(breaks),
    smoothBreaks: keep(smoothBreaks),
  };
}

/**
 * Consecutive clicks that are almost the same radius (nearly vertical on a
 * standing spindle) share one r. A roundover's tangent points should.
 * @param {ProfilePt[]} points
 * @param {number} [rTol]
 */
export function snapVerticalProfile(points, rTol = 0.06) {
  if (points.length < 2) return points.map((p) => ({ ...p }));
  const out = points.map((p) => ({ ...p }));
  let i = 0;
  while (i < out.length) {
    let j = i;
    while (j + 1 < out.length) {
      const dr = Math.abs(out[j + 1].r - out[j].r);
      const dd = Math.abs(out[j + 1].d - out[j].d);
      if (dr > rTol) break;
      if (dd < dr && dd > 1e-9) break;
      j += 1;
    }
    if (j > i) {
      let sum = 0;
      for (let k = i; k <= j; k++) sum += out[k].r;
      const r = sum / (j - i + 1);
      for (let k = i; k <= j; k++) out[k].r = r;
    }
    i = j + 1;
  }
  return out;
}

/** @param {ProfilePt[]} points @param {number} [eps] */
export function dedupeProfile(points, eps = 1e-6) {
  if (!points.length) return [];
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (Math.hypot(p.d - prev.d, p.r - prev.r) > eps) out.push(p);
  }
  return out;
}
