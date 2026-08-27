import { describe, it, expect } from 'vitest';
import { loadLibraryBits } from '../src/demo-bits.js';
import { validateBitProfile } from '../src/bits.js';

describe('bits/ DXF library', () => {
  const bits = loadLibraryBits();

  it('loads Magnate and endmill DXFs as named bits', () => {
    const ids = bits.map((b) => b.id).sort();
    expect(ids).toEqual(['Endmill_1_2', 'Magnate_7533', 'Magnate_7593', 'Magnate_803']);
  });

  it('names bits from the filename (no extension)', () => {
    for (const bit of bits) {
      expect(bit.name).toBe(bit.id);
      expect(bit.name).not.toMatch(/\.dxf$/i);
    }
  });

  it('every profile is inches, tip at (0,0), and validates', () => {
    for (const bit of bits) {
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

  it('Magnate_7593 is oriented as a round cutting edge (radius grows first)', () => {
    const bit = bits.find((b) => b.id === 'Magnate_7593');
    const p = bit.profile.points[1];
    expect(p.r).toBeGreaterThan(p.d);
    const maxD = Math.max(...bit.profile.points.map((pt) => pt.d));
    const maxR = Math.max(...bit.profile.points.map((pt) => pt.r));
    expect(maxD).toBeCloseTo(1.5, 1);
    expect(maxR).toBeCloseTo(1.5, 1);
  });
});
