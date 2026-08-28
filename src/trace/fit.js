// @ts-check
// Fit lines and circular arcs to a (d, r) polyline, and snap an arc to a radius
// while keeping its endpoints.

/**
 * @typedef {{ d: number, r: number }} Pt
 * @typedef {{ type: 'line', a: Pt, b: Pt, smoothIn?: boolean, span?: Pt[] }} LineSeg
 * @typedef {{ type: 'arc', a: Pt, b: Pt, center: Pt, radius: number, ccw: boolean, smoothIn?: boolean, span?: Pt[] }} ArcSeg
 * @typedef {{ type: 'spline', points: Pt[], tanIn?: Pt, tanOut?: Pt, smoothIn?: boolean, span?: Pt[] }} SplineSeg
 * @typedef {LineSeg | ArcSeg | SplineSeg} Seg
 */

/** @param {Pt} a @param {Pt} b */
export function dist(a, b) {
  return Math.hypot(b.d - a.d, b.r - a.r);
}

/** @param {Pt[]} points */
export function fitLineRms(points) {
  const n = points.length;
  if (n < 2) return Infinity;
  let md = 0;
  let mr = 0;
  for (const p of points) {
    md += p.d;
    mr += p.r;
  }
  md /= n;
  mr /= n;
  let sdd = 0;
  let srr = 0;
  let sdr = 0;
  for (const p of points) {
    const ud = p.d - md;
    const ur = p.r - mr;
    sdd += ud * ud;
    srr += ur * ur;
    sdr += ud * ur;
  }
  const angle = 0.5 * Math.atan2(2 * sdr, sdd - srr);
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  let sse = 0;
  for (const p of points) {
    const ud = p.d - md;
    const ur = p.r - mr;
    const along = ud * ca + ur * sa;
    const pd = md + along * ca;
    const pr = mr + along * sa;
    sse += (p.d - pd) ** 2 + (p.r - pr) ** 2;
  }
  return Math.sqrt(sse / n);
}

/**
 * Algebraic (Kåsa) circle fit in the (d, r) plane.
 * @param {Pt[]} points
 * @returns {{ center: Pt, radius: number, rms: number } | null}
 */
export function fitCircle(points) {
  const n = points.length;
  if (n < 3) return null;
  let meanD = 0;
  let meanR = 0;
  for (const p of points) {
    meanD += p.d;
    meanR += p.r;
  }
  meanD /= n;
  meanR /= n;
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suuu = 0;
  let svvv = 0;
  let suvv = 0;
  let svuu = 0;
  for (const p of points) {
    const u = p.d - meanD;
    const v = p.r - meanR;
    const uu = u * u;
    const vv = v * v;
    suu += uu;
    svv += vv;
    suv += u * v;
    suuu += uu * u;
    svvv += vv * v;
    suvv += u * vv;
    svuu += v * uu;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-18) return null;
  const uc = (svv * (suuu + suvv) - suv * (svvv + svuu)) / (2 * det);
  const vc = (suu * (svvv + svuu) - suv * (suuu + suvv)) / (2 * det);
  const radius = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  if (!Number.isFinite(radius) || radius < 1e-6) return null;
  const center = { d: meanD + uc, r: meanR + vc };
  let sse = 0;
  for (const p of points) {
    const e = Math.hypot(p.d - center.d, p.r - center.r) - radius;
    sse += e * e;
  }
  return { center, radius, rms: Math.sqrt(sse / n) };
}

/** @param {Pt} a @param {Pt} b @param {number} radius */
export function sagitta(a, b, radius) {
  const half = dist(a, b) / 2;
  if (radius <= half + 1e-12) return 0;
  return radius - Math.sqrt(radius * radius - half * half);
}

/**
 * Keep endpoints; move the center so the arc has `radius`.
 * @param {ArcSeg} seg
 * @param {number} radius
 * @returns {ArcSeg | null}
 */
export function snapArcToRadius(seg, radius) {
  if (!(radius > 0)) return null;
  const { a, b } = seg;
  const half = dist(a, b) / 2;
  if (radius < half - 1e-9) return null;
  const mid = { d: (a.d + b.d) / 2, r: (a.r + b.r) / 2 };
  const chordD = (b.d - a.d) / (2 * half || 1);
  const chordR = (b.r - a.r) / (2 * half || 1);
  const nd = -chordR;
  const nr = chordD;
  const h = Math.sqrt(Math.max(0, radius * radius - half * half));
  const c1 = { d: mid.d + nd * h, r: mid.r + nr * h };
  const c2 = { d: mid.d - nd * h, r: mid.r - nr * h };
  const d1 = dist(c1, seg.center);
  const d2 = dist(c2, seg.center);
  const center = d1 <= d2 ? c1 : c2;
  const ccw = isCcw(a, b, center);
  return { type: 'arc', a, b, center, radius, ccw, smoothIn: seg.smoothIn, span: seg.span };
}

/** @param {Pt} a @param {Pt} b @param {Pt} center */
export function isCcw(a, b, center) {
  const a1 = Math.atan2(a.r - center.r, a.d - center.d);
  const a2 = Math.atan2(b.r - center.r, b.d - center.d);
  let sweep = a2 - a1;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  return sweep > 0;
}

/**
 * Radii the user can snap this arc to: known-field values that fit the chord,
 * the current value if it is a stock size, and a few neighbors so a snap
 * does not empty the list.
 * @param {number} radius
 * @param {number[]} [known]
 * @param {{ minRadius?: number }} [opts]
 */
export function snapCandidates(radius, known = [], opts = {}) {
  const nice = [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4];
  const knownPos = known.filter((x) => x > 0);
  const pool = [...new Set([...knownPos, ...nice])].sort((a, b) => a - b);
  const minR = opts.minRadius ?? 0;
  const legal = pool.filter((r) => r + 1e-9 >= minR);
  const knownSet = new Set(knownPos);
  const fromKnown = legal.filter((r) => knownSet.has(r));
  const below = legal.filter((r) => r < radius - 1e-6).slice(-2);
  const above = legal.filter((r) => r > radius + 1e-6).slice(0, 3);
  const current = legal.find((r) => Math.abs(r - radius) <= 1e-6);
  return [...new Set([...fromKnown, ...below, ...(current ? [current] : []), ...above])].sort((a, b) => a - b);
}

/**
 * Greedy split of a profile polyline into lines and arcs.
 * `breaks` are point indices that must be joints (curve ends, straight begins).
 * @param {Pt[]} points
 * @param {{ rms?: number, maxRadius?: number, minSagitta?: number, breaks?: number[], smoothBreaks?: number[] }} [opts]
 * @returns {Seg[]}
 */
export function fitSegments(points, opts = {}) {
  if (points.length < 2) return [];
  const last = points.length - 1;
  const joints = [
    0,
    ...[...new Set(opts.breaks ?? [])].filter((i) => i > 0 && i < last).sort((a, b) => a - b),
    last,
  ];
  const smooth = new Set(opts.smoothBreaks ?? []);
  /** @type {Seg[]} */
  const segs = [];
  for (let s = 0; s < joints.length - 1; s++) {
    const piece = fitSpan(points.slice(joints[s], joints[s + 1] + 1), opts);
    if (piece[0] && smooth.has(joints[s])) piece[0].smoothIn = true;
    segs.push(...piece);
  }
  return applySmoothJoins(ensureArcsThroughEnds(segs));
}

/** @param {Seg[]} segs */
export function ensureArcsThroughEnds(segs) {
  return segs.map((seg) => {
    if (seg.type !== 'arc') return seg;
    return arcThroughEndpoints(seg.a, seg.b, seg.center, seg.radius);
  });
}

/**
 * Reverse a profile (and its joint indices) so greedy fit can run foot-first.
 * @param {Pt[]} points
 * @param {number[]} [breaks]
 * @param {number[]} [smoothBreaks]
 */
export function reverseProfile(points, breaks = [], smoothBreaks = []) {
  const n = points.length;
  const map = (/** @type {number} */ i) => n - 1 - i;
  const keep = (/** @type {number[]} */ arr) =>
    [...new Set(arr.map(map).filter((i) => i > 0 && i < n - 1))].sort((a, b) => a - b);
  return {
    points: points.map((p) => ({ ...p })).reverse(),
    breaks: keep(breaks),
    smoothBreaks: keep(smoothBreaks),
  };
}

/**
 * @param {Pt[]} points
 * @param {{ rms?: number, maxRadius?: number, minSagitta?: number }} [opts]
 * @returns {Seg[]}
 */
function fitSpan(points, opts = {}) {
  const rmsMax = opts.rms ?? 0.03;
  const maxRadius = opts.maxRadius ?? 24;
  const minSagitta = opts.minSagitta ?? 0.02;
  if (points.length < 2) return [];
  /** @type {Seg[]} */
  const segs = [];
  let i = 0;
  while (i < points.length - 1) {
    let j = i + 1;
    /** @type {Seg} */
    let best = { type: 'line', a: points[i], b: points[j], span: [points[i], points[j]] };
    while (j < points.length - 1) {
      const next = j + 1;
      const pts = points.slice(i, next + 1);
      const lineRms = fitLineRms(pts);
      const circ = fitCircle(pts);
      const sag = circ ? sagitta(pts[0], pts[pts.length - 1], circ.radius) : 0;
      const circleOk =
        circ &&
        circ.rms <= rmsMax &&
        circ.radius <= maxRadius &&
        sag >= minSagitta &&
        circ.rms <= lineRms * 0.9;
      const lineOk = lineRms <= rmsMax;
      if (!circleOk && !lineOk) break;
      j = next;
      if (circleOk && circ) {
        best = {
          ...arcThroughEndpoints(pts[0], pts[pts.length - 1], circ.center, circ.radius),
          span: pts.map((p) => ({ ...p })),
        };
      } else {
        best = { type: 'line', a: pts[0], b: pts[pts.length - 1], span: pts.map((p) => ({ ...p })) };
      }
    }
    segs.push(best);
    i = j;
  }
  const lines = segs.filter((s) => s.type === 'line');
  if (lines.length >= 3 && lines.length === segs.length && points.length >= 4) {
    const pts = points.map((p) => ({ ...p }));
    return [{ type: 'spline', points: pts, span: pts.map((p) => ({ ...p })) }];
  }
  return segs;
}

/**
 * Dense samples along fitted segments, in order.
 * @param {Seg[]} segs
 * @param {number} [perArc]
 * @returns {Pt[]}
 */
export function sampleSegments(segs, perArc = 16) {
  /** @type {Pt[]} */
  const out = [];
  for (const seg of segs) {
    if (seg.type === 'spline') {
      const pts = sampleSplineSeg(seg, Math.max(perArc, 8));
      if (!out.length) out.push(...pts);
      else out.push(...pts.slice(1));
      continue;
    }
    if (seg.type === 'line') {
      if (!out.length) out.push(seg.a);
      out.push(seg.b);
      continue;
    }
    const pts = sampleArc(seg, perArc);
    if (!out.length) out.push(...pts);
    else out.push(...pts.slice(1));
  }
  return out;
}

/**
 * Circular arc that starts at `a` and ends at `b` exactly.
 * @param {ArcSeg} seg
 * @param {number} n
 */
function sampleArc(seg, n) {
  const a0 = Math.atan2(seg.a.r - seg.center.r, seg.a.d - seg.center.d);
  const a1 = Math.atan2(seg.b.r - seg.center.r, seg.b.d - seg.center.d);
  let sweep = a1 - a0;
  if (seg.ccw && sweep <= 0) sweep += 2 * Math.PI;
  if (!seg.ccw && sweep >= 0) sweep -= 2 * Math.PI;
  /** @type {Pt[]} */
  const pts = [{ ...seg.a }];
  for (let k = 1; k < n; k++) {
    const ang = a0 + sweep * (k / n);
    pts.push({
      d: seg.center.d + seg.radius * Math.cos(ang),
      r: Math.max(0, seg.center.r + seg.radius * Math.sin(ang)),
    });
  }
  pts.push({ ...seg.b });
  return pts;
}

/**
 * Keep the LS radius but move the center so both endpoints lie on the circle.
 * That makes consecutive segments share a drawn point, not just a stored one.
 * @param {Pt} a
 * @param {Pt} b
 * @param {Pt} center
 * @param {number} radius
 * @returns {Seg}
 */
function arcThroughEndpoints(a, b, center, radius) {
  const half = dist(a, b) / 2;
  if (!(half > 0)) return { type: 'line', a, b };
  const raw = {
    type: /** @type {const} */ ('arc'),
    a,
    b,
    center,
    radius,
    ccw: isCcw(a, b, center),
  };
  const r = Math.max(radius, half + 1e-9);
  return snapArcToRadius(raw, r) ?? { type: 'line', a, b };
}

/** @param {Pt[]} points @param {number} n */
export function sampleSpline(points, n = 16) {
  return sampleSplineSeg({ type: 'spline', points }, n);
}

/**
 * Interpolating cubic. Optional tanIn / tanOut make a Smooth join actually tangent.
 * @param {SplineSeg} seg
 * @param {number} [n]
 */
export function sampleSplineSeg(seg, n = 16) {
  const points = seg.points;
  if (points.length <= 1) return points.map((p) => ({ ...p }));
  const tans = knotTangents(points, seg.tanIn, seg.tanOut);
  const out = [];
  const segs = Math.max(1, points.length - 1);
  const per = Math.max(4, Math.ceil(n / segs));
  for (let i = 0; i < segs; i++) {
    const piece = hermite(points[i], points[i + 1], tans[i], tans[i + 1], per);
    if (!out.length) out.push(...piece);
    else out.push(...piece.slice(1));
  }
  return out;
}

/** @param {Pt} p0 @param {Pt} p1 @param {Pt} t0 @param {Pt} t1 @param {number} n */
function hermite(p0, p1, t0, t1, n) {
  const L = dist(p0, p1) || 1;
  const m0 = { d: t0.d * L, r: t0.r * L };
  const m1 = { d: t1.d * L, r: t1.r * L };
  /** @type {Pt[]} */
  const out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    out.push({
      d: h00 * p0.d + h10 * m0.d + h01 * p1.d + h11 * m1.d,
      r: Math.max(0, h00 * p0.r + h10 * m0.r + h01 * p1.r + h11 * m1.r),
    });
  }
  return out;
}

/** @param {Pt[]} pts @param {Pt} [tanIn] @param {Pt} [tanOut] */
function knotTangents(pts, tanIn, tanOut) {
  return pts.map((_, i) => {
    if (i === 0 && tanIn) return unitVec(tanIn);
    if (i === pts.length - 1 && tanOut) return unitVec(tanOut);
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    return unitVec({ d: b.d - a.d, r: b.r - a.r });
  });
}

/** @param {Pt} v */
function unitVec(v) {
  const n = Math.hypot(v.d, v.r) || 1;
  return { d: v.d / n, r: v.r / n };
}

/** @param {Pt[]} points @param {{ startD?: number, endD?: number, startR?: number, endR?: number }} pin */
export function pinProfileEnds(points, pin) {
  if (!points.length) return points;
  const out = points.map((p) => ({ ...p }));
  if (pin.startD != null) out[0].d = pin.startD;
  if (pin.startR != null) out[0].r = pin.startR;
  if (pin.endD != null) out[out.length - 1].d = pin.endD;
  if (pin.endR != null) out[out.length - 1].r = pin.endR;
  return out;
}

/** @param {Seg[]} segs */
export function reverseSegs(segs) {
  const n = segs.length;
  const rev = segs
    .slice()
    .reverse()
    .map((seg) => reverseOne(seg));
  for (let i = 1; i < n; i++) {
    if (segs[i].smoothIn) rev[n - i].smoothIn = true;
  }
  return rev;
}

/** @param {Seg} seg */
function reverseOne(seg) {
  if (seg.type === 'line') return { type: 'line', a: { ...seg.b }, b: { ...seg.a } };
  if (seg.type === 'spline') {
    return { type: 'spline', points: seg.points.map((p) => ({ ...p })).reverse() };
  }
  return {
    type: 'arc',
    a: { ...seg.b },
    b: { ...seg.a },
    center: { ...seg.center },
    radius: seg.radius,
    ccw: !seg.ccw,
  };
}

/**
 * If an arc's ends are almost the same radius (roundover on a cylinder),
 * equalize them — the bit cut a true semicircle with vertical tangents.
 * Not applied automatically after fit: moving an arc's ends without
 * updating neighbors used to leave gaps between segments.
 * @param {Seg} seg
 * @param {number} [tol]
 */
export function equalizeArcEndRadii(seg, tol = 0.08) {
  if (seg.type !== 'arc') return seg;
  if (Math.abs(seg.a.r - seg.b.r) > tol || Math.abs(seg.a.r - seg.b.r) < 1e-9) return seg;
  const r = (seg.a.r + seg.b.r) / 2;
  const next = {
    ...seg,
    a: { ...seg.a, r },
    b: { ...seg.b, r },
  };
  return snapArcToRadius(next, seg.radius) ?? next;
}

/** @param {Seg[]} segs */
export function applySmoothJoins(segs) {
  const out = segs.map((s) => cloneSeg(s));
  for (let i = 1; i < out.length; i++) {
    if (!out[i].smoothIn) continue;
    const T = endTangent(out[i - 1]);
    const dual = i + 1 < out.length && !!out[i + 1].smoothIn;
    out[i] = makeSmoothIn(out[i], T, dual, out[i + 1]);
  }
  return out;
}

/**
 * Circle through P and B whose tangent at P matches T. Endpoints stay put; radius changes.
 * @param {Pt} P
 * @param {Pt} B
 * @param {Pt} T
 * @param {Pt} [hint]
 * @returns {ArcSeg | null}
 */
export function arcFromStartTangent(P, B, T, hint) {
  const t = unitVec(T);
  const normals = [
    { d: -t.r, r: t.d },
    { d: t.r, r: -t.d },
  ];
  /** @type {ArcSeg | null} */
  let best = null;
  let bestScore = Infinity;
  const chord2 = (P.d - B.d) ** 2 + (P.r - B.r) ** 2;
  for (const n of normals) {
    const dot = (P.d - B.d) * n.d + (P.r - B.r) * n.r;
    if (Math.abs(dot) < 1e-9) continue;
    const radius = -chord2 / (2 * dot);
    if (!(radius > 1e-6) || radius > 48) continue;
    const center = { d: P.d + n.d * radius, r: P.r + n.r * radius };
    const arc = {
      type: /** @type {const} */ ('arc'),
      a: { ...P },
      b: { ...B },
      center,
      radius,
      ccw: isCcw(P, B, center),
    };
    const st = startTangent(arc);
    if (st.d * t.d + st.r * t.r < 0.9) continue;
    const score = hint ? dist(center, hint) : 0;
    if (score < bestScore) {
      bestScore = score;
      best = arc;
    }
  }
  return best;
}

/**
 * @param {Seg} seg
 * @param {Pt} T
 * @param {boolean} dual
 * @param {Seg} [next]
 */
function makeSmoothIn(seg, T, dual, next) {
  const t = unitVec(T);
  if (seg.type === 'arc' && !dual) {
    const arc = arcFromStartTangent(segStart(seg), segEnd(seg), t, seg.center);
    if (arc) return { ...arc, smoothIn: true, span: spanOf(seg) };
  }
  if (seg.type === 'line' && !dual) {
    const dir = unitVec({ d: seg.b.d - seg.a.d, r: seg.b.r - seg.a.r });
    if (dir.d * t.d + dir.r * t.r > 0.995) return { ...seg, smoothIn: true };
  }
  /** @type {Pt | undefined} */
  let tanOut;
  if (next?.type === 'line') {
    tanOut = unitVec({ d: next.b.d - next.a.d, r: next.b.r - next.a.r });
  }
  return toSpline(seg, t, tanOut);
}

/** @param {Seg} seg @param {'line' | 'arc' | 'spline'} type */
export function forceSegType(seg, type) {
  let span;
  if (type === 'spline' && (seg.type === 'arc' || (seg.type === 'spline' && seg.points.length > 2))) {
    span = sampleSegments([seg], 24);
  } else if (seg.span && seg.span.length >= 3) {
    span = spanOf(seg);
  } else {
    span = sampleSegments([seg], 24);
    if (span.length < 2) span = spanOf(seg);
  }
  const a = span[0];
  const b = span[span.length - 1];
  if (type === 'line') return { type: 'line', a, b, span, smoothIn: seg.smoothIn };
  if (type === 'arc') {
    const circ = span.length >= 3 ? fitCircle(span) : null;
    if (circ) return { ...arcThroughEndpoints(a, b, circ.center, circ.radius), span, smoothIn: seg.smoothIn };
    const mid = { d: (a.d + b.d) / 2, r: (a.r + b.r) / 2 + dist(a, b) * 0.15 };
    const guess = fitCircle([a, mid, b]);
    if (guess) return { ...arcThroughEndpoints(a, b, guess.center, guess.radius), span, smoothIn: seg.smoothIn };
    return { type: 'spline', points: span, span, smoothIn: seg.smoothIn };
  }
  return { type: 'spline', points: span, span, smoothIn: seg.smoothIn };
}

/**
 * Combine segs[i] and segs[i+1] into one piece (one bit). Auto prefers a circle if the combined span is round.
 * @param {Seg[]} segs
 * @param {number} i
 * @param {'auto' | 'line' | 'arc' | 'spline'} [prefer]
 */
export function mergeAdjacent(segs, i, prefer = 'auto') {
  if (i < 0 || i >= segs.length - 1) return segs;
  const left = denseSpan(segs[i]);
  const right = denseSpan(segs[i + 1]);
  const span = [...left, ...right.slice(1)];
  const seed = { type: /** @type {const} */ ('spline'), points: span, span, smoothIn: segs[i].smoothIn };
  let one;
  if (prefer === 'auto') {
    const circ = span.length >= 3 ? fitCircle(span) : null;
    const lineRms = fitLineRms(span);
    if (lineRms <= 0.03 && (!circ || lineRms <= circ.rms * 0.9)) one = forceSegType(seed, 'line');
    else if (circ && circ.rms <= 0.04) one = forceSegType(seed, 'arc');
    else one = forceSegType(seed, 'spline');
  } else {
    one = forceSegType(seed, prefer);
  }
  one.smoothIn = segs[i].smoothIn;
  const out = [...segs.slice(0, i), one, ...segs.slice(i + 2)];
  return applySmoothJoins(ensureArcsThroughEnds(out));
}

/** Signed turn (radians) from the end of `prev` into the start of `next`. */
export function joinTurn(prev, next) {
  const T0 = endTangent(prev);
  const T1 = startTangent(next);
  return Math.atan2(T0.d * T1.r - T0.r * T1.d, T0.d * T1.d + T0.r * T1.r);
}

/** Inside corner tighter than a typical bit nose — cannot cut. */
export function isUncuttableInside(prev, next, minTurn = 0.9) {
  return Math.abs(joinTurn(prev, next)) > minTurn;
}

/** @param {Seg} seg @param {Pt} tanIn @param {Pt} [tanOut] */
function toSpline(seg, tanIn, tanOut) {
  const points = spanOf(seg);
  return { type: 'spline', points, span: points, tanIn, tanOut, smoothIn: true };
}

/** @param {Seg} seg */
function spanOf(seg) {
  if (seg.span && seg.span.length >= 2) return seg.span.map((p) => ({ ...p }));
  if (seg.type === 'spline') return seg.points.map((p) => ({ ...p }));
  return [{ ...seg.a }, { ...seg.b }];
}

/** @param {Seg} seg */
function denseSpan(seg) {
  const stored = spanOf(seg);
  if (stored.length >= 3) return stored;
  const sampled = sampleSegments([seg], 18);
  return sampled.length >= 2 ? sampled : stored;
}

/** @param {Seg} seg */
function cloneSeg(seg) {
  if (seg.type === 'spline') {
    return {
      type: 'spline',
      points: seg.points.map((p) => ({ ...p })),
      tanIn: seg.tanIn ? { ...seg.tanIn } : undefined,
      tanOut: seg.tanOut ? { ...seg.tanOut } : undefined,
      smoothIn: seg.smoothIn,
      span: seg.span?.map((p) => ({ ...p })),
    };
  }
  if (seg.type === 'line') {
    return { type: 'line', a: { ...seg.a }, b: { ...seg.b }, smoothIn: seg.smoothIn, span: seg.span?.map((p) => ({ ...p })) };
  }
  return {
    type: 'arc',
    a: { ...seg.a },
    b: { ...seg.b },
    center: { ...seg.center },
    radius: seg.radius,
    ccw: seg.ccw,
    smoothIn: seg.smoothIn,
    span: seg.span?.map((p) => ({ ...p })),
  };
}

/** @param {Seg} seg */
export function segStart(seg) {
  if (seg.type === 'spline') return seg.points[0];
  return seg.a;
}

/** @param {Seg} seg */
export function segEnd(seg) {
  if (seg.type === 'spline') return seg.points[seg.points.length - 1];
  return seg.b;
}

/** @param {Seg} seg */
export function startTangent(seg) {
  if (seg.type === 'line') return unitVec({ d: seg.b.d - seg.a.d, r: seg.b.r - seg.a.r });
  if (seg.type === 'spline') {
    if (seg.tanIn) return unitVec(seg.tanIn);
    const pts = seg.points;
    return unitVec({ d: pts[1].d - pts[0].d, r: pts[1].r - pts[0].r });
  }
  const rd = seg.a.d - seg.center.d;
  const rr = seg.a.r - seg.center.r;
  const n = Math.hypot(rd, rr) || 1;
  return seg.ccw ? { d: -rr / n, r: rd / n } : { d: rr / n, r: -rd / n };
}

/** @param {Seg} seg */
export function endTangent(seg) {
  if (seg.type === 'line') return unitVec({ d: seg.b.d - seg.a.d, r: seg.b.r - seg.a.r });
  if (seg.type === 'spline') {
    if (seg.tanOut) return unitVec(seg.tanOut);
    const pts = seg.points;
    const a = pts[pts.length - 2];
    const b = pts[pts.length - 1];
    return unitVec({ d: b.d - a.d, r: b.r - a.r });
  }
  const rd = seg.b.d - seg.center.d;
  const rr = seg.b.r - seg.center.r;
  const n = Math.hypot(rd, rr) || 1;
  return seg.ccw ? { d: -rr / n, r: rd / n } : { d: rr / n, r: -rd / n };
}
