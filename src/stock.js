// @ts-check
// Prism starting stock: round, square, or hexagonal.
// size is diameter (round), side length (square), or across-flats (hex).
// radius(theta) is the polar envelope of that prism — bits only subtract from it.

/** @typedef {'round' | 'square' | 'hex'} StockType */
/**
 * @typedef {{
 *   type: StockType,
 *   length: number,
 *   size: number,
 * }} Stock
 */

export const STOCK_TYPES = /** @type {const} */ (['round', 'square', 'hex']);

/**
 * Polar radius of the uncut blank at a rotation angle.
 * Square/hex are aligned so a face is at 0° (shortest radius).
 * @param {Stock} stock
 * @param {number} thetaDeg
 * @returns {number} inches from the centerline
 */
export function stockRadius(stock, thetaDeg) {
  const { type, size } = stock;
  if (!(size > 0)) return 0;

  if (type === 'round') return size / 2;

  let t = thetaDeg % 360;
  if (t < 0) t += 360;
  const rad = (t * Math.PI) / 180;

  if (type === 'square') {
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    const m = Math.max(Math.abs(c), Math.abs(s));
    return m === 0 ? size / 2 : size / 2 / m;
  }

  // Regular hexagon, across-flats = size. Faces at 0°, 60°, ...
  const sector = Math.PI / 3;
  let a = Math.abs(rad) % sector;
  if (a > sector / 2) a = sector - a;
  return size / 2 / Math.cos(a);
}

/** Farthest corner/vertex from the centerline (for view framing). */
export function stockMaxRadius(stock) {
  if (stock.type === 'round') return stock.size / 2;
  if (stock.type === 'square') return (stock.size / 2) * Math.SQRT2;
  // hex across points = acrossFlats / cos(30°)
  return stock.size / 2 / Math.cos(Math.PI / 6);
}

/** Face (across-flats) radius — the side-view silhouette half-width. */
export function stockFaceRadius(stock) {
  return stock.size / 2;
}
