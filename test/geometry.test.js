import { describe, it, expect } from 'vitest';
import { radiusAt, MIN_RADIUS, faceRadiusAt, isRun, isCutHidden, bakeCutRadii, remainingFromCut } from '../src/geometry.js';
import { stockRadius } from '../src/stock.js';

// Pommel truth-test from the operating model:
// 3.5" square × 34", ball-nose R 1", tip 1.5" from centerline at 4" from headstock.
// Remaining at the tip is a 3" round, blending back into the square.

const pommel = {
  stock: { type: 'square', length: 34, size: 3.5 },
  placements: [
    {
      id: 'p1',
      bitId: 'round-1',
      profile: { type: 'round', r: 1 },
      atLength: 4,
      circularDistance: 1.5,
    },
  ],
};

describe('pommel: 3.5" square, ball-nose to 1.5" from centerline at 4"', () => {
  it('at the bit tip every angle is 1.5" (3.00" diameter, fully round)', () => {
    for (const theta of [0, 45, 90, 180]) {
      expect(radiusAt(pommel, 4, theta)).toBeCloseTo(1.5, 10);
    }
  });

  it('reports 3.00" diameter at the tip', () => {
    expect(radiusAt(pommel, 4, 0) * 2).toBeCloseTo(3.0, 10);
  });

  it('leaves the square untouched at the headstock (bit does not reach)', () => {
    expect(radiusAt(pommel, 0, 0)).toBeCloseTo(1.75, 10);
    expect(radiusAt(pommel, 0, 45)).toBeCloseTo(1.75 * Math.SQRT2, 10);
  });

  it('is subtractive: remaining never exceeds the blank', () => {
    for (const x of [0, 3, 4, 5, 20]) {
      for (const theta of [0, 45]) {
        expect(radiusAt(pommel, x, theta)).toBeLessThanOrEqual(stockRadius(pommel.stock, theta) + 1e-12);
      }
    }
  });

  it('blends back to the square faces a bit past the tip', () => {
    // Hemisphere R=1": faces (1.75") are uncut once envelope >= 1.75, i.e. d >= 0.25.
    // That is |s| = sqrt(2*R*d - d^2) = sqrt(0.4375) ≈ 0.66" from the tip.
    const x = 4 + 0.8;
    expect(radiusAt(pommel, x, 0)).toBeCloseTo(1.75, 10);
  });
});

describe('radiusAt clamps through-axis cuts', () => {
  it('does not collapse to zero', () => {
    const model = {
      stock: { type: 'round', length: 10, size: 2 },
      placements: [
        {
          id: 'p1',
          bitId: 'round-1',
          profile: { type: 'round', r: 1 },
          atLength: 5,
          circularDistance: 0,
        },
      ],
    };
    expect(radiusAt(model, 5, 0)).toBe(MIN_RADIUS);
  });
});

const endmill = {
  type: 'points',
  points: [
    { d: 0, r: 0 },
    { d: 0, r: 0.25 },
    { d: 0.5, r: 0.25 },
  ],
};

describe('½″ endmill square shoulder', () => {
  const model = {
    stock: { type: 'square', length: 10, size: 3.5 },
    placements: [
      {
        id: 'p1',
        bitId: 'Endmill_1_2',
        profile: endmill,
        atLength: 4,
        circularDistance: 1.5,
      },
    ],
  };

  it('is still cutting just inside the flute width', () => {
    expect(faceRadiusAt(model, 4)).toBeCloseTo(1.5, 8);
    expect(faceRadiusAt(model, 4 + 0.25 - 1e-6)).toBeCloseTo(1.5, 8);
    expect(faceRadiusAt(model, 4 - 0.25 + 1e-6)).toBeCloseTo(1.5, 8);
  });

  it('returns to the face just past the flute', () => {
    expect(faceRadiusAt(model, 4 + 0.25 + 1e-4)).toBeCloseTo(1.75, 8);
    expect(faceRadiusAt(model, 4 - 0.25 - 1e-4)).toBeCloseTo(1.75, 8);
  });
});

describe('isRun', () => {
  it('is false when run is off even if an end pose is stored', () => {
    expect(
      isRun({
        id: 'p1',
        bitId: 'x',
        profile: endmill,
        atLength: 4,
        circularDistance: 1.5,
        run: false,
        endAtLength: 12,
        endCircularDistance: 0.8,
      })
    ).toBe(false);
  });

  it('does not sweep a stored end pose when run is off', () => {
    const model = {
      stock: { type: 'round', length: 20, size: 2 },
      placements: [
        {
          id: 'p1',
          bitId: 'Endmill_1_2',
          profile: endmill,
          atLength: 4,
          circularDistance: 0.6,
          run: false,
          endAtLength: 12,
          endCircularDistance: 0.6,
        },
      ],
    };
    expect(faceRadiusAt(model, 8)).toBeCloseTo(1, 8);
  });
});

describe('hidden cuts', () => {
  it('does not nick remaining wood', () => {
    const model = {
      stock: { type: 'square', length: 10, size: 3.5 },
      placements: [
        {
          id: 'p1',
          bitId: 'Endmill_1_2',
          profile: endmill,
          atLength: 4,
          circularDistance: 1.5,
          hidden: true,
        },
      ],
    };
    expect(isCutHidden(model.placements[0])).toBe(true);
    expect(faceRadiusAt(model, 4)).toBeCloseTo(1.75, 8);
    expect(radiusAt(model, 4, 0)).toBeCloseTo(1.75, 8);
  });
});

describe('bakeCutRadii', () => {
  it('matches radiusAt at every angle for a station', () => {
    const xs = [0, 3, 4, 5, 20];
    const cuts = bakeCutRadii(pommel, xs);
    for (let i = 0; i < xs.length; i++) {
      for (const theta of [0, 45, 90]) {
        expect(remainingFromCut(pommel.stock, theta, cuts[i])).toBeCloseTo(radiusAt(pommel, xs[i], theta), 10);
      }
    }
  });
});
