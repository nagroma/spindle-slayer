import { describe, it, expect } from 'vitest';
import {
  createRecipe,
  validateRecipe,
  addOperation,
  removeOperation,
  updateOperation,
  moveOperation,
  expandOperation,
  toGeometryRecipe,
  describeOperation,
  describeRecipe,
  toJSON,
  fromJSON,
  legReferenceRecipe,
  fluteSpiralExampleRecipe,
} from '../src/recipe.js';
import { getBitById, BIT_LIBRARY } from '../src/bits.js';

function minimalRecipe(extraOps = []) {
  const bits = [getBitById(BIT_LIBRARY, 'rb-1273')];
  return createRecipe({
    stock: { totalLength: 20, squareSize: 2, squareEndX: 0 },
    bits,
    operations: [{ type: 'taper', points: [{ x: 0, r: 0.5 }, { x: 20, r: 0.3 }] }, ...extraOps],
  });
}

describe('createRecipe / validateRecipe', () => {
  it('accepts a minimal valid recipe', () => {
    expect(() => minimalRecipe()).not.toThrow();
  });

  it('rejects a missing stock field', () => {
    expect(() =>
      createRecipe({ stock: { totalLength: 20, squareSize: 2 }, bits: [], operations: [] })
    ).toThrow(/squareEndX/);
  });

  it('rejects duplicate bit ids', () => {
    const bit = getBitById(BIT_LIBRARY, 'rb-1273');
    expect(() =>
      createRecipe({ stock: { totalLength: 1, squareSize: 1, squareEndX: 0 }, bits: [bit, bit], operations: [] })
    ).toThrow(/Duplicate bit id/);
  });

  it('rejects a ring op referencing an unknown bit', () => {
    expect(() =>
      minimalRecipe([{ type: 'ring', bitId: 'nope', kind: 'bead', atLength: 5 }])
    ).toThrow(/No bit with id/);
  });

  it('rejects an unknown operation type', () => {
    expect(() => minimalRecipe([{ type: 'ogee' }])).toThrow(/Unknown operation type/);
  });

  it('rejects a taper with fewer than two points', () => {
    expect(() =>
      createRecipe({
        stock: { totalLength: 1, squareSize: 1, squareEndX: 0 },
        bits: [],
        operations: [{ type: 'taper', points: [{ x: 0, r: 1 }] }],
      })
    ).toThrow(/at least two points/);
  });

  it('rejects a spiral missing turnsPerTravel', () => {
    expect(() =>
      minimalRecipe([
        {
          type: 'spiral',
          bitId: 'rb-1273',
          circularDistance: 0.3,
          from: 1,
          to: 5,
          startAngleDeg: 0,
        },
      ])
    ).toThrow(/turnsPerTravel/);
  });

  it('rejects a flute repeatUntilDeg not divisible by indexIncrementDeg', () => {
    expect(() =>
      minimalRecipe([
        {
          type: 'flute',
          bitId: 'rb-1273',
          circularDistance: 0.3,
          from: 1,
          to: 5,
          startAngleDeg: 0,
          indexIncrementDeg: 50,
        },
      ])
    ).toThrow(/evenly divisible/);
  });
});

describe('ringGroove operation', () => {
  it('validates and resolves through toGeometryRecipe with the bit\'s real profile', () => {
    const r = minimalRecipe([{ type: 'ringGroove', bitId: 'rb-1273', circularDistance: 0.1, atLength: 5 }]);
    const geo = toGeometryRecipe(r);
    const op = geo.operations.find((o) => o.type === 'ringGroove');
    expect(op.profile).toEqual({ type: 'round', r: 0.1875 });
    expect(op.circularDistance).toBe(0.1);
    expect(op.atLength).toBe(5);
  });

  it('rejects an unknown bit', () => {
    expect(() =>
      minimalRecipe([{ type: 'ringGroove', bitId: 'nope', circularDistance: 0.1, atLength: 5 }])
    ).toThrow(/No bit with id/);
  });

  it('describes with circular distance and position', () => {
    const r = minimalRecipe([{ type: 'ringGroove', bitId: 'rb-1273', circularDistance: 0.1, atLength: 5 }]);
    const text = describeOperation(r, r.operations[1]);
    expect(text).toMatch(/Bit 1273/);
    expect(text).toMatch(/circular distance 0\.10"/);
    expect(text).toMatch(/5\.00"/);
  });
});

describe('operation list editing', () => {
  it('addOperation appends and validates', () => {
    const r0 = minimalRecipe();
    const r1 = addOperation(r0, { type: 'ring', bitId: 'rb-1273', kind: 'bead', atLength: 5 });
    expect(r1.operations.length).toBe(2);
    expect(r0.operations.length).toBe(1); // original untouched
  });

  it('addOperation rejects an invalid op and leaves original untouched', () => {
    const r0 = minimalRecipe();
    expect(() => addOperation(r0, { type: 'ring', bitId: 'nope', kind: 'bead', atLength: 5 })).toThrow();
    expect(r0.operations.length).toBe(1);
  });

  it('removeOperation removes by index', () => {
    const r0 = addOperation(minimalRecipe(), { type: 'ring', bitId: 'rb-1273', kind: 'bead', atLength: 5 });
    const r1 = removeOperation(r0, 1);
    expect(r1.operations.length).toBe(1);
    expect(r1.operations[0].type).toBe('taper');
  });

  it('removeOperation throws on out-of-range index', () => {
    expect(() => removeOperation(minimalRecipe(), 5)).toThrow(/out of range/);
  });

  it('updateOperation patches fields and re-validates', () => {
    const r0 = addOperation(minimalRecipe(), { type: 'ring', bitId: 'rb-1273', kind: 'bead', atLength: 5 });
    const r1 = updateOperation(r0, 1, { atLength: 7.5 });
    expect(r1.operations[1].atLength).toBe(7.5);
    expect(r0.operations[1].atLength).toBe(5); // original untouched
  });

  it('updateOperation rejects a patch that becomes invalid', () => {
    const r0 = addOperation(minimalRecipe(), { type: 'ring', bitId: 'rb-1273', kind: 'bead', atLength: 5 });
    expect(() => updateOperation(r0, 1, { kind: 'triangle' })).toThrow();
  });

  it('moveOperation reorders', () => {
    let r = minimalRecipe();
    r = addOperation(r, { type: 'ring', bitId: 'rb-1273', kind: 'bead', atLength: 5 });
    r = addOperation(r, { type: 'ring', bitId: 'rb-1273', kind: 'cove', atLength: 8 });
    const moved = moveOperation(r, 2, 1);
    expect(moved.operations.map((o) => o.atLength ?? 'taper')).toEqual(['taper', 8, 5]);
  });
});

describe('expandOperation', () => {
  it('leaves ring/taper ops unchanged', () => {
    const op = { type: 'ring', bitId: 'x', kind: 'bead', atLength: 5 };
    expect(expandOperation(op)).toEqual([op]);
  });

  it('expands a flute with indexIncrementDeg/repeatUntilDeg into evenly-spaced instances', () => {
    const op = {
      type: 'flute',
      bitId: 'x',
      circularDistance: 0.3,
      from: 1,
      to: 5,
      startAngleDeg: 10,
      indexIncrementDeg: 90,
      repeatUntilDeg: 360,
    };
    const out = expandOperation(op);
    expect(out.map((o) => o.startAngleDeg)).toEqual([10, 100, 190, 280]);
    expect(out.every((o) => o.type === 'flute' && o.from === 1 && o.to === 5)).toBe(true);
  });

  it('expands a spiral with starts into evenly-spaced instances', () => {
    const op = {
      type: 'spiral',
      bitId: 'x',
      circularDistance: 0.3,
      from: 1,
      to: 5,
      startAngleDeg: 0,
      turnsPerTravel: { turns: 1, travel: 4 },
      starts: 3,
    };
    const out = expandOperation(op);
    expect(out.map((o) => o.startAngleDeg)).toEqual([0, 120, 240]);
  });

  it('does not expand when starts is 1 or omitted', () => {
    const op = {
      type: 'spiral', bitId: 'x', circularDistance: 0.3, from: 1, to: 5,
      startAngleDeg: 0, turnsPerTravel: { turns: 1, travel: 4 },
    };
    expect(expandOperation(op)).toEqual([op]);
  });
});

describe('toGeometryRecipe + the known leg fixture, through the recipe layer', () => {
  it('legReferenceRecipe produces a geometry recipe with the ball ring at 8.3"', () => {
    const geo = toGeometryRecipe(legReferenceRecipe());
    const ball = geo.operations.find((o) => o.type === 'ring' && o.atLength === 8.3);
    expect(ball).toBeDefined();
    expect(ball.r).toBe(1);
  });

  it('throws when there is no taper operation', () => {
    const r = createRecipe({
      stock: { totalLength: 1, squareSize: 1, squareEndX: 0 },
      bits: [],
      operations: [],
    });
    expect(() => toGeometryRecipe(r)).toThrow(/no taper operation/);
  });

  it('fluteSpiralExampleRecipe expands into distinct groove instances', () => {
    const geo = toGeometryRecipe(fluteSpiralExampleRecipe());
    const grooveTypes = geo.operations.filter((o) => o.type === 'flute' || o.type === 'spiral');
    expect(grooveTypes.length).toBe(4 + 2); // 4 indexed flutes + 2-start spiral
  });
});

describe('describeOperation / describeRecipe', () => {
  const recipe = legReferenceRecipe();

  it('describes a taper', () => {
    const text = describeOperation(recipe, recipe.operations[0]);
    expect(text).toMatch(/Turn the taper/);
    expect(text).toMatch(/5\.00" @ 0\.60" radius/);
  });

  it('describes a ring with bit tool number and position', () => {
    const ballOp = recipe.operations.find((o) => o.type === 'ring' && o.bitId === 'ball-7592');
    const text = describeOperation(recipe, ballOp);
    expect(text).toMatch(/Bit 7592/);
    expect(text).toMatch(/8\.30"/);
    expect(text).toMatch(/rotate one full turn/);
  });

  it('describes a flute with circular distance and repeat count', () => {
    const flute = fluteSpiralExampleRecipe();
    const op = flute.operations.find((o) => o.type === 'flute');
    const text = describeOperation(flute, op);
    expect(text).toMatch(/circular distance to 0\.70"/);
    expect(text).toMatch(/Repeat at 4 evenly-spaced/);
  });

  it('describes a spiral with turns/travel and direction', () => {
    const flute = fluteSpiralExampleRecipe();
    const op = flute.operations.find((o) => o.type === 'spiral');
    const text = describeOperation(flute, op);
    expect(text).toMatch(/1 turn\(s\) per 4" of travel/);
    expect(text).toMatch(/clockwise/);
    expect(text).toMatch(/Repeat at 2 evenly-spaced/);
  });

  it('describeRecipe numbers every operation in order', () => {
    const text = describeRecipe(recipe);
    const lines = text.split('\n');
    expect(lines.length).toBe(recipe.operations.length);
    expect(lines[0]).toMatch(/^1\. /);
    expect(lines[lines.length - 1]).toMatch(new RegExp(`^${lines.length}\\. `));
  });
});

describe('JSON round-trip', () => {
  it('toJSON/fromJSON preserves a recipe exactly and re-validates it', () => {
    const recipe = legReferenceRecipe();
    const json = toJSON(recipe);
    const restored = fromJSON(json);
    expect(restored).toEqual(recipe);
  });

  it('fromJSON rejects invalid JSON content', () => {
    expect(() => fromJSON(JSON.stringify({ stock: {}, bits: [], operations: [] }))).toThrow();
  });
});
