// @ts-check
// Bit half-profile helpers. A profile is revolved 360° around the bit's
// own axis (the d axis, tip at 0) to make the cutter solid.
//
// Plunge cut: the bit axis is radial to the workpiece. At an axial offset
// s from the tip, the remaining radius allowed by the bit is
//   circularDistance + d(|s|)
// where d(|s|) is the smallest distance-from-tip at which the profile is
// at least |s| wide. If the bit never reaches width |s|, it does not cut
// there.

/**
 * @typedef {{d: number, r: number}} ProfilePoint
 * @typedef {{type: 'round', r: number}} RoundProfile
 * @typedef {{type: 'v', angleDeg: number}} VProfile
 * @typedef {{type: 'flat', r: number}} FlatProfile
 * @typedef {{type: 'points', points: ProfilePoint[]}} PointsProfile
 * @typedef {RoundProfile | VProfile | FlatProfile | PointsProfile} BitProfile
 */

export const NO_CUT = Number.POSITIVE_INFINITY;

/**
 * Hemisphere generating curve for a ball-nose / round-nose of radius R.
 * Tip at (0,0), equator at (R, R).
 * @param {number} radius
 * @param {number} [samples]
 * @returns {ProfilePoint[]}
 */
export function roundNosePoints(radius, samples = 48) {
  const pts = [{ d: 0, r: 0 }];
  for (let i = 1; i <= samples; i++) {
    const d = (radius * i) / samples;
    const r = Math.sqrt(Math.max(0, 2 * radius * d - d * d));
    pts.push({ d, r });
  }
  return pts;
}

/**
 * @param {BitProfile} profile
 * @returns {ProfilePoint[]}
 */
export function profilePoints(profile) {
  if (profile.type === 'points') return profile.points;
  if (profile.type === 'round') return roundNosePoints(profile.r);
  if (profile.type === 'flat') {
    return [
      { d: 0, r: 0 },
      { d: 0, r: profile.r }, // validation requires increasing d — use a hair of d
    ];
  }
  if (profile.type === 'v') {
    const half = ((profile.angleDeg / 2) * Math.PI) / 180;
    const tan = Math.tan(half);
    const dEnd = 1;
    return [
      { d: 0, r: 0 },
      { d: dEnd, r: dEnd * tan },
    ];
  }
  throw new Error(`Unknown bit profile type: ${profile.type}`);
}

/**
 * Smallest d at which the profile is at least `width` wide, or null if it
 * never is. Closed-form for round-nose; polyline scan for points.
 * @param {BitProfile} profile
 * @param {number} width
 * @returns {number | null}
 */
export function depthForWidth(profile, width) {
  const s = Math.abs(width);
  if (s < 1e-12) return 0;

  if (profile.type === 'round') {
    const R = profile.r;
    if (s > R + 1e-12) return null;
    if (s > R) return R;
    return R - Math.sqrt(Math.max(0, R * R - s * s));
  }

  if (profile.type === 'flat') {
    return s <= profile.r + 1e-12 ? 0 : null;
  }

  if (profile.type === 'v') {
    const half = ((profile.angleDeg / 2) * Math.PI) / 180;
    const tan = Math.tan(half);
    if (tan <= 0) return null;
    return s / tan;
  }

  const pts = profile.points;
  let best = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = minDOnSegmentWhereRAtLeast(pts[i], pts[i + 1], s);
    if (d != null && (best == null || d < best)) best = d;
  }
  return best;
}

/**
 * Smallest d on segment a→b at which the profile is at least `s` wide.
 * @param {ProfilePoint} a
 * @param {ProfilePoint} b
 * @param {number} s
 * @returns {number | null}
 */
function minDOnSegmentWhereRAtLeast(a, b, s) {
  const r0 = a.r;
  const r1 = b.r;
  const d0 = a.d;
  const d1 = b.d;
  if (r0 < s && r1 < s) return null;
  if (Math.abs(r1 - r0) < 1e-15) return r0 >= s ? Math.min(d0, d1) : null;
  const tCross = (s - r0) / (r1 - r0);
  const candidates = [];
  if (r0 >= s) candidates.push(d0);
  if (r1 >= s) candidates.push(d1);
  if (tCross > 0 && tCross < 1) candidates.push(d0 + tCross * (d1 - d0));
  if (!candidates.length) return null;
  return Math.min(...candidates);
}

/**
 * Remaining radius allowed by one plunge at axial offset `s` from the tip.
 * Infinity means the bit does not reach this x.
 * @param {BitProfile} profile
 * @param {number} circularDistance tip-to-axis, inches
 * @param {number} s axial offset from the tip, inches (x - atLength)
 */
export function plungeEnvelope(profile, circularDistance, s) {
  const d = depthForWidth(profile, s);
  if (d == null) return NO_CUT;
  return circularDistance + d;
}

/** @param {BitProfile} profile */
export function profileMaxRadius(profile) {
  if (profile.type === 'round' || profile.type === 'flat') return profile.r;
  if (profile.type === 'v') return Infinity;
  return Math.max(...profile.points.map((p) => p.r));
}

/** @param {BitProfile} profile */
export function profileMaxDepth(profile) {
  if (profile.type === 'round') return profile.r;
  if (profile.type === 'flat') return 0;
  if (profile.type === 'v') return 1;
  return Math.max(...profile.points.map((p) => p.d));
}
