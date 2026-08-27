// @ts-check
// Bits from bits/*.dxf — inches, half-profile, tip at (0,0).
// Display name is the filename without extension.

import { importDxfProfile } from './dxf-profile.js';
import { validateBitProfile } from './bits.js';

/**
 * @typedef {import('./bits.js').Bit} Bit
 * @typedef {import('./geometry.js').Model} Model
 */

/** @returns {Bit[]} */
export function loadLibraryBits() {
  const modules = import.meta.glob('../bits/*.dxf', { query: '?raw', import: 'default', eager: true });
  const bits = [];
  for (const [path, text] of Object.entries(modules)) {
    const match = path.match(/([^/\\]+)\.dxf$/i);
    const name = match ? match[1] : path;
    const points = importDxfProfile(text, { dAxis: 'auto' });
    const profile = { type: 'points', points };
    validateBitProfile(profile);
    bits.push({
      id: name,
      name,
      tool: name,
      group: 'compound',
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
  const first = bits.find((b) => b.id === 'Magnate_7593') ?? bits[0];
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
