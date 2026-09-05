import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importDxfProfile, importDxfOverlay, importDxfFluteProfile, sampleBulgeSegment } from '../src/dxf-profile.js';

const dxfPath = fileURLToPath(new URL('../reference/Bit Profile.dxf', import.meta.url));

describe('importDxfProfile (real reference/Bit Profile.dxf)', () => {
  const dxfText = readFileSync(dxfPath, 'utf8');
  const points = importDxfProfile(dxfText);

  it('starts exactly at the tip (0,0)', () => {
    expect(points[0].d).toBe(0);
    expect(points[0].r).toBe(0);
  });

  it('ends at the profile\'s farthest point, matching the DXF spline\'s last control point', () => {
    const last = points[points.length - 1];
    expect(last.d).toBeCloseTo(67.68605654449011, 6);
    expect(last.r).toBeCloseTo(19.07844764406891, 6);
  });

  it('is sorted by d ascending with no duplicate/out-of-order points', () => {
    for (let i = 1; i < points.length; i++) {
      expect(points[i].d).toBeGreaterThan(points[i - 1].d);
    }
  });

  it('passes through the arc/spline joint (verified independently against the DXF\'s own numbers)', () => {
    const joint = points.find((p) => Math.abs(p.d - 14.390671578856171) < 1e-6);
    expect(joint).toBeDefined();
    expect(joint.r).toBeCloseTo(5.499231413260183, 6);
  });
});

function polylineDxf(verts) {
  const lines = [
    '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'POLYLINE', '8', 'PROFILE', '66', '1',
  ];
  for (const [x, y] of verts) {
    lines.push('0', 'VERTEX', '8', 'PROFILE', '10', String(x), '20', String(y), '30', '0');
  }
  lines.push('0', 'SEQEND', '0', 'ENDSEC', '0', 'EOF', '');
  return lines.join('\n');
}

describe('importDxfProfile auto axis', () => {
  it('ignores a tiny origin wiggle so a wide ogee keeps X as radius', () => {
    const dxf = polylineDxf([
      [0, 0],
      [0.000011, -0.001765],
      [0.025612, -0.000397],
      [1.50826, 0.753113],
    ]);
    const pts = importDxfProfile(dxf, { dAxis: 'auto' });
    const maxD = Math.max(...pts.map((p) => p.d));
    const maxR = Math.max(...pts.map((p) => p.r));
    expect(maxR).toBeCloseTo(1.508, 2);
    expect(maxD).toBeCloseTo(0.753, 2);
  });

  it('keeps a pointed 3/4″ roundover along the bit, not a ball', () => {
    const dxf = polylineDxf([
      [0, 0],
      [0.011617, 0.066826],
      [0.727319, 0.669998],
      [0.728272, 0.971246],
    ]);
    const pts = importDxfProfile(dxf, { dAxis: 'auto' });
    const first = pts.find((p) => Math.hypot(p.d, p.r) > 0.01);
    expect(first.d).toBeGreaterThan(first.r);
    const maxD = Math.max(...pts.map((p) => p.d));
    const maxR = Math.max(...pts.map((p) => p.r));
    expect(maxD).toBeCloseTo(0.971, 2);
    expect(maxR).toBeCloseTo(0.728, 2);
  });
});

describe('importDxfOverlay', () => {
  const lineDxf = [
    '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', 'PROFILE',
    '10', '1.75', '20', '0', '30', '0',
    '11', '1.75', '21', '10', '31', '0',
    '0', 'ENDSEC', '0', 'EOF', '',
  ].join('\n');

  it('maps a trace-style line (X = radius, Y = length) onto the blank', () => {
    const pts = importDxfOverlay(lineDxf);
    expect(pts[0]).toEqual({ d: 0, r: 1.75 });
    expect(pts[pts.length - 1]).toEqual({ d: 10, r: 1.75 });
  });

  it('does not require a bit tip at (0,0)', () => {
    expect(() => importDxfProfile(lineDxf)).toThrow(/tip/);
    expect(() => importDxfOverlay(lineDxf)).not.toThrow();
  });

  it('reverses an arc that is stored start-at-the-far-end so the chord is not drawn', () => {
    const dxf = [
      '0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '0', 'ENDSEC',
      '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', 'PROFILE',
      '10', '1.75', '20', '0', '30', '0',
      '11', '1.75', '21', '5', '31', '0',
      '0', 'ARC', '8', 'PROFILE',
      '10', '1.75', '20', '6.5', '30', '0', '40', '1.5',
      '50', '90', '51', '270',
      '0', 'ENDSEC', '0', 'EOF', '',
    ].join('\n');
    const pts = importDxfOverlay(dxf);
    const joint = pts.find((p) => Math.abs(p.d - 5) < 0.05 && Math.abs(p.r - 1.75) < 0.05);
    expect(joint).toBeDefined();
    const i = pts.indexOf(joint);
    const next = pts[i + 1];
    expect(Math.hypot(next.d - joint.d, next.r - joint.r)).toBeLessThan(0.45);
  });

  const overlayPath = fileURLToPath(new URL('./fixtures/leg-reference-photo.dxf', import.meta.url));
  const maybe = existsSync(overlayPath) ? it : it.skip;
  maybe('reads the traced leg DXF as a long thin silhouette', () => {
    const pts = importDxfOverlay(readFileSync(overlayPath, 'utf8'));
    expect(pts.length).toBeGreaterThan(40);
    const dMax = Math.max(...pts.map((p) => p.d));
    const rMax = Math.max(...pts.map((p) => p.r));
    expect(dMax).toBeGreaterThan(20);
    expect(rMax).toBeGreaterThan(0.4);
    expect(rMax).toBeLessThan(4);
  });
});

describe('sampleBulgeSegment', () => {
  it('traces a 90° arc of the 1/2″ flute round (center at the bearing)', () => {
    const a = { d: 0.1875, r: 0 };
    const b = { d: 0.4375, r: 0.25 };
    const bulge = 0.4142135623730951;
    const pts = sampleBulgeSegment(a, b, bulge, 16);
    const last = pts[pts.length - 1];
    expect(last.d).toBeCloseTo(0.4375, 10);
    expect(last.r).toBeCloseTo(0.25, 10);
    const cx = 0.1875;
    const cy = 0.25;
    for (const p of pts) {
      expect(Math.hypot(p.d - cx, p.r - cy)).toBeCloseTo(0.25, 5);
    }
  });
});

describe('importDxfFluteProfile', () => {
  const flutePath = fileURLToPath(new URL('../bits/Flute/0.5in_Round.dxf', import.meta.url));

  it('reads the half-circle without requiring a tip at (0,0)', () => {
    const profile = importDxfFluteProfile(readFileSync(flutePath, 'utf8'));
    expect(profile.type).toBe('flute');
    expect(profile.bearingRadius).toBeCloseTo(0.1875, 6);
    expect(profile.points[0].d).toBeCloseTo(0.1875, 6);
    expect(profile.points[0].r).toBeCloseTo(0, 6);
    const maxD = Math.max(...profile.points.map((p) => p.d));
    expect(maxD).toBeCloseTo(0.4375, 3);
    const ys = profile.points.map((p) => p.r);
    expect(Math.max(...ys)).toBeCloseTo(0.5, 4);
    expect(profile.points.length).toBeGreaterThan(8);
  });
});
