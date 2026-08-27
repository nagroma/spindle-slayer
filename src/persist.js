// @ts-check
import { isRun, isCutHidden } from './geometry.js';

export const UI_KEY = 'legacy1200.ui';
export const SESSION_KEY = 'legacy1200.session';
export const PROJECT_FORMAT = 'legacy-1200-project';
export const PROJECT_VERSION = 1;
export const PROJECT_FILENAME = 'spindle.lomp';

/** @param {unknown} raw @param {string} [fallback] */
export function lompDownloadName(raw, fallback = PROJECT_FILENAME) {
  let name = String(raw ?? '').trim();
  name = name.split(/[/\\]/).pop() ?? '';
  name = name.replace(/[?%*:|"<>]/g, '-');
  if (!name || name === '.' || name === '..') name = fallback;
  if (!/\.lomp$/i.test(name)) name += '.lomp';
  return name;
}

export const PROJECT_FILE_TYPES = [
  {
    description: 'LOMP (*.lomp)',
    accept: { 'application/x-legacy-ornamental-planner': ['.lomp'] },
  },
];
export const PROJECT_OPEN_PICKER = {
  multiple: false,
  types: PROJECT_FILE_TYPES,
  excludeAcceptAllOption: false,
  id: 'legacy1200-lomp',
};
export const PROJECT_SAVE_PICKER = {
  suggestedName: PROJECT_FILENAME,
  types: [
    {
      description: 'LOMP (*.lomp)',
      accept: { 'text/plain': ['.lomp'] },
    },
  ],
  excludeAcceptAllOption: false,
  id: 'legacy1200-lomp',
};

/**
 * @typedef {{ cuts: number, side: number, three: number }} PaneWidths
 * @typedef {{ xMin: number, yMin: number, width: number, height: number }} ViewBox
 * @typedef {{ x: number, y: number, z: number }} Vec3
 * @typedef {{ position: Vec3, target: Vec3, up?: Vec3, layout?: string }} Camera3d
 * @typedef {{
 *   panes?: PaneWidths,
 *   sideView?: ViewBox | null,
 *   selectedId?: string | null,
 * }} UiState
 * @typedef {{
 *   stock: import('./stock.js').Stock,
 *   cuts: {
 *     id: string,
 *     bitId: string,
 *     atLength: number,
 *     circularDistance: number,
 *     run?: boolean,
 *     hidden?: boolean,
 *     endAtLength?: number,
 *     endCircularDistance?: number,
 *   }[],
 *   selectedId?: string | null,
 *   sideView?: ViewBox | null,
 *   camera3d?: Camera3d | null,
 * }} SessionState
 */

/** @param {string} key */
function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** @returns {UiState | null} */
export function loadUi() {
  return readJson(UI_KEY);
}

/** @param {UiState} ui */
export function saveUi(ui) {
  localStorage.setItem(UI_KEY, JSON.stringify(ui));
}

/** @returns {SessionState | null} */
export function loadSession() {
  const data = readJson(SESSION_KEY);
  if (!data || !data.stock || !Array.isArray(data.cuts)) return null;
  return data;
}

/** @param {SessionState} session */
export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

/**
 * @param {import('./geometry.js').Model} model
 * @param {{ selectedId?: string | null, sideView?: ViewBox | null, camera3d?: Camera3d | null }} [extra]
 */
export function serializeProject(model, extra = {}) {
  /** @type {Record<string, unknown>} */
  const file = {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    stock: { ...model.stock },
    cuts: model.placements.map((p) => {
      /** @type {Record<string, unknown>} */
      const cut = {
        id: p.id,
        bitId: p.bitId,
        atLength: p.atLength,
        circularDistance: p.circularDistance,
        diameterAtTip: p.circularDistance * 2,
      };
      if (isCutHidden(p)) cut.hidden = true;
      if (isRun(p)) {
        cut.run = true;
        cut.endAtLength = p.endAtLength;
        cut.endCircularDistance = p.endCircularDistance;
        cut.endDiameterAtTip = /** @type {number} */ (p.endCircularDistance) * 2;
      }
      return cut;
    }),
    selectedId: extra.selectedId ?? null,
  };
  const sideView = parseViewBox(extra.sideView);
  if (sideView) file.sideView = sideView;
  const camera3d = parseCamera3d(extra.camera3d);
  if (camera3d) file.camera3d = camera3d;
  return file;
}

/**
 * @param {string} text
 * @returns {unknown | null}
 */
export function parseProjectJson(text) {
  const cleaned = String(text ?? '').replace(/^\uFEFF/, '').trim();
  if (!cleaned) return null;
  try {
    let data = JSON.parse(cleaned);
    if (typeof data === 'string') {
      data = JSON.parse(data.replace(/^\uFEFF/, '').trim());
    }
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {unknown} data
 * @param {import('./bits.js').Bit[]} bits
 * @returns {{
 *   model: import('./geometry.js').Model,
 *   selectedId: string | null,
 *   missing: string[],
 *   sideView: ViewBox | null,
 *   camera3d: Camera3d | null,
 * } | null}
 */
export function deserializeProject(data, bits) {
  if (!data || typeof data !== 'object') return null;
  const obj = /** @type {any} */ (data);
  if (obj.format && obj.format !== PROJECT_FORMAT) return null;
  const stock = obj.stock;
  const length = Number(stock?.length);
  const size = Number(stock?.size);
  if (!Number.isFinite(length) || !Number.isFinite(size) || length <= 0 || size <= 0) return null;
  const type = stock.type === 'round' || stock.type === 'hex' ? stock.type : 'square';
  const cuts = Array.isArray(obj.cuts) ? obj.cuts : Array.isArray(obj.placements) ? obj.placements : [];
  /** @type {string[]} */
  const missing = [];
  /** @type {import('./geometry.js').Placement[]} */
  const placements = [];
  for (const c of cuts) {
    if (!c || typeof c.bitId !== 'string') continue;
    const bit = bits.find((b) => b.id === c.bitId);
    if (!bit) {
      missing.push(c.bitId);
      continue;
    }
    const id = typeof c.id === 'string' ? c.id : `p${placements.length + 1}`;
    const atLength = Number(c.atLength);
    let circularDistance = Number(c.circularDistance);
    if (!Number.isFinite(circularDistance) && Number.isFinite(Number(c.diameterAtTip))) {
      circularDistance = Number(c.diameterAtTip) / 2;
    }
    if (!Number.isFinite(atLength) || !Number.isFinite(circularDistance)) continue;
    /** @type {import('./geometry.js').Placement} */
    const placement = {
      id,
      bitId: bit.id,
      profile: bit.profile,
      atLength,
      circularDistance,
    };
    let endAtLength = Number(c.endAtLength);
    let endCircularDistance = Number(c.endCircularDistance);
    if (!Number.isFinite(endCircularDistance) && Number.isFinite(Number(c.endDiameterAtTip))) {
      endCircularDistance = Number(c.endDiameterAtTip) / 2;
    }
    const endsPresent = Number.isFinite(endAtLength) && Number.isFinite(endCircularDistance);
    if (endsPresent) {
      placement.endAtLength = endAtLength;
      placement.endCircularDistance = endCircularDistance;
    }
    if (c.run === true || (c.run !== false && endsPresent)) {
      placement.run = true;
    }
    if (c.hidden === true) placement.hidden = true;
    placements.push(placement);
  }
  return {
    model: {
      stock: { type, length, size },
      placements,
    },
    selectedId: typeof obj.selectedId === 'string' ? obj.selectedId : placements[0]?.id ?? null,
    missing,
    sideView: parseViewBox(obj.sideView),
    camera3d: parseCamera3d(obj.camera3d),
  };
}

/**
 * @param {import('./bits.js').Bit[]} bits
 * @param {SessionState} session
 */
export function hydrateSession(bits, session) {
  return deserializeProject(
    {
      format: PROJECT_FORMAT,
      version: PROJECT_VERSION,
      stock: session.stock,
      cuts: session.cuts,
      selectedId: session.selectedId,
      sideView: session.sideView,
      camera3d: session.camera3d,
    },
    bits
  );
}

/**
 * @param {string} json
 * @param {string} filename
 */
export function downloadText(json, filename) {
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(json);
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.dispatchEvent(new MouseEvent('click'));
  window.setTimeout(() => a.remove(), 0);
}

/** @param {unknown} raw @returns {ViewBox | null} */
export function parseViewBox(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v = /** @type {any} */ (raw);
  const xMin = Number(v.xMin);
  const yMin = Number(v.yMin);
  const width = Number(v.width);
  const height = Number(v.height);
  if (![xMin, yMin, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { xMin, yMin, width, height };
}

/** @param {unknown} raw @returns {Vec3 | null} */
function parseVec3(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const v = /** @type {any} */ (raw);
  const x = Number(v.x);
  const y = Number(v.y);
  const z = Number(v.z);
  if (![x, y, z].every(Number.isFinite)) return null;
  return { x, y, z };
}

/** @param {unknown} raw @returns {Camera3d | null} */
export function parseCamera3d(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const position = parseVec3(/** @type {any} */ (raw).position);
  const target = parseVec3(/** @type {any} */ (raw).target);
  if (!position || !target) return null;
  const up = parseVec3(/** @type {any} */ (raw).up);
  const layout = typeof /** @type {any} */ (raw).layout === 'string' ? /** @type {any} */ (raw).layout : undefined;
  if (up && layout) return { position, target, up, layout };
  if (up) return { position, target, up };
  return { position, target };
}

/**
 * Write UTF-8 bytes through the File System Access API.
 * Windows Chromium/Edge can leave a 0-byte file for string or JSON-typed writes.
 * @param {{ createWritable: Function, getFile: Function, queryPermission?: Function, requestPermission?: Function }} handle
 * @param {string} text
 * @returns {Promise<number>} bytes on disk after close
 */
export async function writeTextToFileHandle(handle, text) {
  if (typeof handle.queryPermission === 'function' && typeof handle.requestPermission === 'function') {
    let perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') throw new Error('permission-denied');
  }
  const bytes = new TextEncoder().encode(text);
  const blob = new Blob([bytes], { type: 'text/plain;charset=utf-8' });
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const attempts = [
    async () => {
      const writable = await handle.createWritable({ keepExistingData: false });
      await blob.stream().pipeTo(writable);
    },
    async () => writeStream(handle, blob),
    async () => writeStream(handle, buffer),
    async () => writeStream(handle, bytes),
    async () => writeStream(handle, { type: 'write', position: 0, data: blob }),
  ];
  let size = 0;
  for (const run of attempts) {
    try {
      await run();
    } catch {
      continue;
    }
    size = await fileSize(handle);
    if (size >= bytes.length) return size;
  }
  return size;
}

/** @param {{ createWritable: Function }} handle @param {BufferSource | Blob | { type: string, position?: number, data: unknown }} data */
async function writeStream(handle, data) {
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    try {
      await writable.abort();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

/** @param {{ getFile: Function }} handle */
async function fileSize(handle) {
  for (const wait of [0, 40, 120]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const n = (await handle.getFile()).size;
      if (n > 0) return n;
    } catch {
      /* retry */
    }
  }
  try {
    return (await handle.getFile()).size;
  } catch {
    return 0;
  }
}
