// @ts-check
// Subtractive mill geometry.
//
// Workpiece is radius(x, theta): polar distance from the centerline.
// Starting stock is a prism (round / square / hex). A placement is a
// plunge (parked, full revolution), a run (tip travels; still a surface
// of revolution), a flute (side-mounted, indexed), or a spiral: run plus
// geared rotation. Spiral uses the same helix for a top-mounted plunge
// bit (barley twist) and a side-mounted flute (pineapple); the bit
// chooses the cutter. Remaining:
//   min(stockRadius(theta), revolved envelopes, groove envelopes at (x, θ))
//
// Pure functions — no DOM, no Three.js.

import { stockRadius } from './stock.js';
import {
  plungeEnvelope,
  NO_CUT,
  profilePoints,
  profileMaxRadius,
  profileMaxDepth,
  isFluteProfile,
  fluteCutDepth,
} from './profile.js';

export { NO_CUT };
export const MIN_RADIUS = 0.02;
export const DEFAULT_FLUTE_INDEX_DEG = 90;
/** Default spiral ratio: 2 inches of travel per 1 turn. */
export const DEFAULT_SPIRAL_TRAVEL = 2;
export const DEFAULT_SPIRAL_TURNS = 1;
export const DEFAULT_SPIRAL_STARTS = 1;
/** @typedef {'cw' | 'ccw' | 'both'} SpiralDir */
export const DEFAULT_SPIRAL_DIR = /** @type {SpiralDir} */ ('cw');

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
 *   spiral?: boolean,
 *   spiralTravel?: number,
 *   spiralTurns?: number,
 *   spiralStarts?: number,
 *   spiralStartDeg?: number,
 *   spiralDir?: 'cw' | 'ccw' | 'both',
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
 * Geared wrap: carriage travel locked to headstock rotation.
 * Needs a run. The bit decides barley twist (plunge, on top) vs pineapple (flute).
 * @param {Placement} p
 */
export function isSpiral(p) {
  return Boolean(p.spiral) && isRun(p);
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
 * 4 starts = 90° spacing. Clamped to 1…36.
 * @param {Placement} p
 */
export function spiralStarts(p) {
  const n = Number(p.spiralStarts);
  if (Number.isFinite(n) && n >= 1) return Math.min(36, Math.max(1, Math.round(n)));
  const inc = Number(p.indexIncrementDeg);
  if (Number.isFinite(inc) && inc > 0) {
    return Math.min(36, Math.max(1, Math.round(360 / inc)));
  }
  return DEFAULT_SPIRAL_STARTS;
}

/**
 * Starts → index degrees (4 → 90).
 * @param {number} starts
 */
export function startsToIndexDeg(starts) {
  const n = Math.min(36, Math.max(1, Math.round(Number(starts) || 1)));
  return 360 / n;
}

/**
 * Index degrees → starts (90 → 4).
 * @param {number} incrementDeg
 */
export function indexDegToStarts(incrementDeg) {
  const inc = Number(incrementDeg);
  if (!Number.isFinite(inc) || inc <= 0) return DEFAULT_SPIRAL_STARTS;
  return Math.min(36, Math.max(1, Math.round(360 / inc)));
}

/**
 * Turn on spiral; fill ratio / starts if missing. Caller must make it a run.
 * @param {Placement} p
 */
export function enableSpiral(p) {
  p.spiral = true;
  if (!(Number.isFinite(Number(p.spiralTravel)) && Math.abs(Number(p.spiralTravel)) > 1e-9)) {
    p.spiralTravel = DEFAULT_SPIRAL_TRAVEL;
  }
  if (!Number.isFinite(Number(p.spiralTurns))) p.spiralTurns = DEFAULT_SPIRAL_TURNS;
  if (!Number.isFinite(Number(p.spiralStartDeg))) p.spiralStartDeg = 0;
  if (!(Number.isFinite(Number(p.spiralStarts)) && Number(p.spiralStarts) >= 1)) {
    p.spiralStarts = isFlute(p)
      ? indexDegToStarts(p.indexIncrementDeg ?? DEFAULT_FLUTE_INDEX_DEG)
      : DEFAULT_SPIRAL_STARTS;
  }
  // Barley twist is the same bit in both directions; pineapple defaults to one way.
  if (p.spiralDir !== 'cw' && p.spiralDir !== 'ccw' && p.spiralDir !== 'both') {
    p.spiralDir = isFlute(p) ? 'cw' : 'both';
  }
}

/**
 * Turn off spiral. Flutes keep index from starts.
 * @param {Placement} p
 */
export function disableSpiral(p) {
  if (isFlute(p) && Number.isFinite(Number(p.spiralStarts))) {
    p.indexIncrementDeg = startsToIndexDeg(p.spiralStarts);
  }
  p.spiral = false;
}

/**
 * Helix rotation at length `x`, degrees, before start angle and starts.
 * Ratio travel:turns — 2:1 means 2 inches of travel per 1 turn.
 * @param {Placement} p
 * @param {number} x
 */
export function spiralTwistDeg(p, x) {
  const travel = Number(p.spiralTravel);
  const turns = Number(p.spiralTurns);
  const tTravel = Number.isFinite(travel) && Math.abs(travel) > 1e-9 ? travel : DEFAULT_SPIRAL_TRAVEL;
  const tTurns = Number.isFinite(turns) ? turns : DEFAULT_SPIRAL_TURNS;
  const mag = ((x - p.atLength) * tTurns * 360) / tTravel;
  return spiralDir(p) === 'ccw' ? -mag : mag;
}

/**
 * @param {Placement} p
 * @returns {SpiralDir}
 */
export function spiralDir(p) {
  if (p.spiralDir === 'ccw' || p.spiralDir === 'both') return p.spiralDir;
  return 'cw';
}

/**
 * Groove angles at a station: indexed flutes, or a helix with starts.
 * @param {Placement} p
 * @param {number} x
 * @returns {number[]}
 */
export function grooveAnglesAt(p, x) {
  if (isSpiral(p)) {
    const start = Number(p.spiralStartDeg);
    const startDeg = Number.isFinite(start) ? start : 0;
    const travel = Number(p.spiralTravel);
    const turns = Number(p.spiralTurns);
    const tTravel = Number.isFinite(travel) && Math.abs(travel) > 1e-9 ? travel : DEFAULT_SPIRAL_TRAVEL;
    const tTurns = Number.isFinite(turns) ? turns : DEFAULT_SPIRAL_TURNS;
    const mag = ((x - p.atLength) * tTurns * 360) / tTravel;
    const n = spiralStarts(p);
    const step = 360 / n;
    const dir = spiralDir(p);
    const twists = dir === 'both' ? [mag, -mag] : dir === 'ccw' ? [-mag] : [mag];
    /** @type {number[]} */
    const out = [];
    for (const twist of twists) {
      for (let i = 0; i < n; i++) out.push(startDeg + twist + i * step);
    }
    return out;
  }
  return fluteIndexAngles(p.indexIncrementDeg ?? DEFAULT_FLUTE_INDEX_DEG);
}

/**
 * Remaining radius allowed by one placement at station `x`.
 * @param {Placement} p
 * @param {number} x
 */
export function placementEnvelope(p, x) {
  if (isFlute(p) || isSpiral(p)) return NO_CUT;
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
    if (isCutHidden(p) || isFlute(p) || isSpiral(p)) continue;
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
  const cut = Math.min(cutRadiusAt(model, x), grooveRadiusAt(model, x, thetaDeg));
  return remainingFromCut(stock, thetaDeg, cut);
}

/**
 * Remaining radius allowed by visible flute / spiral cuts at (x, θ).
 * Infinity if none cut.
 * @param {Model} model
 * @param {number} x
 * @param {number} thetaDeg
 * @param {{ posesPerInch?: number }} [opts]
 */
export function grooveRadiusAt(model, x, thetaDeg, opts = {}) {
  return grooveFromPrepared(prepareGrooveCuts(model, x, opts.posesPerInch), x, thetaDeg);
}

/** @param {Model} model @param {number} x @param {number} thetaDeg @param {{ posesPerInch?: number }} [opts] */
export function fluteRadiusAt(model, x, thetaDeg, opts = {}) {
  return grooveRadiusAt(model, x, thetaDeg, opts);
}

/** @param {Model} model */
export function hasVisibleGrooves(model) {
  return model.placements.some((p) => !isCutHidden(p) && (isFlute(p) || isSpiral(p)));
}

/** @param {Model} model */
export function hasVisibleFlutes(model) {
  return hasVisibleGrooves(model);
}

/** @param {Model} model */
export function visibleGroovePlacements(model) {
  return model.placements.filter((p) => !isCutHidden(p) && (isFlute(p) || isSpiral(p)));
}

/**
 * Angular half-width of a groove on the blank, degrees. Used to cut a slot
 * in the turned 3D body and to size the helix ribbon.
 * @param {Placement} p
 */
export function grooveHalfWidthDeg(p) {
  const cd0 = Number(p.circularDistance);
  const cd1 = Number(p.endCircularDistance);
  const cd = Math.max(Number.isFinite(cd0) ? cd0 : 0, Number.isFinite(cd1) ? cd1 : 0, 0.2);
  let reach = 0.25;
  if (isFlute(p)) {
    reach = fluteCutDepth(/** @type {import('./profile.js').FluteProfile} */ (p.profile));
  } else {
    const maxR = profileMaxRadius(p.profile);
    reach = Number.isFinite(maxR) && maxR !== Infinity ? maxR : 0.5;
  }
  if (!(reach > 0)) reach = 0.25;
  const rad = Math.asin(Math.min(0.995, reach / cd));
  return Math.min(85, Math.max(8, ((rad * 180) / Math.PI) * 1.25));
}

/**
 * Groove remaining radii at one station for many angles. Prepares poses once.
 * @param {Model} model
 * @param {number} x
 * @param {number[]} thetaDegs
 * @param {number} [posesPerInch]
 * @returns {Float64Array}
 */
export function grooveRadiiAtThetas(model, x, thetaDegs, posesPerInch) {
  const prepared = prepareGrooveCuts(model, x, posesPerInch);
  const out = new Float64Array(thetaDegs.length);
  for (let i = 0; i < thetaDegs.length; i++) {
    out[i] = grooveFromPrepared(prepared, x, thetaDegs[i]);
  }
  return out;
}

/**
 * Groove radii for a 3D mesh: poses once per length station, then every θ.
 * Layout is `xs.length × (nTheta + 1)`; the last column repeats θ = 0.
 * @param {Model} model
 * @param {number[]} xs
 * @param {number} nTheta
 * @param {number} [posesPerInch]
 */
export function bakeGrooveGrid(model, xs, nTheta, posesPerInch) {
  const cols = nTheta + 1;
  const out = new Float64Array(xs.length * cols);
  out.fill(NO_CUT);
  if (!hasVisibleGrooves(model)) return out;
  for (let i = 0; i < xs.length; i++) {
    const prepared = prepareGrooveCuts(model, xs[i], posesPerInch);
    if (!prepared.length) continue;
    const x = xs[i];
    const row = i * cols;
    for (let j = 0; j < nTheta; j++) {
      out[row + j] = grooveFromPrepared(prepared, x, (360 * j) / nTheta);
    }
    out[row + nTheta] = out[row];
  }
  return out;
}

/**
 * @typedef {{ x: number, cd: number, angles: number[] }} GroovePose
 * @typedef {{
 *   kind: 'flute' | 'plunge',
 *   poses: GroovePose[],
 *   R?: number,
 *   profile?: BitProfile,
 *   maxProfR?: number,
 * }} PreparedGroove
 */

/**
 * @param {Model} model
 * @param {number} x
 * @param {number} [posesPerInch]
 * @returns {PreparedGroove[]}
 */
function prepareGrooveCuts(model, x, posesPerInch) {
  /** @type {PreparedGroove[]} */
  const items = [];
  for (const p of model.placements) {
    if (isCutHidden(p)) continue;
    if (isFlute(p)) {
      const R = fluteCutDepth(/** @type {import('./profile.js').FluteProfile} */ (p.profile));
      if (!(R > 0)) continue;
      const poses = pathPoses(p, x, R, posesPerInch).map((pose) => ({
        ...pose,
        angles: grooveAnglesAt(p, pose.x),
      }));
      if (poses.length) items.push({ kind: 'flute', poses, R });
    } else if (isSpiral(p)) {
      const maxR = profileMaxRadius(p.profile);
      const reach = Number.isFinite(maxR) && maxR !== Infinity ? maxR : 2;
      const poses = pathPoses(p, x, reach, posesPerInch).map((pose) => ({
        ...pose,
        angles: grooveAnglesAt(p, pose.x),
      }));
      if (poses.length) items.push({ kind: 'plunge', poses, profile: p.profile, maxProfR: reach });
    }
  }
  return items;
}

/**
 * @param {PreparedGroove[]} items
 * @param {number} x
 * @param {number} thetaDeg
 */
function grooveFromPrepared(items, x, thetaDeg) {
  let best = NO_CUT;
  for (const item of items) {
    if (item.kind === 'flute') {
      const R = item.R ?? 0;
      for (const pose of item.poses) {
        for (const a of pose.angles) {
          const env = sphereRayInner(pose.cd, a, pose.x, R, x, thetaDeg);
          if (env < best) best = env;
        }
      }
    } else if (item.profile) {
      const maxProfR = item.maxProfR ?? 2;
      for (const pose of item.poses) {
        for (const a of pose.angles) {
          const env = plungeBitRayInner(item.profile, pose.cd, pose.x, a, x, thetaDeg, maxProfR);
          if (env < best) best = env;
        }
      }
    }
  }
  return best;
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
 * Revolved plunge-bit solid at one pose, inner hit on the ray at (x, θ).
 * Inside test is r_bit ≤ profile radius at d_bit (solid of revolution).
 * @param {BitProfile} profile
 * @param {number} cd
 * @param {number} x0
 * @param {number} theta0Deg
 * @param {number} x
 * @param {number} thetaDeg
 * @param {number} [maxProfR]
 */
function plungeBitRayInner(profile, cd, x0, theta0Deg, x, thetaDeg, maxProfR) {
  const reachR =
    Number.isFinite(maxProfR) && maxProfR !== Infinity
      ? maxProfR
      : Number.isFinite(profileMaxRadius(profile)) && profileMaxRadius(profile) !== Infinity
        ? profileMaxRadius(profile)
        : 2;
  const dx = x - x0;
  if (Math.abs(dx) > reachR + 1e-9) return NO_CUT;
  let dTheta = ((thetaDeg - theta0Deg) * Math.PI) / 180;
  dTheta = Math.atan2(Math.sin(dTheta), Math.cos(dTheta));
  const cos = Math.cos(dTheta);
  const sin = Math.sin(dTheta);
  // Bit solid lives at d ≥ 0 (out from the tip), so the opposite hemisphere is empty.
  if (cos <= 1e-9) return NO_CUT;
  if (cd * Math.abs(sin) > reachR + 1e-6) return NO_CUT;

  if (profile.type === 'round') {
    return sphereRayInner(cd + profile.r, theta0Deg, x0, profile.r, x, thetaDeg);
  }

  const maxD = profileMaxDepth(profile);
  const rMax = cd + (Number.isFinite(maxD) ? maxD : 2) + reachR + 0.25;
  const lut = profileRadiusLut(profile);
  /** @param {number} r */
  const inside = (r) => {
    const dBit = r * cos - cd;
    const rBitSq = dx * dx + r * r * sin * sin;
    const R = radiusAtDLut(lut, dBit);
    if (R == null) return false;
    return rBitSq <= R * R + 1e-12;
  };
  const n = 8;
  let first = null;
  let prev = 0;
  for (let i = 0; i <= n; i++) {
    const r = (rMax * i) / n;
    if (inside(r)) {
      first = r;
      break;
    }
    prev = r;
  }
  if (first == null) return NO_CUT;
  let lo = prev;
  let hi = first;
  for (let k = 0; k < 16; k++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/**
 * @typedef {{ dMin: number, dMax: number, n: number, R: Float64Array }} RadiusLut
 * @type {WeakMap<BitProfile, RadiusLut>}
 */
const radiusLutCache = new WeakMap();

/**
 * @param {BitProfile} profile
 * @returns {RadiusLut}
 */
function profileRadiusLut(profile) {
  const hit = radiusLutCache.get(profile);
  if (hit) return hit;
  const pts = profilePoints(profile);
  let dMin = Infinity;
  let dMax = -Infinity;
  for (const p of pts) {
    if (p.d < dMin) dMin = p.d;
    if (p.d > dMax) dMax = p.d;
  }
  if (!Number.isFinite(dMin) || !Number.isFinite(dMax) || dMax < dMin) {
    const empty = { dMin: 0, dMax: 0, n: 0, R: new Float64Array(1) };
    empty.R[0] = -1;
    radiusLutCache.set(profile, empty);
    return empty;
  }
  const n = 96;
  const R = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const d = dMin + ((dMax - dMin) * i) / n;
    const v = profileRadiusAtD(profile, d);
    R[i] = v == null ? -1 : v;
  }
  const lut = { dMin, dMax, n, R };
  radiusLutCache.set(profile, lut);
  return lut;
}

/**
 * @param {RadiusLut} lut
 * @param {number} d
 * @returns {number | null}
 */
function radiusAtDLut(lut, d) {
  if (lut.n <= 0 || d < lut.dMin - 1e-9 || d > lut.dMax + 1e-9) return null;
  const span = lut.dMax - lut.dMin;
  if (span < 1e-15) return lut.R[0] < 0 ? null : lut.R[0];
  const t = ((d - lut.dMin) / span) * lut.n;
  const i = Math.min(lut.n - 1, Math.max(0, Math.floor(t)));
  const f = t - i;
  const a = lut.R[i];
  const b = lut.R[i + 1];
  if (a < 0 && b < 0) return null;
  if (a < 0) return b;
  if (b < 0) return a;
  return a + f * (b - a);
}

/**
 * @param {BitProfile} profile
 * @param {number} d along the bit axis from the tip
 * @returns {number | null}
 */
function profileRadiusAtD(profile, d) {
  const pts = profilePoints(profile);
  if (!pts.length) return null;
  const dMin = Math.min(pts[0].d, pts[pts.length - 1].d);
  const dMax = Math.max(pts[0].d, pts[pts.length - 1].d);
  if (d < dMin - 1e-9 || d > dMax + 1e-9) return null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const span = b.d - a.d;
    if (Math.abs(span) < 1e-15) {
      if (Math.abs(d - a.d) < 1e-9) return Math.max(a.r, b.r);
      continue;
    }
    const t = (d - a.d) / span;
    if (t >= -1e-9 && t <= 1 + 1e-9) return a.r + Math.min(1, Math.max(0, t)) * (b.r - a.r);
  }
  return null;
}

/**
 * Sphere / bit poses along the path that can still reach station `x`.
 * Samples only the window `[x − reach, x + reach]`, plus the pose at `x`.
 * @param {Placement} p
 * @param {number} x
 * @param {number} reach
 * @param {number} [posesPerInch]
 * @returns {{ x: number, cd: number }[]}
 */
function pathPoses(p, x, reach, posesPerInch = 12) {
  if (!isRun(p) || p.endAtLength == null || p.endCircularDistance == null) {
    return Math.abs(x - p.atLength) <= reach + 1e-9 ? [{ x: p.atLength, cd: p.circularDistance }] : [];
  }
  const a = p.atLength;
  const b = p.endAtLength;
  const cd0 = p.circularDistance;
  const cd1 = p.endCircularDistance;
  const span = Math.abs(b - a);
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (x < lo - reach - 1e-9 || x > hi + reach + 1e-9) return [];
  /** @param {number} s */
  const cdAt = (s) => {
    if (span < 1e-9) return cd0;
    const t = (s - a) / (b - a);
    return cd0 + t * (cd1 - cd0);
  };
  /** @type {{ x: number, cd: number }[]} */
  const out = [];
  if (x >= lo - 1e-9 && x <= hi + 1e-9) {
    out.push({ x, cd: cdAt(x) });
  }
  if (span < 1e-9) return out.length ? out : [{ x: a, cd: cd0 }];
  const winLo = Math.max(lo, x - reach);
  const winHi = Math.min(hi, x + reach);
  if (winHi < winLo - 1e-12) return out;
  const perInch = Number.isFinite(posesPerInch) && posesPerInch > 0 ? posesPerInch : 12;
  const winSpan = winHi - winLo;
  const n = Math.max(2, Math.ceil(winSpan * perInch));
  for (let i = 0; i <= n; i++) {
    const s = winLo + (winSpan * i) / n;
    if (Math.abs(s - x) < 1e-9) continue;
    out.push({ x: s, cd: cdAt(s) });
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
 * @param {{ dense?: boolean, perInch?: number, perInchMax?: number, flutePerInch?: number, skipGrooves?: boolean }} [opts]
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
    if (isFlute(p) || isSpiral(p)) {
      if (opts.skipGrooves !== true) addFluteStations(xs, p, length, opts.flutePerInch);
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
  const maxR = isFlute(p)
    ? fluteCutDepth(/** @type {import('./profile.js').FluteProfile} */ (p.profile))
    : profileMaxRadius(p.profile);
  const R = Number.isFinite(maxR) && maxR !== Infinity ? maxR : 2;
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
