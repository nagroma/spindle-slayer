// @ts-check
// Bit profile library — seeded from docs/bit-catalog.md (Magnate's "Router
// Bits For Legacy Ornamental Milling Machinery" catalog). Bits travel with
// the saved recipe (see docs/mechanics-notes.md's JSON schema) — this
// module is the seed library plus lookup/custom-bit-creation logic, not a
// hardcoded app-wide list.
//
// Pure functions/data only — no DOM. The actual "add a custom bit" form is
// a later UI phase; this is the validation/construction logic it will call.

/**
 * @typedef {{type: 'round', r: number}} RoundProfile
 * @typedef {{type: 'v', angleDeg: number}} VProfile
 * @typedef {{type: 'flat', r: number}} FlatProfile
 *
 * A full 2D cross-section curve, for bits too complex for a single
 * radius/angle number (compound ogees, rope moldings, "Classic Spiral",
 * etc). `points` is an ordered polyline from the tip outward: `d` =
 * distance along the bit's own spindle axis from the tip, `r` = radius
 * from that axis at that point — sweeping this curve around the spindle
 * (the Z axis, in the bit's own frame) is literally the bit's 3D shape.
 * The first point must be the tip, `{d: 0, r: 0}` — that's the
 * circularDistance reference point for plunge-mounted use (see
 * mechanics-notes.md). Import one from a CAD sketch via
 * `scripts/import-bit-profile.js` rather than hand-authoring points.
 * @typedef {{type: 'points', points: {d: number, r: number}[]}} PointsProfile
 * @typedef {{type: 'flute', points: {d: number, r: number}[], bearingRadius: number}} FluteProfile
 *
 * @typedef {RoundProfile | VProfile | FlatProfile | PointsProfile | FluteProfile} BitProfile
 * @typedef {{id: string, name: string, tool: string, group: string, kind?: 'plunge' | 'flute', profile: BitProfile}} Bit
 */

export const BIT_GROUPS = /** @type {const} */ ({
  ROUNDOVER: 'roundover',
  BALL: 'ball',
  COVE: 'cove',
  COMPOUND: 'compound',
  TEMPLATE: 'template',
  FLUTE: 'flute', // round-nose, side-riding: core box / fluting & reeding extended shank
  VGROOVE: 'vgroove',
});

/**
 * Seed bit library — curated (not exhaustive) per docs/bit-catalog.md:
 * only bits whose catalog caption ties them to the Legacy Ornamental Mill,
 * a representative few sizes per group, no compound (two-radii) bits for
 * now. This is sample/example data, not a full owned-bits inventory —
 * that's a later refinement (see `createCustomBit` below).
 *
 * `profile.type === 'round'` bits use the same round-nose groove math
 * geometry.js already implements for rings and flutes/spirals
 * (`grooveDepthAt`/`ringDeltaAt`). `profile.type === 'v'` bits are not yet
 * wired into geometry.js (a follow-up once V-groove flute/spiral math is
 * needed) — they're captured here so the library and custom-bit form have
 * a real second shape to validate against.
 * @type {Bit[]}
 */
export const BIT_LIBRARY = [
  // -- Plunge Flat Roundover — astragal/bead transitions --
  { id: 'rb-1273', tool: '1273', name: 'Roundover 3/16"', group: BIT_GROUPS.ROUNDOVER, profile: { type: 'round', r: 0.1875 } },
  { id: 'rb-1274', tool: '1274', name: 'Roundover 1/4"', group: BIT_GROUPS.ROUNDOVER, profile: { type: 'round', r: 0.25 } },
  { id: 'rb-1278', tool: '1278', name: 'Roundover 1/2"', group: BIT_GROUPS.ROUNDOVER, profile: { type: 'round', r: 0.5 } },

  // -- Plunge Roundover with Radius — balls --
  { id: 'ball-7592', tool: '7592', name: 'Ball 2" dia', group: BIT_GROUPS.BALL, profile: { type: 'round', r: 1.0 } },
  { id: 'ball-7593', tool: '7593', name: 'Ball 3" dia', group: BIT_GROUPS.BALL, profile: { type: 'round', r: 1.5 } },

  // -- Double Bead Point Plunge — small decorative bead/ball --
  { id: 'db-3481', tool: '3481', name: 'Bead R 5/16"', group: BIT_GROUPS.BALL, profile: { type: 'round', r: 0.3125 } },
  { id: 'db-3482', tool: '3482', name: 'Bead R 5/8"', group: BIT_GROUPS.BALL, profile: { type: 'round', r: 0.625 } },

  // -- Pattern Extended Shank — template follower, no fixed profile --
  { id: 'tp-7621', tool: '7621', name: 'Pattern Extended Shank (template follower)', group: BIT_GROUPS.TEMPLATE, profile: { type: 'round', r: 0 } },

  // -- Core Box — round-nose, for indexed flutes/coves (side-riding) --
  { id: 'cb2-802', tool: '802', name: 'Core Box R 3/16"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 0.1875 } },
  { id: 'cb2-805', tool: '805', name: 'Core Box R 3/8"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 0.375 } },
  { id: 'cb2-808', tool: '808', name: 'Core Box R 1"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 1.0 } },

  // -- Fluting Extended Shank — round-nose, bearing-guided, full spindle length --
  { id: 'fl-6051', tool: '6051', name: 'Fluting Extended Shank R 1/8"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 0.125 } },
  { id: 'fl-6054', tool: '6054', name: 'Fluting Extended Shank R 3/16"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 0.1875 } },
  { id: 'fl-6058', tool: '6058', name: 'Fluting Extended Shank R 3/8"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 0.375 } },

  // -- Reeding Extended Shank — round-nose, 5" shank --
  { id: 're-7691', tool: '7691', name: 'Reeding Extended Shank R 3/16"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 0.1875 } },
  { id: 're-7697', tool: '7697', name: 'Reeding Extended Shank R 1/2"', group: BIT_GROUPS.FLUTE, profile: { type: 'round', r: 0.5 } },

  // -- Side V-Grooving — 90 deg, bearing-guided --
  { id: 'vg-771', tool: '771', name: 'Side V-Grooving 90deg', group: BIT_GROUPS.VGROOVE, profile: { type: 'v', angleDeg: 90 } },
  { id: 'vg-775', tool: '775', name: 'Side V-Grooving 90deg', group: BIT_GROUPS.VGROOVE, profile: { type: 'v', angleDeg: 90 } },

  // -- V-Grooving & Carving, 3-flute — sign lettering / decorative grooves --
  { id: 'vc-767', tool: '767', name: 'V-Grooving & Carving 45deg', group: BIT_GROUPS.VGROOVE, profile: { type: 'v', angleDeg: 45 } },
  { id: 'vc-761', tool: '761', name: 'V-Grooving & Carving 60deg', group: BIT_GROUPS.VGROOVE, profile: { type: 'v', angleDeg: 60 } },
  { id: 'vc-706', tool: '706', name: 'V-Grooving & Carving 90deg', group: BIT_GROUPS.VGROOVE, profile: { type: 'v', angleDeg: 90 } },
];

/**
 * @param {Bit[]} library
 * @param {string} id
 * @returns {Bit | undefined}
 */
export function getBitById(library, id) {
  return library.find((b) => b.id === id);
}

/**
 * @param {Bit[]} library
 * @param {string} group
 * @returns {Bit[]}
 */
export function listByGroup(library, group) {
  return library.filter((b) => b.group === group);
}

/**
 * Throws a descriptive Error if the profile shape is invalid. Used by
 * createCustomBit and (later) the custom-bit form's live validation.
 * @param {BitProfile} profile
 */
export function validateBitProfile(profile) {
  if (!profile || typeof profile !== 'object') {
    throw new Error('Bit profile is required.');
  }
  if (profile.type === 'round') {
    if (!(typeof profile.r === 'number' && profile.r >= 0 && Number.isFinite(profile.r))) {
      throw new Error('Round bit profile needs a radius (r) that is a non-negative number.');
    }
    return;
  }
  if (profile.type === 'v') {
    if (!(typeof profile.angleDeg === 'number' && profile.angleDeg > 0 && profile.angleDeg < 180)) {
      throw new Error('V bit profile needs an included angle (angleDeg) between 0 and 180.');
    }
    return;
  }
  if (profile.type === 'flat') {
    if (!(typeof profile.r === 'number' && profile.r > 0 && Number.isFinite(profile.r))) {
      throw new Error('Flat bit profile needs a radius (r) that is a positive number.');
    }
    return;
  }
  if (profile.type === 'points') {
    const pts = profile.points;
    if (!(Array.isArray(pts) && pts.length >= 2)) {
      throw new Error('Points profile needs an array of at least two {d, r} points.');
    }
    for (const p of pts) {
      if (!(typeof p.d === 'number' && typeof p.r === 'number' && p.r >= 0)) {
        throw new Error('Every profile point needs numeric d and a non-negative r.');
      }
    }
    if (pts[0].d !== 0 || pts[0].r !== 0) {
      throw new Error('Points profile must start at the tip, {d: 0, r: 0} — that\'s the circularDistance reference point.');
    }
    return;
  }
  if (profile.type === 'flute') {
    const pts = profile.points;
    if (!(Array.isArray(pts) && pts.length >= 2)) {
      throw new Error('Flute profile needs an array of at least two {d, r} points.');
    }
    for (const p of pts) {
      if (!(typeof p.d === 'number' && typeof p.r === 'number' && p.d >= 0 && p.r >= 0)) {
        throw new Error('Every flute profile point needs non-negative numeric d and r.');
      }
    }
    if (!(typeof profile.bearingRadius === 'number' && profile.bearingRadius >= 0 && Number.isFinite(profile.bearingRadius))) {
      throw new Error('Flute profile needs a non-negative bearingRadius.');
    }
    return;
  }
  throw new Error(`Unknown bit profile type: ${profile.type}`);
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Construct and validate a custom (non-catalog) bit. Andrew's daughter
 * defines these for bits not in docs/bit-catalog.md; they travel with the
 * saved recipe (see mechanics-notes.md schema's `bits` array), not a
 * hardcoded app list.
 * @param {{name: string, tool?: string, group?: string, profile: BitProfile}} fields
 * @param {Bit[]} [existingLibrary] checked for id collisions
 * @returns {Bit}
 */
export function createCustomBit(fields, existingLibrary = []) {
  if (!fields || typeof fields.name !== 'string' || fields.name.trim() === '') {
    throw new Error('Custom bit needs a name.');
  }
  validateBitProfile(fields.profile);

  const tool = fields.tool && fields.tool.trim() !== '' ? fields.tool.trim() : 'custom';
  const group = fields.group || (fields.profile.type === 'v' ? BIT_GROUPS.VGROOVE : BIT_GROUPS.FLUTE);

  let id = `custom-${slugify(fields.name)}`;
  let n = 2;
  const taken = new Set(existingLibrary.map((b) => b.id));
  while (taken.has(id)) {
    id = `custom-${slugify(fields.name)}-${n}`;
    n += 1;
  }

  return { id, name: fields.name.trim(), tool, group, profile: fields.profile };
}
