// @ts-check
// Import a bit half-profile from DXF into {d, r} points.
// d = distance along the bit spindle from the tip, r = radius from that axis.
// Pure functions — no fs — so the browser bundle can import a DXF as well.

/**
 * @typedef {{d: number, r: number}} ProfilePoint
 * @typedef {{code: number, value: string}} DxfTag
 * @typedef {{type: string, tags: DxfTag[]}} DxfEntity
 */

/**
 * @param {string} text
 * @returns {DxfTag[]}
 */
function parseDxfTags(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const tags = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    const value = lines[i + 1];
    tags.push({ code, value: value === undefined ? '' : value.trim() });
  }
  return tags;
}

/**
 * @param {DxfTag[]} tags
 * @returns {DxfEntity[]}
 */
function extractEntities(tags) {
  const startIdx = tags.findIndex((t) => t.code === 2 && t.value === 'ENTITIES');
  const endIdx = tags.findIndex((t, i) => i > startIdx && t.code === 0 && t.value === 'ENDSEC');
  if (startIdx === -1 || endIdx === -1) throw new Error('No ENTITIES section found in DXF.');
  const section = tags.slice(startIdx + 1, endIdx);

  const entities = [];
  let current = null;
  for (const tag of section) {
    if (tag.code === 0) {
      if (current) entities.push(current);
      current = { type: tag.value, tags: [] };
      continue;
    }
    if (current) current.tags.push(tag);
  }
  if (current) entities.push(current);
  return entities;
}

/**
 * @param {DxfTag[]} tags
 * @param {number} code
 * @param {number} [occurrence]
 */
function num(tags, code, occurrence = 0) {
  const matches = tags.filter((t) => t.code === code);
  if (matches.length <= occurrence) throw new Error(`Missing group code ${code} (occurrence ${occurrence}).`);
  return parseFloat(matches[occurrence].value);
}

/**
 * @param {DxfTag[]} tags
 * @param {number} code
 */
function nums(tags, code) {
  return tags.filter((t) => t.code === code).map((t) => parseFloat(t.value));
}

/** @param {DxfEntity} entity @param {number} [samples] */
function sampleArc(entity, samples = 24) {
  const cx = num(entity.tags, 10);
  const cy = num(entity.tags, 20);
  const r = num(entity.tags, 40);
  const startDeg = num(entity.tags, 50);
  const endDeg = num(entity.tags, 51);
  let sweep = endDeg - startDeg;
  if (sweep < 0) sweep += 360;

  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const deg = startDeg + (sweep * i) / samples;
    const rad = (deg * Math.PI) / 180;
    pts.push({ d: cx + r * Math.cos(rad), r: cy + r * Math.sin(rad) });
  }
  return pts;
}

/**
 * @param {number} i
 * @param {number} degree
 * @param {number} t
 * @param {number[]} knots
 */
function bsplineBasis(i, degree, t, knots) {
  if (degree === 0) {
    if (t === knots[knots.length - 1]) {
      return knots[i] < t && i + 1 === knots.length - 1 ? 1 : knots[i] <= t && t < knots[i + 1] ? 1 : 0;
    }
    return knots[i] <= t && t < knots[i + 1] ? 1 : 0;
  }
  let term1 = 0;
  const denom1 = knots[i + degree] - knots[i];
  if (denom1 !== 0) term1 = ((t - knots[i]) / denom1) * bsplineBasis(i, degree - 1, t, knots);
  let term2 = 0;
  const denom2 = knots[i + degree + 1] - knots[i + 1];
  if (denom2 !== 0) term2 = ((knots[i + degree + 1] - t) / denom2) * bsplineBasis(i + 1, degree - 1, t, knots);
  return term1 + term2;
}

/**
 * @param {number} degree
 * @param {number[]} knots
 * @param {ProfilePoint[]} controlPoints
 * @param {number} t
 */
function evalBspline(degree, knots, controlPoints, t) {
  if (t === knots[0]) return controlPoints[0];
  if (t === knots[knots.length - 1]) return controlPoints[controlPoints.length - 1];
  let x = 0;
  let y = 0;
  for (let i = 0; i < controlPoints.length; i++) {
    const b = bsplineBasis(i, degree, t, knots);
    x += b * controlPoints[i].d;
    y += b * controlPoints[i].r;
  }
  return { d: x, r: y };
}

/** @param {DxfEntity} entity @param {number} [samples] */
function sampleSpline(entity, samples = 60) {
  const degree = num(entity.tags, 71);
  const knots = nums(entity.tags, 40);
  const xs = nums(entity.tags, 10);
  const ys = nums(entity.tags, 20);
  if (xs.length !== ys.length) throw new Error('SPLINE control point x/y count mismatch.');
  const controlPoints = xs.map((x, i) => ({ d: x, r: ys[i] }));

  const tMin = knots[degree];
  const tMax = knots[knots.length - degree - 1];
  const pts = [];
  for (let i = 0; i <= samples; i++) {
    const t = tMin + ((tMax - tMin) * i) / samples;
    pts.push(evalBspline(degree, knots, controlPoints, t));
  }
  return pts;
}

/** @param {ProfilePoint[]} points @param {number} [eps] */
function dedupeConsecutive(points, eps = 1e-9) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (Math.abs(p.d - prev.d) > eps || Math.abs(p.r - prev.r) > eps) out.push(p);
  }
  return out;
}

/**
 * Parse a DXF whose sketched (x, y) is the bit half-profile, tip at (0,0).
 * dAxis: 'x' (default, x along the bit), 'y' (y along the bit), or 'auto'
 * (pick the mapping where the first step off the tip is mostly radius —
 * that is the usual round/ball cutting edge).
 * @param {string} dxfText
 * @param {{ dAxis?: 'x' | 'y' | 'auto' }} [opts]
 * @returns {ProfilePoint[]}
 */
export function importDxfProfile(dxfText, opts = {}) {
  const tags = parseDxfTags(dxfText);
  const entities = extractEntities(tags);

  let points = [];
  /** @type {ProfilePoint[] | null} */
  let polyline = null;

  for (const entity of entities) {
    if (entity.type === 'POLYLINE') {
      if (polyline && polyline.length) points = points.concat(polyline);
      polyline = [];
      continue;
    }
    if (entity.type === 'VERTEX') {
      if (!polyline) polyline = [];
      polyline.push({
        d: num(entity.tags, 10),
        r: Math.max(0, num(entity.tags, 20)),
      });
      continue;
    }
    if (entity.type === 'SEQEND') {
      if (polyline && polyline.length) points = points.concat(polyline);
      polyline = null;
      continue;
    }
    if (entity.type === 'LWPOLYLINE') {
      const xs = nums(entity.tags, 10);
      const ys = nums(entity.tags, 20);
      const n = Math.min(xs.length, ys.length);
      for (let i = 0; i < n; i++) points.push({ d: xs[i], r: Math.max(0, ys[i]) });
      continue;
    }
    if (entity.type === 'LINE') {
      points.push({ d: num(entity.tags, 10), r: Math.max(0, num(entity.tags, 20)) });
      points.push({ d: num(entity.tags, 11), r: Math.max(0, num(entity.tags, 21)) });
      continue;
    }
    if (entity.type === 'ARC') {
      points = points.concat(sampleArc(entity));
      continue;
    }
    if (entity.type === 'SPLINE') {
      points = points.concat(sampleSpline(entity));
      continue;
    }
    if (entity.type === 'ENDSEC' || entity.type === 'ENDBLK') continue;
    throw new Error(`Unsupported DXF entity type "${entity.type}" in profile.`);
  }
  if (polyline && polyline.length) points = points.concat(polyline);

  if (!points.length) throw new Error('DXF profile contained no geometry.');

  points = dedupeConsecutive(points);
  points = orientProfile(points, opts.dAxis ?? 'x');
  // Keep sketch order. A shank/undercut can go slightly backward in d;
  // sorting would scramble the cutting shape versus the drawn bit.

  if (Math.abs(points[0].d) < 1e-4) points[0].d = 0;
  if (Math.abs(points[0].r) < 1e-4) points[0].r = 0;
  if ((points[0].d !== 0 || points[0].r !== 0) && points[0].d < 0.05 && points[0].r < 0.05) {
    points.unshift({ d: 0, r: 0 });
    points = dedupeConsecutive(points);
  }

  if (Math.abs(points[0].d) > 1e-6 || Math.abs(points[0].r) > 1e-6) {
    throw new Error(
      `Profile does not start at the tip (0,0) — first point is (${points[0].d}, ${points[0].r}).`
    );
  }

  return points;
}

/**
 * DXF (x, y) is stored as {d: x, r: y} until this remaps.
 * @param {ProfilePoint[]} points
 * @param {'x' | 'y' | 'auto'} dAxis
 */
function orientProfile(points, dAxis) {
  let axis = dAxis;
  if (axis === 'auto') {
    let i = 1;
    while (i < points.length && Math.hypot(points[i].d, points[i].r) < 1e-4) i++;
    const p = points[i] ?? points[1];
    // If the first step off the tip is mostly in X, X is radius (round cutting
    // edge) and Y is the bit axis.
    axis = p && Math.abs(p.d) >= Math.abs(p.r) ? 'y' : 'x';
  }
  if (axis === 'y') {
    return points.map((p) => ({ d: p.r, r: p.d }));
  }
  return points;
}

/**
 * The reference Bit Profile.dxf was sketched in millimetres (A3 LIMMAX).
 * Mill model units are inches.
 * @param {ProfilePoint[]} points
 * @param {number} [scale]
 */
export function scaleProfilePoints(points, scale = 1 / 25.4) {
  return points.map((p) => ({ d: p.d * scale, r: p.r * scale }));
}
