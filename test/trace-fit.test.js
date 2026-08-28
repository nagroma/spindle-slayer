import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { axisScaleFromLength, pixelToProfile, traceToProfile, endCenter, snapVerticalProfile } from '../src/trace/coords.js';
import {
  fitCircle,
  fitLineRms,
  fitSegments,
  snapArcToRadius,
  snapCandidates,
  sampleSegments,
  pinProfileEnds,
  reverseProfile,
  reverseSegs,
  equalizeArcEndRadii,
  ensureArcsThroughEnds,
  applySmoothJoins,
  startTangent,
  endTangent,
  forceSegType,
  mergeAdjacent,
  isUncuttableInside,
} from '../src/trace/fit.js';
import { segsToDxf, sampledBitDxf } from '../src/trace/dxf-export.js';
import { importDxfProfile } from '../src/dxf-profile.js';
import { serializeSession, parseSession } from '../src/trace/session.js';
import { closestInsert, cycleJoin } from '../src/trace/edit.js';

describe('end center from extreme + two sides', () => {
  it('sits between the sides at the extreme station', () => {
    const c = endCenter({ x: 50, y: 10 }, { x: 10, y: 40 }, { x: 90, y: 40 });
    expect(c.x).toBeCloseTo(50, 6);
    expect(c.y).toBeCloseTo(10, 6);
  });

  it('falls on the midpoint when the extreme is on the side-to-side line', () => {
    const c = endCenter({ x: 50, y: 40 }, { x: 10, y: 40 }, { x: 90, y: 40 });
    expect(c.x).toBeCloseTo(50, 6);
    expect(c.y).toBeCloseTo(40, 6);
  });

  it('allows sides at a different height from the extreme', () => {
    const c = endCenter({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 });
    expect(c.x).toBeCloseTo(5, 6);
    expect(c.y).toBeCloseTo(0, 6);
  });
});

describe('pixel to profile', () => {
  it('maps axis length to d and offset to r', () => {
    const scale = axisScaleFromLength({ x: 0, y: 0 }, { x: 0, y: 100 }, 10);
    expect(scale).not.toBeNull();
    const p = pixelToProfile(scale, { x: 20, y: 50 });
    expect(p.d).toBeCloseTo(5, 6);
    expect(p.r).toBeCloseTo(2, 6);
  });

  it('treats either side of the axis as positive radius', () => {
    const scale = axisScaleFromLength({ x: 0, y: 0 }, { x: 0, y: 100 }, 10);
    const left = pixelToProfile(scale, { x: -20, y: 50 });
    const right = pixelToProfile(scale, { x: 20, y: 50 });
    expect(left.r).toBeCloseTo(right.r, 6);
  });

  it('keeps Ctrl-click joints as breaks', () => {
    const scale = axisScaleFromLength({ x: 0, y: 0 }, { x: 0, y: 100 }, 10);
    const { points, breaks } = traceToProfile(scale, [
      { x: 10, y: 0 },
      { x: 10, y: 20 },
      { x: 10, y: 40, joint: true },
      { x: 20, y: 60 },
      { x: 20, y: 80 },
    ]);
    expect(points).toHaveLength(5);
    expect(breaks).toEqual([2]);
  });
});

describe('circle / line fit', () => {
  it('recovers a 3" radius from noisy samples', () => {
    const center = { d: 4, r: 1 };
    const radius = 3;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * 0.15 + (i / 12) * Math.PI * 0.4;
      pts.push({
        d: center.d + radius * Math.cos(a),
        r: center.r + radius * Math.sin(a),
      });
    }
    const fit = fitCircle(pts);
    expect(fit).not.toBeNull();
    expect(fit.radius).toBeCloseTo(3, 2);
    expect(fit.rms).toBeLessThan(0.01);
  });

  it('prefers a line for colinear points', () => {
    const pts = [
      { d: 0, r: 1.75 },
      { d: 1, r: 1.75 },
      { d: 2, r: 1.75 },
      { d: 3, r: 1.75 },
    ];
    expect(fitLineRms(pts)).toBeLessThan(1e-9);
    const segs = fitSegments(pts, { rms: 0.02, minSagitta: 0.03 });
    expect(segs).toHaveLength(1);
    expect(segs[0].type).toBe('line');
  });

  it('honors a marked joint between a straight and a curve', () => {
    const pts = [
      { d: 0, r: 1.75 },
      { d: 1, r: 1.75 },
      { d: 2, r: 1.75 },
    ];
    const center = { d: 3, r: 1.75 };
    for (let i = 1; i <= 8; i++) {
      const a = Math.PI - (i / 8) * (Math.PI / 2);
      pts.push({
        d: center.d + Math.cos(a),
        r: center.r + Math.sin(a),
      });
    }
    const segs = fitSegments(pts, { breaks: [2] });
    expect(segs.length).toBeGreaterThanOrEqual(2);
    expect(segs[0].type).toBe('line');
    expect(segs[0].b).toEqual({ d: 2, r: 1.75 });
    expect(segs.slice(1).some((s) => s.type === 'arc')).toBe(true);
  });

  it('snaps an arc to 3" and keeps the endpoints', () => {
    const a = { d: 0, r: 0 };
    const b = { d: 2, r: 2 };
    const fitted = {
      type: 'arc',
      a,
      b,
      center: { d: 0, r: 2 },
      radius: 2.87,
      ccw: true,
    };
    const snapped = snapArcToRadius(fitted, 3);
    expect(snapped).not.toBeNull();
    expect(snapped.radius).toBe(3);
    expect(snapped.a).toEqual(a);
    expect(snapped.b).toEqual(b);
    expect(Math.hypot(a.d - snapped.center.d, a.r - snapped.center.r)).toBeCloseTo(3, 6);
    expect(Math.hypot(b.d - snapped.center.d, b.r - snapped.center.r)).toBeCloseTo(3, 6);
  });

  it('suggests 3" for a 2.91" fit when 3 is known', () => {
    const c = snapCandidates(2.91, [3]);
    expect(c).toContain(3);
  });

  it('keeps neighbors after snapping to a stock radius', () => {
    const c = snapCandidates(2, []);
    expect(c).toContain(1.75);
    expect(c).toContain(2);
    expect(c).toContain(2.25);
    expect(c).toContain(2.5);
  });

  it('lists a typed known radius even when it is not close to the fit', () => {
    const c = snapCandidates(1.86, [2.5]);
    expect(c).toContain(2.5);
  });
});

describe('DXF export', () => {
  it('round-trips a sampled bit through importDxfProfile', () => {
    const pts = [{ d: 0, r: 0 }];
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      pts.push({ d: 0.5 * t, r: Math.sqrt(Math.max(0, 1 * 0.5 * t - (0.5 * t) ** 2)) });
    }
    const dxf = sampledBitDxf(pts);
    const got = importDxfProfile(dxf, { dAxis: 'auto' });
    expect(got[0]).toEqual({ d: 0, r: 0 });
    expect(got[got.length - 1].d).toBeCloseTo(pts[pts.length - 1].d, 4);
    expect(got[got.length - 1].r).toBeCloseTo(pts[pts.length - 1].r, 4);
  });

  it('writes ARC entities for a snapped curve', () => {
    const segs = [
      {
        type: 'arc',
        a: { d: 0, r: 0 },
        b: { d: 1, r: 1 },
        center: { d: 0, r: 1 },
        radius: 1,
        ccw: true,
      },
    ];
    const dxf = segsToDxf(segs);
    expect(dxf).toMatch(/ARC/);
    expect(dxf).toMatch(/1$/m);
  });

  it('samples fitted segments without dropping the start', () => {
    const segs = fitSegments([
      { d: 0, r: 1 },
      { d: 1, r: 1 },
      { d: 2, r: 1 },
    ]);
    const sampled = sampleSegments(segs);
    expect(sampled[0]).toEqual({ d: 0, r: 1 });
    expect(sampled[sampled.length - 1].d).toBeCloseTo(2, 6);
  });
});

describe('vertical snap and pins', () => {
  it('equalizes nearly-constant radius runs', () => {
    const pts = [
      { d: 0, r: 1.0 },
      { d: 1, r: 1.03 },
      { d: 2, r: 0.98 },
      { d: 2.2, r: 1.4 },
    ];
    const snapped = snapVerticalProfile(pts, 0.06);
    expect(snapped[0].r).toBeCloseTo(snapped[1].r, 6);
    expect(snapped[1].r).toBeCloseTo(snapped[2].r, 6);
    expect(snapped[3].r).toBeCloseTo(1.4, 6);
  });

  it('pins first and last stations', () => {
    const pts = pinProfileEnds(
      [
        { d: 0.4, r: 1.6 },
        { d: 10, r: 1.1 },
        { d: 29.1, r: 0.9 },
      ],
      { startD: 0, endD: 29.5, endR: 0.85 },
    );
    expect(pts[0].d).toBe(0);
    expect(pts[2].d).toBe(29.5);
    expect(pts[2].r).toBe(0.85);
  });

  it('equalizes a roundover whose ends are almost the same radius', () => {
    const seg = {
      type: 'arc',
      a: { d: 2, r: 1.02 },
      b: { d: 4, r: 0.97 },
      center: { d: 3, r: 1.0 },
      radius: 1,
      ccw: true,
    };
    const next = equalizeArcEndRadii(seg, 0.08);
    expect(next.type).toBe('arc');
    if (next.type !== 'arc') return;
    expect(next.a.r).toBeCloseTo(next.b.r, 6);
  });
});

describe('fit extras', () => {
  it('still finds an unmarked arc between two straights', () => {
    const pts = [
      { d: 0, r: 1.75 },
      { d: 1, r: 1.75 },
      { d: 2, r: 1.75 },
    ];
    const center = { d: 3, r: 1.75 };
    for (let i = 1; i <= 8; i++) {
      const a = Math.PI - (i / 8) * (Math.PI / 2);
      pts.push({
        d: center.d + Math.cos(a),
        r: center.r + Math.sin(a),
      });
    }
    pts.push({ d: 4, r: 2.75 });
    pts.push({ d: 5, r: 2.75 });
    const segs = fitSegments(pts);
    expect(segs.some((s) => s.type === 'arc')).toBe(true);
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1].type === 'spline' ? segs[i - 1].points[segs[i - 1].points.length - 1] : segs[i - 1].b;
      const next = segs[i].type === 'spline' ? segs[i].points[0] : segs[i].a;
      expect(Math.hypot(prev.d - next.d, prev.r - next.r)).toBeLessThan(1e-9);
    }
  });

  it('fits a wiggly leftover as a spline', () => {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      pts.push({ d: i * 0.25, r: 1 + 0.2 * Math.sin(i * 1.1) });
    }
    const segs = fitSegments(pts, { rms: 0.02, minSagitta: 0.04 });
    expect(segs.some((s) => s.type === 'spline' || s.type === 'arc')).toBe(true);
  });

  it('reverses a profile and maps joints', () => {
    const pts = [
      { d: 0, r: 1 },
      { d: 1, r: 1 },
      { d: 2, r: 1.2 },
      { d: 3, r: 1.2 },
    ];
    const rev = reverseProfile(pts, [1], [1]);
    expect(rev.points[0].d).toBe(3);
    expect(rev.breaks).toEqual([2]);
    expect(rev.smoothBreaks).toEqual([2]);
  });

  it('reverses fitted segs back to headstock-first', () => {
    const segs = fitSegments([
      { d: 0, r: 1 },
      { d: 1, r: 1 },
      { d: 2, r: 1 },
    ]);
    const twice = reverseSegs(reverseSegs(segs));
    expect(twice[0].type).toBe(segs[0].type);
    const a = twice[0].type === 'spline' ? twice[0].points[0] : twice[0].a;
    expect(a.d).toBeCloseTo(0, 5);
  });

  it('writes sampled lines for a spline', () => {
    const dxf = segsToDxf([
      {
        type: 'spline',
        points: [
          { d: 0, r: 1 },
          { d: 1, r: 1.2 },
          { d: 2, r: 1 },
        ],
      },
    ]);
    expect(dxf).toMatch(/LINE/);
    expect(dxf).not.toMatch(/ARC/);
  });
});

describe('session and node edit', () => {
  it('round-trips a session file', () => {
    const json = serializeSession({
      imageName: 'leg.jpg',
      imageData: 'data:image/jpeg;base64,xx',
      mode: 'spindle',
      knownInches: 29.5,
      axisIsLength: true,
      knownRadii: '1, 3',
      ends: [{ x: 1, y: 2 }],
      scaleA: null,
      scaleB: null,
      trace: [{ x: 3, y: 4, joint: true, smooth: true }],
      tool: 'editPoints',
      segs: [],
    });
    const got = parseSession(json);
    expect(got.imageName).toBe('leg.jpg');
    expect(got.trace[0].smooth).toBe(true);
  });

  it('inserts on a span and cycles join type', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 0, y: 20 },
    ];
    const hit = closestInsert(pts, { x: 1, y: 15 });
    expect(hit).not.toBeNull();
    expect(hit?.index).toBe(2);
    const p = { x: 0, y: 10 };
    cycleJoin(p);
    expect(p.joint).toBe(true);
    expect(p.smooth).toBe(false);
    cycleJoin(p);
    expect(p.smooth).toBe(true);
    cycleJoin(p);
    expect(p.joint).toBe(false);
  });
});

describe('leg-reference session', () => {
  it('drawn curve ends meet the next curve', () => {
    const fixture = JSON.parse(readFileSync('test/fixtures/leg-reference-trace.json', 'utf8'));
    const origin = endCenter(fixture.ends[0], fixture.ends[1], fixture.ends[2]);
    const axis = endCenter(fixture.ends[3], fixture.ends[4], fixture.ends[5]);
    const scale = axisScaleFromLength(origin, axis, fixture.knownInches);
    expect(scale).not.toBeNull();
    const { points, breaks, smoothBreaks } = traceToProfile(scale, fixture.trace);
    const segs = fitSegments(points, { breaks, smoothBreaks });
    expect(segs.length).toBeGreaterThan(5);
    for (let i = 1; i < segs.length; i++) {
      const pe = sampleSegments([segs[i - 1]], 20).at(-1);
      const ns = sampleSegments([segs[i]], 20)[0];
      expect(Math.hypot(pe.d - ns.d, pe.r - ns.r)).toBeLessThan(1e-9);
    }
  });

  it('forces saved arcs through their stored endpoints', () => {
    const a = { d: 0, r: 1 };
    const b = { d: 1, r: 1.2 };
    const segs = ensureArcsThroughEnds([
      {
        type: 'arc',
        a,
        b,
        center: { d: 0.4, r: 0.2 },
        radius: 0.9,
        ccw: true,
      },
      { type: 'line', a: b, b: { d: 2, r: 1.2 } },
    ]);
    const pe = sampleSegments([segs[0]], 20).at(-1);
    const ns = sampleSegments([segs[1]], 20)[0];
    expect(pe).toEqual(b);
    expect(ns).toEqual(b);
    expect(segs[0].type).toBe('arc');
    if (segs[0].type === 'arc') {
      expect(Math.hypot(a.d - segs[0].center.d, a.r - segs[0].center.r)).toBeCloseTo(segs[0].radius, 6);
      expect(Math.hypot(b.d - segs[0].center.d, b.r - segs[0].center.r)).toBeCloseTo(segs[0].radius, 6);
    }
  });

  it('smooth join matches tangents without a gap', () => {
    const segs = fitSegments(
      [
        { d: 0, r: 1 },
        { d: 1, r: 1 },
        { d: 2, r: 1 },
        { d: 2.7, r: 0.55 },
        { d: 3, r: 0 },
      ],
      { breaks: [2], smoothBreaks: [2] },
    );
    expect(segs.length).toBeGreaterThanOrEqual(2);
    const T = endTangent(segs[0]);
    const S = startTangent(segs[1]);
    expect(T.d * S.d + T.r * S.r).toBeGreaterThan(0.95);
    const pe = sampleSegments([segs[0]], 16).at(-1);
    const ns = sampleSegments([segs[1]], 16)[0];
    expect(Math.hypot(pe.d - ns.d, pe.r - ns.r)).toBeLessThan(1e-8);
  });
});

describe('type convert, merge, uncuttable', () => {
  const quarterLeft = {
    type: /** @type {const} */ ('arc'),
    a: { d: 0, r: 1 },
    b: { d: 1, r: 2 },
    center: { d: 1, r: 1 },
    radius: 1,
    ccw: true,
  };
  const quarterRight = {
    type: /** @type {const} */ ('arc'),
    a: { d: 1, r: 2 },
    b: { d: 2, r: 1 },
    center: { d: 1, r: 1 },
    radius: 1,
    ccw: true,
  };

  it('arc → spline follows the arc, not the chord', () => {
    const semi = {
      type: /** @type {const} */ ('arc'),
      a: { d: 0, r: 1 },
      b: { d: 2, r: 1 },
      center: { d: 1, r: 1 },
      radius: 1,
      ccw: true,
    };
    const spline = forceSegType(semi, 'spline');
    expect(spline.type).toBe('spline');
    expect(spline.points.length).toBeGreaterThan(2);
    const mid = spline.points[Math.floor(spline.points.length / 2)];
    expect(Math.abs(mid.r - 1)).toBeGreaterThan(0.3);
  });

  it('line → arc gets a radius instead of staying a chord', () => {
    const line = { type: /** @type {const} */ ('line'), a: { d: 0, r: 1 }, b: { d: 2, r: 1 } };
    const arc = forceSegType(line, 'arc');
    expect(arc.type).toBe('arc');
    if (arc.type === 'arc') expect(arc.radius).toBeGreaterThan(0.5);
  });

  it('joins two colinear lines into one line', () => {
    const a = { type: /** @type {const} */ ('line'), a: { d: 0, r: 1 }, b: { d: 1, r: 1 } };
    const b = { type: /** @type {const} */ ('line'), a: { d: 1, r: 1 }, b: { d: 3, r: 1 } };
    const out = mergeAdjacent([a, b], 0);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('line');
  });

  it('joins two quarters of a circle into one arc', () => {
    const out = mergeAdjacent([quarterLeft, quarterRight], 0, 'arc');
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('arc');
  });

  it('flags a sharp V and not a shallow turn', () => {
    const vPrev = { type: /** @type {const} */ ('line'), a: { d: 0, r: 2 }, b: { d: 1, r: 0 } };
    const vNext = { type: /** @type {const} */ ('line'), a: { d: 1, r: 0 }, b: { d: 2, r: 2 } };
    expect(isUncuttableInside(vPrev, vNext)).toBe(true);
    const sPrev = { type: /** @type {const} */ ('line'), a: { d: 0, r: 1 }, b: { d: 1, r: 1.02 } };
    const sNext = { type: /** @type {const} */ ('line'), a: { d: 1, r: 1.02 }, b: { d: 2, r: 1.04 } };
    expect(isUncuttableInside(sPrev, sNext)).toBe(false);
  });
});
