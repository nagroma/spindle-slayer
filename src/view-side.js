// @ts-check
// Side view: length down, radius from the centerline left/right.
// Remaining wood is the revolved envelope: everything outside
// min(stock, bit envelopes) is gone, including out to the blank's face
// when a bit is plunged inside the stock. Camera (viewBox) is owned by the app.

import { faceRadiusAt, sampleStations, isRun, isCutHidden, bakeCutRadii, isFlute } from './geometry.js';
import { stockFaceRadius } from './stock.js';
import { profilePoints, profileMaxDepth, profileMaxRadius, fluteOuterRadius, fluteBearingRadius, fluteBitCenterRadius, isFluteProfile } from './profile.js';

/**
 * @typedef {import('./geometry.js').Model} Model
 * @typedef {import('./geometry.js').Placement} Placement
 * @typedef {{ xMin: number, yMin: number, width: number, height: number }} ViewBox
 */

export const SIDE_MARGIN_PX = 5;

/**
 * @param {Model} model
 * @param {number} pixelW
 * @param {number} pixelH
 * @returns {ViewBox}
 */
export function defaultViewBox(model, pixelW, pixelH) {
  return viewBoxFitBlank(model, pixelW, pixelH);
}

/**
 * Left and top of the stock, plus bits that stick out to the right.
 * @param {Model} model
 */
export function sideContentBounds(model) {
  const face = stockFaceRadius(model.stock);
  let xMin = -face;
  let xMax = face;
  for (const p of model.placements) {
    if (isCutHidden(p)) continue;
    if (isFlute(p)) {
      const flute = /** @type {import('./profile.js').FluteProfile} */ (p.profile);
      const stick = fluteBearingRadius(flute) + fluteOuterRadius(flute);
      xMax = Math.max(xMax, p.circularDistance + stick);
      if (isRun(p) && p.endCircularDistance != null) {
        xMax = Math.max(xMax, p.endCircularDistance + stick);
      }
      continue;
    }
    const depth = profileMaxDepth(p.profile);
    xMax = Math.max(xMax, p.circularDistance + depth);
    if (isRun(p) && p.endCircularDistance != null) {
      xMax = Math.max(xMax, p.endCircularDistance + depth);
    }
  }
  return { xMin, xMax, yMin: 0, yMax: model.stock.length };
}

/**
 * Whole blank, top and left justified with a small pixel margin.
 * Extra width goes to the right so zooming out does not add empty space on the left.
 * @param {Model} model
 * @param {number} pixelW
 * @param {number} pixelH
 * @returns {ViewBox}
 */
export function viewBoxFitBlank(model, pixelW, pixelH) {
  const pw = Math.max(1, pixelW);
  const ph = Math.max(1, pixelH);
  const pad = SIDE_MARGIN_PX;
  const usable = Math.max(1, ph - pad);
  const height = model.stock.length * (ph / usable);
  const yMin = -pad * (height / ph);
  const width = height * (pw / ph);
  const bounds = sideContentBounds(model);
  const xMin = bounds.xMin - pad * (width / pw);
  return { xMin, yMin, width, height };
}

/**
 * Keep the left of the stock pinned unless the drawing is wider than the pane.
 * @param {ViewBox} vb
 * @param {Model} model
 * @param {number} pixelW
 * @param {number} pixelH
 * @returns {ViewBox}
 */
export function pinViewBoxLeft(vb, model, pixelW, pixelH) {
  const pw = Math.max(1, pixelW);
  const margin = SIDE_MARGIN_PX * (vb.width / pw);
  const bounds = sideContentBounds(model);
  const left = bounds.xMin - margin;
  const right = bounds.xMax + margin;
  const span = right - left;
  let xMin = left;
  if (span > vb.width) {
    const minX = left;
    const maxX = right - vb.width;
    xMin = Math.min(maxX, Math.max(minX, vb.xMin));
  }
  return { xMin, yMin: vb.yMin, width: vb.width, height: vb.height };
}

/**
 * Close-up of one cut so the remaining outline and bit profile can be compared.
 * @param {Model} model
 * @param {Placement} p
 * @param {number} pixelW
 * @param {number} pixelH
 * @returns {ViewBox}
 */
export function viewBoxAroundPlacement(model, p, pixelW, pixelH) {
  const face = stockFaceRadius(model.stock);
  const maxR = Math.max(profileMaxRadius(p.profile), 0.6);
  const maxD = profileMaxDepth(p.profile);
  const h = Math.max(maxR * 2.6, 2.4);
  const aspect = pixelW > 0 && pixelH > 0 ? pixelW / pixelH : 0.7;
  const xMinWant = -face - 0.3;
  const flute = isFlute(p) ? /** @type {import('./profile.js').FluteProfile} */ (p.profile) : null;
  const xMaxWant = flute
    ? Math.max(face, fluteBitCenterRadius(p.circularDistance, flute) + fluteOuterRadius(flute)) + 0.4
    : Math.max(face, p.circularDistance + maxD) + 0.4;
  const contentW = xMaxWant - xMinWant;
  const width = Math.max(h * aspect, contentW);
  return {
    xMin: xMinWant - (width - contentW) * 0.1,
    yMin: p.atLength - h / 2,
    width,
    height: h,
  };
}

/**
 * @param {import('./stock.js').Stock} stock
 */
export function stockSilhouettePath(stock) {
  const face = stockFaceRadius(stock);
  return `M ${-face} 0 L ${face} 0 L ${face} ${stock.length} L ${-face} ${stock.length} Z`;
}

/**
 * @param {Placement} p
 * @param {{ mirror?: boolean }} [opts]
 * @returns {string} SVG path in (radius, length) inches
 */
export function bitProfilePath(p, opts = {}) {
  if (isFlute(p)) return fluteCirclesPath(p, p.circularDistance, p.atLength);
  const pts = profilePoints(p.profile);
  if (pts.length < 2) return '';
  const sgn = opts.mirror ? -1 : 1;
  const right = pts.map((pt) => ({
    x: sgn * (p.circularDistance + pt.d),
    y: p.atLength + pt.r,
  }));
  const left = pts.map((pt) => ({
    x: sgn * (p.circularDistance + pt.d),
    y: p.atLength - pt.r,
  }));
  const d = [];
  d.push(`M ${right[0].x} ${right[0].y}`);
  for (let i = 1; i < right.length; i++) d.push(`L ${right[i].x} ${right[i].y}`);
  for (let i = left.length - 1; i >= 0; i--) d.push(`L ${left[i].x} ${left[i].y}`);
  d.push('Z');
  return d.join(' ');
}

/**
 * Bit solid at the run's end pose (same shape, different length/diameter).
 * @param {Placement} p
 * @param {{ mirror?: boolean }} [opts]
 */
export function bitEndProfilePath(p, opts = {}) {
  if (!isRun(p)) return '';
  return bitProfilePath(
    {
      ...p,
      atLength: /** @type {number} */ (p.endAtLength),
      circularDistance: /** @type {number} */ (p.endCircularDistance),
    },
    opts
  );
}

/**
 * Transparent sweep of the bit solid from start pose to end pose.
 * @param {Placement} p
 * @param {{ mirror?: boolean }} [opts]
 */
export function bitSmearPath(p, opts = {}) {
  if (!isRun(p)) return '';
  if (isFlute(p)) {
    const flute = /** @type {import('./profile.js').FluteProfile} */ (p.profile);
    const R = fluteOuterRadius(flute);
    const x0 = fluteBitCenterRadius(p.circularDistance, flute);
    const x1 = fluteBitCenterRadius(/** @type {number} */ (p.endCircularDistance), flute);
    return stadiumPath(x0, p.atLength, x1, /** @type {number} */ (p.endAtLength), R);
  }
  const pts = profilePoints(p.profile);
  if (pts.length < 2) return '';
  const sgn = opts.mirror ? -1 : 1;
  const start = closedBitPoints(p, sgn);
  const end = closedBitPoints(
    {
      ...p,
      atLength: /** @type {number} */ (p.endAtLength),
      circularDistance: /** @type {number} */ (p.endCircularDistance),
    },
    sgn
  );
  const d = [`M ${start[0].x} ${start[0].y}`];
  for (let i = 1; i < start.length; i++) d.push(`L ${start[i].x} ${start[i].y}`);
  for (let i = end.length - 1; i >= 0; i--) d.push(`L ${end[i].x} ${end[i].y}`);
  d.push('Z');
  return d.join(' ');
}

/**
 * @param {Placement} p
 * @param {number} sgn
 * @returns {{ x: number, y: number }[]}
 */
function closedBitPoints(p, sgn) {
  const pts = profilePoints(p.profile);
  const right = pts.map((pt) => ({
    x: sgn * (p.circularDistance + pt.d),
    y: p.atLength + pt.r,
  }));
  const left = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    left.push({
      x: sgn * (p.circularDistance + pts[i].d),
      y: p.atLength - pts[i].r,
    });
  }
  return right.concat(left);
}

/**
 * Two concentric circles on the bit axis: inner = bearing, outer = cutter OD.
 * Diameter-at-bearing is the wood the bearing rides; the axis sits `bearingRadius` outside that.
 * @param {Placement} p
 * @param {number} cd
 * @param {number} at
 */
function fluteCirclesPath(p, cd, at) {
  const flute = /** @type {import('./profile.js').FluteProfile} */ (p.profile);
  const outer = fluteOuterRadius(flute);
  const inner = fluteBearingRadius(flute);
  const cx = fluteBitCenterRadius(cd, flute);
  return circlePath(cx, at, outer) + ' ' + circlePath(cx, at, Math.min(inner, outer * 0.95));
}

/** @param {number} cx @param {number} cy @param {number} r */
function circlePath(cx, cy, r) {
  if (!(r > 0)) return '';
  return `M ${cx + r} ${cy} A ${r} ${r} 0 1 0 ${cx - r} ${cy} A ${r} ${r} 0 1 0 ${cx + r} ${cy}`;
}

/**
 * Convex hull of two equal-radius circles (run smear).
 * @param {number} x0
 * @param {number} y0
 * @param {number} x1
 * @param {number} y1
 * @param {number} r
 */
function stadiumPath(x0, y0, x1, y1, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return circlePath(x0, y0, r);
  const nx = (-dy / len) * r;
  const ny = (dx / len) * r;
  return (
    `M ${x0 + nx} ${y0 + ny} L ${x1 + nx} ${y1 + ny} ` +
    `A ${r} ${r} 0 0 1 ${x1 - nx} ${y1 - ny} L ${x0 - nx} ${y0 - ny} ` +
    `A ${r} ${r} 0 0 1 ${x0 + nx} ${y0 + ny} Z`
  );
}

/**
 * Tiny profile glyph for the bit palette.
 * @param {import('./profile.js').BitProfile} profile
 * @param {{ size?: number }} [opts]
 */
export function bitIconSVG(profile, opts = {}) {
  const size = opts.size ?? 44;
  if (isFluteProfile(profile)) {
    const flute = /** @type {import('./profile.js').FluteProfile} */ (profile);
    const outer = Math.max(fluteOuterRadius(flute), 0.05);
    const inner = Math.max(Math.min(fluteBearingRadius(flute), outer * 0.95), 0.02);
    const pad = outer * 0.18;
    const s = 2 * (outer + pad);
    return (
      `<svg class="bit-icon flute" viewBox="${-outer - pad} ${-outer - pad} ${s} ${s}" ` +
      `width="${size}" height="${size}" aria-hidden="true">` +
      `<circle cx="0" cy="0" r="${outer}" />` +
      `<circle class="bearing" cx="0" cy="0" r="${inner}" fill="none" />` +
      `</svg>`
    );
  }
  const pts = profilePoints(profile);
  if (pts.length < 2) return '';
  const maxD = Math.max(...pts.map((p) => p.d), 0.05);
  const maxR = Math.max(...pts.map((p) => p.r), 0.05);
  let d = `M 0 0`;
  for (const p of pts) d += ` L ${p.d} ${p.r}`;
  for (let i = pts.length - 1; i >= 0; i--) d += ` L ${pts[i].d} ${-pts[i].r}`;
  d += ' Z';
  const pad = Math.max(maxD, maxR) * 0.12;
  return (
    `<svg class="bit-icon" viewBox="${-pad} ${-maxR - pad} ${maxD + 2 * pad} ${2 * (maxR + pad)}" ` +
    `width="${size}" height="${size}" aria-hidden="true">` +
    `<path d="${d}" />` +
    `</svg>`
  );
}

/**
 * Sampled remaining envelope after a full revolution. This is the 2D fill:
 * wood from the centerline out to min(face, bit envelopes). A deep plunge
 * therefore cuts all the way to the original outside edge, not a buried hole.
 * @param {Model} model
 */
export function remainingSilhouettePath(model) {
  const xs = sampleStations(model);
  if (!xs.length) return '';
  const cuts = bakeCutRadii(model, xs);
  const rs = xs.map((x, i) => faceRadiusAt(model, x, cuts[i]));
  const outline = remainingOutline(xs, rs);
  const right = outline.map((p) => `${p.r} ${p.x}`);
  const left = [...outline].reverse().map((p) => `${-p.r} ${p.x}`);
  return `M ${right[0]} L ${right.slice(1).join(' L ')} L ${left.join(' L ')} Z`;
}

/**
 * Square a near-vertical remaining wall (endmill shoulder) so the outline
 * does not draw a visible diagonal between "still cutting" and "past the bit".
 * Gentle ball blends stay as sampled.
 * @param {number[]} xs
 * @param {number[]} rs
 */
function remainingOutline(xs, rs) {
  /** @type {{ r: number, x: number }[]} */
  const pts = [{ r: rs[0], x: xs[0] }];
  for (let i = 1; i < xs.length; i++) {
    const dx = xs[i] - xs[i - 1];
    const dr = rs[i] - rs[i - 1];
    if (dx > 1e-12 && Math.abs(dr) > 0.02 && Math.abs(dr) / dx > 40) {
      pts.push({ r: rs[i], x: xs[i - 1] });
    }
    pts.push({ r: rs[i], x: xs[i] });
  }
  return pts;
}

/**
 * Split a half-profile where the DXF left a gap so we do not draw a chord across it.
 * @param {{ d: number, r: number }[]} points
 * @param {number} [maxJoin]
 */
export function overlayConnectedRuns(points, maxJoin = 0.25) {
  if (!points || points.length < 2) return [];
  /** @type {{ d: number, r: number }[][]} */
  const runs = [];
  /** @type {{ d: number, r: number }[]} */
  let run = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const step = Math.hypot(points[i].d - points[i - 1].d, points[i].r - points[i - 1].r);
    if (step > maxJoin) {
      if (run.length >= 2) runs.push(run);
      run = [points[i]];
    } else {
      run.push(points[i]);
    }
  }
  if (run.length >= 2) runs.push(run);
  return runs;
}

/**
 * Closed target silhouette from a traced half-profile (d along blank, r from axis).
 * @param {{ d: number, r: number }[]} points
 */
export function overlaySilhouettePath(points) {
  const runs = overlayConnectedRuns(points);
  return runs
    .map((run) => {
      const right = run.map((p) => `${p.r} ${p.d}`);
      const left = [...run].reverse().map((p) => `${-p.r} ${p.d}`);
      return `M ${right.join(' L ')} L ${left.join(' L ')} Z`;
    })
    .join(' ');
}

/**
 * Left and right target outlines (no fill) so the edge stays visible over remaining wood.
 * @param {{ d: number, r: number }[]} points
 */
export function overlayOutlinePath(points) {
  const runs = overlayConnectedRuns(points);
  return runs
    .map((run) => {
      const right = run.map((p) => `${p.r} ${p.d}`).join(' L ');
      const left = [...run].reverse().map((p) => `${-p.r} ${p.d}`).join(' L ');
      return `M ${right} M ${left}`;
    })
    .join(' ');
}

/**
 * @param {Model} model
 * @param {{ selectedId?: string | null, width?: number, height?: number, viewBox?: ViewBox, overlay?: { points: { d: number, r: number }[], opacity?: number } | null }} [opts]
 */
export function renderSideSVG(model, opts = {}) {
  const { selectedId = null, width = 420, height = 720 } = opts;
  const { stock } = model;
  const vb = opts.viewBox ?? defaultViewBox(model, width, height);
  const stockPath = stockSilhouettePath(stock);
  const overlay = opts.overlay?.points?.length >= 2 ? opts.overlay : null;
  const op = overlay ? Math.max(0, Math.min(1, (overlay.opacity ?? 55) / 100)) : 0;
  const overlayFill =
    overlay && op > 0
      ? `<g class="overlay" opacity="${op}" pointer-events="none"><path class="overlay-fill" d="${overlaySilhouettePath(overlay.points)}" /></g>`
      : '';
  const overlayEdge =
    overlay && op > 0
      ? `<g class="overlay-edge" opacity="${op}" pointer-events="none"><path class="overlay-line" d="${overlayOutlinePath(overlay.points)}" /></g>`
      : '';

  const bits = model.placements
    .filter((p) => !isCutHidden(p))
    .map((p) => {
      const sel = p.id === selectedId;
      const flute = isFlute(p) ? /** @type {import('./profile.js').FluteProfile} */ (p.profile) : null;
      const fluteCls = flute ? ' flute' : '';
      const tipR = flute
        ? Math.max(0.05, fluteBearingRadius(flute) * 0.15)
        : Math.max(0.04, Math.min(profileMaxRadius(p.profile), profileMaxDepth(p.profile)) * 0.06);
      const tipX = flute ? fluteBitCenterRadius(p.circularDistance, flute) : p.circularDistance;
      const smear = bitSmearPath(p);
      const endPath = bitEndProfilePath(p);
      const endBit = endPath
        ? `<path class="bit-end${fluteCls}${sel ? ' selected' : ''}" data-placement="${p.id}" data-end="true" ${flute ? 'fill-rule="evenodd" ' : ''}d="${endPath}" />`
        : '';
      const endTipX =
        flute && p.endCircularDistance != null
          ? fluteBitCenterRadius(p.endCircularDistance, flute)
          : p.endCircularDistance;
      const endTip = isRun(p)
        ? `<circle class="bit-tip-end${sel ? ' selected' : ''}" data-placement="${p.id}" data-end="true" ` +
          `cx="${endTipX}" cy="${p.endAtLength}" r="${Math.max(0.06, tipR)}" />`
        : '';
      return (
        (smear ? `<path class="bit-smear${fluteCls}${sel ? ' selected' : ''}" data-placement="${p.id}" d="${smear}" />` : '') +
        `<path class="bit${fluteCls}${sel ? ' selected' : ''}" data-placement="${p.id}" ` +
        `${flute ? 'fill-rule="evenodd" ' : ''}d="${bitProfilePath(p)}" />` +
        `<circle class="bit-tip${sel ? ' selected' : ''}" data-placement="${p.id}" ` +
        `cx="${tipX}" cy="${p.atLength}" r="${Math.max(0.05, tipR)}" />` +
        endBit +
        endTip
      );
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.xMin} ${vb.yMin} ${vb.width} ${vb.height}" ` +
    `width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet">` +
    `<rect class="bg" x="${vb.xMin}" y="${vb.yMin}" width="${vb.width}" height="${vb.height}" />` +
    `<path class="stock-ghost" d="${stockPath}" />` +
    overlayFill +
    `<path class="remaining" d="${remainingSilhouettePath(model)}" />` +
    overlayEdge +
    `<line class="centerline" x1="0" y1="0" x2="0" y2="${stock.length}" />` +
    bits +
    `</svg>`
  );
}

/**
 * @param {SVGSVGElement} svg
 * @param {number} clientX
 * @param {number} clientY
 * @returns {{radius: number, length: number} | null}
 */
export function clientToSideInches(svg, clientX, clientY) {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const p = pt.matrixTransform(ctm.inverse());
  return { radius: p.x, length: p.y };
}

/**
 * @param {SVGSVGElement} svg
 * @param {Model} model
 * @param {string | null} selectedId
 * @param {ViewBox} viewBox
 */
export function patchSideSVG(svg, model, selectedId, viewBox) {
  svg.setAttribute('viewBox', `${viewBox.xMin} ${viewBox.yMin} ${viewBox.width} ${viewBox.height}`);
  const bg = svg.querySelector('.bg');
  if (bg) {
    bg.setAttribute('x', String(viewBox.xMin));
    bg.setAttribute('y', String(viewBox.yMin));
    bg.setAttribute('width', String(viewBox.width));
    bg.setAttribute('height', String(viewBox.height));
  }

  const stockPath = stockSilhouettePath(model.stock);
  const remaining = svg.querySelector('.remaining');
  if (remaining) remaining.setAttribute('d', remainingSilhouettePath(model));
  const ghost = svg.querySelector('.stock-ghost');
  if (ghost) ghost.setAttribute('d', stockPath);

  for (const p of model.placements) {
    if (isCutHidden(p)) continue;
    const d = bitProfilePath(p);
    const smear = bitSmearPath(p);
    const path = svg.querySelector(`path.bit[data-placement="${p.id}"]`);
    const tip = svg.querySelector(`circle.bit-tip[data-placement="${p.id}"]`);
    const smearPath = svg.querySelector(`path.bit-smear[data-placement="${p.id}"]`);
    const endPath = svg.querySelector(`path.bit-end[data-placement="${p.id}"]`);
    const endTip = svg.querySelector(`circle.bit-tip-end[data-placement="${p.id}"]`);
    if (path) {
      path.setAttribute('d', d);
      path.classList.toggle('selected', p.id === selectedId);
    }
    if (smearPath) {
      smearPath.setAttribute('d', smear);
      smearPath.classList.toggle('selected', p.id === selectedId);
    }
    if (endPath) {
      endPath.setAttribute('d', bitEndProfilePath(p));
      endPath.classList.toggle('selected', p.id === selectedId);
    }
    if (tip) {
      const flute = isFlute(p) ? /** @type {import('./profile.js').FluteProfile} */ (p.profile) : null;
      tip.setAttribute('cx', String(flute ? fluteBitCenterRadius(p.circularDistance, flute) : p.circularDistance));
      tip.setAttribute('cy', String(p.atLength));
      tip.classList.toggle('selected', p.id === selectedId);
    }
    if (endTip && p.endCircularDistance != null && p.endAtLength != null) {
      const flute = isFlute(p) ? /** @type {import('./profile.js').FluteProfile} */ (p.profile) : null;
      endTip.setAttribute(
        'cx',
        String(flute ? fluteBitCenterRadius(p.endCircularDistance, flute) : p.endCircularDistance)
      );
      endTip.setAttribute('cy', String(p.endAtLength));
      endTip.classList.toggle('selected', p.id === selectedId);
    }
  }
}

/**
 * Zoom viewBox toward a point (in inches), keeping aspect.
 * @param {ViewBox} vb
 * @param {number} factor >1 zooms out
 * @param {{radius: number, length: number}} around
 * @returns {ViewBox}
 */
export function zoomViewBox(vb, factor, around) {
  const width = Math.min(80, Math.max(0.4, vb.width * factor));
  const height = Math.min(80, Math.max(0.4, vb.height * factor));
  const sx = width / vb.width;
  const sy = height / vb.height;
  return {
    xMin: around.radius - (around.radius - vb.xMin) * sx,
    yMin: around.length - (around.length - vb.yMin) * sy,
    width,
    height,
  };
}

/**
 * @param {ViewBox} vb
 * @param {number} dRadius
 * @param {number} dLength
 * @returns {ViewBox}
 */
export function panViewBox(vb, dRadius, dLength) {
  return {
    xMin: vb.xMin - dRadius,
    yMin: vb.yMin - dLength,
    width: vb.width,
    height: vb.height,
  };
}

/**
 * Center of a viewBox, for button zoom.
 * @param {ViewBox} vb
 */
export function viewBoxCenter(vb) {
  return { radius: vb.xMin + vb.width / 2, length: vb.yMin + vb.height / 2 };
}
