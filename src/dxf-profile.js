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
 * Intermediate points of a DXF bulge arc from a to b (excluding a, including b).
 * bulge = tan(included-angle / 4). Positive is CCW.
 * @param {ProfilePoint} a
 * @param {ProfilePoint} b
 * @param {number} bulge
 * @param {number} [samples]
 * @returns {ProfilePoint[]}
 */
export function sampleBulgeSegment(a, b, bulge, samples = 16) {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-12) return [{ d: b.d, r: b.r }];
  const dx = b.d - a.d;
  const dy = b.r - a.r;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-15) return [{ d: b.d, r: b.r }];
  const included = 4 * Math.atan(bulge);
  const sinHalf = Math.sin(included / 2);
  if (Math.abs(sinHalf) < 1e-15) return [{ d: b.d, r: b.r }];
  const radius = Math.abs(chord / (2 * sinHalf));
  const h = radius * Math.cos(included / 2);
  const sign = bulge >= 0 ? 1 : -1;
  const nx = -dy / chord;
  const ny = dx / chord;
  const cx = (a.d + b.d) / 2 + nx * h * sign;
  const cy = (a.r + b.r) / 2 + ny * h * sign;
  const startAng = Math.atan2(a.r - cy, a.d - cx);
  const n = Math.max(4, samples);
  /** @type {ProfilePoint[]} */
  const pts = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const ang = startAng + included * t;
    pts.push({ d: cx + radius * Math.cos(ang), r: cy + radius * Math.sin(ang) });
  }
  pts[pts.length - 1] = { d: b.d, r: b.r };
  return pts;
}

/**
 * @param {{ d: number, r: number, bulge?: number }[]} verts
 * @param {number} [samples]
 * @returns {ProfilePoint[]}
 */
function expandPolylineBulges(verts, samples = 16, expandBulge = false) {
  if (!verts.length) return [];
  if (!expandBulge) {
    return dedupeConsecutive(verts.map((v) => ({ d: v.d, r: v.r })));
  }
  /** @type {ProfilePoint[]} */
  const out = [{ d: verts[0].d, r: verts[0].r }];
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i];
    const b = verts[i + 1];
    const more = sampleBulgeSegment(a, b, a.bulge ?? 0, samples);
    for (const p of more) out.push(p);
  }
  return dedupeConsecutive(out);
}

function vertexBulge(tags) {
  const matches = tags.filter((t) => t.code === 42);
  if (!matches.length) return 0;
  const v = parseFloat(matches[0].value);
  return Number.isFinite(v) ? v : 0;
}

/**
 * LWPOLYLINE vertices are 10/20 pairs with an optional 42 bulge per vertex.
 * @param {DxfTag[]} tags
 * @returns {{ d: number, r: number, bulge: number }[]}
 */
function lwpolylineVerts(tags) {
  /** @type {{ d: number, r: number, bulge: number }[]} */
  const verts = [];
  /** @type {{ d: number, r: number, bulge: number } | null} */
  let cur = null;
  for (const tag of tags) {
    if (tag.code === 10) {
      if (cur) verts.push(cur);
      cur = { d: parseFloat(tag.value), r: 0, bulge: 0 };
    } else if (tag.code === 20 && cur) {
      cur.r = parseFloat(tag.value);
    } else if (tag.code === 42 && cur) {
      const v = parseFloat(tag.value);
      cur.bulge = Number.isFinite(v) ? v : 0;
    }
  }
  if (cur) verts.push(cur);
  return verts;
}

function parseDxfSketchChains(dxfText, opts = {}) {
  const tags = parseDxfTags(dxfText);
  const entities = extractEntities(tags);
  const arcSamples = opts.arcSamples ?? 24;

  /** @type {ProfilePoint[][]} */
  const chains = [];
  /** @type {{ d: number, r: number, bulge: number }[] | null} */
  let polyline = null;
  /** @param {ProfilePoint[] | null | undefined} pts */
  const pushChain = (pts) => {
    if (pts && pts.length) chains.push(pts);
  };
  const pushPoly = (verts) => {
    if (verts && verts.length) pushChain(expandPolylineBulges(verts, arcSamples, Boolean(opts.expandBulge)));
  };

  for (const entity of entities) {
    if (entity.type === 'POLYLINE') {
      pushPoly(polyline);
      polyline = [];
      continue;
    }
    if (entity.type === 'VERTEX') {
      if (!polyline) polyline = [];
      polyline.push({ d: num(entity.tags, 10), r: num(entity.tags, 20), bulge: vertexBulge(entity.tags) });
      continue;
    }
    if (entity.type === 'SEQEND') {
      pushPoly(polyline);
      polyline = null;
      continue;
    }
    if (entity.type === 'LWPOLYLINE') {
      pushPoly(lwpolylineVerts(entity.tags));
      continue;
    }
    if (entity.type === 'LINE') {
      pushChain([
        { d: num(entity.tags, 10), r: num(entity.tags, 20) },
        { d: num(entity.tags, 11), r: num(entity.tags, 21) },
      ]);
      continue;
    }
    if (entity.type === 'ARC') {
      pushChain(sampleArc(entity, arcSamples));
      continue;
    }
    if (entity.type === 'SPLINE') {
      pushChain(sampleSpline(entity));
      continue;
    }
    if (entity.type === 'ENDSEC' || entity.type === 'ENDBLK') continue;
    throw new Error(`Unsupported DXF entity type "${entity.type}" in profile.`);
  }
  pushPoly(polyline);
  if (!chains.length) throw new Error('DXF profile contained no geometry.');
  return chains;
}

/** @param {ProfilePoint} a @param {ProfilePoint} b */
function sketchDist2(a, b) {
  return (a.d - b.d) ** 2 + (a.r - b.r) ** 2;
}

/**
 * Join entity samples into one polyline. Reverse a chain when that meets the
 * previous end — otherwise an ARC stored start-at-the-far-end draws its chord.
 * @param {ProfilePoint[][]} chains
 */
function stitchSketchChains(chains) {
  /** @type {ProfilePoint[]} */
  const out = [];
  for (const raw of chains) {
    if (!raw.length) continue;
    let chain = raw;
    if (out.length) {
      const last = out[out.length - 1];
      if (sketchDist2(last, chain[chain.length - 1]) < sketchDist2(last, chain[0])) {
        chain = chain.slice().reverse();
      }
    } else {
      out.push(...chain);
      continue;
    }
    const last = out[out.length - 1];
    const skip = sketchDist2(last, chain[0]) < 1e-12 ? 1 : 0;
    for (let i = skip; i < chain.length; i++) out.push(chain[i]);
  }
  return out.length ? dedupeConsecutive(out) : [];
}

function parseDxfSketchPoints(dxfText, opts = {}) {
  return dedupeConsecutive(parseDxfSketchChains(dxfText, opts).flat());
}

function clampRadius(points) {
  return points.map((p) => ({ d: p.d, r: Math.max(0, p.r) }));
}

/**
 * Parse a DXF whose sketched (x, y) is the bit half-profile, tip at (0,0).
 * dAxis: 'x' (default, x along the bit), 'y' (y along the bit), or 'auto'
 * (`auto` is the bits/*.dxf / Trace convention: Y along the bit, X as radius).
 * @param {string} dxfText
 * @param {{ dAxis?: 'x' | 'y' | 'auto' }} [opts]
 * @returns {ProfilePoint[]}
 */
export function importDxfProfile(dxfText, opts = {}) {
  let points = parseDxfSketchPoints(dxfText);
  points = orientProfile(points, opts.dAxis ?? 'x');
  points = clampRadius(points);
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
 * Traced spindle (or any half-profile that is not a bit tip at 0,0).
 * Longer sketch axis becomes length along the blank; the other is radius.
 * Trace DXF uses X = radius, Y = along the axis.
 * @param {string} dxfText
 * @returns {ProfilePoint[]}
 */
export function importDxfOverlay(dxfText) {
  return clampRadius(orientOverlay(stitchSketchChains(parseDxfSketchChains(dxfText, { arcSamples: 48, expandBulge: true }))));
}

/**
 * Side-mounted flute bit: X is distance from the bit axis (bearing offset),
 * Y is along the cutter. Do not require a tip at (0,0).
 * @param {string} dxfText
 * @returns {import('./profile.js').FluteProfile}
 */
export function importDxfFluteProfile(dxfText) {
  const points = parseDxfSketchPoints(dxfText, { expandBulge: true, arcSamples: 24 });
  if (points.length < 2) throw new Error('Flute DXF needs at least two profile points.');
  let minD = Infinity;
  let minR = Infinity;
  let maxR = -Infinity;
  for (const p of points) {
    if (!(Number.isFinite(p.d) && Number.isFinite(p.r))) {
      throw new Error('Flute DXF contained a non-numeric point.');
    }
    if (p.d < minD) minD = p.d;
    if (p.r < minR) minR = p.r;
    if (p.r > maxR) maxR = p.r;
  }
  if (!(minD >= 0) || !Number.isFinite(minD)) {
    throw new Error('Flute DXF X (bearing offset) must be non-negative.');
  }
  const shifted = minR < 0 ? points.map((p) => ({ d: p.d, r: p.r - minR })) : points;
  return { type: 'flute', points: shifted, bearingRadius: minD };
}

/**
 * DXF (x, y) is stored as {d: x, r: y} until this remaps.
 * @param {ProfilePoint[]} points
 * @param {'x' | 'y' | 'auto'} dAxis
 */
function orientProfile(points, dAxis) {
  let axis = dAxis;
  if (axis === 'auto') {
    // bits/*.dxf and Trace write X = radius, Y = along the axis, tip at (0,0).
    // An older heuristic picked whichever axis grew first as radius so a ball
    // would map correctly. A pointed roundover's first motion is along the
    // bit, so that swapped d/r into a half-disk.
    axis = 'y';
  }
  if (axis === 'y') {
    return points.map((p) => ({ d: p.r, r: p.d }));
  }
  return points;
}

/** Longer sketch axis is length along the blank; the other is radius from the centerline. */
function orientOverlay(points) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.d);
    maxX = Math.max(maxX, p.d);
    minY = Math.min(minY, p.r);
    maxY = Math.max(maxY, p.r);
  }
  if (maxY - minY >= maxX - minX) {
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
