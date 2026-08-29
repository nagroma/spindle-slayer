// @ts-check
// Bits from bits/*.dxf — inches, half-profile, tip at (0,0).
// bits/Flute/*.dxf are side-mounted flute bits (bearing offset, no tip at origin).
// Display name is the filename without extension.

import { importDxfProfile, importDxfFluteProfile } from './dxf-profile.js';
import { validateBitProfile } from './profile.js';

/**
 * @typedef {import('./profile.js').BitProfile} BitProfile
 * @typedef {{id: string, name: string, tool: string, group: string, kind?: 'plunge' | 'flute', profile: BitProfile}} Bit
 * @typedef {import('./geometry.js').Model} Model
 */

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
