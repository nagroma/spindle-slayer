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
import {
  plungeEnvelope,
  NO_CUT,
  profilePoints,
  profileMaxRadius,
  isFluteProfile,
  fluteCutDepth,
} from './profile.js';

export { NO_CUT };
export const MIN_RADIUS = 0.02;
export const DEFAULT_FLUTE_INDEX_DEG = 90;

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
 *   indexIncrementDeg?: number,
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

/** @param {Placement} p */
export function isFlute(p) {
  return isFluteProfile(p.profile);
}

/**
 * Headstock angles for an indexed flute. 20° → 0, 20, …, 340 (18 grooves).
 * @param {number} [incrementDeg]
 * @returns {number[]}
 */
export function fluteIndexAngles(incrementDeg) {
  const inc = Number(incrementDeg);
  if (!Number.isFinite(inc) || inc <= 0) return [0];
  const step = Math.min(180, Math.max(1, inc));
  /** @type {number[]} */
  const out = [];
  for (let a = 0; a < 360 - 1e-9; a += step) out.push(a);
  return out.length ? out : [0];
}

/**
 * Remaining radius allowed by one placement at station `x`.
 * @param {Placement} p
 * @param {number} x
 */
export function placementEnvelope(p, x) {
  if (isFlute(p)) return NO_CUT;
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
    if (isCutHidden(p) || isFlute(p)) continue;
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
  const cut = Math.min(cutRadiusAt(model, x), fluteRadiusAt(model, x, thetaDeg));
  return remainingFromCut(stock, thetaDeg, cut);
}

/**
 * Remaining radius allowed by visible flute cuts at (x, θ). Infinity if none cut.
 * @param {Model} model
 * @param {number} x
 * @param {number} thetaDeg
 * @param {{ posesPerInch?: number }} [opts]
 */
export function fluteRadiusAt(model, x, thetaDeg, opts = {}) {
  let cut = NO_CUT;
  for (const p of model.placements) {
    if (isCutHidden(p) || !isFlute(p)) continue;
    const env = flutePlacementEnvelope(p, x, thetaDeg, opts.posesPerInch);
    if (env < cut) cut = env;
  }
  return cut;
}

/** @param {Model} model */
export function hasVisibleFlutes(model) {
  return model.placements.some((p) => !isCutHidden(p) && isFlute(p));
}

/**
 * Inner intersection of a sphere (cutter) with the radial ray at (x, θ).
 * Center of the sphere is at (cd, theta0Deg, x0) in mill coordinates.
 * @param {number} cd
 * @param {number} theta0Deg
 * @param {number} x0
 * @param {number} radius
 * @param {number} x
 * @param {number} thetaDeg
 */
export function sphereRayInner(cd, theta0Deg, x0, radius, x, thetaDeg) {
  const dx = x - x0;
  if (Math.abs(dx) > radius + 1e-9) return NO_CUT;
  let dTheta = ((thetaDeg - theta0Deg) * Math.PI) / 180;
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  const sin = Math.sin(dTheta);
  const inside = radius * radius - dx * dx - cd * cd * sin * sin;
  if (inside < -1e-12) return NO_CUT;
  const root = Math.sqrt(Math.max(0, inside));
  const proj = cd * Math.cos(dTheta);
  const inner = proj - root;
  const outer = proj + root;
  // Opposite-side spheres yield two negative roots. A flute does not punch through the axis.
  if (outer < 0 || inner < 0) return NO_CUT;
  return inner;
}

/**
 * @param {Placement} p
 * @param {number} x
 * @param {number} thetaDeg
 * @param {number} [posesPerInch]
 */
function flutePlacementEnvelope(p, x, thetaDeg, posesPerInch) {
  const R = fluteCutDepth(/** @type {import('./profile.js').FluteProfile} */ (p.profile));
  if (!(R > 0)) return NO_CUT;
  const angles = fluteIndexAngles(p.indexIncrementDeg ?? DEFAULT_FLUTE_INDEX_DEG);
  let best = NO_CUT;
  const poses = fluteCenterPoses(p, x, R, posesPerInch);
  for (const pose of poses) {
    for (const a of angles) {
      const env = sphereRayInner(pose.cd, a, pose.x, R, x, thetaDeg);
      if (env < best) best = env;
    }
  }
  return best;
}

/**
 * Sphere centers along the flute path that can still reach station `x`.
 * @param {Placement} p
 * @param {number} x
 * @param {number} reach
 * @param {number} [posesPerInch]
 * @returns {{ x: number, cd: number }[]}
 */
function fluteCenterPoses(p, x, reach, posesPerInch = 12) {
  if (!isRun(p) || p.endAtLength == null || p.endCircularDistance == null) {
    return Math.abs(x - p.atLength) <= reach + 1e-9 ? [{ x: p.atLength, cd: p.circularDistance }] : [];
  }
  const a = p.atLength;
  const b = p.endAtLength;
  const cd0 = p.circularDistance;
  const cd1 = p.endCircularDistance;
  const span = Math.abs(b - a);
  if (span < 1e-9) {
    return Math.abs(x - a) <= reach + 1e-9 ? [{ x: a, cd: cd0 }] : [];
  }
  const perInch = Number.isFinite(posesPerInch) && posesPerInch > 0 ? posesPerInch : 12;
  const n = Math.max(12, Math.ceil(span * perInch) + 4);
  /** @type {{ x: number, cd: number }[]} */
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = a + t * (b - a);
    if (Math.abs(x - s) > reach + 1e-9) continue;
    out.push({ x: s, cd: cd0 + t * (cd1 - cd0) });
  }
  return out;
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
 * @param {{ dense?: boolean, perInch?: number, perInchMax?: number, flutePerInch?: number }} [opts]
 * @returns {number[]}
 */
export function sampleStations(model, opts = {}) {
  const dense = opts.dense !== false;
  const { length } = model.stock;
  const xs = new Set([0, length]);
  const perInch = opts.perInch ?? 4;
  const perInchMax = opts.perInchMax ?? 240;
  const uniform = Math.max(60, Math.min(perInchMax, Math.ceil(length * perInch)));
  for (let i = 0; i <= uniform; i++) xs.add((length * i) / uniform);

  const steps = dense ? 8 : 3;
  const face = stockRadius(model.stock, 0);
  for (const p of model.placements) {
    if (isCutHidden(p)) continue;
    if (isFlute(p)) {
      addFluteStations(xs, p, length, opts.flutePerInch);
      continue;
    }
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
 * @param {Set<number>} xs
 * @param {Placement} p
 * @param {number} length
 * @param {number} [perInch]
 */
function addFluteStations(xs, p, length, perInch = 8) {
  const R = fluteCutDepth(/** @type {import('./profile.js').FluteProfile} */ (p.profile));
  const a = p.atLength;
  const b = isRun(p) && p.endAtLength != null ? p.endAtLength : p.atLength;
  xs.add(clamp01(a, length));
  xs.add(clamp01(b, length));
  xs.add(clamp01(Math.min(a, b) - R, length));
  xs.add(clamp01(Math.max(a, b) + R, length));
  const density = Number.isFinite(perInch) && perInch > 0 ? perInch : 8;
  const along = Math.max(8, Math.ceil(Math.abs(b - a) * density) + 4);
  for (let i = 1; i < along; i++) {
    const t = i / along;
    xs.add(clamp01(a + t * (b - a), length));
  }
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
