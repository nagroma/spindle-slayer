// @ts-check
// Bits from bits/*.dxf — inches, half-profile, tip at (0,0).
// bits/Flute/*.dxf are side-mounted flute bits (bearing offset, no tip at origin).
// Display name is the filename without extension.

import { importDxfProfile, importDxfFluteProfile } from './dxf-profile.js';
import { validateBitProfile } from './profile.js';

/**
 * @typedef {import('./profile.js').BitProfile} BitProfile
 * @typedef {{id: string, name: string, tool: string, group: string, kind?: 'plunge' | 'flute', profile: BitProfile, user?: boolean}} Bit
 * @typedef {import('./geometry.js').Model} Model
 */

/** Reject spindle-length overlays masquerading as bits. */
export const MAX_USER_BIT_IN = 8;

/**
 * @param {string} filename
 * @returns {string}
 */
export function bitIdFromFilename(filename) {
  let name = String(filename ?? '').split(/[/\\]/).pop() ?? '';
  name = name.replace(/\.dxf$/i, '').trim();
  name = name.replace(/[?%*:|"<>]/g, '-');
  return name || 'bit';
}

/**
 * @param {string} desired
 * @param {Iterable<string>} existingIds
 */
export function uniqueBitId(desired, existingIds) {
  const ids = existingIds instanceof Set ? existingIds : new Set(existingIds);
  const base = desired || 'bit';
  if (!ids.has(base)) return base;
  let n = 2;
  while (ids.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

/** @param {BitProfile} profile */
function profileTooBig(profile) {
  const pts = 'points' in profile ? profile.points : null;
  if (!Array.isArray(pts)) return false;
  let m = 0;
  for (const p of pts) {
    m = Math.max(m, Math.abs(p.d), Math.abs(p.r));
  }
  return m > MAX_USER_BIT_IN;
}

/**
 * Parse a DXF into a user bit (plunge first, then flute). Does not add it to the library.
 * @param {string} filename
 * @param {string} text
 * @param {{ existingIds?: Iterable<string>, replaceId?: string }} [opts]
 * @returns {Bit}
 */
export function bitFromDxf(filename, text, opts = {}) {
  const desired = bitIdFromFilename(filename);
  const existing = opts.existingIds ?? [];
  const id = opts.replaceId || uniqueBitId(desired, existing);
  const tooBigMsg =
    'That DXF is larger than a router bit (over 8 in). For a spindle outline use Overlay DXF.';

  try {
    const points = importDxfProfile(text, { dAxis: 'auto' });
    const profile = { type: /** @type {const} */ ('points'), points };
    validateBitProfile(profile);
    if (profileTooBig(profile)) throw new Error(tooBigMsg);
    return {
      id,
      name: id,
      tool: id,
      group: 'compound',
      kind: 'plunge',
      profile,
      user: true,
    };
  } catch (plungeErr) {
    try {
      const profile = importDxfFluteProfile(text);
      validateBitProfile(profile);
      if (profileTooBig(profile)) throw new Error(tooBigMsg);
      return {
        id,
        name: id,
        tool: id,
        group: 'flute',
        kind: 'flute',
        profile,
        user: true,
      };
    } catch (fluteErr) {
      if (fluteErr instanceof Error && fluteErr.message === tooBigMsg) throw fluteErr;
      const msg = plungeErr instanceof Error ? plungeErr.message : 'Could not read that DXF as a bit.';
      throw new Error(msg);
    }
  }
}

/**
 * Shipped bits first; skip user ids that collide with shipped names.
 * @param {Bit[]} shipped
 * @param {Bit[]} userBits
 * @returns {Bit[]}
 */
export function mergeUserBits(shipped, userBits) {
  const ids = new Set(shipped.map((b) => b.id));
  /** @type {Bit[]} */
  const extra = [];
  for (const b of userBits) {
    if (!b?.id || ids.has(b.id)) continue;
    ids.add(b.id);
    extra.push({ ...b, user: true });
  }
  return [...shipped.map((b) => ({ ...b, user: false })), ...extra].sort((a, b) =>
    a.name.localeCompare(b.name)
  );
}

function isFlutePath(path) {
  return /[/\\]Flute[/\\]/i.test(path);
}

/** @returns {Bit[]} */
export function loadLibraryBits() {
  const modules = import.meta.glob('../bits/**/*.dxf', { query: '?raw', import: 'default', eager: true });
  const bits = [];
  for (const [path, text] of Object.entries(modules)) {
    const match = path.match(/([^/\\]+)\.dxf$/i);
    const name = match ? match[1] : path;
    if (isFlutePath(path)) {
      const profile = importDxfFluteProfile(text);
      validateBitProfile(profile);
      bits.push({
        id: name,
        name,
        tool: name,
        group: 'flute',
        kind: 'flute',
        profile,
      });
      continue;
    }
    const points = importDxfProfile(text, { dAxis: 'auto' });
    const profile = { type: 'points', points };
    validateBitProfile(profile);
    bits.push({
      id: name,
      name,
      tool: name,
      group: 'compound',
      kind: 'plunge',
      profile,
    });
  }
  bits.sort((a, b) => a.name.localeCompare(b.name));
  return bits;
}

/**
 * @returns {{ model: Model, bits: Bit[] }}
 */
export function defaultDemo() {
  const bits = loadLibraryBits();
  const first = bits.find((b) => b.id === 'Magnate_7593') ?? bits.find((b) => b.kind !== 'flute') ?? bits[0];
  /** @type {import('./geometry.js').Placement[]} */
  const placements = [];
  if (first) {
    placements.push({
      id: 'p1',
      bitId: first.id,
      profile: first.profile,
      atLength: 4,
      circularDistance: 1.5,
    });
  }
  return {
    bits,
    model: {
      stock: { type: 'square', length: 34, size: 3.5 },
      placements,
    },
  };
}
