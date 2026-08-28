// @ts-check
// Write a tiny R12 DXF: LINE + ARC in inches.
// Sketch plane: X = radius, Y = along axis (headstock / bit tip at 0).
// That matches bits/*.dxf so importDxfProfile({ dAxis: 'auto' }) can read a bit.

import { sampleSplineSeg } from './fit.js';

/**
 * @typedef {import('./fit.js').Seg} Seg
 * @typedef {import('./fit.js').Pt} Pt
 */

/** @param {number} n */
function f(n) {
  return (Math.round(n * 1e6) / 1e6).toString();
}

/** @param {string[]} lines @param {number} code @param {string|number} value */
function tag(lines, code, value) {
  lines.push(String(code).padStart(3, ' '), String(value));
}

/**
 * @param {Seg} seg
 * @returns {{ startDeg: number, endDeg: number }}
 */
function arcDegrees(seg) {
  if (seg.type !== 'arc') throw new Error('not an arc');
  // DXF (x, y) = (r, d)
  const cx = seg.center.r;
  const cy = seg.center.d;
  const start = (Math.atan2(seg.a.d - cy, seg.a.r - cx) * 180) / Math.PI;
  const end = (Math.atan2(seg.b.d - cy, seg.b.r - cx) * 180) / Math.PI;
  let startDeg = start;
  let endDeg = end;
  // AutoCAD ARC is CCW from start to end. If our profile arc is CW in DXF
  // space, the CCW short path is from b to a — swap so the drawn curve is
  // the short arc through the same endpoints (sample order may reverse).
  const ccwInDxf = dxfCcw(seg);
  if (!ccwInDxf) {
    startDeg = end;
    endDeg = start;
  }
  return { startDeg: normDeg(startDeg), endDeg: normDeg(endDeg) };
}

/** @param {import('./fit.js').ArcSeg} seg */
function dxfCcw(seg) {
  const cx = seg.center.r;
  const cy = seg.center.d;
  const a0 = Math.atan2(seg.a.d - cy, seg.a.r - cx);
  const a1 = Math.atan2(seg.b.d - cy, seg.b.r - cx);
  let sweep = a1 - a0;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  return sweep > 0;
}

/** @param {number} deg */
function normDeg(deg) {
  let x = deg % 360;
  if (x < 0) x += 360;
  return x;
}

/**
 * @param {Seg[]} segs
 * @param {{ layer?: string }} [opts]
 */
export function segsToDxf(segs, opts = {}) {
  const layer = opts.layer ?? 'PROFILE';
  /** @type {string[]} */
  const lines = [];
  tag(lines, 0, 'SECTION');
  tag(lines, 2, 'HEADER');
  tag(lines, 9, '$ACADVER');
  tag(lines, 1, 'AC1009');
  tag(lines, 0, 'ENDSEC');
  tag(lines, 0, 'SECTION');
  tag(lines, 2, 'ENTITIES');
  for (const seg of segs) {
    if (seg.type === 'line') {
      tag(lines, 0, 'LINE');
      tag(lines, 8, layer);
      tag(lines, 10, f(seg.a.r));
      tag(lines, 20, f(seg.a.d));
      tag(lines, 30, '0');
      tag(lines, 11, f(seg.b.r));
      tag(lines, 21, f(seg.b.d));
      tag(lines, 31, '0');
      continue;
    }
    if (seg.type === 'spline') {
      const pts = sampleSplineSeg(seg, 24);
      for (let i = 0; i < pts.length - 1; i++) {
        tag(lines, 0, 'LINE');
        tag(lines, 8, layer);
        tag(lines, 10, f(pts[i].r));
        tag(lines, 20, f(pts[i].d));
        tag(lines, 30, '0');
        tag(lines, 11, f(pts[i + 1].r));
        tag(lines, 21, f(pts[i + 1].d));
        tag(lines, 31, '0');
      }
      continue;
    }
    const { startDeg, endDeg } = arcDegrees(seg);
    tag(lines, 0, 'ARC');
    tag(lines, 8, layer);
    tag(lines, 10, f(seg.center.r));
    tag(lines, 20, f(seg.center.d));
    tag(lines, 30, '0');
    tag(lines, 40, f(seg.radius));
    tag(lines, 50, f(startDeg));
    tag(lines, 51, f(endDeg));
  }
  tag(lines, 0, 'ENDSEC');
  tag(lines, 0, 'EOF');
  return lines.join('\n') + '\n';
}

/**
 * Sampled LWPOLYLINE, tip at (0,0) if missing — drop into bits/ after a check.
 * @param {Pt[]} points
 */
export function sampledBitDxf(points) {
  let pts = points.map((p) => ({ d: p.d, r: Math.max(0, p.r) }));
  if (!pts.length) return segsToDxf([]);
  if (Math.abs(pts[0].d) > 1e-4 || Math.abs(pts[0].r) > 1e-4) {
    pts = [{ d: 0, r: 0 }, ...pts];
  } else {
    pts = [{ d: 0, r: 0 }, ...pts.slice(1)];
  }
  /** @type {string[]} */
  const lines = [];
  tag(lines, 0, 'SECTION');
  tag(lines, 2, 'HEADER');
  tag(lines, 9, '$ACADVER');
  tag(lines, 1, 'AC1009');
  tag(lines, 0, 'ENDSEC');
  tag(lines, 0, 'SECTION');
  tag(lines, 2, 'ENTITIES');
  tag(lines, 0, 'LWPOLYLINE');
  tag(lines, 8, 'PROFILE');
  tag(lines, 90, pts.length);
  tag(lines, 70, 0);
  for (const p of pts) {
    tag(lines, 10, f(p.r));
    tag(lines, 20, f(p.d));
  }
  tag(lines, 0, 'ENDSEC');
  tag(lines, 0, 'EOF');
  return lines.join('\n') + '\n';
}
