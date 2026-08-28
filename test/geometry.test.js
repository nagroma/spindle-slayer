import { describe, it, expect } from 'vitest';
import { radiusAt, MIN_RADIUS, faceRadiusAt, isRun, isCutHidden, bakeCutRadii, remainingFromCut, fluteIndexAngles, isFlute, sampleStations } from '../src/geometry.js';
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

const fluteHalf = {
  type: 'flute',
  bearingRadius: 0.1875,
  points: [
    { d: 0.1875, r: 0 },
    { d: 0.4375, r: 0.25 },
    { d: 0.1875, r: 0.5 },
  ],
};

function fluteModel(extra = {}) {
  return {
    stock: { type: 'round', length: 20, size: 3.5 },
    placements: [
      {
        id: 'f1',
        bitId: '0.5in_Round',
        profile: fluteHalf,
        atLength: 8,
        circularDistance: 1.75,
        run: true,
        endAtLength: 14,
        endCircularDistance: 1.75,
        indexIncrementDeg: 90,
        ...extra,
      },
    ],
  };
}

describe('indexed flute', () => {
  it('puts a groove every 20° all the way around (18 flutes)', () => {
    const angles = fluteIndexAngles(20);
    expect(angles).toHaveLength(18);
    expect(angles[0]).toBe(0);
    expect(angles[angles.length - 1]).toBeCloseTo(340, 10);
  });

  it('cuts 1/4″ deep at each index on a cylinder, and leaves the face between flutes', () => {
    const model = fluteModel();
    expect(isFlute(model.placements[0])).toBe(true);
    expect(radiusAt(model, 11, 0)).toBeCloseTo(1.5, 6);
    expect(radiusAt(model, 11, 90)).toBeCloseTo(1.5, 6);
    expect(radiusAt(model, 11, 45)).toBeCloseTo(1.75, 6);
    expect(radiusAt(model, 1, 0)).toBeCloseTo(1.75, 6);
  });

  it('does not change the 2D remaining silhouette (revolution envelope only)', () => {
    const model = fluteModel();
    expect(faceRadiusAt(model, 11)).toBeCloseTo(1.75, 8);
  });

  it('follows a taper: deeper remaining radius tracks the bearing path', () => {
    const model = fluteModel({
      circularDistance: 1.5,
      endCircularDistance: 1.0,
    });
    expect(radiusAt(model, 8, 0)).toBeCloseTo(1.25, 5);
    expect(radiusAt(model, 14, 0)).toBeCloseTo(0.75, 5);
  });

  it('on 3″ round stock with bearing at the face, cuts 1/4″ (remaining 1.25″)', () => {
    const model = {
      stock: { type: 'round', length: 34, size: 3 },
      placements: [
        {
          id: 'f1',
          bitId: '0.5in_Round',
          profile: fluteHalf,
          atLength: 10,
          circularDistance: 1.5,
          run: true,
          endAtLength: 20,
          endCircularDistance: 1.5,
          indexIncrementDeg: 90,
        },
      ],
    };
    expect(radiusAt(model, 15, 0)).toBeCloseTo(1.25, 6);
    expect(radiusAt(model, 15, 90)).toBeCloseTo(1.25, 6);
    expect(radiusAt(model, 15, 45)).toBeCloseTo(1.5, 6);
    expect(faceRadiusAt(model, 15)).toBeCloseTo(1.5, 8);
  });

  it('can sample the flute path more densely for a finer 3D mesh', () => {
    const model = fluteModel();
    const coarse = sampleStations(model, { dense: false, flutePerInch: 8 });
    const fine = sampleStations(model, { dense: true, perInch: 24, perInchMax: 960, flutePerInch: 56 });
    expect(fine.length).toBeGreaterThan(coarse.length);
  });
});
