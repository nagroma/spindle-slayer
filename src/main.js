// @ts-check
// Prism blank + plunge bits + live 2D/3D. 2D camera is independent of bit drag.

import { defaultDemo } from './demo-bits.js';
import { MIN_RADIUS, isRun, isCutHidden, isFlute, isSpiral, enableSpiral, disableSpiral, DEFAULT_FLUTE_INDEX_DEG, DEFAULT_SPIRAL_TRAVEL, DEFAULT_SPIRAL_TURNS } from './geometry.js';
import { stockMaxRadius, stockFaceRadius } from './stock.js';
import {
  renderSideSVG,
  clientToSideInches,
  patchSideSVG,
  defaultViewBox,
  viewBoxFitBlank,
  zoomViewBox,
  panViewBox,
  pinViewBoxLeft,
  viewBoxCenter,
  bitIconSVG,
} from './view-side.js';
import { createView3d, CAMERA3D_LAYOUT, clampMeshQuality, meshQualityLabel } from './view3d.js';
import { profileMaxDepth } from './profile.js';
import { bindSplitters } from './layout.js';
import {
  loadUi,
  saveUi,
  loadSession,
  saveSession,
  serializeProject,
  deserializeProject,
  hydrateSession,
  downloadText,
  parseProjectJson,
  lompDownloadName,
  PROJECT_FILENAME,
} from './persist.js';
import { importDxfOverlay } from './dxf-profile.js';

const { bits, model: initial } = defaultDemo();
const savedUi = loadUi();
const savedSession = loadSession();
const hydrated = savedSession ? hydrateSession(bits, savedSession) : null;

/** @type {import('./geometry.js').Model} */
const model = {
  stock: { ...(hydrated?.model.stock ?? initial.stock) },
  placements: (hydrated?.model.placements ?? initial.placements).map((p) => ({ ...p })),
};

/** @type {string | null} */
let selectedId = hydrated?.selectedId ?? model.placements[0]?.id ?? null;
if (selectedId && !model.placements.some((p) => p.id === selectedId)) {
  selectedId = model.placements[0]?.id ?? null;
}
let nextId = 1 + model.placements.reduce((m, p) => {
  const n = Number(String(p.id).replace(/^p/, ''));
  return Number.isFinite(n) ? Math.max(m, n) : m;
}, 1);
let cameraFramed = false;
const savedCamera3d = hydrated?.camera3d ?? savedSession?.camera3d ?? null;

/** @type {import('./persist.js').OverlayState | null} */
let overlay = hydrated?.overlay ?? null;

const MAX_HISTORY = 40;
/** @type {ReturnType<typeof recipeSnapshot>[]} */
let undoStack = [];
/** @type {ReturnType<typeof recipeSnapshot>[]} */
let redoStack = [];
let historyLocked = false;

function recipeSnapshot() {
  return {
    stock: { ...model.stock },
    selectedId,
    nextId,
    cuts: model.placements.map((p) => ({
      id: p.id,
      bitId: p.bitId,
      atLength: p.atLength,
      circularDistance: p.circularDistance,
      run: Boolean(p.run),
      hidden: Boolean(p.hidden),
      endAtLength: p.endAtLength,
      endCircularDistance: p.endCircularDistance,
      indexIncrementDeg: p.indexIncrementDeg,
      spiral: Boolean(p.spiral),
      spiralTravel: p.spiralTravel,
      spiralTurns: p.spiralTurns,
      spiralStarts: p.spiralStarts,
      spiralStartDeg: p.spiralStartDeg,
      spiralDir: p.spiralDir,
    })),
  };
}

/** @param {ReturnType<typeof recipeSnapshot>} snap */
function recipeKey(snap) {
  return JSON.stringify(snap);
}

function pushUndo() {
  if (historyLocked) return;
  const snap = recipeSnapshot();
  const last = undoStack[undoStack.length - 1];
  if (last && recipeKey(last) === recipeKey(snap)) return;
  undoStack.push(snap);
  if (undoStack.length > MAX_HISTORY) undoStack.shift();
  redoStack = [];
  syncHistoryButtons();
}

function discardUndoIfUnchanged() {
  const last = undoStack[undoStack.length - 1];
  if (last && recipeKey(last) === recipeKey(recipeSnapshot())) {
    undoStack.pop();
    syncHistoryButtons();
  }
}

function clearHistory() {
  undoStack = [];
  redoStack = [];
  syncHistoryButtons();
}

/** @param {ReturnType<typeof recipeSnapshot>} snap */
function applyRecipe(snap) {
  historyLocked = true;
  model.stock = { ...snap.stock };
  /** @type {import('./geometry.js').Placement[]} */
  const placements = [];
  for (const c of snap.cuts) {
    const bit = bits.find((b) => b.id === c.bitId);
    if (!bit) continue;
    /** @type {import('./geometry.js').Placement} */
    const p = {
      id: c.id,
      bitId: bit.id,
      profile: bit.profile,
      atLength: c.atLength,
      circularDistance: c.circularDistance,
    };
    if (c.run) p.run = true;
    if (c.hidden) p.hidden = true;
    if (c.endAtLength != null) p.endAtLength = c.endAtLength;
    if (c.endCircularDistance != null) p.endCircularDistance = c.endCircularDistance;
    if (c.indexIncrementDeg != null) p.indexIncrementDeg = c.indexIncrementDeg;
    if (c.spiral) p.spiral = true;
    if (c.spiralTravel != null) p.spiralTravel = c.spiralTravel;
    if (c.spiralTurns != null) p.spiralTurns = c.spiralTurns;
    if (c.spiralStarts != null) p.spiralStarts = c.spiralStarts;
    if (c.spiralStartDeg != null) p.spiralStartDeg = c.spiralStartDeg;
    if (c.spiralDir === 'cw' || c.spiralDir === 'ccw' || c.spiralDir === 'both') p.spiralDir = c.spiralDir;
    placements.push(p);
  }
  model.placements = placements;
  selectedId =
    snap.selectedId && model.placements.some((p) => p.id === snap.selectedId)
      ? snap.selectedId
      : model.placements[0]?.id ?? null;
  nextId = snap.nextId ?? nextId;
  historyLocked = false;
}

function undoRecipe() {
  if (!undoStack.length) return;
  redoStack.push(recipeSnapshot());
  applyRecipe(/** @type {ReturnType<typeof recipeSnapshot>} */ (undoStack.pop()));
  render({ rebuildSide: true, rebuild3d: true, forceFields: true });
}

function redoRecipe() {
  if (!redoStack.length) return;
  undoStack.push(recipeSnapshot());
  applyRecipe(/** @type {ReturnType<typeof recipeSnapshot>} */ (redoStack.pop()));
  render({ rebuildSide: true, rebuild3d: true, forceFields: true });
}

function syncHistoryButtons() {
  if (btnUndo) btnUndo.disabled = undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = redoStack.length === 0;
}

/** @type {import('./view-side.js').ViewBox | null} */
let sideView = hydrated?.sideView ?? savedSession?.sideView ?? savedUi?.sideView ?? null;

const stockTypeEl = /** @type {HTMLSelectElement} */ (document.getElementById('stockType'));
const stockLengthEl = /** @type {HTMLInputElement} */ (document.getElementById('stockLength'));
const stockSizeEl = /** @type {HTMLInputElement} */ (document.getElementById('stockSize'));
const sizeKindEl = document.getElementById('sizeKind');
const meshQualityEl = /** @type {HTMLInputElement} */ (document.getElementById('meshQuality'));
const meshQualityLabelEl = document.getElementById('meshQualityLabel');
const paletteEl = document.getElementById('bitPalette');
const placedListEl = document.getElementById('placedList');
const sideWrap = document.getElementById('side-wrap');
const threeWrap = document.getElementById('three-wrap');
const btnDelete = document.getElementById('btnDelete');
const btnUndo = /** @type {HTMLButtonElement} */ (document.getElementById('btnUndo'));
const btnRedo = /** @type {HTMLButtonElement} */ (document.getElementById('btnRedo'));
const btnFit = document.getElementById('btnFit');
const btnZoomIn = document.getElementById('btnZoomIn');
const btnZoomOut = document.getElementById('btnZoomOut');
const fileOpen = /** @type {HTMLInputElement} */ (document.getElementById('fileOpen'));
const fileOverlay = /** @type {HTMLInputElement} */ (document.getElementById('fileOverlay'));
const btnOverlay = document.getElementById('btnOverlay');
const btnOverlayClear = document.getElementById('btnOverlayClear');
const overlayOpWrap = document.getElementById('overlayOpWrap');
const overlayOpacityEl = /** @type {HTMLInputElement} */ (document.getElementById('overlayOpacity'));
const overlayNameEl = document.getElementById('overlayName');
const projectNameEl = document.getElementById('projectName');
const placeLengthEl = /** @type {HTMLInputElement} */ (document.getElementById('placeLength'));
const placeDiaEl = /** @type {HTMLInputElement} */ (document.getElementById('placeDia'));
const placeRunEl = /** @type {HTMLInputElement} */ (document.getElementById('placeRun'));
const runFieldsEl = document.getElementById('runFields');
const placeEndLengthEl = /** @type {HTMLInputElement} */ (document.getElementById('placeEndLength'));
const placeEndDiaEl = /** @type {HTMLInputElement} */ (document.getElementById('placeEndDia'));
const placeIndexEl = /** @type {HTMLInputElement} */ (document.getElementById('placeIndex'));
const indexFieldEl = document.getElementById('indexField');
const placeSpiralEl = /** @type {HTMLInputElement} */ (document.getElementById('placeSpiral'));
const spiralFieldsEl = document.getElementById('spiralFields');
const placeStartsEl = /** @type {HTMLInputElement} */ (document.getElementById('placeStarts'));
const placeStartDegEl = /** @type {HTMLInputElement} */ (document.getElementById('placeStartDeg'));
const placeSpiralTravelEl = /** @type {HTMLInputElement} */ (document.getElementById('placeSpiralTravel'));
const placeSpiralTurnsEl = /** @type {HTMLInputElement} */ (document.getElementById('placeSpiralTurns'));
const placeSpiralDirEl = /** @type {HTMLSelectElement} */ (document.getElementById('placeSpiralDir'));
const placeDiaLabelEl = document.getElementById('placeDiaLabel');
const placeEndDiaLabelEl = document.getElementById('placeEndDiaLabel');

const view3d = createView3d(threeWrap);
let meshQuality = clampMeshQuality(savedUi?.meshQuality);
view3d.setQuality(meshQuality);
if (meshQualityEl) meshQualityEl.value = String(meshQuality);
if (meshQualityLabelEl) meshQualityLabelEl.textContent = meshQualityLabel(meshQuality);

/** @type {import('./layout.js').PaneWidths | null} */
let paneWidths = savedUi?.panes ?? null;

bindSplitters({
  workspace: document.getElementById('workspace'),
  cuts: document.getElementById('paneCuts'),
  side: document.getElementById('paneSide'),
  three: document.getElementById('paneThree'),
  splitCuts: document.getElementById('splitCuts'),
  splitSide: document.getElementById('splitSide'),
  initial: paneWidths,
  onChange: (panes) => {
    paneWidths = panes;
    persistUi();
    render({ rebuildSide: true, rebuild3d: false });
    view3d.resize();
  },
});

/** @param {import('./stock.js').StockType} type */
function sizeKind(type) {
  if (type === 'round') return 'Diameter (in)';
  if (type === 'hex') return 'Across flats (in)';
  return 'Side (in)';
}

function readStockFromForm() {
  const type = /** @type {import('./stock.js').StockType} */ (stockTypeEl.value);
  const length = Math.max(4, Number(stockLengthEl.value) || model.stock.length);
  const size = Math.max(0.5, Number(sizeEl().value) || model.stock.size);
  model.stock.type = type;
  model.stock.length = length;
  model.stock.size = size;
  sizeKindEl.textContent = sizeKind(type);
}

function sizeEl() {
  return /** @type {HTMLInputElement} */ (document.getElementById('stockSize'));
}

stockTypeEl.addEventListener('change', () => {
  pushUndo();
  readStockFromForm();
  render({ resetCamera: true, rebuildSide: true });
});
stockLengthEl.addEventListener('change', () => {
  pushUndo();
  readStockFromForm();
  render({ resetCamera: true, rebuildSide: true });
});
stockSizeEl.addEventListener('change', () => {
  pushUndo();
  readStockFromForm();
  render({ resetCamera: true, rebuildSide: true });
});

meshQualityEl?.addEventListener('input', () => {
  meshQuality = clampMeshQuality(meshQualityEl.value);
  if (meshQualityLabelEl) meshQualityLabelEl.textContent = meshQualityLabel(meshQuality);
  view3d.setQuality(meshQuality);
  persistUi();
  document.body.style.cursor = meshQuality === 3 ? 'wait' : '';
  window.requestAnimationFrame(() => {
    render({ rebuildSide: false, rebuild3d: true });
    document.body.style.cursor = '';
  });
});

paletteEl.innerHTML = bits
  .map((b) => {
    const flute = b.kind === 'flute' || b.profile?.type === 'flute';
    return `<button class="bit${flute ? ' flute' : ''}" type="button" data-bit="${b.id}">${bitIconSVG(b.profile, { size: 28 })}<span class="nm">${b.name}</span></button>`;
  })
  .join('');

paletteEl.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('[data-bit]');
  if (!btn) return;
  const bit = bits.find((b) => b.id === btn.getAttribute('data-bit'));
  if (!bit) return;
  const id = `p${nextId++}`;
  const face = stockFaceRadius(model.stock);
  const center = sideView ? viewBoxCenter(sideView) : { radius: face, length: Math.min(4, model.stock.length / 2) };
  pushUndo();
  const fluteBit = bit.kind === 'flute' || bit.profile?.type === 'flute';
  /** @type {import('./geometry.js').Placement} */
  const cut = {
    id,
    bitId: bit.id,
    profile: bit.profile,
    atLength: clamp(center.length, 0, model.stock.length),
    // Plunge: nick the face. Flute: bearing rides the wood; DXF offset is applied in the views.
    circularDistance: Math.max(MIN_RADIUS, fluteBit ? face : face - 0.25),
  };
  if (isFlute(cut)) {
    cut.indexIncrementDeg = DEFAULT_FLUTE_INDEX_DEG;
    cut.run = true;
    const span = Math.min(6, Math.max(1, model.stock.length - cut.atLength));
    cut.endAtLength = clamp(cut.atLength + span, 0, model.stock.length);
    cut.endCircularDistance = cut.circularDistance;
  }
  model.placements.push(cut);
  selectedId = id;
  render({ rebuildSide: true });
});

btnUndo.addEventListener('click', () => undoRecipe());
btnRedo.addEventListener('click', () => redoRecipe());
btnDelete.addEventListener('click', () => {
  if (!selectedId) return;
  removeCut(selectedId);
});

btnFit.addEventListener('click', () => {
  const wrap = sideWrap.getBoundingClientRect();
  sideView = viewBoxFitBlank(model, wrap.width || 420, wrap.height || 640);
  render({ rebuildSide: true, rebuild3d: false });
});

function pinSide() {
  if (!sideView) return;
  const wrap = sideWrap.getBoundingClientRect();
  sideView = pinViewBoxLeft(sideView, model, wrap.width || 420, wrap.height || 640);
}

function zoomSide(factor) {
  if (!sideView) return;
  sideView = zoomViewBox(sideView, factor, viewBoxCenter(sideView));
  pinSide();
  render({ rebuildSide: true, rebuild3d: false });
}
btnZoomIn.addEventListener('click', () => zoomSide(1 / 1.25));
btnZoomOut.addEventListener('click', () => zoomSide(1.25));

function syncOverlayUi() {
  const has = !!(overlay && overlay.points.length >= 2);
  if (btnOverlayClear) btnOverlayClear.hidden = !has;
  if (overlayOpWrap) overlayOpWrap.hidden = !has;
  if (overlayNameEl) overlayNameEl.textContent = has ? overlay.name : '';
  if (has && overlayOpacityEl && document.activeElement !== overlayOpacityEl) {
    overlayOpacityEl.value = String(overlay.opacity);
  }
}

btnOverlay?.addEventListener('click', () => {
  if (!fileOverlay) return;
  fileOverlay.value = '';
  fileOverlay.click();
});
btnOverlayClear?.addEventListener('click', () => {
  overlay = null;
  syncOverlayUi();
  render({ rebuildSide: true, rebuild3d: false });
});
overlayOpacityEl?.addEventListener('input', () => {
  if (!overlay) return;
  overlay = { ...overlay, opacity: Number(overlayOpacityEl.value) || 0 };
  render({ rebuildSide: true, rebuild3d: false });
});
if (fileOverlay) {
  fileOverlay.onchange = async () => {
    const file = fileOverlay.files?.[0];
    if (!file) return;
    try {
      const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
      const points = importDxfOverlay(text);
      overlay = { name: file.name, points, opacity: overlay?.opacity ?? 55 };
      syncOverlayUi();
      render({ rebuildSide: true, rebuild3d: false });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not read that DXF as a profile overlay.');
    } finally {
      fileOverlay.value = '';
    }
  };
}

placedListEl.addEventListener('click', (e) => {
  const hideBtn = /** @type {HTMLElement} */ (e.target).closest('[data-hide]');
  if (hideBtn) {
    const item = hideBtn.closest('[data-placed]');
    const id = item?.getAttribute('data-placed') || hideBtn.getAttribute('data-hide');
    if (id) toggleCutHidden(id);
    return;
  }
  const delBtn = /** @type {HTMLElement} */ (e.target).closest('[data-remove]');
  if (delBtn) {
    const item = delBtn.closest('[data-placed]');
    const id = item?.getAttribute('data-placed');
    if (id) removeCut(id);
    return;
  }
  const moveBtn = /** @type {HTMLElement} */ (e.target).closest('[data-move]');
  if (moveBtn) {
    const item = moveBtn.closest('[data-placed]');
    const id = item?.getAttribute('data-placed');
    if (!id || moveBtn.hasAttribute('disabled')) return;
    selectedId = id;
    pushUndo();
    movePlacement(id, moveBtn.getAttribute('data-move') === 'up' ? -1 : 1);
    render({ rebuildSide: true, rebuild3d: false });
    return;
  }
  const item = /** @type {HTMLElement} */ (e.target).closest('[data-placed]');
  if (!item) return;
  selectedId = item.getAttribute('data-placed');
  render({ rebuildSide: true, rebuild3d: false });
});

placedListEl.addEventListener('dragstart', (e) => {
  if (/** @type {HTMLElement} */ (e.target).closest('[data-move], [data-remove], [data-hide]')) {
    e.preventDefault();
    return;
  }
  const item = /** @type {HTMLElement} */ (e.target).closest('[data-placed]');
  if (!item || !e.dataTransfer) return;
  const id = item.getAttribute('data-placed');
  if (!id) return;
  e.dataTransfer.setData('text/plain', id);
  e.dataTransfer.effectAllowed = 'move';
  item.classList.add('dragging');
  selectedId = id;
});

placedListEl.addEventListener('dragend', () => {
  placedListEl.querySelectorAll('.dragging, .drag-over').forEach((el) => {
    el.classList.remove('dragging', 'drag-over');
  });
});

placedListEl.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  const over = /** @type {HTMLElement} */ (e.target).closest('[data-placed]');
  placedListEl.querySelectorAll('.drag-over').forEach((el) => el.classList.remove('drag-over'));
  if (over) over.classList.add('drag-over');
});

placedListEl.addEventListener('drop', (e) => {
  e.preventDefault();
  const id = e.dataTransfer?.getData('text/plain');
  const over = /** @type {HTMLElement} */ (e.target).closest('[data-placed]');
  placedListEl.querySelectorAll('.dragging, .drag-over').forEach((el) => {
    el.classList.remove('dragging', 'drag-over');
  });
  if (!id || !over) return;
  const overId = over.getAttribute('data-placed');
  if (!overId) return;
  const rect = over.getBoundingClientRect();
  pushUndo();
  movePlacementRelative(id, overId, e.clientY > rect.top + rect.height / 2);
  selectedId = id;
  render({ rebuildSide: true, rebuild3d: false });
});

placeLengthEl.addEventListener('input', () => applyPlaceLength(true));
placeLengthEl.addEventListener('change', () => applyPlaceLength(false));
placeDiaEl.addEventListener('input', () => applyPlaceDia(true));
placeDiaEl.addEventListener('change', () => applyPlaceDia(false));
placeEndLengthEl.addEventListener('input', () => applyPlaceEndLength(true));
placeEndLengthEl.addEventListener('change', () => applyPlaceEndLength(false));
placeEndDiaEl.addEventListener('input', () => applyPlaceEndDia(true));
placeEndDiaEl.addEventListener('change', () => applyPlaceEndDia(false));
placeIndexEl.addEventListener('input', () => applyPlaceIndex(true));
placeIndexEl.addEventListener('change', () => applyPlaceIndex(false));
placeStartsEl?.addEventListener('input', () => applyPlaceStarts(true));
placeStartsEl?.addEventListener('change', () => applyPlaceStarts(false));
placeStartDegEl?.addEventListener('input', () => applyPlaceStartDeg(true));
placeStartDegEl?.addEventListener('change', () => applyPlaceStartDeg(false));
placeSpiralTravelEl?.addEventListener('input', () => applyPlaceSpiralTravel(true));
placeSpiralTravelEl?.addEventListener('change', () => applyPlaceSpiralTravel(false));
placeSpiralTurnsEl?.addEventListener('input', () => applyPlaceSpiralTurns(true));
placeSpiralTurnsEl?.addEventListener('change', () => applyPlaceSpiralTurns(false));
placeSpiralDirEl?.addEventListener('change', () => applyPlaceSpiralDir());

/** @param {HTMLInputElement} el */
function armFieldUndo(el) {
  el.addEventListener('focus', () => {
    el.dataset.undoArmed = '1';
  });
  el.addEventListener('input', () => {
    if (el.dataset.undoArmed === '1') {
      pushUndo();
      el.dataset.undoArmed = '0';
    }
  });
}
armFieldUndo(placeLengthEl);
armFieldUndo(placeDiaEl);
armFieldUndo(placeEndLengthEl);
armFieldUndo(placeEndDiaEl);
armFieldUndo(placeIndexEl);
if (placeStartsEl) armFieldUndo(placeStartsEl);
if (placeStartDegEl) armFieldUndo(placeStartDegEl);
if (placeSpiralTravelEl) armFieldUndo(placeSpiralTravelEl);
if (placeSpiralTurnsEl) armFieldUndo(placeSpiralTurnsEl);
placeSpiralDirEl?.addEventListener('focus', () => {
  if (placeSpiralDirEl) placeSpiralDirEl.dataset.undoArmed = '1';
});
armFieldUndo(stockLengthEl);
armFieldUndo(stockSizeEl);
placeRunEl.addEventListener('change', () => {
  const p = selectedPlacement();
  if (!p) return;
  pushUndo();
  if (placeRunEl.checked) {
    p.run = true;
    if (p.endAtLength == null || p.endCircularDistance == null) {
      const span = Math.min(6, Math.max(1, model.stock.length - p.atLength));
      p.endAtLength = clamp(p.atLength + span, 0, model.stock.length);
      p.endCircularDistance = p.circularDistance;
    }
  } else {
    p.run = false;
    if (p.spiral) disableSpiral(p);
  }
  render({ rebuildSide: true });
});

placeSpiralEl?.addEventListener('change', () => {
  const p = selectedPlacement();
  if (!p) return;
  pushUndo();
  if (placeSpiralEl.checked) {
    p.run = true;
    if (p.endAtLength == null || p.endCircularDistance == null) {
      const span = Math.min(6, Math.max(1, model.stock.length - p.atLength));
      p.endAtLength = clamp(p.atLength + span, 0, model.stock.length);
      p.endCircularDistance = p.circularDistance;
    }
    enableSpiral(p);
  } else {
    disableSpiral(p);
  }
  render({ rebuildSide: true });
});

/** @param {boolean} live */
function applyPlaceLength(live) {
  const p = selectedPlacement();
  if (!p || placeLengthEl.value === '') return;
  const n = Number(placeLengthEl.value);
  if (!Number.isFinite(n)) return;
  p.atLength = clamp(n, 0, model.stock.length);
  render({ live, rebuild3d: !live });
}
/** @param {boolean} live */
function applyPlaceDia(live) {
  const p = selectedPlacement();
  if (!p || placeDiaEl.value === '') return;
  const n = Number(placeDiaEl.value);
  if (!Number.isFinite(n)) return;
  const maxCd = stockMaxRadius(model.stock) + profileMaxDepth(p.profile);
  p.circularDistance = clamp(n / 2, MIN_RADIUS, maxCd);
  render({ live, rebuild3d: !live });
}
/** @param {boolean} live */
function applyPlaceEndLength(live) {
  const p = selectedPlacement();
  if (!p || !isRun(p) || placeEndLengthEl.value === '') return;
  const n = Number(placeEndLengthEl.value);
  if (!Number.isFinite(n)) return;
  p.endAtLength = clamp(n, 0, model.stock.length);
  render({ live, rebuildSide: true, rebuild3d: !live });
}
/** @param {boolean} live */
function applyPlaceEndDia(live) {
  const p = selectedPlacement();
  if (!p || !isRun(p) || placeEndDiaEl.value === '') return;
  const n = Number(placeEndDiaEl.value);
  if (!Number.isFinite(n)) return;
  const maxCd = stockMaxRadius(model.stock) + profileMaxDepth(p.profile);
  p.endCircularDistance = clamp(n / 2, MIN_RADIUS, maxCd);
  render({ live, rebuildSide: true, rebuild3d: !live });
}

/** @param {boolean} live */
function applyPlaceIndex(live) {
  const p = selectedPlacement();
  if (!p || !isFlute(p) || isSpiral(p) || placeIndexEl.value === '') return;
  const n = Number(placeIndexEl.value);
  if (!Number.isFinite(n)) return;
  p.indexIncrementDeg = clamp(n, 1, 180);
  render({ live, rebuild3d: !live });
}

/** @param {boolean} live */
function applyPlaceStarts(live) {
  const p = selectedPlacement();
  if (!p || !isSpiral(p) || !placeStartsEl || placeStartsEl.value === '') return;
  const n = Number(placeStartsEl.value);
  if (!Number.isFinite(n)) return;
  p.spiralStarts = clamp(Math.round(n), 1, 36);
  render({ live, rebuild3d: !live });
}

/** @param {boolean} live */
function applyPlaceStartDeg(live) {
  const p = selectedPlacement();
  if (!p || !isSpiral(p) || !placeStartDegEl || placeStartDegEl.value === '') return;
  const n = Number(placeStartDegEl.value);
  if (!Number.isFinite(n)) return;
  p.spiralStartDeg = n;
  render({ live, rebuild3d: !live });
}

/** @param {boolean} live */
function applyPlaceSpiralTravel(live) {
  const p = selectedPlacement();
  if (!p || !isSpiral(p) || !placeSpiralTravelEl || placeSpiralTravelEl.value === '') return;
  const n = Number(placeSpiralTravelEl.value);
  if (!Number.isFinite(n) || Math.abs(n) < 1e-9) return;
  p.spiralTravel = n;
  render({ live, rebuild3d: !live });
}

/** @param {boolean} live */
function applyPlaceSpiralTurns(live) {
  const p = selectedPlacement();
  if (!p || !isSpiral(p) || !placeSpiralTurnsEl || placeSpiralTurnsEl.value === '') return;
  const n = Number(placeSpiralTurnsEl.value);
  if (!Number.isFinite(n)) return;
  p.spiralTurns = n;
  render({ live, rebuild3d: !live });
}

function applyPlaceSpiralDir() {
  const p = selectedPlacement();
  if (!p || !isSpiral(p) || !placeSpiralDirEl) return;
  const v = placeSpiralDirEl.value;
  if (v !== 'cw' && v !== 'ccw' && v !== 'both') return;
  if (placeSpiralDirEl.dataset.undoArmed === '1') {
    pushUndo();
    placeSpiralDirEl.dataset.undoArmed = '0';
  }
  p.spiralDir = v;
  render({ rebuild3d: true });
}

{
  const el = document.getElementById('btnOpen');
  if (el && el.parentNode) {
    const next = el.cloneNode(true);
    el.parentNode.replaceChild(next, el);
    next.addEventListener('click', () => {
      fileOpen.value = '';
      fileOpen.click();
    });
  }
}
fileOpen.onchange = async () => {
  const file = fileOpen.files?.[0];
  if (!file) return;
  try {
    const text = new TextDecoder('utf-8').decode(await file.arrayBuffer());
    loadProjectText(text, file.name);
  } catch {
    window.alert('Could not read that file.');
  } finally {
    fileOpen.value = '';
  }
};

/** @param {string} text @param {string} [filename] */
function loadProjectText(text, filename) {
  if (!String(text ?? '').replace(/^\uFEFF/, '').trim()) {
    window.alert('That file is empty.');
    return;
  }
  let data = parseProjectJson(text);
  if (typeof data === 'string') data = parseProjectJson(data);
  if (data == null || typeof data !== 'object') {
    window.alert('Could not read that file as a spindle project.');
    return;
  }
  applyProject(data, filename);
}

function projectSnapshotJson() {
  return JSON.stringify(
    serializeProject(model, {
      selectedId,
      sideView,
      camera3d: view3d.getCamera(),
      overlay,
    }),
    null,
    2
  );
}

let lastSaveName = PROJECT_FILENAME;

function setProjectLabel(filename) {
  if (filename) lastSaveName = lompDownloadName(filename);
  if (!projectNameEl) return;
  const n = model.placements.length;
  projectNameEl.textContent = filename
    ? `${lastSaveName} · ${n} cut${n === 1 ? '' : 's'}`
    : '';
}

function saveProjectFile() {
  const json = projectSnapshotJson();
  if (!json || json.length < 16) {
    window.alert('Nothing to save.');
    return;
  }
  const name = lompDownloadName(lastSaveName);
  downloadText(json, name);
  setProjectLabel(name);
}

{
  const w = /** @type {any} */ (window);
  if (typeof w.__lompSaveListener === 'function') {
    document.removeEventListener('click', w.__lompSaveListener, true);
    w.__lompSaveListener = undefined;
  }
  const el = document.getElementById('btnSaveLomp');
  if (el && el.parentNode) {
    const next = el.cloneNode(true);
    el.parentNode.replaceChild(next, el);
    next.addEventListener('click', () => saveProjectFile());
  }
}

/** @param {unknown} data @param {string} [filename] */
function applyProject(data, filename) {
  const loaded = deserializeProject(data, bits);
  if (!loaded) {
    window.alert('That file is not a spindle project.');
    return;
  }
  dragBit = null;
  pan = null;
  const active = document.activeElement;
  if (active instanceof HTMLElement) active.blur();
  model.stock = { ...loaded.model.stock };
  model.placements = loaded.model.placements.map((p) => ({ ...p }));
  selectedId = loaded.selectedId && model.placements.some((p) => p.id === loaded.selectedId)
    ? loaded.selectedId
    : model.placements[0]?.id ?? null;
  nextId = 1 + model.placements.reduce((m, p) => {
    const n = Number(String(p.id).replace(/^p/, ''));
    return Number.isFinite(n) ? Math.max(m, n) : m;
  }, 1);
  if (loaded.missing.length) {
    window.alert(`Missing bits (not in bits/): ${loaded.missing.join(', ')}`);
  }
  setProjectLabel(filename);
  sideView = loaded.sideView;
  overlay = loaded.overlay;
  const cam = loaded.camera3d?.layout === CAMERA3D_LAYOUT ? loaded.camera3d : null;
  cameraFramed = Boolean(cam);
  clearHistory();
  render({ resetCamera: !cam, rebuildSide: true, rebuild3d: true, forceFields: true });
  if (cam) view3d.setCamera(cam);
  persistSessionNow();
}

/** @param {number} n */
function fmt(n) {
  return n.toFixed(2);
}

function selectedPlacement() {
  return model.placements.find((p) => p.id === selectedId) ?? null;
}

/** @param {string} id */
function removeCut(id) {
  const i = model.placements.findIndex((p) => p.id === id);
  if (i < 0) return;
  pushUndo();
  model.placements.splice(i, 1);
  if (selectedId === id) {
    selectedId = model.placements[i]?.id ?? model.placements[i - 1]?.id ?? null;
  }
  render({ rebuildSide: true, rebuild3d: true });
}

/** @param {string} id */
function toggleCutHidden(id) {
  const p = model.placements.find((x) => x.id === id);
  if (!p) return;
  pushUndo();
  p.hidden = !isCutHidden(p);
  render({ rebuildSide: true, rebuild3d: true });
}

/** @param {boolean} hidden */
function eyeIconSvg(hidden) {
  const slash = hidden
    ? '<path fill="none" stroke="currentColor" stroke-width="1.5" d="M3 13 L13 3"/>'
    : '';
  return (
    `<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">` +
    `<path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.5 8s2.8-4.5 6.5-4.5S14.5 8 14.5 8 11.7 12.5 8 12.5 1.5 8 1.5 8z"/>` +
    `<circle cx="8" cy="8" r="1.8" fill="currentColor"/>` +
    slash +
    `</svg>`
  );
}

/**
 * @param {string} id
 * @param {number} delta
 */
function movePlacement(id, delta) {
  const i = model.placements.findIndex((p) => p.id === id);
  if (i < 0) return;
  const j = i + delta;
  if (j < 0 || j >= model.placements.length) return;
  const [item] = model.placements.splice(i, 1);
  model.placements.splice(j, 0, item);
}

/**
 * @param {string} id
 * @param {string} overId
 * @param {boolean} after
 */
function movePlacementRelative(id, overId, after) {
  if (id === overId) return;
  const from = model.placements.findIndex((p) => p.id === id);
  if (from < 0) return;
  const [item] = model.placements.splice(from, 1);
  let to = model.placements.findIndex((p) => p.id === overId);
  if (to < 0) {
    model.placements.splice(from, 0, item);
    return;
  }
  if (after) to += 1;
  model.placements.splice(to, 0, item);
}

function renderPlacedList() {
  if (!model.placements.length) {
    placedListEl.innerHTML = '<p class="meta" style="color:var(--muted);font-size:12px;">None yet — click a bit to add a cut.</p>';
    return;
  }
  const last = model.placements.length - 1;
  placedListEl.innerHTML = model.placements
    .map((p, i) => {
      const bit = bits.find((b) => b.id === p.bitId);
      const name = bit ? bit.name : p.bitId;
      const sel = p.id === selectedId ? ' selected' : '';
      const hidden = isCutHidden(p);
      const run = isRun(p);
      const flute = isFlute(p);
      const wrap = isSpiral(p);
      const idx = flute && !wrap ? ` · ${p.indexIncrementDeg ?? DEFAULT_FLUTE_INDEX_DEG}°` : '';
      const spiralMeta = wrap
        ? ` · ${p.spiralStarts ?? 1} start${(p.spiralStarts ?? 1) === 1 ? '' : 's'} · ${p.spiralTravel ?? DEFAULT_SPIRAL_TRAVEL}:${p.spiralTurns ?? DEFAULT_SPIRAL_TURNS} · ${p.spiralDir === 'both' ? 'both' : p.spiralDir === 'ccw' ? 'ccw' : 'cw'}`
        : '';
      const meta = run
        ? `${fmt(p.atLength)}–${fmt(/** @type {number} */ (p.endAtLength))}" · Ø${fmt(p.circularDistance * 2)}→${fmt(/** @type {number} */ (p.endCircularDistance) * 2)}${idx}${spiralMeta}`
        : `${fmt(p.atLength)}" from top · ${fmt(p.circularDistance * 2)}" dia${idx}`;
      const hideTitle = hidden ? 'Show cut' : 'Hide cut';
      return (
        `<div class="placed-item${sel}${hidden ? ' cut-hidden' : ''}" data-placed="${p.id}" draggable="true">` +
        `<span class="placed-num" title="Drag to reorder">${i + 1}</span>` +
        `<button class="placed-main" type="button" draggable="false">` +
        `${name}${run ? ' · run' : ''}${wrap ? ' · spiral' : flute ? ' · flute' : ''}${hidden ? ' · hidden' : ''}` +
        `<span class="meta">${meta}</span>` +
        `</button>` +
        `<span class="placed-ord">` +
        `<button type="button" draggable="false" data-move="up" ${i === 0 ? 'disabled' : ''} title="Move up" aria-label="Move cut ${i + 1} up">▲</button>` +
        `<button type="button" draggable="false" data-move="down" ${i === last ? 'disabled' : ''} title="Move down" aria-label="Move cut ${i + 1} down">▼</button>` +
        `</span>` +
        `<span class="placed-tools">` +
        `<button class="placed-del" type="button" draggable="false" data-remove="${p.id}" title="Remove cut" aria-label="Remove cut ${i + 1}">×</button>` +
        `<button class="placed-hide" type="button" draggable="false" data-hide="${p.id}" title="${hideTitle}" aria-label="${hideTitle} ${i + 1}">${eyeIconSvg(hidden)}</button>` +
        `</span>` +
        `</div>`
      );
    })
    .join('');
}

function syncPlaceFields(force = false) {
  const p = selectedPlacement();
  const disabled = !p;
  const flute = Boolean(p && isFlute(p));
  const wrap = Boolean(p && isSpiral(p));
  const run = Boolean(p && isRun(p));
  placeLengthEl.disabled = disabled;
  placeDiaEl.disabled = disabled;
  placeRunEl.disabled = disabled;
  placeEndLengthEl.disabled = disabled;
  placeEndDiaEl.disabled = disabled;
  placeIndexEl.disabled = disabled || !flute || wrap;
  if (placeSpiralEl) placeSpiralEl.disabled = disabled;
  if (placeStartsEl) placeStartsEl.disabled = disabled || !wrap;
  if (placeStartDegEl) placeStartDegEl.disabled = disabled || !wrap;
  if (placeSpiralTravelEl) placeSpiralTravelEl.disabled = disabled || !wrap;
  if (placeSpiralTurnsEl) placeSpiralTurnsEl.disabled = disabled || !wrap;
  if (placeSpiralDirEl) placeSpiralDirEl.disabled = disabled || !wrap;
  btnDelete.toggleAttribute('disabled', disabled);
  if (!p) {
    if (force || document.activeElement !== placeLengthEl) placeLengthEl.value = '';
    if (force || document.activeElement !== placeDiaEl) placeDiaEl.value = '';
    if (force || document.activeElement !== placeEndLengthEl) placeEndLengthEl.value = '';
    if (force || document.activeElement !== placeEndDiaEl) placeEndDiaEl.value = '';
    if (force || document.activeElement !== placeIndexEl) placeIndexEl.value = '';
    if (placeStartsEl && (force || document.activeElement !== placeStartsEl)) placeStartsEl.value = '';
    if (placeStartDegEl && (force || document.activeElement !== placeStartDegEl)) placeStartDegEl.value = '';
    if (placeSpiralTravelEl && (force || document.activeElement !== placeSpiralTravelEl)) placeSpiralTravelEl.value = '';
    if (placeSpiralTurnsEl && (force || document.activeElement !== placeSpiralTurnsEl)) placeSpiralTurnsEl.value = '';
    if (placeSpiralDirEl && (force || document.activeElement !== placeSpiralDirEl)) placeSpiralDirEl.value = 'cw';
    placeRunEl.checked = false;
    if (placeSpiralEl) placeSpiralEl.checked = false;
    runFieldsEl.hidden = true;
    if (spiralFieldsEl) spiralFieldsEl.hidden = true;
    if (indexFieldEl) indexFieldEl.hidden = true;
    if (placeDiaLabelEl) placeDiaLabelEl.textContent = 'Diameter at tip (in)';
    if (placeEndDiaLabelEl) placeEndDiaLabelEl.textContent = 'End diameter at tip (in)';
    return;
  }
  if (indexFieldEl) indexFieldEl.hidden = !flute || wrap;
  if (spiralFieldsEl) spiralFieldsEl.hidden = !run || !wrap;
  if (placeDiaLabelEl) placeDiaLabelEl.textContent = flute ? 'Diameter at bearing (in)' : 'Diameter at tip (in)';
  if (placeEndDiaLabelEl) {
    placeEndDiaLabelEl.textContent = flute ? 'End diameter at bearing (in)' : 'End diameter at tip (in)';
  }
  if (force || document.activeElement !== placeRunEl) placeRunEl.checked = run;
  if (placeSpiralEl && (force || document.activeElement !== placeSpiralEl)) placeSpiralEl.checked = wrap;
  runFieldsEl.hidden = !run;
  if (force || document.activeElement !== placeLengthEl) placeLengthEl.value = String(roundPlace(p.atLength));
  if (force || document.activeElement !== placeDiaEl) placeDiaEl.value = String(roundPlace(p.circularDistance * 2));
  if (flute && !wrap && (force || document.activeElement !== placeIndexEl)) {
    placeIndexEl.value = String(roundPlace(p.indexIncrementDeg ?? DEFAULT_FLUTE_INDEX_DEG));
  }
  if (wrap) {
    if (placeStartsEl && (force || document.activeElement !== placeStartsEl)) {
      placeStartsEl.value = String(p.spiralStarts ?? 1);
    }
    if (placeStartDegEl && (force || document.activeElement !== placeStartDegEl)) {
      placeStartDegEl.value = String(roundPlace(p.spiralStartDeg ?? 0));
    }
    if (placeSpiralTravelEl && (force || document.activeElement !== placeSpiralTravelEl)) {
      placeSpiralTravelEl.value = String(roundPlace(p.spiralTravel ?? DEFAULT_SPIRAL_TRAVEL));
    }
    if (placeSpiralTurnsEl && (force || document.activeElement !== placeSpiralTurnsEl)) {
      placeSpiralTurnsEl.value = String(roundPlace(p.spiralTurns ?? DEFAULT_SPIRAL_TURNS));
    }
    if (placeSpiralDirEl && (force || document.activeElement !== placeSpiralDirEl)) {
      placeSpiralDirEl.value =
        p.spiralDir === 'ccw' || p.spiralDir === 'both' ? p.spiralDir : 'cw';
    }
  }
  if (run) {
    if (force || document.activeElement !== placeEndLengthEl) {
      placeEndLengthEl.value = String(roundPlace(/** @type {number} */ (p.endAtLength)));
    }
    if (force || document.activeElement !== placeEndDiaEl) {
      placeEndDiaEl.value = String(roundPlace(/** @type {number} */ (p.endCircularDistance) * 2));
    }
  }
}

function roundPlace(n) {
  return Math.round(n * 1000) / 1000;
}

function persistUi() {
  saveUi({
    panes: paneWidths,
    sideView,
    selectedId,
    meshQuality,
  });
}

let persistTimer = 0;
function sessionPayload() {
  return {
    stock: { ...model.stock },
    cuts: model.placements.map((p) => ({
      id: p.id,
      bitId: p.bitId,
      atLength: p.atLength,
      circularDistance: p.circularDistance,
      run: Boolean(p.run),
      ...(p.hidden ? { hidden: true } : {}),
      ...(p.endAtLength != null && p.endCircularDistance != null
        ? { endAtLength: p.endAtLength, endCircularDistance: p.endCircularDistance }
        : {}),
      ...(isFlute(p) ? { indexIncrementDeg: p.indexIncrementDeg ?? DEFAULT_FLUTE_INDEX_DEG } : {}),
      ...(isSpiral(p)
        ? {
            spiral: true,
            spiralTravel: p.spiralTravel,
            spiralTurns: p.spiralTurns,
            spiralStarts: p.spiralStarts,
            spiralStartDeg: p.spiralStartDeg,
            spiralDir: p.spiralDir,
          }
        : {}),
    })),
    selectedId,
    sideView,
    camera3d: view3d.getCamera(),
    overlay,
  };
}
function persistSession() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => persistSessionNow(), 150);
}
function persistSessionNow() {
  window.clearTimeout(persistTimer);
  saveSession(sessionPayload());
  persistUi();
}
window.addEventListener('pagehide', () => {
  persistSessionNow();
});

function ensureView() {
  const wrap = sideWrap.getBoundingClientRect();
  if (!sideView) sideView = defaultViewBox(model, wrap.width || 420, wrap.height || 640);
  return wrap;
}

/** @type {number} */
let pending3d = 0;

/** @param {{ resetCamera?: boolean, rebuildSide?: boolean, rebuild3d?: boolean, live?: boolean, forceFields?: boolean }} [opts] */
function render(opts = {}) {
  const live = Boolean(dragBit || pan || opts.live);
  const forceFields = Boolean(opts.forceFields);
  if (forceFields || document.activeElement !== stockTypeEl) stockTypeEl.value = model.stock.type;
  if (forceFields || document.activeElement !== stockLengthEl) stockLengthEl.value = String(model.stock.length);
  const sizeInput = sizeEl();
  if (forceFields || document.activeElement !== sizeInput) sizeInput.value = String(model.stock.size);
  sizeKindEl.textContent = sizeKind(model.stock.type);

  const wrap = ensureView();
  const svg = /** @type {SVGSVGElement | null} */ (sideWrap.querySelector('svg'));
  const rebuildSide = opts.rebuildSide !== false && !dragBit && !pan;
  if (rebuildSide || !svg) {
    const w = Math.max(200, wrap.width || 420);
    const h = Math.max(200, wrap.height || 640);
    const html = renderSideSVG(model, { selectedId, width: w, height: h, viewBox: sideView, overlay });
    const hint = sideWrap.querySelector('.hint');
    sideWrap.innerHTML = html;
    if (hint) sideWrap.appendChild(hint);
  } else if (sideView) {
    patchSideSVG(svg, model, selectedId, sideView);
  }

  const rebuild3d = opts.rebuild3d ?? !live;
  if (rebuild3d) {
    const resetCamera = Boolean(opts.resetCamera) || !cameraFramed;
    if (pending3d) cancelAnimationFrame(pending3d);
    pending3d = requestAnimationFrame(() => {
      pending3d = 0;
      view3d.update(model, { rebuild: true, resetCamera });
      cameraFramed = true;
    });
  } else if (opts.resetCamera) {
    view3d.update(model, {
      rebuild: false,
      resetCamera: true,
    });
    cameraFramed = true;
  }

  if (!dragBit && !pan) {
    renderPlacedList();
    persistSession();
  }
  syncPlaceFields(forceFields);
  syncHistoryButtons();
  syncOverlayUi();
}

/** @type {{ id: string, end: boolean, startLen: number, startCd: number, startEndLen?: number, startEndCd?: number, startP: {radius: number, length: number} } | null} */
let dragBit = null;
/** @type {{ startView: import('./view-side.js').ViewBox, startX: number, startY: number, inchPerPxX: number, inchPerPxY: number } | null} */
let pan = null;

sideWrap.addEventListener('pointerdown', (e) => {
  const svg = sideWrap.querySelector('svg');
  if (!svg || !sideView) return;
  const t = /** @type {Element} */ (e.target);
  const id = t.getAttribute?.('data-placement') || t.closest?.('[data-placement]')?.getAttribute('data-placement');
  const pos = clientToSideInches(svg, e.clientX, e.clientY);
  if (!pos) return;

  if (id) {
    selectedId = id;
    const p = selectedPlacement();
    if (!p) return;
    const end = Boolean(t.getAttribute?.('data-end') || t.closest?.('[data-end]'));
    pushUndo();
    dragBit = {
      id: p.id,
      end,
      startLen: p.atLength,
      startCd: p.circularDistance,
      startEndLen: p.endAtLength,
      startEndCd: p.endCircularDistance,
      startP: pos,
    };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    render();
    return;
  }

  const a = clientToSideInches(svg, e.clientX, e.clientY);
  const b = clientToSideInches(svg, e.clientX + 100, e.clientY + 100);
  if (!a || !b) return;
  pan = {
    startView: { ...sideView },
    startX: e.clientX,
    startY: e.clientY,
    inchPerPxX: (b.radius - a.radius) / 100,
    inchPerPxY: (b.length - a.length) / 100,
  };
  svg.classList.add('panning');
  svg.setPointerCapture(e.pointerId);
  e.preventDefault();
});

sideWrap.addEventListener('pointermove', (e) => {
  const svg = sideWrap.querySelector('svg');
  if (!svg || !sideView) return;

  if (dragBit) {
    const pos = clientToSideInches(svg, e.clientX, e.clientY);
    if (!pos) return;
    const p = model.placements.find((pl) => pl.id === dragBit.id);
    if (!p) return;
    const maxCd = stockMaxRadius(model.stock) + profileMaxDepth(p.profile);
    const dLen = pos.length - dragBit.startP.length;
    const dCd = pos.radius - dragBit.startP.radius;
    if (dragBit.end && isRun(p) && dragBit.startEndLen != null && dragBit.startEndCd != null) {
      p.endAtLength = clamp(dragBit.startEndLen + dLen, 0, model.stock.length);
      p.endCircularDistance = clamp(dragBit.startEndCd + dCd, MIN_RADIUS, maxCd);
    } else {
      p.atLength = clamp(dragBit.startLen + dLen, 0, model.stock.length);
      p.circularDistance = clamp(dragBit.startCd + dCd, MIN_RADIUS, maxCd);
    }
    render();
    return;
  }

  if (pan) {
    const dx = (e.clientX - pan.startX) * pan.inchPerPxX;
    const dy = (e.clientY - pan.startY) * pan.inchPerPxY;
    sideView = {
      xMin: pan.startView.xMin - dx,
      yMin: pan.startView.yMin - dy,
      width: pan.startView.width,
      height: pan.startView.height,
    };
    pinSide();
    render();
  }
});

function endPointer() {
  const droppedBit = Boolean(dragBit);
  dragBit = null;
  pan = null;
  const svg = sideWrap.querySelector('svg');
  if (svg) svg.classList.remove('panning');
  if (droppedBit) {
    discardUndoIfUnchanged();
    render({ rebuildSide: true, rebuild3d: true });
  } else persistSession();
}
sideWrap.addEventListener('pointerup', endPointer);
sideWrap.addEventListener('pointercancel', endPointer);

sideWrap.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const svg = sideWrap.querySelector('svg');
    if (!svg || !sideView) return;
    if (e.shiftKey) {
      const wrap = sideWrap.getBoundingClientRect();
      const inchPerPxY = sideView.height / (wrap.height || 1);
      sideView = panViewBox(sideView, 0, -e.deltaY * inchPerPxY);
      pinSide();
      render({ rebuild3d: false });
      return;
    }
    const pos = clientToSideInches(svg, e.clientX, e.clientY);
    if (!pos) return;
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    sideView = zoomViewBox(sideView, factor, pos);
    pinSide();
    render({ rebuildSide: true, rebuild3d: false });
  },
  { passive: false }
);

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z') {
    e.preventDefault();
    if (e.shiftKey) redoRecipe();
    else undoRecipe();
  } else if (key === 'y') {
    e.preventDefault();
    redoRecipe();
  }
});

stockTypeEl.value = model.stock.type;
stockLengthEl.value = String(model.stock.length);
stockSizeEl.value = String(model.stock.size);
sizeKindEl.textContent = sizeKind(model.stock.type);

const framedCamera = savedCamera3d?.layout === CAMERA3D_LAYOUT ? savedCamera3d : null;
if (framedCamera) cameraFramed = true;
render({ resetCamera: !framedCamera, rebuildSide: true });
if (framedCamera) view3d.setCamera(framedCamera);
window.addEventListener('resize', () => {
  render({ rebuildSide: true, rebuild3d: false });
  view3d.resize();
});
