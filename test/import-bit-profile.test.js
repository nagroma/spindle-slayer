import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { importDxfProfile } from '../scripts/import-bit-profile.js';

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
