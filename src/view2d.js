// @ts-check
// Unrolled length x angle view: x (length along the workpiece) across,
// theta (rotation angle, 0-360deg) around, shaded by cut depth. A flute
// shows up as a vertical stripe; a spiral as a diagonal band; a ring shows
// as a full-width horizontal band (it's theta-independent).
//
// `computeUnrolledGrid` is plain data (framework-free, unit-testable).
// `renderUnrolledSVG` builds an SVG *string* (works identically in Node
// and the browser — no canvas/DOM dependency), for view2d to stay simple
// to test the same way as everything else in this codebase.

import { radiusAt, baselineAt } from './geometry.js';

/**
 * @param {import('./geometry.js').Recipe} geometryRecipe
 * @param {{xMin: number, xMax: number, xSamples?: number, thetaSamples?: number}} opts
 * @returns {{xs: number[], thetas: number[], depths: number[][]}} depths[i][j] = cut depth at (xs[i], thetas[j]), >= 0
 */
export function computeUnrolledGrid(geometryRecipe, { xMin, xMax, xSamples = 150, thetaSamples = 48 }) {
  const xs = [];
  for (let i = 0; i <= xSamples; i++) xs.push(xMin + ((xMax - xMin) * i) / xSamples);
  const thetas = [];
  for (let j = 0; j < thetaSamples; j++) thetas.push((360 * j) / thetaSamples);

  const depths = xs.map((x) => {
    const base = baselineAt(geometryRecipe.basePoints, x);
    return thetas.map((theta) => Math.max(0, base - radiusAt(geometryRecipe, x, theta)));
  });

  return { xs, thetas, depths };
}

const UNCUT_COLOR = [0xe8, 0xca, 0xa0]; // light oak
const DEEP_COLOR = [0x4a, 0x2f, 0x1a]; // dark walnut

function depthColor(depth, maxDepth) {
  const t = maxDepth > 0 ? Math.min(1, depth / maxDepth) : 0;
  const [r, g, b] = UNCUT_COLOR.map((c, i) => Math.round(c + (DEEP_COLOR[i] - c) * t));
  return `rgb(${r},${g},${b})`;
}

/**
 * @param {import('./geometry.js').Recipe} geometryRecipe
 * @param {{xMin: number, xMax: number, xSamples?: number, thetaSamples?: number, width?: number, height?: number}} opts
 * @returns {string} an SVG document string
 */
export function renderUnrolledSVG(geometryRecipe, opts) {
  const { xMin, xMax, xSamples = 150, thetaSamples = 48, width = 880, height = 360 } = opts;
  const { xs, thetas, depths } = computeUnrolledGrid(geometryRecipe, { xMin, xMax, xSamples, thetaSamples });

  let maxDepth = 0;
  for (const row of depths) for (const d of row) if (d > maxDepth) maxDepth = d;

  const cellW = width / xs.length;
  const cellH = height / thetas.length;

  const rects = [];
  for (let i = 0; i < xs.length; i++) {
    for (let j = 0; j < thetas.length; j++) {
      const depth = depths[i][j];
      const fill = depthColor(depth, maxDepth);
      const x = (i * cellW).toFixed(2);
      const y = (j * cellH).toFixed(2);
      rects.push(
        `<rect x="${x}" y="${y}" width="${(cellW + 0.6).toFixed(2)}" height="${(cellH + 0.6).toFixed(2)}" ` +
          `fill="${fill}" data-x="${xs[i].toFixed(3)}" data-theta="${thetas[j].toFixed(1)}" data-depth="${depth.toFixed(4)}" />`
      );
    }
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" ` +
    `font-family="monospace" font-size="11">` +
    `<rect x="0" y="0" width="${width}" height="${height}" fill="rgb(${UNCUT_COLOR.join(',')})" />` +
    rects.join('') +
    `</svg>`
  );
}
