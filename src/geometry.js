// @ts-check
// Subtractive mill geometry.
//
// Workpiece is radius(x, theta): polar distance from the centerline.
// Starting stock is a prism (round / square / hex). Each placement
// removes everything outside the bit's revolved envelope. A placement is
// either a plunge (parked) or a run (tip travels from start to end while
// circular distance may change). Remaining:
//   min(stockRadius(theta), envelopes at this x)
//
// Pure functions — no DOM, no Three.js.

import { stockRadius } from './stock.js';
import { plungeEnvelope, NO_CUT, profilePoints, profileMaxRadius } from './profile.js';

export { NO_CUT };
export const MIN_RADIUS = 0.02;

/**
 * @typedef {import('./stock.js').Stock} Stock
 * @typedef {import('./profile.js').BitProfile} BitProfile
 *
 * @typedef {{
 *   id: string,
 *   bitId: string,
 *   profile: BitProfile,
 *   atLength: number,
 *   circularDistance: number,
 *   run?: boolean,
 *   hidden?: boolean,
 *   endAtLength?: number,
 *   endCircularDistance?: number,
 * }} Placement
 *
 * @typedef {{ stock: Stock, placements: Placement[] }} Model
 */

/**
 * True when this cut travels from a start pose to an end pose.
 * @param {Placement} p
 */
export function isRun(p) {
  return Boolean(p.run);
}

/** @param {Placement} p */
export function isCutHidden(p) {
  return Boolean(p.hidden);
}

/**
 * Remaining radius allowed by one placement at station `x`.
 * @param {Placement} p
 * @param {number} x
 */
export function placementEnvelope(p, x) {
  if (!isRun(p) || p.endAtLength == null || p.endCircularDistance == null) {
    return plungeEnvelope(p.profile, p.circularDistance, x - p.atLength);
  }

  const a = p.atLength;
  const b = /** @type {number} */ (p.endAtLength);
  const cd0 = p.circularDistance;
  const cd1 = /** @type {number} */ (p.endCircularDistance);
  const maxR = profileMaxRadius(p.profile);
  const reach = Number.isFinite(maxR) ? maxR : 1e6;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (x < lo - reach - 1e-9 || x > hi + reach + 1e-9) return NO_CUT;

  const span = Math.abs(b - a);
  const n = Math.max(12, Math.ceil(span * 12) + 4);
  let best = NO_CUT;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = a + t * (b - a);
    const cd = cd0 + t * (cd1 - cd0);
    const env = plungeEnvelope(p.profile, cd, x - s);
    if (env < best) best = env;
  }
  return best;
}

/**
 * Bit envelopes are surfaces of revolution — they do not depend on θ.
 * Compute the remaining cut radius at `x` once, then min with the blank
 * at each angle.
 * @param {Model} model
 * @param {number} x
 */
export function cutRadiusAt(model, x) {
  let cut = NO_CUT;
  for (const p of model.placements) {
    if (isCutHidden(p)) continue;
    const env = placementEnvelope(p, x);
    if (env < cut) cut = env;
  }
  return cut;
}

/**
 * @param {import('./stock.js').Stock} stock
 * @param {number} thetaDeg
 * @param {number} cut
 */
export function remainingFromCut(stock, thetaDeg, cut) {
  const blank = stockRadius(stock, thetaDeg);
  return Math.max(MIN_RADIUS, Math.min(blank, cut));
}

/**
 * Remaining radius at a station and angle. Subtractive only — never larger
 * than the uncut blank.
 * @param {Model} model
 * @param {number} x distance from the headstock, inches
 * @param {number} thetaDeg rotation angle, degrees
 */
export function radiusAt(model, x, thetaDeg) {
  const { stock } = model;
  if (x < 0 || x > stock.length) return 0;
  return remainingFromCut(stock, thetaDeg, cutRadiusAt(model, x));
}

/**
 * Precompute cut radius at each length station so 2D/3D do not re-run every
 * bit at every angle.
 * @param {Model} model
 * @param {number[]} xs
 * @returns {Float64Array}
 */
export function bakeCutRadii(model, xs) {
  const cuts = new Float64Array(xs.length);
  for (let i = 0; i < xs.length; i++) cuts[i] = cutRadiusAt(model, xs[i]);
  return cuts;
}

/**
 * Length stations for silhouettes/meshes: a coarse grid plus samples at
 * each bit profile's r offsets so the remaining outline follows the bit.
 * @param {Model} model
 * @param {{ dense?: boolean }} [opts]
 * @returns {number[]}
 */
export function sampleStations(model, opts = {}) {
  const dense = opts.dense !== false;
  const { length } = model.stock;
  const xs = new Set([0, length]);
  const uniform = Math.max(60, Math.min(240, Math.ceil(length * 4)));
  for (let i = 0; i <= uniform; i++) xs.add((length * i) / uniform);

  const steps = dense ? 8 : 3;
  const face = stockRadius(model.stock, 0);
  for (const p of model.placements) {
    if (isCutHidden(p)) continue;
    addProfileStations(xs, p.atLength, p.profile, p.circularDistance, face, length, steps);
    if (isRun(p) && p.endAtLength != null && p.endCircularDistance != null) {
      const end = p.endAtLength;
      addProfileStations(xs, end, p.profile, p.endCircularDistance, face, length, steps);
      const along = Math.max(8, Math.ceil(Math.abs(end - p.atLength) * 4));
      for (let i = 1; i < along; i++) {
        const t = i / along;
        xs.add(clamp01(p.atLength + t * (end - p.atLength), length));
      }
    }
  }

  return [...xs].sort((a, b) => a - b);
}

const EDGE = 1e-4;

/**
 * @param {Set<number>} xs
 * @param {number} at
 * @param {BitProfile} profile
 * @param {number} cd
 * @param {number} face
 * @param {number} length
 * @param {number} steps
 */
function addProfileStations(xs, at, profile, cd, face, length, steps) {
  const pts = profilePoints(profile);
  for (let i = 0; i < pts.length; i++) {
    xs.add(clamp01(at + pts[i].r, length));
    xs.add(clamp01(at - pts[i].r, length));
    if (i < pts.length - 1) {
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        const r = pts[i].r + t * (pts[i + 1].r - pts[i].r);
        xs.add(clamp01(at + r, length));
        xs.add(clamp01(at - r, length));
      }
    }
  }

  const maxR = profileMaxRadius(profile);
  const reach = Number.isFinite(maxR) ? maxR : 2;
  let prev = plungeEnvelope(profile, cd, 0);
  const n = 48;
  for (let i = 1; i <= n; i++) {
    const s = (reach * i) / n;
    const env = plungeEnvelope(profile, cd, s);
    const prevCut = prev < face - 1e-9;
    const nowCut = env < face - 1e-9;
    if (prevCut !== nowCut) {
      xs.add(clamp01(at + s, length));
      xs.add(clamp01(at - s, length));
      xs.add(clamp01(at + s + EDGE, length));
      xs.add(clamp01(at - s - EDGE, length));
    }
    prev = env;
  }
  if (Number.isFinite(maxR) && maxR > 0) {
    xs.add(clamp01(at + maxR, length));
    xs.add(clamp01(at - maxR, length));
    xs.add(clamp01(at + maxR + EDGE, length));
    xs.add(clamp01(at - maxR - EDGE, length));
  }
}

function clamp01(x, length) {
  return Math.max(0, Math.min(length, x));
}

/**
 * Face-plane remaining radius (θ = 0), for the 2D side silhouette.
 * Pass a baked cut radius when sampling many stations.
 * @param {Model} model
 * @param {number} x
 * @param {number} [cut]
 */
export function faceRadiusAt(model, x, cut) {
  const c = cut === undefined ? cutRadiusAt(model, x) : cut;
  return remainingFromCut(model.stock, 0, c);
}
