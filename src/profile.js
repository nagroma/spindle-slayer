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
 * Side-mounted flute: d = X from the bit axis, r = along the cutter.
 * bearingRadius is min(d) — the inner circle in 2D.
 * @typedef {{type: 'flute', points: ProfilePoint[], bearingRadius: number}} FluteProfile
 * @typedef {RoundProfile | VProfile | FlatProfile | PointsProfile | FluteProfile} BitProfile
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
  if (profile.type === 'points' || profile.type === 'flute') return profile.points;
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
  if (profile.type === 'flute') return null;
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
export function isFluteProfile(profile) {
  return Boolean(profile && profile.type === 'flute');
}

/**
 * Outer circle radius in the 2D bit image: max X from the DXF (bit axis to cutter).
 * For 0.5in_Round that is 0.4375″ (Ø 0.875″ = bearing + 2 × cut depth).
 * @param {FluteProfile} profile
 */
export function fluteOuterRadius(profile) {
  const pts = profile.points;
  let maxD = profile.bearingRadius || 0;
  for (const p of pts) {
    if (p.d > maxD) maxD = p.d;
  }
  return Math.max(0, maxD);
}

/**
 * How far the cutter sits past the bearing, inches.
 * @param {FluteProfile} profile
 */
export function fluteCutDepth(profile) {
  return Math.max(0, fluteOuterRadius(profile) - fluteBearingRadius(profile));
}

/** @param {FluteProfile} profile */
export function fluteBearingRadius(profile) {
  if (Number.isFinite(profile.bearingRadius)) return Math.max(0, profile.bearingRadius);
  return Math.min(...profile.points.map((p) => p.d));
}

/**
 * Workpiece radius of the bit axis: bearing rides at `cd`, axis is outside by the bearing radius.
 * @param {number} circularDistance bearing seat, inches from centerline
 * @param {FluteProfile} profile
 */
export function fluteBitCenterRadius(circularDistance, profile) {
  return circularDistance + fluteBearingRadius(profile);
}

/** @param {BitProfile} profile */
export function profileMaxRadius(profile) {
  if (profile.type === 'flute') return fluteOuterRadius(profile);
  if (profile.type === 'round' || profile.type === 'flat') return profile.r;
  if (profile.type === 'v') return Infinity;
  return Math.max(...profile.points.map((p) => p.r));
}

/** @param {BitProfile} profile */
export function profileMaxDepth(profile) {
  if (profile.type === 'flute') return fluteCutDepth(profile);
  if (profile.type === 'round') return profile.r;
  if (profile.type === 'flat') return 0;
  if (profile.type === 'v') return 1;
  return Math.max(...profile.points.map((p) => p.d));
}

/**
 * Throws if the profile shape is invalid.
 * @param {BitProfile} profile
 */
export function validateBitProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Bit profile is required.');
  }
  if (profile.type === 'round') {
    if (!(typeof profile.r === 'number' && profile.r >= 0 && Number.isFinite(profile.r))) {
      throw new Error('Round bit profile needs a radius (r) that is a non-negative number.');
    }
    return;
  }
  if (profile.type === 'v') {
    if (!(typeof profile.angleDeg === 'number' && profile.angleDeg > 0 && profile.angleDeg < 180)) {
      throw new Error('V bit profile needs an included angle (angleDeg) between 0 and 180.');
    }
    return;
  }
  if (profile.type === 'flat') {
    if (!(typeof profile.r === 'number' && profile.r > 0 && Number.isFinite(profile.r))) {
      throw new Error('Flat bit profile needs a radius (r) that is a positive number.');
    }
    return;
  }
  if (profile.type === 'points') {
    const pts = profile.points;
    if (!(Array.isArray(pts) && pts.length >= 2)) {
      throw new Error('Points profile needs an array of at least two {d, r} points.');
    }
    for (const p of pts) {
      if (!(typeof p.d === 'number' && typeof p.r === 'number' && p.r >= 0)) {
        throw new Error('Every profile point needs numeric d and a non-negative r.');
      }
    }
    if (pts[0].d !== 0 || pts[0].r !== 0) {
      throw new Error('Points profile must start at the tip, {d: 0, r: 0} — that\'s the circularDistance reference point.');
    }
    return;
  }
  if (profile.type === 'flute') {
    const pts = profile.points;
    if (!(Array.isArray(pts) && pts.length >= 2)) {
      throw new Error('Flute profile needs an array of at least two {d, r} points.');
    }
    for (const p of pts) {
      if (!(typeof p.d === 'number' && typeof p.r === 'number' && p.d >= 0 && p.r >= 0)) {
        throw new Error('Every flute profile point needs non-negative numeric d and r.');
      }
    }
    if (!(typeof profile.bearingRadius === 'number' && profile.bearingRadius >= 0 && Number.isFinite(profile.bearingRadius))) {
      throw new Error('Flute profile needs a non-negative bearingRadius.');
    }
    return;
  }
  throw new Error(`Unknown bit profile type: ${profile.type}`);
}
