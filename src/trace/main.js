// @ts-check
// Separate tracing experiment. Humans click the edge; we fit lines/arcs/splines.

import {
  axisScaleFromLength,
  axisScaleFromSpan,
  traceToProfile,
  endCenter,
  pixelToProfile,
  profileToPixel,
  bitOriginAxis,
  startProfileAtTip,
} from './coords.js';
import {
  applySmoothJoins,
  fitSegments,
  forceSegType,
  mergeAdjacent,
  isUncuttableInside,
  sampleSegments,
  snapArcToRadius,
  snapCandidates,
  ensureArcsThroughEnds,
  segStart,
  dist,
} from './fit.js';
import { segsToDxf, sampledBitDxf } from './dxf-export.js';
import { serializeSession, parseSession } from './session.js';
import { closestInsert, cycleJoin, hitPointIndex } from './edit.js';

/**
 * @typedef {import('./coords.js').Pixel} Pixel
 * @typedef {import('./fit.js').Seg} Seg
 */

const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas'));
const ctx = canvas.getContext('2d');
const stepEl = document.getElementById('step');
const segsEl = document.getElementById('segs');
const previewEl = /** @type {SVGSVGElement} */ (document.getElementById('preview'));
const modeEl = /** @type {HTMLSelectElement} */ (document.getElementById('mode'));
const tipTowardEl = /** @type {HTMLSelectElement} */ (document.getElementById('tipToward'));
const tipTowardWrap = document.getElementById('tipTowardWrap');
const toolEl = /** @type {HTMLSelectElement} */ (document.getElementById('tool'));
const knownInchesEl = /** @type {HTMLInputElement} */ (document.getElementById('knownInches'));
const axisIsLengthEl = /** @type {HTMLInputElement} */ (document.getElementById('axisIsLength'));
const knownRadiiEl = /** @type {HTMLInputElement} */ (document.getElementById('knownRadii'));
const lengthCaption = document.getElementById('lengthCaption');
const fileImage = /** @type {HTMLInputElement} */ (document.getElementById('fileImage'));
const fileSession = /** @type {HTMLInputElement} */ (document.getElementById('fileSession'));
const imageNameEl = document.getElementById('imageName');
const sessionNameEl = document.getElementById('sessionName');
const photoOpacityEl = /** @type {HTMLInputElement} */ (document.getElementById('photoOpacity'));
const btnUndo = /** @type {HTMLButtonElement} */ (document.getElementById('btnUndo'));
const btnRedo = /** @type {HTMLButtonElement} */ (document.getElementById('btnRedo'));

/** @type {HTMLImageElement | null} */
let image = null;
let imageName = '';
let imageData = '';
let view = { scale: 1, x: 0, y: 0 };
/** @type {Pixel[]} */
let ends = [];
/** @type {Pixel | null} */
let scaleA = null;
/** @type {Pixel | null} */
let scaleB = null;
/** @type {Pixel[]} */
let trace = [];
/** @type {Seg[]} */
let segs = [];
let selectedPoint = -1;
let selectedSeg = -1;
let panning = false;
let panStart = { x: 0, y: 0, vx: 0, vy: 0 };
/** @type {{ kind: 'trace' | 'end' | 'scaleA' | 'scaleB', index: number, moved: boolean, wasSelected: boolean, before: ReturnType<typeof snapshot>, startX: number, startY: number } | null} */
let drag = null;

/** @type {ReturnType<typeof snapshot>[]} */
let undoStack = [];
/** @type {ReturnType<typeof snapshot>[]} */
let redoStack = [];

function mode() {
  return modeEl.value === 'bit' ? 'bit' : 'spindle';
}

/** @returns {'auto' | 'left' | 'right' | 'top' | 'bottom'} */
function tipToward() {
  const v = tipTowardEl?.value;
  if (v === 'left' || v === 'right' || v === 'top' || v === 'bottom' || v === 'auto') return v;
  return mode() === 'bit' ? 'right' : 'auto';
}

function syncTipTowardUi() {
  if (tipTowardWrap) tipTowardWrap.hidden = mode() !== 'bit';
}

function tool() {
  const v = toolEl.value;
  if (v === 'editPoints' || v === 'editFit') return v;
  return 'place';
}

function photoOpacity() {
  const n = Number(photoOpacityEl?.value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 0.8;
}

function knownInches() {
  const n = Number(knownInchesEl.value);
  return n > 0 ? n : 0;
}

function knownRadii() {
  return knownRadiiEl.value
    .split(/[, ]+/)
    .map((s) => Number(s))
    .filter((n) => n > 0);
}

function snapshot() {
  return {
    ends: ends.map((p) => ({ ...p })),
    scaleA: scaleA ? { ...scaleA } : null,
    scaleB: scaleB ? { ...scaleB } : null,
    trace: trace.map((p) => ({ ...p })),
    segs: structuredClone(segs),
    selectedPoint,
    selectedSeg,
  };
}

/** @param {ReturnType<typeof snapshot>} s */
function restore(s) {
  ends = s.ends.map((p) => ({ ...p }));
  scaleA = s.scaleA ? { ...s.scaleA } : null;
  scaleB = s.scaleB ? { ...s.scaleB } : null;
  trace = s.trace.map((p) => ({ ...p }));
  segs = structuredClone(s.segs);
  selectedPoint = s.selectedPoint;
  selectedSeg = s.selectedSeg;
}

function pushHistory() {
  undoStack.push(snapshot());
  if (undoStack.length > 40) undoStack.shift();
  redoStack = [];
  syncHistoryButtons();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(/** @type {ReturnType<typeof snapshot>} */ (undoStack.pop()));
  draw();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(/** @type {ReturnType<typeof snapshot>} */ (redoStack.pop()));
  draw();
}

function syncHistoryButtons() {
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

const END_PHASES = ['topExt', 'topSide1', 'topSide2', 'botExt', 'botSide1', 'botSide2'];

function topCenter() {
  if (ends.length < 3) return null;
  return endCenter(ends[0], ends[1], ends[2]);
}

function botCenter() {
  if (ends.length < 6) return null;
  return endCenter(ends[3], ends[4], ends[5]);
}

function phase() {
  if (!image) return 'load';
  if (ends.length < 6) return END_PHASES[ends.length];
  if (!axisIsLengthEl.checked && (!scaleA || !scaleB)) return scaleA ? 'scaleB' : 'scaleA';
  if (!segs.length) return 'trace';
  return 'review';
}

function stepText() {
  const bit = mode() === 'bit';
  const t = tool();
  switch (phase()) {
    case 'load':
      return '<strong>Load a picture</strong> or open a saved session. A side view works better than a 3/4 shot.';
    case 'topExt':
      return bit
        ? '<strong>Click the tip end</strong> of the bit (cutting end), then its two sides. Catalog photos are usually shank on the left, tip on the right — set <em>Tip is toward</em> to match.'
        : '<strong>Click the high spot</strong> of the headstock end (the top of the wood). Not the center — just the highest point.';
    case 'topSide1':
      return '<strong>Click one side</strong> of that end (left or right edge). It does not have to be at the same height as the high spot.';
    case 'topSide2':
      return '<strong>Click the other side</strong> of that end. We compute the top-center from those three clicks.';
    case 'botExt':
      return bit
        ? '<strong>Click the shank end</strong> of the bit (the other end along the axis), then its two sides.'
        : '<strong>Click the low spot</strong> of the foot (the bottom of the wood). Not the center.';
    case 'botSide1':
      return '<strong>Click one side</strong> of that end.';
    case 'botSide2':
      return '<strong>Click the other side</strong> of that end. We compute the bottom-center and the centerline.';
    case 'scaleA':
      return '<strong>Click one end</strong> of a known length in the photo (the inches in the box).';
    case 'scaleB':
      return '<strong>Click the other end</strong> of that known length.';
    case 'trace':
      if (t === 'editPoints') {
        return '<strong>Edit points.</strong> Drag a node. Click a span to insert. Sharp vs Smooth is the join at that point: Smooth matches tangents (no kink); Sharp allows a corner.';
      }
      return '<strong>Click along one silhouette.</strong> Ctrl-click a sharp transition, Shift-click a smooth (tangent) join. You do not need to mark every change. Backspace undoes. Finish &amp; fit when the outline is in.';
    default:
      if (t === 'editPoints') {
        return '<strong>Edit points</strong> then Finish &amp; fit (or it refits when you drop a node). Ctrl+Z undoes a radius snap too.';
      }
      if (t === 'editFit') {
        return '<strong>Edit fit.</strong> Click a gold curve or a list row. Line / Arc / Spline keeps the current shape. Join prev/next if two list rows are really one bit. Use / Set R for a circular bit. Red X = inside corner a bit cannot cut.';
      }
      return '<strong>Snap radii</strong> with Use / Set R on an arc row (type 2.5 if it is not listed). Click a row to highlight it. Red X = inside corner a bit cannot cut.';
  }
}

function currentScale() {
  const first = topCenter();
  const second = botCenter();
  if (!first || !second) return null;
  const { origin, axis } =
    mode() === 'bit' ? bitOriginAxis(first, second, tipToward()) : { origin: first, axis: second };
  const inches = knownInches();
  if (axisIsLengthEl.checked) return axisScaleFromLength(origin, axis, inches);
  if (scaleA && scaleB) return axisScaleFromSpan(origin, axis, scaleA, scaleB, inches);
  return null;
}

function applyStoredTypes(list) {
  const scale = currentScale();
  if (!scale) return list;
  const out = list.map((seg) => {
    const pix = nearestTracePoint(scale, seg.type === 'spline' ? seg.points[0] : seg.a);
    if (pix?.spanType && pix.spanType !== seg.type) return forceSegType(seg, pix.spanType);
    return seg;
  });
  return applySmoothJoins(ensureArcsThroughEnds(out));
}

/** @param {import('./coords.js').AxisScale} scale @param {import('./fit.js').Pt} P */
function nearestTracePoint(scale, P) {
  let best = /** @type {import('./coords.js').Pixel | null} */ (null);
  let bestD = Infinity;
  for (const pix of trace) {
    const pr = pixelToProfile(scale, pix);
    const d = Math.hypot(pr.d - P.d, pr.r - P.r);
    if (d < bestD) {
      bestD = d;
      best = pix;
    }
  }
  return best;
}

function fitNow() {
  const scale = currentScale();
  if (!scale || trace.length < 2) return;
  const traced = traceToProfile(scale, trace);
  let pts = traced.points;
  let breaks = traced.breaks;
  let smoothBreaks = traced.smoothBreaks;
  if (mode() === 'bit') {
    const started = startProfileAtTip(pts, breaks, smoothBreaks);
    pts = started.points;
    breaks = started.breaks;
    smoothBreaks = started.smoothBreaks;
    if (pts.length && (Math.abs(pts[0].d) > 0.02 || Math.abs(pts[0].r) > 0.02)) {
      pts = [{ d: 0, r: 0 }, ...pts];
      breaks = breaks.map((i) => i + 1);
      smoothBreaks = smoothBreaks.map((i) => i + 1);
    }
  }
  segs = fitSegments(pts, { breaks, smoothBreaks });
  segs = applyStoredTypes(segs);
}

function resize() {
  const stage = document.getElementById('stage');
  if (!stage || !ctx) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(w * dpr));
  canvas.height = Math.max(1, Math.floor(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

function fitView() {
  const stage = document.getElementById('stage');
  if (!image || !stage) return;
  const w = stage.clientWidth;
  const h = stage.clientHeight;
  const s = Math.min(w / image.width, h / image.height) * 0.98;
  view.scale = s;
  view.x = (w - image.width * s) / 2;
  view.y = (h - image.height * s) / 2;
}

/** @param {Pixel} p */
function imgToCanvas(p) {
  return { x: p.x * view.scale + view.x, y: p.y * view.scale + view.y };
}

/** @param {number} cx @param {number} cy */
function canvasToImg(cx, cy) {
  return { x: (cx - view.x) / view.scale, y: (cy - view.y) / view.scale };
}

function hitRadiusImg() {
  return 10 / view.scale;
}

function updateCursor() {
  if (panning || (drag && drag.moved)) canvas.style.cursor = 'grabbing';
  else if (tool() === 'place' && (phase() === 'trace' || END_PHASES.includes(phase()) || phase() === 'scaleA' || phase() === 'scaleB')) {
    canvas.style.cursor = 'crosshair';
  } else canvas.style.cursor = 'default';
}

function draw() {
  if (!ctx) return;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  ctx.fillStyle = '#151412';
  ctx.fillRect(0, 0, w, h);
  if (image) {
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = photoOpacity();
    ctx.drawImage(image, view.x, view.y, image.width * view.scale, image.height * view.scale);
    ctx.globalAlpha = 1;
  }
  drawEndMarks();
  const first = topCenter();
  const second = botCenter();
  const pair =
    first && second && mode() === 'bit' ? bitOriginAxis(first, second, tipToward()) : { origin: first, axis: second };
  const origin = pair.origin;
  const axis = pair.axis;
  if (origin && axis) {
    const a = imgToCanvas(origin);
    const b = imgToCanvas(axis);
    ctx.strokeStyle = '#6aa3c8';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    drawCross(a, '#6aa3c8');
    drawCross(b, '#6aa3c8');
  } else if (origin) {
    drawCross(imgToCanvas(origin), '#6aa3c8');
  }
  if (scaleA) drawDot(imgToCanvas(scaleA), '#c98a4b');
  if (scaleB) drawDot(imgToCanvas(scaleB), '#c98a4b');
  if (trace.length) {
    ctx.strokeStyle = '#c98a4b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    trace.forEach((p, i) => {
      const c = imgToCanvas(p);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
    trace.forEach((p, i) => {
      const c = imgToCanvas(p);
      const sel = i === selectedPoint;
      if (p.smooth) drawJoint(c, true, sel);
      else if (p.joint) drawJoint(c, false, sel);
      else drawDot(c, sel ? '#ece6da' : '#c98a4b', sel ? 5 : 3.5);
    });
  }
  const scale = currentScale();
  if (scale && segs.length) {
    drawSegsOnPhoto(scale, false);
    drawSegsOnPhoto(scale, true);
    drawBadJoins(scale);
  }
  if (stepEl) stepEl.innerHTML = stepText();
  if (imageNameEl) imageNameEl.textContent = imageName;
  if (sessionNameEl) sessionNameEl.textContent = imageName;
  renderSegList();
  renderJoinPanel();
  renderPreview();
  updateCursor();
  syncHistoryButtons();
}

function drawEndMarks() {
  if (!ctx) return;
  for (let i = 0; i < ends.length; i++) {
    const c = imgToCanvas(ends[i]);
    const isExt = i === 0 || i === 3;
    drawDot(c, isExt ? '#ece6da' : '#6aa3c8');
  }
  if (ends.length >= 3) drawChord(ends[1], ends[2]);
  if (ends.length >= 6) drawChord(ends[4], ends[5]);
}

/** @param {Pixel} a @param {Pixel} b */
function drawChord(a, b) {
  if (!ctx) return;
  const p = imgToCanvas(a);
  const q = imgToCanvas(b);
  ctx.strokeStyle = 'rgba(106,163,200,0.6)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(q.x, q.y);
  ctx.stroke();
}

/** @param {{x:number,y:number}} c @param {string} color */
function drawCross(c, color) {
  if (!ctx) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c.x - 7, c.y);
  ctx.lineTo(c.x + 7, c.y);
  ctx.moveTo(c.x, c.y - 7);
  ctx.lineTo(c.x, c.y + 7);
  ctx.stroke();
}

/** @param {{x:number,y:number}} c @param {string} color @param {number} [r] */
function drawDot(c, color, r = 3.5) {
  if (!ctx) return;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** @param {{x:number,y:number}} c @param {boolean} smooth @param {boolean} [sel] */
function drawJoint(c, smooth, sel = false) {
  if (!ctx) return;
  ctx.fillStyle = '#ece6da';
  ctx.beginPath();
  ctx.arc(c.x, c.y, sel ? 5.5 : 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = smooth ? '#6aa3c8' : '#c98a4b';
  ctx.lineWidth = sel ? 3 : 2;
  ctx.beginPath();
  ctx.arc(c.x, c.y, sel ? 8 : 6, 0, Math.PI * 2);
  ctx.stroke();
}

/** @param {import('./coords.js').AxisScale} scale @param {boolean} mirror */
function drawSegsOnPhoto(scale, mirror) {
  if (!ctx) return;
  const order = segs.map((_, i) => i).sort((a, b) => (a === selectedSeg ? 1 : b === selectedSeg ? -1 : 0));
  for (const i of order) {
    const samples = sampleSegments([segs[i]], 20);
    const pixels = samples.map((p) => profileToPixel(scale, p, mirror));
    const sel = !mirror && i === selectedSeg;
    ctx.strokeStyle = mirror ? 'rgba(201,154,95,0.28)' : sel ? '#f4ead4' : 'rgba(201,154,95,0.7)';
    ctx.lineWidth = sel ? 4 : 1.75;
    ctx.beginPath();
    pixels.forEach((p, k) => {
      const c = imgToCanvas(p);
      if (k === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.stroke();
    if (sel && pixels.length) {
      drawDot(imgToCanvas(pixels[0]), '#f4ead4', 4);
      drawDot(imgToCanvas(pixels[pixels.length - 1]), '#f4ead4', 4);
    }
  }
}

/** @param {import('./coords.js').AxisScale} scale */
function drawBadJoins(scale) {
  if (!ctx) return;
  for (let i = 1; i < segs.length; i++) {
    if (!isUncuttableInside(segs[i - 1], segs[i])) continue;
    const pix = profileToPixel(scale, segStart(segs[i]), false);
    const c = imgToCanvas(pix);
    ctx.strokeStyle = '#d45c4a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c.x, c.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(c.x - 4, c.y - 4);
    ctx.lineTo(c.x + 4, c.y + 4);
    ctx.moveTo(c.x + 4, c.y - 4);
    ctx.lineTo(c.x - 4, c.y + 4);
    ctx.stroke();
  }
}

function renderSegList() {
  if (!segsEl) return;
  const known = knownRadii();
  const bad = segs.some((_, i) => i > 0 && isUncuttableInside(segs[i - 1], segs[i]));
  const hint = bad
    ? `<div class="meta">Red X on the photo = inside corner a bit cannot cut.</div>`
    : '';
  segsEl.innerHTML =
    hint +
    segs
      .map((seg, i) => {
        const sel = i === selectedSeg ? ' sel' : '';
        if (seg.type === 'line') {
          const len = Math.hypot(seg.b.d - seg.a.d, seg.b.r - seg.a.r);
          return `<div class="seg${sel}" data-seg="${i}"><div>Line ${i + 1}</div><div class="meta">${len.toFixed(2)} in</div>${typeBtns(i, seg)}</div>`;
        }
        if (seg.type === 'spline') {
          return (
            `<div class="seg${sel}" data-seg="${i}"><div>Spline ${i + 1} · ${seg.points.length} pts</div>` +
            `<div class="meta">along axis ${seg.points[0].d.toFixed(2)} → ${seg.points[seg.points.length - 1].d.toFixed(2)}</div>${typeBtns(i, seg)}</div>`
          );
        }
        const minR = dist(seg.a, seg.b) / 2;
        const snaps = snapCandidates(seg.radius, known, { minRadius: minR });
        const buttons = snaps
          .map((r) => {
            const on = Math.abs(r - seg.radius) <= 1e-6 ? ' on' : '';
            return `<button type="button" class="ghost${on}" data-snap="${i}:${r}">Use ${r}</button>`;
          })
          .join('');
        const typed =
          i === selectedSeg
            ? `<div class="snaps"><input class="r-in" type="number" min="${minR.toFixed(3)}" step="0.05" value="${seg.radius.toFixed(3)}" data-rset="${i}" /><button type="button" class="ghost" data-rapply="${i}">Set R</button></div>`
            : '';
        const empty = buttons ? '' : `<span class="meta">need R ≥ ${minR.toFixed(2)} in — type one below</span>`;
        return (
          `<div class="seg${sel}" data-seg="${i}"><div>Arc ${i + 1} · R ${seg.radius.toFixed(3)} in</div>` +
          `<div class="meta">along axis ${seg.a.d.toFixed(2)} → ${seg.b.d.toFixed(2)}</div>` +
          `<div class="snaps">${buttons || empty}</div>${typed}${typeBtns(i, seg)}</div>`
        );
      })
      .join('');
  segsEl.querySelector('.seg.sel')?.scrollIntoView({ block: 'nearest' });
}

/** @param {number} i @param {Seg} seg */
function typeBtns(i, seg) {
  const merge =
    i === selectedSeg
      ? `<div class="snaps">` +
        (i > 0 ? `<button type="button" class="ghost" data-merge="${i}:prev">Join prev</button>` : '') +
        (i < segs.length - 1 ? `<button type="button" class="ghost" data-merge="${i}:next">Join next</button>` : '') +
        `</div>`
      : '';
  return (
    `<div class="snaps">` +
    ['line', 'arc', 'spline']
      .map(
        (k) =>
          `<button type="button" class="ghost ${seg.type === k ? 'on' : ''}" data-kind="${i}:${k}">${k[0].toUpperCase()}${k.slice(1)}</button>`,
      )
      .join('') +
    `</div>` +
    merge
  );
}

function renderJoinPanel() {
  const el = document.getElementById('joinPanel');
  if (!el) return;
  const p = selectedPoint >= 0 ? trace[selectedPoint] : null;
  const usable = !!(p && selectedPoint > 0 && selectedPoint < trace.length - 1);
  el.hidden = !usable;
  if (!usable) return;
  const none = !p.joint && !p.smooth;
  const sharp = !!p.joint && !p.smooth;
  const smooth = !!p.smooth;
  el.querySelectorAll('[data-point-join]').forEach((btn) => {
    const kind = btn.getAttribute('data-point-join');
    btn.classList.toggle('on', kind === 'none' ? none : kind === 'sharp' ? sharp : smooth);
  });
}

function renderPreview() {
  if (!previewEl) return;
  const samples = segs.length ? sampleSegments(segs, 24) : [];
  if (!samples.length) {
    previewEl.innerHTML = '';
    return;
  }
  let rMax = 0.2;
  let dMax = 1;
  for (const p of samples) {
    rMax = Math.max(rMax, p.r);
    dMax = Math.max(dMax, p.d);
  }
  const pad = rMax * 0.15;
  previewEl.setAttribute('viewBox', `${-rMax - pad} ${-pad} ${2 * (rMax + pad)} ${dMax + 2 * pad}`);
  const right = samples.map((p) => `${p.r} ${p.d}`).join(' L ');
  const left = [...samples].reverse().map((p) => `${-p.r} ${p.d}`).join(' L ');
  previewEl.innerHTML =
    `<rect x="${-rMax - pad}" y="${-pad}" width="${2 * (rMax + pad)}" height="${dMax + 2 * pad}" fill="#151412"/>` +
    `<line x1="0" y1="0" x2="0" y2="${dMax}" stroke="#6aa3c8" stroke-width="${rMax * 0.02}"/>` +
    `<path d="M ${right} L ${left} Z" fill="rgba(201,154,95,0.35)" stroke="#c99a5f" stroke-width="${rMax * 0.03}"/>`;
}

function download(name, text, mime = 'application/dxf') {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function sessionState() {
  return {
    imageName,
    imageData,
    mode: mode(),
    knownInches: knownInches(),
    axisIsLength: axisIsLengthEl.checked,
    knownRadii: knownRadiiEl.value,
    photoOpacity: Number(photoOpacityEl?.value) || 80,
    tipToward: mode() === 'bit' ? tipToward() : 'auto',
    ends,
    scaleA,
    scaleB,
    trace,
    tool: tool(),
    segs,
  };
}

/** @param {import('./session.js').TraceSession} data */
function applySession(data) {
  modeEl.value = data.mode === 'bit' ? 'bit' : 'spindle';
  if (tipTowardEl) {
    const t = data.tipToward;
    tipTowardEl.value = t === 'left' || t === 'right' || t === 'top' || t === 'bottom' || t === 'auto' ? t : data.mode === 'bit' ? 'right' : 'auto';
  }
  syncTipTowardUi();
  if (data.knownInches) knownInchesEl.value = String(data.knownInches);
  axisIsLengthEl.checked = data.axisIsLength !== false;
  updateLengthCaption();
  knownRadiiEl.value = data.knownRadii ?? '';
  if (photoOpacityEl && data.photoOpacity != null) photoOpacityEl.value = String(data.photoOpacity);
  ends = (data.ends ?? []).map((p) => ({ ...p }));
  scaleA = data.scaleA ? { ...data.scaleA } : null;
  scaleB = data.scaleB ? { ...data.scaleB } : null;
  trace = (data.trace ?? []).map((p) => ({ ...p }));
  toolEl.value = data.tool === 'editPoints' || data.tool === 'editFit' ? data.tool : 'place';
  segs = Array.isArray(data.segs) ? structuredClone(data.segs) : [];
  if (segs.length) segs = applyStoredTypes(ensureArcsThroughEnds(segs));
  selectedPoint = -1;
  selectedSeg = -1;
  imageName = data.imageName ?? '';
  imageData = data.imageData ?? '';
  undoStack = [];
  redoStack = [];
  if (imageData) {
    const img = new Image();
    img.onload = () => {
      image = img;
      fitView();
      draw();
    };
    img.src = imageData;
  } else {
    draw();
  }
}

function ensureImageData() {
  if (imageData || !image) return;
  const c = document.createElement('canvas');
  c.width = image.naturalWidth || image.width;
  c.height = image.naturalHeight || image.height;
  const cctx = c.getContext('2d');
  if (!cctx) return;
  cctx.drawImage(image, 0, 0);
  imageData = c.toDataURL('image/jpeg', 0.92);
}

/** @param {'none' | 'sharp' | 'smooth'} kind */
function setPointJoin(kind) {
  if (selectedPoint <= 0 || selectedPoint >= trace.length - 1) return;
  const p = trace[selectedPoint];
  pushHistory();
  if (kind === 'none') {
    p.joint = false;
    p.smooth = false;
  } else if (kind === 'sharp') {
    p.joint = true;
    p.smooth = false;
  } else {
    p.joint = true;
    p.smooth = true;
  }
  if (segs.length) fitNow();
}

/** @param {number} i @param {'line' | 'arc' | 'spline'} type */
function setSegType(i, type) {
  if (!segs[i]) return;
  pushHistory();
  segs[i] = forceSegType(segs[i], type);
  segs = applySmoothJoins(ensureArcsThroughEnds(segs));
  const scale = currentScale();
  if (scale) {
    const P = segs[i].type === 'spline' ? segs[i].points[0] : segs[i].a;
    const pix = nearestTracePoint(scale, P);
    if (pix) pix.spanType = type;
  }
  selectedSeg = i;
}

/** @param {number} i @param {'prev' | 'next'} dir */
function mergeSeg(i, dir) {
  if (!segs[i]) return;
  const at = dir === 'prev' ? i - 1 : i;
  if (at < 0 || at >= segs.length - 1) return;
  pushHistory();
  segs = mergeAdjacent(segs, at);
  selectedSeg = Math.min(at, segs.length - 1);
}

/** @param {number} i @param {number} r */
function applyArcRadius(i, r) {
  const seg = segs[i];
  if (!seg || seg.type !== 'arc') return;
  const snapped = snapArcToRadius(seg, r);
  if (!snapped) {
    window.alert('That radius is too small to pass through the endpoints.');
    return;
  }
  pushHistory();
  segs[i] = snapped;
  segs = applySmoothJoins(ensureArcsThroughEnds(segs));
  selectedSeg = i;
}

function hitSegIndex(/** @type {Pixel} */ img, /** @type {number} */ cx, /** @type {number} */ cy) {
  const scale = currentScale();
  if (!scale || !segs.length) return -1;
  let best = -1;
  let bestD = 14;
  segs.forEach((seg, i) => {
    const samples = sampleSegments([seg], 14);
    for (const p of samples) {
      const pix = profileToPixel(scale, p, false);
      const c = imgToCanvas(pix);
      const d = Math.hypot(c.x - cx, c.y - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  });
  return best;
}

canvas.addEventListener('pointerdown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const cx = e.clientX - rect.left;
  const cy = e.clientY - rect.top;
  const img = canvasToImg(cx, cy);
  const p = phase();
  const t = tool();

  if (e.button === 1 || e.altKey || e.button === 2) {
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    canvas.setPointerCapture(e.pointerId);
    updateCursor();
    return;
  }
  if (e.button !== 0) return;

  if ((p === 'trace' || p === 'review') && t === 'editPoints') {
    const hi = hitPointIndex(trace, img, hitRadiusImg());
    if (hi >= 0) {
      drag = {
        kind: 'trace',
        index: hi,
        moved: false,
        wasSelected: selectedPoint === hi,
        before: snapshot(),
        startX: e.clientX,
        startY: e.clientY,
      };
      selectedPoint = hi;
      canvas.setPointerCapture(e.pointerId);
      draw();
      return;
    }
    const endHit = hitPointIndex(ends, img, hitRadiusImg());
    if (endHit >= 0) {
      drag = { kind: 'end', index: endHit, moved: false, wasSelected: false, before: snapshot(), startX: e.clientX, startY: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }
    const ins = closestInsert(trace, img);
    if (ins && ins.dist <= hitRadiusImg()) {
      pushHistory();
      trace.splice(ins.index, 0, { x: ins.proj.x, y: ins.proj.y });
      selectedPoint = ins.index;
      if (segs.length) fitNow();
      draw();
      return;
    }
    const si = hitSegIndex(img, cx, cy);
    if (si >= 0) {
      selectedSeg = si;
      selectedPoint = -1;
      draw();
      return;
    }
    selectedPoint = -1;
    draw();
    return;
  }

  if (p === 'review' && t === 'editFit') {
    const si = hitSegIndex(img, cx, cy);
    if (si >= 0) selectedSeg = si;
    draw();
    return;
  }

  const jointClick = e.ctrlKey || e.metaKey;
  const smoothClick = e.shiftKey && !jointClick;
  if ((jointClick || smoothClick) && p === 'trace' && t === 'place') {
    e.preventDefault();
    pushHistory();
    img.joint = true;
    img.smooth = smoothClick;
    trace.push(img);
    segs = [];
    draw();
    return;
  }

  if (ends.length < 6 && END_PHASES.includes(p)) {
    pushHistory();
    ends.push(img);
  } else if (p === 'scaleA') {
    pushHistory();
    scaleA = img;
  } else if (p === 'scaleB') {
    pushHistory();
    scaleB = img;
    if (trace.length >= 2) fitNow();
  } else if (p === 'trace' && t === 'place') {
    pushHistory();
    trace.push(img);
    segs = [];
  }
  draw();
});

canvas.addEventListener('pointermove', (e) => {
  if (panning) {
    view.x = panStart.vx + (e.clientX - panStart.x);
    view.y = panStart.vy + (e.clientY - panStart.y);
    draw();
    return;
  }
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  const img = canvasToImg(e.clientX - rect.left, e.clientY - rect.top);
  if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 3) drag.moved = true;
  if (drag.kind === 'trace') {
    const prev = trace[drag.index];
    trace[drag.index] = { ...prev, x: img.x, y: img.y };
    if (segs.length) fitNow();
  } else if (drag.kind === 'end') {
    ends[drag.index] = { x: img.x, y: img.y };
    if (segs.length) fitNow();
  }
  draw();
});

canvas.addEventListener('pointerup', (e) => {
  if (panning) {
    panning = false;
    updateCursor();
    return;
  }
  if (!drag) return;
  if (!drag.moved && drag.kind === 'trace' && drag.wasSelected) {
    const p = trace[drag.index];
    if (p) {
      pushHistory();
      cycleJoin(p);
      if (segs.length) fitNow();
    }
  } else if (drag.moved) {
    undoStack.push(drag.before);
    if (undoStack.length > 60) undoStack.shift();
    redoStack = [];
  }
  drag = null;
  draw();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const old = view.scale;
    // Match the planner: scroll down = zoom out, scroll up = zoom in.
    const factor = e.deltaY > 0 ? 1 / 1.12 : 1.12;
    view.scale = Math.min(40, Math.max(0.05, view.scale * factor));
    view.x = mx - ((mx - view.x) / old) * view.scale;
    view.y = my - ((my - view.y) / old) * view.scale;
    draw();
  },
  { passive: false },
);

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    return;
  }
  const tag = /** @type {HTMLElement} */ (e.target).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'Backspace' || e.key === 'Delete') {
    if (tool() === 'editPoints' && selectedPoint >= 0 && trace[selectedPoint]) {
      e.preventDefault();
      pushHistory();
      trace.splice(selectedPoint, 1);
      selectedPoint = Math.min(selectedPoint, trace.length - 1);
      if (segs.length) fitNow();
      else segs = [];
      draw();
      return;
    }
    if (phase() === 'trace' && trace.length) {
      e.preventDefault();
      pushHistory();
      trace.pop();
      segs = [];
      draw();
    } else if (ends.length && !trace.length) {
      e.preventDefault();
      pushHistory();
      ends.pop();
      segs = [];
      draw();
    }
  }
  if (e.key === 'Enter' && (phase() === 'trace' || phase() === 'review')) {
    e.preventDefault();
    pushHistory();
    fitNow();
    draw();
  }
});

document.getElementById('btnLoad')?.addEventListener('click', () => fileImage.click());
document.getElementById('btnOpen')?.addEventListener('click', () => fileSession.click());

fileImage.addEventListener('change', () => {
  const file = fileImage.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    imageName = file.name;
    imageData = String(reader.result);
    const img = new Image();
    img.onload = () => {
      image = img;
      ends = [];
      scaleA = scaleB = null;
      trace = [];
      segs = [];
      selectedPoint = -1;
      selectedSeg = -1;
      undoStack = [];
      redoStack = [];
      fitView();
      draw();
    };
    img.src = imageData;
  };
  reader.readAsDataURL(file);
  fileImage.value = '';
});

fileSession.addEventListener('change', async () => {
  const file = fileSession.files?.[0];
  if (!file) return;
  try {
    applySession(parseSession(await file.text()));
  } catch (err) {
    window.alert(err instanceof Error ? err.message : 'Could not open that session.');
  }
  fileSession.value = '';
});

document.getElementById('btnSave')?.addEventListener('click', () => {
  if (!image && !trace.length) {
    window.alert('Nothing to save yet.');
    return;
  }
  ensureImageData();
  const base = (imageName || 'trace').replace(/\.[^.]+$/, '');
  download(`${base}.ltrace`, serializeSession(sessionState()), 'application/json');
});

document.getElementById('btnReset')?.addEventListener('click', () => {
  pushHistory();
  ends = [];
  scaleA = scaleB = null;
  trace = [];
  segs = [];
  selectedPoint = -1;
  selectedSeg = -1;
  draw();
});

btnUndo?.addEventListener('click', () => undo());
btnRedo?.addEventListener('click', () => redo());

document.getElementById('btnFinish')?.addEventListener('click', () => {
  if (!currentScale() || trace.length < 3) {
    window.alert('Mark both ends (each end: extreme + two sides), then click at least three points along the edge.');
    return;
  }
  pushHistory();
  fitNow();
  draw();
});

document.getElementById('btnDxf')?.addEventListener('click', () => {
  if (!segs.length) {
    window.alert('Finish & fit a trace first.');
    return;
  }
  const base = (imageName || (mode() === 'bit' ? 'bit-trace' : 'spindle-trace')).replace(/\.[^.]+$/, '');
  if (mode() === 'bit') {
    // Photo stays tip-on-the-right. Sampled polyline is tip at (0,0), X = radius,
    // Y along the bit — ARC entities can be stored start-at-the-far-end.
    download(`${base}.dxf`, sampledBitDxf(sampleSegments(segs)));
  } else {
    download(`${base}.dxf`, segsToDxf(segs));
  }
});

segsEl?.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const snap = t.getAttribute('data-snap');
  if (snap) {
    const [is, rs] = snap.split(':');
    applyArcRadius(Number(is), Number(rs));
    draw();
    return;
  }
  const rapply = t.getAttribute('data-rapply');
  if (rapply) {
    e.stopPropagation();
    const i = Number(rapply);
    const row = t.closest('.seg');
    const inp = /** @type {HTMLInputElement | null} */ (row?.querySelector('[data-rset]'));
    applyArcRadius(i, Number(inp?.value));
    draw();
    return;
  }
  if (t.closest('[data-rset]')) return;
  const merge = t.getAttribute('data-merge');
  if (merge) {
    const [is, dir] = merge.split(':');
    e.stopPropagation();
    if (dir === 'prev' || dir === 'next') mergeSeg(Number(is), dir);
    draw();
    return;
  }
  const kind = t.getAttribute('data-kind');
  if (kind) {
    const [is, ty] = kind.split(':');
    if (ty === 'line' || ty === 'arc' || ty === 'spline') {
      e.stopPropagation();
      setSegType(Number(is), ty);
      draw();
    }
    return;
  }
  const segAttr = t.closest('.seg')?.getAttribute('data-seg');
  if (segAttr != null) {
    const i = Number(segAttr);
    if (i === selectedSeg) return;
    selectedSeg = i;
    draw();
  }
});

segsEl?.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const t = /** @type {HTMLElement} */ (e.target);
  const i = Number(t.getAttribute('data-rset'));
  if (!Number.isFinite(i)) return;
  e.preventDefault();
  applyArcRadius(i, Number(/** @type {HTMLInputElement} */ (t).value));
  draw();
});

document.getElementById('joinPanel')?.addEventListener('click', (e) => {
  const t = /** @type {HTMLElement} */ (e.target);
  const kind = t.getAttribute('data-point-join');
  if (kind !== 'none' && kind !== 'sharp' && kind !== 'smooth') return;
  setPointJoin(kind);
  draw();
});

function updateLengthCaption() {
  if (!lengthCaption) return;
  lengthCaption.textContent = axisIsLengthEl.checked
    ? 'Length between end centers (in)'
    : 'Known length to click in the photo (in)';
}

modeEl.addEventListener('change', () => {
  updateLengthCaption();
  syncTipTowardUi();
  if (mode() === 'bit' && knownInchesEl.value === '29.5') knownInchesEl.value = '1';
  if (mode() === 'spindle' && knownInchesEl.value === '1') knownInchesEl.value = '29.5';
  segs = [];
  draw();
});

tipTowardEl?.addEventListener('change', () => {
  if (currentScale() && trace.length >= 2) fitNow();
  draw();
});

toolEl.addEventListener('change', () => draw());

function refitIfReady() {
  if (segs.length) fitNow();
  draw();
}

knownInchesEl.addEventListener('change', refitIfReady);
axisIsLengthEl.addEventListener('change', () => {
  updateLengthCaption();
  if (currentScale() && trace.length >= 2) fitNow();
  draw();
});
knownRadiiEl.addEventListener('input', () => renderSegList());
photoOpacityEl?.addEventListener('input', () => draw());

window.addEventListener('resize', resize);
updateLengthCaption();
syncTipTowardUi();
if (stepEl) stepEl.innerHTML = stepText();
resize();
