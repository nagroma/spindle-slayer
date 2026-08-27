import { describe, it, expect } from 'vitest';
import {
  BIT_LIBRARY,
  BIT_GROUPS,
  getBitById,
  listByGroup,
  validateBitProfile,
  createCustomBit,
} from '../src/bits.js';

describe('BIT_LIBRARY seed data', () => {
  it('has unique ids', () => {
    const ids = BIT_LIBRARY.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every entry has a valid profile', () => {
    for (const bit of BIT_LIBRARY) {
      expect(() => validateBitProfile(bit.profile)).not.toThrow();
    }
  });

  it('matches the known leg fixture bits (ball and foot ball)', () => {
    // reference/leg-designer-v1.html + CLAUDE.md: 7592 (R1") mills the 3.00"
    // dia ball, 1278 (R1/2") mills the 1.50" dia foot ball.
    expect(getBitById(BIT_LIBRARY, 'ball-7592').profile).toEqual({ type: 'round', r: 1.0 });
    expect(getBitById(BIT_LIBRARY, 'rb-1278').profile).toEqual({ type: 'round', r: 0.5 });
  });

  it('includes real flute/spiral bit numbers from the catalog, not placeholders', () => {
    const flute = listByGroup(BIT_LIBRARY, BIT_GROUPS.FLUTE);
    expect(flute.length).toBeGreaterThan(0);
    expect(getBitById(BIT_LIBRARY, 'cb2-808').profile).toEqual({ type: 'round', r: 1.0 });

    const vgroove = listByGroup(BIT_LIBRARY, BIT_GROUPS.VGROOVE);
    expect(vgroove.length).toBeGreaterThan(0);
    expect(getBitById(BIT_LIBRARY, 'vc-761').profile).toEqual({ type: 'v', angleDeg: 60 });
  });
});

describe('getBitById / listByGroup', () => {
  it('returns undefined for an unknown id', () => {
    expect(getBitById(BIT_LIBRARY, 'nope')).toBeUndefined();
  });

  it('groups only return bits of that group', () => {
    for (const bit of listByGroup(BIT_LIBRARY, BIT_GROUPS.COVE)) {
      expect(bit.group).toBe(BIT_GROUPS.COVE);
    }
  });
});

describe('validateBitProfile', () => {
  it('accepts a valid round profile', () => {
    expect(() => validateBitProfile({ type: 'round', r: 0.25 })).not.toThrow();
  });

  it('accepts a valid v profile', () => {
    expect(() => validateBitProfile({ type: 'v', angleDeg: 90 })).not.toThrow();
  });

  it('accepts a valid flat profile', () => {
    expect(() => validateBitProfile({ type: 'flat', r: 0.25 })).not.toThrow();
  });

  it('rejects a flat profile with a non-positive radius', () => {
    expect(() => validateBitProfile({ type: 'flat', r: 0 })).toThrow();
    expect(() => validateBitProfile({ type: 'flat', r: -0.5 })).toThrow();
  });

  it('rejects a negative radius', () => {
    expect(() => validateBitProfile({ type: 'round', r: -1 })).toThrow();
  });

  it('rejects a missing radius', () => {
    expect(() => validateBitProfile({ type: 'round' })).toThrow();
  });

  it('rejects an out-of-range angle', () => {
    expect(() => validateBitProfile({ type: 'v', angleDeg: 0 })).toThrow();
    expect(() => validateBitProfile({ type: 'v', angleDeg: 180 })).toThrow();
  });

  it('rejects an unknown profile type', () => {
    expect(() => validateBitProfile({ type: 'ogee' })).toThrow();
  });
});

describe('createCustomBit', () => {
  it('creates a valid round custom bit with a derived id', () => {
    const bit = createCustomBit({ name: 'Hand-ground cove 1/4"', profile: { type: 'round', r: 0.25 } });
    expect(bit.id).toBe('custom-hand-ground-cove-1-4');
    expect(bit.name).toBe('Hand-ground cove 1/4"');
    expect(bit.tool).toBe('custom');
    expect(bit.profile).toEqual({ type: 'round', r: 0.25 });
  });

  it('defaults group by profile type', () => {
    const round = createCustomBit({ name: 'Test round', profile: { type: 'round', r: 0.1 } });
    const v = createCustomBit({ name: 'Test v', profile: { type: 'v', angleDeg: 60 } });
    expect(round.group).toBe(BIT_GROUPS.FLUTE);
    expect(v.group).toBe(BIT_GROUPS.VGROOVE);
  });

  it('avoids id collisions against an existing library', () => {
    const existing = [createCustomBit({ name: 'Widget', profile: { type: 'round', r: 0.1 } })];
    const second = createCustomBit({ name: 'Widget', profile: { type: 'round', r: 0.2 } }, existing);
    expect(second.id).not.toBe(existing[0].id);
    expect(second.id).toBe('custom-widget-2');
  });

  it('rejects a bit with no name', () => {
    expect(() => createCustomBit({ name: '', profile: { type: 'round', r: 0.1 } })).toThrow();
  });

  it('rejects a bit with an invalid profile', () => {
    expect(() => createCustomBit({ name: 'Bad', profile: { type: 'round', r: -1 } })).toThrow();
  });
});
