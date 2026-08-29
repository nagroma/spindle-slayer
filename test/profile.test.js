import { describe, it, expect } from 'vitest';
import {
  depthForWidth,
  plungeEnvelope,
  NO_CUT,
  roundNosePoints,
  fluteOuterRadius,
  fluteCutDepth,
  fluteBearingRadius,
  fluteBitCenterRadius,
  validateBitProfile,
} from '../src/profile.js';

describe('depthForWidth (round-nose closed form)', () => {
  const round = { type: 'round', r: 1 };

  it('at the tip (width 0) d is 0', () => {
    expect(depthForWidth(round, 0)).toBe(0);
  });

  it('at the equator (width = R) d is R', () => {
    expect(depthForWidth(round, 1)).toBeCloseTo(1, 10);
  });

  it('matches d = R - sqrt(R^2 - s^2)', () => {
    const s = 0.6;
    const expected = 1 - Math.sqrt(1 - s * s);
    expect(depthForWidth(round, s)).toBeCloseTo(expected, 10);
  });

  it('returns null when the bit is not that wide', () => {
    expect(depthForWidth(round, 1.01)).toBeNull();
  });
});

describe('depthForWidth (points polyline)', () => {
  const points = { type: 'points', points: roundNosePoints(1, 64) };

  it('agrees with the round closed form near the tip', () => {
    const s = 0.5;
    const closed = depthForWidth({ type: 'round', r: 1 }, s);
    const poly = depthForWidth(points, s);
    expect(poly).toBeCloseTo(closed, 2);
  });
});

describe('plungeEnvelope', () => {
  const round = { type: 'round', r: 1 };

  it('at s=0 is exactly circularDistance', () => {
    expect(plungeEnvelope(round, 1.5, 0)).toBeCloseTo(1.5, 10);
  });

  it('does not cut beyond the bit radius along the length', () => {
    expect(plungeEnvelope(round, 1.5, 1.2)).toBe(NO_CUT);
  });
});

describe('flute DXF sizes', () => {
  const flute = {
    type: 'flute',
    bearingRadius: 0.1875,
    points: [
      { d: 0.1875, r: 0 },
      { d: 0.4375, r: 0.25 },
      { d: 0.1875, r: 0.5 },
    ],
  };

  it('reads inner, outer, and cut depth from the profile', () => {
    expect(fluteBearingRadius(flute)).toBeCloseTo(0.1875, 10);
    expect(fluteOuterRadius(flute)).toBeCloseTo(0.4375, 10);
    expect(fluteCutDepth(flute)).toBeCloseTo(0.25, 10);
  });

  it('places the bit axis at wood radius plus bearing radius', () => {
    expect(fluteBitCenterRadius(1.5, flute)).toBeCloseTo(1.6875, 10);
  });
});

describe('validateBitProfile', () => {
  it('accepts a valid round profile', () => {
    expect(() => validateBitProfile({ type: 'round', r: 0.25 })).not.toThrow();
  });

  it('accepts a valid v profile', () => {
    expect(() => validateBitProfile({ type: 'v', angleDeg: 90 })).not.toThrow();
  });

  it('rejects a negative radius', () => {
    expect(() => validateBitProfile({ type: 'round', r: -1 })).toThrow();
  });

  it('rejects an unknown profile type', () => {
    expect(() => validateBitProfile({ type: 'ogee' })).toThrow();
  });

  it('requires a flute bearingRadius', () => {
    expect(() =>
      validateBitProfile({
        type: 'flute',
        points: [
          { d: 0.2, r: 0 },
          { d: 0.4, r: 0.2 },
        ],
      })
    ).toThrow(/bearingRadius/);
  });
});
