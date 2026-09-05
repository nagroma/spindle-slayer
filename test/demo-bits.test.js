import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadLibraryBits, bitFromDxf, bitIdFromFilename, uniqueBitId, mergeUserBits } from '../src/demo-bits.js';
import { validateBitProfile } from '../src/profile.js';

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

describe('runtime DXF bits', () => {
  it('names a bit from the DXF filename', () => {
    expect(bitIdFromFilename('C:\\\\Downloads\\\\My Cove.dxf')).toBe('My Cove');
    expect(bitIdFromFilename('tiny-ball.DXF')).toBe('tiny-ball');
  });

  it('avoids colliding with an existing id', () => {
    expect(uniqueBitId('Magnate_7593', ['Magnate_7593'])).toBe('Magnate_7593 (2)');
    expect(uniqueBitId('cove', ['cove', 'cove (2)'])).toBe('cove (3)');
  });

  it('parses a plunge half-profile from a DXF', () => {
    const dxf = readFileSync(fileURLToPath(new URL('./fixtures/tiny-ball.dxf', import.meta.url)), 'utf8');
    const bit = bitFromDxf('tiny-ball.dxf', dxf, { existingIds: [] });
    expect(bit.user).toBe(true);
    expect(bit.kind).toBe('plunge');
    expect(bit.id).toBe('tiny-ball');
    expect(bit.profile.type).toBe('points');
    expect(bit.profile.points[0]).toEqual({ d: 0, r: 0 });
  });

  it('parses a flute DXF when there is no tip at the origin', () => {
    const dxf = readFileSync(fileURLToPath(new URL('../bits/Flute/0.5in_Round.dxf', import.meta.url)), 'utf8');
    const bit = bitFromDxf('0.5in_Round.dxf', dxf, { existingIds: ['0.5in_Round'] });
    expect(bit.kind).toBe('flute');
    expect(bit.id).toBe('0.5in_Round (2)');
    expect(bit.profile.type).toBe('flute');
  });

  it('rejects a spindle-length overlay DXF', () => {
    const dxf = polylineDxf([
      [1.75, 0],
      [1.75, 29.5],
    ]);
    expect(() => bitFromDxf('spindle-trace.dxf', dxf)).toThrow(/Overlay DXF/i);
  });

  it('does not let a user bit shadow a shipped id', () => {
    const shipped = [{ id: 'Magnate_7593', name: 'Magnate_7593', tool: 'Magnate_7593', group: 'compound', profile: { type: 'round', r: 1 } }];
    const user = [{ id: 'Magnate_7593', name: 'fake', tool: 'fake', group: 'compound', profile: { type: 'round', r: 9 }, user: true }];
    const merged = mergeUserBits(shipped, user);
    expect(merged).toHaveLength(1);
    expect(merged[0].user).toBe(false);
    expect(merged[0].profile).toEqual({ type: 'round', r: 1 });
  });
});
