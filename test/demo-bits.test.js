import { describe, it, expect } from 'vitest';
import { loadLibraryBits } from '../src/demo-bits.js';
import { validateBitProfile } from '../src/bits.js';

describe('bits/ DXF library', () => {
  const bits = loadLibraryBits();

  it('loads Magnate, endmill, and flute DXFs as named bits', () => {
    const ids = bits.map((b) => b.id).sort();
    expect(ids).toEqual(['0.5in_Round', 'Endmill_1_2', 'Magnate 7554', 'Magnate_7533', 'Magnate_7593', 'Magnate_803']);
  });

  it('names bits from the filename (no extension)', () => {
    for (const bit of bits) {
      expect(bit.name).toBe(bit.id);
      expect(bit.name).not.toMatch(/\.dxf$/i);
    }
  });

  it('plunge profiles are inches, tip at (0,0), and validate', () => {
    const plunge = bits.filter((b) => b.kind !== 'flute');
    expect(plunge.length).toBeGreaterThan(0);
    for (const bit of plunge) {
      expect(() => validateBitProfile(bit.profile)).not.toThrow();
      expect(bit.profile.type).toBe('points');
      expect(bit.profile.points[0]).toEqual({ d: 0, r: 0 });
      const maxD = Math.max(...bit.profile.points.map((p) => p.d));
      const maxR = Math.max(...bit.profile.points.map((p) => p.r));
      expect(maxD).toBeGreaterThan(0.05);
      expect(maxD).toBeLessThan(6);
      expect(maxR).toBeGreaterThan(0.05);
      expect(maxR).toBeLessThan(6);
    }
  });

  it('loads bits/Flute/0.5in_Round as a 1/2″ cutter with a 3/8″ bearing', () => {
    const bit = bits.find((b) => b.id === '0.5in_Round');
    expect(bit).toBeDefined();
    expect(bit.kind).toBe('flute');
    expect(bit.profile.type).toBe('flute');
    expect(() => validateBitProfile(bit.profile)).not.toThrow();
    expect(bit.profile.bearingRadius).toBeCloseTo(0.1875, 6);
    const ys = bit.profile.points.map((p) => p.r);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(0.5, 4);
  });

  it('Magnate_7593 is oriented as a round cutting edge (radius grows first)', () => {
    const bit = bits.find((b) => b.id === 'Magnate_7593');
    const p = bit.profile.points[1];
    expect(p.r).toBeGreaterThan(p.d);
    const maxD = Math.max(...bit.profile.points.map((pt) => pt.d));
    const maxR = Math.max(...bit.profile.points.map((pt) => pt.r));
    expect(maxD).toBeCloseTo(1.5, 1);
    expect(maxR).toBeCloseTo(1.5, 1);
  });

  it('Magnate 7554 keeps X as radius (round cutting edge), not a spindle-length stretch', () => {
    const bit = bits.find((b) => b.id === 'Magnate 7554');
    expect(bit).toBeDefined();
    const maxD = Math.max(...bit.profile.points.map((pt) => pt.d));
    const maxR = Math.max(...bit.profile.points.map((pt) => pt.r));
    expect(maxR).toBeCloseTo(1.51, 1);
    expect(maxR).toBeGreaterThan(0.5);
    expect(maxD).toBeLessThan(6);
  });
});
