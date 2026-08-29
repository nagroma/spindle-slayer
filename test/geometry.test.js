import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { radiusAt, MIN_RADIUS, faceRadiusAt, isRun, isCutHidden, bakeCutRadii, remainingFromCut, fluteIndexAngles, isFlute, isSpiral, sampleStations, spiralTwistDeg, grooveAnglesAt, indexDegToStarts, startsToIndexDeg, bakeGrooveGrid } from '../src/geometry.js';
import { stockRadius } from '../src/stock.js';
import { importDxfProfile } from '../src/dxf-profile.js';

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

describe('spiral / pineapple helix', () => {
  it('treats 4 starts as 90° and 90° as 4 starts', () => {
    expect(startsToIndexDeg(4)).toBe(90);
    expect(indexDegToStarts(90)).toBe(4);
    expect(indexDegToStarts(20)).toBe(18);
  });

  it('2:1 ratio is 2 inches of travel per turn (180° per inch)', () => {
    const p = {
      id: 's1',
      bitId: 'x',
      profile: { type: 'round', r: 0.5 },
      atLength: 10,
      circularDistance: 1.5,
      run: true,
      endAtLength: 18,
      endCircularDistance: 1.5,
      spiral: true,
      spiralTravel: 2,
      spiralTurns: 1,
      spiralStarts: 1,
    };
    expect(isSpiral(p)).toBe(true);
    expect(spiralTwistDeg(p, 10)).toBeCloseTo(0, 10);
    expect(spiralTwistDeg(p, 12)).toBeCloseTo(360, 10);
    expect(grooveAnglesAt(p, 11)[0]).toBeCloseTo(180, 10);
  });

  it('pineapple: flute groove follows the helix, not a straight index', () => {
    const model = fluteModel({
      spiral: true,
      spiralTravel: 4,
      spiralTurns: 1,
      spiralStarts: 1,
      spiralStartDeg: 0,
    });
    // 4″ per turn → 90° per inch. At x=8 start, groove at 0°. At x=10, groove at 180°.
    expect(radiusAt(model, 8, 0)).toBeCloseTo(1.5, 5);
    expect(radiusAt(model, 8, 180)).toBeCloseTo(1.75, 5);
    expect(radiusAt(model, 10, 180)).toBeCloseTo(1.5, 5);
    expect(radiusAt(model, 10, 0)).toBeCloseTo(1.75, 5);
    expect(faceRadiusAt(model, 10)).toBeCloseTo(1.75, 8);
  });

  it('pineapple with 4 starts cuts every 90° on the helix', () => {
    const model = fluteModel({
      spiral: true,
      spiralTravel: 4,
      spiralTurns: 1,
      spiralStarts: 4,
      spiralStartDeg: 0,
    });
    expect(radiusAt(model, 8, 0)).toBeCloseTo(1.5, 5);
    expect(radiusAt(model, 8, 90)).toBeCloseTo(1.5, 5);
    expect(radiusAt(model, 8, 45)).toBeCloseTo(1.75, 5);
  });

  it('barley twist: plunge bit wraps; 2D silhouette stays the turned envelope', () => {
    const model = {
      stock: { type: 'round', length: 24, size: 3 },
      placements: [
        {
          id: 's1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 6,
          circularDistance: 1.25,
          run: true,
          endAtLength: 14,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 4,
          spiralTurns: 1,
          spiralStarts: 1,
          spiralStartDeg: 0,
        },
      ],
    };
    expect(isSpiral(model.placements[0])).toBe(true);
    expect(isFlute(model.placements[0])).toBe(false);
    expect(radiusAt(model, 6, 0)).toBeCloseTo(1.25, 5);
    expect(radiusAt(model, 6, 180)).toBeCloseTo(1.5, 5);
    expect(radiusAt(model, 8, 180)).toBeCloseTo(1.25, 5);
    expect(radiusAt(model, 8, 0)).toBeCloseTo(1.5, 5);
    expect(faceRadiusAt(model, 8)).toBeCloseTo(1.5, 8);
  });

  it('does not revolve a spiral plunge the way a ring would', () => {
    const ring = {
      stock: { type: 'round', length: 12, size: 3 },
      placements: [
        {
          id: 'p1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 4,
          circularDistance: 1.25,
        },
      ],
    };
    const wrap = {
      ...ring,
      placements: [
        {
          ...ring.placements[0],
          run: true,
          endAtLength: 10,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 4,
          spiralTurns: 1,
          spiralStarts: 1,
        },
      ],
    };
    expect(radiusAt(ring, 4, 0)).toBeCloseTo(1.25, 5);
    expect(radiusAt(ring, 4, 180)).toBeCloseTo(1.25, 5);
    expect(radiusAt(wrap, 4, 0)).toBeCloseTo(1.25, 5);
    expect(radiusAt(wrap, 4, 180)).toBeCloseTo(1.5, 5);
  });

  it('ccw helix is the opposite of cw', () => {
    const p = {
      id: 's1',
      bitId: 'x',
      profile: { type: 'round', r: 0.5 },
      atLength: 10,
      circularDistance: 1.5,
      run: true,
      endAtLength: 18,
      endCircularDistance: 1.5,
      spiral: true,
      spiralTravel: 2,
      spiralTurns: 1,
      spiralStarts: 1,
      spiralDir: 'ccw',
    };
    expect(spiralTwistDeg(p, 12)).toBeCloseTo(-360, 10);
    expect(grooveAnglesAt(p, 11)[0]).toBeCloseTo(-180, 10);
  });

  it('both ways cuts the cw and ccw helices (barley twist)', () => {
    const model = {
      stock: { type: 'round', length: 24, size: 3 },
      placements: [
        {
          id: 's1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 6,
          circularDistance: 1.25,
          run: true,
          endAtLength: 14,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 4,
          spiralTurns: 1,
          spiralStarts: 1,
          spiralStartDeg: 0,
          spiralDir: 'both',
        },
      ],
    };
    // 4″/turn → 90° per inch. At x=7, cw is 90° and ccw is −90°.
    expect(radiusAt(model, 7, 90)).toBeCloseTo(1.25, 5);
    expect(radiusAt(model, 7, -90)).toBeCloseTo(1.25, 5);
    expect(radiusAt(model, 7, 0)).toBeCloseTo(1.5, 5);
  });

  it('bakes a Fast barley-twist grid without hanging', () => {
    const model = {
      stock: { type: 'round', length: 24, size: 3 },
      placements: [
        {
          id: 's1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 2,
          circularDistance: 1.25,
          run: true,
          endAtLength: 22,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 2,
          spiralTurns: 1,
          spiralStarts: 4,
          spiralStartDeg: 0,
          spiralDir: 'both',
        },
      ],
    };
    const xs = [];
    for (let i = 0; i <= 96; i++) xs.push((24 * i) / 96);
    const t0 = performance.now();
    const grid = bakeGrooveGrid(model, xs, 96, 2);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(grid.length).toBe(xs.length * 97);
    expect(Math.min(...grid)).toBeLessThan(1.4);
  });

  it('bakes a Magnate 7554 barley grid without hanging', () => {
    const dxf = readFileSync(fileURLToPath(new URL('../bits/Magnate 7554.dxf', import.meta.url)), 'utf8');
    const points = importDxfProfile(dxf, { dAxis: 'auto' });
    const model = {
      stock: { type: 'round', length: 24, size: 3 },
      placements: [
        {
          id: 's1',
          bitId: 'Magnate 7554',
          profile: { type: 'points', points },
          atLength: 2,
          circularDistance: 1.25,
          run: true,
          endAtLength: 22,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 2,
          spiralTurns: 1,
          spiralStarts: 4,
          spiralStartDeg: 0,
          spiralDir: 'both',
        },
      ],
    };
    const xs = [];
    for (let i = 0; i <= 80; i++) xs.push((24 * i) / 80);
    const t0 = performance.now();
    const grid = bakeGrooveGrid(model, xs, 96, 2);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(Math.min(...grid)).toBeLessThan(1.5);
  });
});
