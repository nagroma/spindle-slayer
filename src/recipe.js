// @ts-check
// Operations/recipe list: an ordered, editable list of cut operations
// (taper/ring/flute/spiral) plus the bits they reference, the JSON
// import/export shape, and the plain-English shop-floor text generator.
// See docs/mechanics-notes.md for the domain vocabulary and draft schema.
//
// Pure functions/data only — no DOM. This module is the layer between the
// user-facing recipe (bits referenced by id, operations in the units an
// operator dials in) and geometry.js's height field (which wants resolved
// bit radii). Operations are immutable: every edit function returns a new
// recipe rather than mutating the one passed in.

import { getBitById } from './bits.js';
import { BIT_LIBRARY } from './bits.js';

/**
 * @typedef {import('./bits.js').Bit} Bit
 * @typedef {{totalLength: number, squareSize: number, squareEndX: number}} Stock
 * @typedef {{type: 'taper', points: {x: number, r: number}[]}} TaperOp
 *
 * Ring ops still use v1's proven bead/cove + bit-radius model (see
 * CLAUDE.md's known leg fixture), not the circularDistance direct-depth
 * setpoint the draft schema sketches for it. mechanics-notes.md flags
 * v1's ring math as "not the right primitive going forward," but the
 * physical bit geometry that would make a *convex* bead/ball feature
 * expressible as a single circularDistance dial-in isn't settled — cove
 * rings actually would map cleanly (same math as flute/spiral, applied
 * along x instead of theta), but ball/bead rings wouldn't with the same
 * formula. Deferred until that's confirmed rather than guessed at; see the
 * note in mechanics-notes.md.
 * @typedef {{type: 'ring', bitId: string, kind: 'bead'|'cove', atLength: number}} RingOp
 *
 * Profile-driven ring groove: subtractive-only (V, flat, or round-as-cove),
 * using circularDistance as the direct depth setpoint at the bit's
 * reference point (its closest point to the axis, for a plunge-mounted
 * bit) per Andrew's definition. Resolves cleanly for any profile shape,
 * unlike convex `ring` bead features above.
 * @typedef {{type: 'ringGroove', bitId: string, circularDistance: number, atLength: number}} RingGrooveOp
 *
 * @typedef {{
 *   type: 'flute',
 *   bitId: string,
 *   circularDistance: number,
 *   from: number,
 *   to: number,
 *   startAngleDeg: number,
 *   starts?: number,
 *   indexIncrementDeg?: number,
 *   repeatUntilDeg?: number,
 * }} FluteOp
 *
 * @typedef {{
 *   type: 'spiral',
 *   bitId: string,
 *   circularDistance: number,
 *   from: number,
 *   to: number,
 *   startAngleDeg: number,
 *   turnsPerTravel: {turns: number, travel: number},
 *   direction?: 'cw'|'ccw',
 *   starts?: number,
 * }} SpiralOp
 *
 * @typedef {TaperOp | RingOp | RingGrooveOp | FluteOp | SpiralOp} RecipeOperation
 * @typedef {{stock: Stock, bits: Bit[], operations: RecipeOperation[]}} Recipe
 */

/** @param {Partial<Recipe>} fields */
export function createRecipe({ stock, bits = [], operations = [] } = {}) {
  const recipe = { stock: { ...stock }, bits: [...bits], operations: [...operations] };
  validateRecipe(recipe);
  return recipe;
}

/** @param {Recipe} recipe */
export function validateRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') throw new Error('Recipe is required.');
  const { stock, bits, operations } = recipe;

  for (const key of ['totalLength', 'squareSize', 'squareEndX']) {
    if (!(stock && typeof stock[key] === 'number' && Number.isFinite(stock[key]))) {
      throw new Error(`Recipe stock.${key} must be a number.`);
    }
  }

  if (!Array.isArray(bits)) throw new Error('Recipe bits must be an array.');
  const bitIds = new Set();
  for (const bit of bits) {
    if (bitIds.has(bit.id)) throw new Error(`Duplicate bit id in recipe: ${bit.id}`);
    bitIds.add(bit.id);
  }

  if (!Array.isArray(operations)) throw new Error('Recipe operations must be an array.');
  operations.forEach((op, i) => {
    try {
      validateOperation(recipe, op);
    } catch (err) {
      throw new Error(`operations[${i}]: ${err.message}`);
    }
  });
}

/**
 * @param {Recipe} recipe
 * @param {RecipeOperation} op
 */
export function validateOperation(recipe, op) {
  if (!op || typeof op !== 'object') throw new Error('Operation is required.');

  if (op.type === 'taper') {
    if (!Array.isArray(op.points) || op.points.length < 2) {
      throw new Error('Taper needs at least two points.');
    }
    for (const p of op.points) {
      if (!(typeof p.x === 'number' && typeof p.r === 'number')) {
        throw new Error('Each taper point needs numeric x and r.');
      }
    }
    return;
  }

  if (op.type === 'ring') {
    resolveBit(recipe, op.bitId);
    if (op.kind !== 'bead' && op.kind !== 'cove') throw new Error('Ring kind must be "bead" or "cove".');
    if (typeof op.atLength !== 'number') throw new Error('Ring needs a numeric atLength.');
    return;
  }

  if (op.type === 'ringGroove') {
    resolveBit(recipe, op.bitId);
    if (typeof op.circularDistance !== 'number') throw new Error('ringGroove needs a numeric circularDistance.');
    if (typeof op.atLength !== 'number') throw new Error('ringGroove needs a numeric atLength.');
    return;
  }

  if (op.type === 'flute' || op.type === 'spiral') {
    resolveBit(recipe, op.bitId);
    if (typeof op.circularDistance !== 'number') throw new Error(`${op.type} needs a numeric circularDistance.`);
    if (!(typeof op.from === 'number' && typeof op.to === 'number' && op.to > op.from)) {
      throw new Error(`${op.type} needs numeric from/to with to > from.`);
    }
    if (typeof op.startAngleDeg !== 'number') throw new Error(`${op.type} needs a numeric startAngleDeg.`);
    if (op.type === 'spiral') {
      const t = op.turnsPerTravel;
      if (!(t && typeof t.turns === 'number' && typeof t.travel === 'number' && t.travel !== 0)) {
        throw new Error('Spiral needs turnsPerTravel: {turns, travel} with travel != 0.');
      }
    }
    if (op.starts !== undefined && !(Number.isInteger(op.starts) && op.starts >= 1)) {
      throw new Error(`${op.type} starts must be a positive integer.`);
    }
    if (op.type === 'flute' && op.indexIncrementDeg !== undefined) {
      if (!(typeof op.indexIncrementDeg === 'number' && op.indexIncrementDeg > 0)) {
        throw new Error('Flute indexIncrementDeg must be a positive number.');
      }
      const repeatUntil = op.repeatUntilDeg ?? 360;
      if (repeatUntil % op.indexIncrementDeg !== 0) {
        throw new Error('Flute repeatUntilDeg must be evenly divisible by indexIncrementDeg.');
      }
    }
    return;
  }

  throw new Error(`Unknown operation type: ${op.type}`);
}

/**
 * @param {Recipe} recipe
 * @param {string} bitId
 * @returns {Bit}
 */
export function resolveBit(recipe, bitId) {
  const bit = getBitById(recipe.bits, bitId);
  if (!bit) throw new Error(`No bit with id "${bitId}" in this recipe's bit list.`);
  return bit;
}

/** @param {Recipe} recipe @param {RecipeOperation} op @returns {Recipe} */
export function addOperation(recipe, op) {
  const next = { ...recipe, operations: [...recipe.operations, op] };
  validateRecipe(next);
  return next;
}

/** @param {Recipe} recipe @param {number} index @returns {Recipe} */
export function removeOperation(recipe, index) {
  assertIndexInRange(recipe.operations, index);
  const next = { ...recipe, operations: recipe.operations.filter((_, i) => i !== index) };
  return next;
}

/** @param {Recipe} recipe @param {number} index @param {Partial<RecipeOperation>} patch @returns {Recipe} */
export function updateOperation(recipe, index, patch) {
  assertIndexInRange(recipe.operations, index);
  const operations = recipe.operations.slice();
  operations[index] = { ...operations[index], ...patch };
  const next = { ...recipe, operations };
  validateRecipe(next);
  return next;
}

/** @param {Recipe} recipe @param {number} fromIndex @param {number} toIndex @returns {Recipe} */
export function moveOperation(recipe, fromIndex, toIndex) {
  assertIndexInRange(recipe.operations, fromIndex);
  assertIndexInRange(recipe.operations, toIndex);
  const operations = recipe.operations.slice();
  const [moved] = operations.splice(fromIndex, 1);
  operations.splice(toIndex, 0, moved);
  return { ...recipe, operations };
}

function assertIndexInRange(arr, index) {
  if (!(Number.isInteger(index) && index >= 0 && index < arr.length)) {
    throw new Error(`Operation index ${index} is out of range (0..${arr.length - 1}).`);
  }
}

/**
 * Expand an operation's indexed-repeat / multi-start shorthand into the
 * individual single-angle instances geometry.js's flute/spiral ops model.
 * Ring/taper ops pass through unchanged (a single instance).
 * @param {RecipeOperation} op
 * @returns {RecipeOperation[]}
 */
export function expandOperation(op) {
  if (op.type !== 'flute' && op.type !== 'spiral') return [op];

  let count = op.starts;
  if (count === undefined && op.type === 'flute' && op.indexIncrementDeg !== undefined) {
    count = (op.repeatUntilDeg ?? 360) / op.indexIncrementDeg;
  }
  if (!count || count <= 1) return [op];

  const step = 360 / count;
  const out = [];
  for (let i = 0; i < count; i++) {
    const { starts, indexIncrementDeg, repeatUntilDeg, ...rest } = op;
    out.push({ ...rest, startAngleDeg: op.startAngleDeg + step * i });
  }
  return out;
}

/**
 * Resolve a recipe (bit ids, indexed repeats/starts) into the plain
 * {basePoints, operations} shape geometry.js's radiusAt expects.
 * @param {Recipe} recipe
 * @returns {{basePoints: {x:number,r:number}[], operations: import('./geometry.js').Operation[]}}
 */
export function toGeometryRecipe(recipe) {
  const taperOp = recipe.operations.find((op) => op.type === 'taper');
  if (!taperOp) throw new Error('Recipe has no taper operation to define the baseline.');

  /** @type {import('./geometry.js').Operation[]} */
  const operations = [];
  for (const op of recipe.operations) {
    if (op.type === 'taper') continue;

    if (op.type === 'ring') {
      const bit = resolveBit(recipe, op.bitId);
      operations.push({ type: 'ring', kind: op.kind, atLength: op.atLength, r: bit.profile.r });
      continue;
    }

    if (op.type === 'ringGroove') {
      const bit = resolveBit(recipe, op.bitId);
      operations.push({
        type: 'ringGroove',
        profile: bit.profile,
        circularDistance: op.circularDistance,
        atLength: op.atLength,
      });
      continue;
    }

    for (const instance of expandOperation(op)) {
      const bit = resolveBit(recipe, instance.bitId);
      operations.push({
        type: instance.type,
        profile: bit.profile,
        circularDistance: instance.circularDistance,
        from: instance.from,
        to: instance.to,
        startAngleDeg: instance.startAngleDeg,
        ...(instance.type === 'spiral'
          ? { turnsPerTravel: instance.turnsPerTravel, direction: instance.direction }
          : {}),
      });
    }
  }

  return { basePoints: taperOp.points, operations };
}

function fmtIn(n) {
  return `${n.toFixed(2)}"`;
}
function fmtDeg(n) {
  return `${Number(n.toFixed(1))}°`;
}

/**
 * Plain-English, shop-floor recipe text for one operation.
 * @param {Recipe} recipe
 * @param {RecipeOperation} op
 * @returns {string}
 */
export function describeOperation(recipe, op) {
  if (op.type === 'taper') {
    const pts = op.points.map((p) => `${fmtIn(p.x)} @ ${fmtIn(p.r)} radius`).join(' -> ');
    return `Turn the taper, travel continuously: ${pts}.`;
  }

  const bit = resolveBit(recipe, op.bitId);
  const bitLabel = `Bit ${bit.tool} (${bit.name})`;

  if (op.type === 'ring') {
    const verb = op.kind === 'bead' ? 'plunge to add a bead' : 'plunge to cut a cove';
    return `${bitLabel}: position the carriage at ${fmtIn(op.atLength)} along the length, ${verb} to full depth, rotate one full turn.`;
  }

  if (op.type === 'ringGroove') {
    return `${bitLabel}: position the carriage at ${fmtIn(op.atLength)} along the length, plunge to circular distance ${fmtIn(op.circularDistance)}, rotate one full turn.`;
  }

  const count = op.starts ?? (op.type === 'flute' && op.indexIncrementDeg ? (op.repeatUntilDeg ?? 360) / op.indexIncrementDeg : 1);
  const repeatText = count > 1 ? ` Repeat at ${count} evenly-spaced start angle(s) (every ${fmtDeg(360 / count)}).` : '';

  if (op.type === 'flute') {
    return (
      `${bitLabel}: horizontal mount, set circular distance to ${fmtIn(op.circularDistance)}, ` +
      `start angle ${fmtDeg(op.startAngleDeg)}, travel from ${fmtIn(op.from)} to ${fmtIn(op.to)} along the length.` +
      repeatText
    );
  }

  // spiral
  const dir = op.direction === 'ccw' ? 'counter-clockwise' : 'clockwise';
  return (
    `${bitLabel}: horizontal mount, set circular distance to ${fmtIn(op.circularDistance)}, ` +
    `start angle ${fmtDeg(op.startAngleDeg)}, travel from ${fmtIn(op.from)} to ${fmtIn(op.to)} along the length, ` +
    `${op.turnsPerTravel.turns} turn(s) per ${op.turnsPerTravel.travel}" of travel, ${dir}.` +
    repeatText
  );
}

/**
 * The full plain-English recipe, one line per operation in order.
 * @param {Recipe} recipe
 * @returns {string}
 */
export function describeRecipe(recipe) {
  return recipe.operations.map((op, i) => `${i + 1}. ${describeOperation(recipe, op)}`).join('\n');
}

/** @param {Recipe} recipe @returns {string} */
export function toJSON(recipe) {
  validateRecipe(recipe);
  return JSON.stringify(recipe, null, 2);
}

/** @param {string} json @returns {Recipe} */
export function fromJSON(json) {
  const recipe = JSON.parse(json);
  validateRecipe(recipe);
  return recipe;
}

/**
 * Andrew's known 34.5" leg fixture (see CLAUDE.md, reference/leg-designer-
 * v1.html), expressed as a Recipe: taper baseline + ring features only —
 * ball lands on exactly 3.00" diameter, foot ball on exactly 1.50"
 * diameter, matching v1 and the Phase 1 geometry.js tests.
 * @returns {Recipe}
 */
export function legReferenceRecipe() {
  const bits = ['rb-1273', 'rb-1274', 'ball-7592', 'rb-1278'].map((id) => getBitById(BIT_LIBRARY, id));
  return createRecipe({
    stock: { totalLength: 34.5, squareSize: 3.5, squareEndX: 5.0 },
    bits,
    operations: [
      {
        type: 'taper',
        points: [
          { x: 5.0, r: 0.6 },
          { x: 8.3, r: 0.5 },
          { x: 11.3, r: 0.58 },
          { x: 24.8, r: 0.42 },
          { x: 27.6, r: 0.25 },
          { x: 29.5, r: 0.16 },
          { x: 34.5, r: 0.22 },
        ],
      },
      { type: 'ring', bitId: 'rb-1273', kind: 'bead', atLength: 5.3 },
      { type: 'ring', bitId: 'ball-7592', kind: 'bead', atLength: 8.3 }, // 3.00" dia ball
      { type: 'ring', bitId: 'rb-1273', kind: 'bead', atLength: 10.55 },
      { type: 'ring', bitId: 'rb-1274', kind: 'bead', atLength: 26.05 },
      { type: 'ring', bitId: 'rb-1278', kind: 'bead', atLength: 27.6 }, // 1.50" dia foot ball
    ],
  });
}

/**
 * A small flute/spiral example recipe (illustrative, not tied to a real
 * Andrew leg) demonstrating the operation types Phase 1's geometry.js
 * added beyond v1: an indexed flute (4 flutes, 90 deg apart) and a
 * 2-start spiral, both cut with real catalog core-box bits.
 * @returns {Recipe}
 */
export function fluteSpiralExampleRecipe() {
  const bits = ['cb2-805', 'cb2-802', 'vc-761'].map((id) => getBitById(BIT_LIBRARY, id));
  return createRecipe({
    stock: { totalLength: 20, squareSize: 2.0, squareEndX: 0 },
    bits,
    operations: [
      { type: 'taper', points: [{ x: 0, r: 1.0 }, { x: 20, r: 1.0 }] },
      // decorative V-groove ring, using circularDistance directly (per
      // Andrew's definition: the apex, the bit's reference point, reaches
      // exactly this radius)
      { type: 'ringGroove', bitId: 'vc-761', circularDistance: 0.85, atLength: 1 },
      {
        type: 'flute',
        bitId: 'cb2-805',
        circularDistance: 0.7,
        from: 2,
        to: 9,
        startAngleDeg: 0,
        indexIncrementDeg: 90,
        repeatUntilDeg: 360,
      },
      {
        type: 'spiral',
        bitId: 'cb2-802',
        circularDistance: 0.85,
        from: 11,
        to: 18,
        startAngleDeg: 0,
        turnsPerTravel: { turns: 1, travel: 4 },
        starts: 2,
        direction: 'cw',
      },
    ],
  });
}
