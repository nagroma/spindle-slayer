import { describe, it, expect } from 'vitest';
import { depthForWidth, plungeEnvelope, NO_CUT, roundNosePoints } from '../src/profile.js';

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
