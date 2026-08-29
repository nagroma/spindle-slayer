// @ts-check
// 3D preview: remaining radius on a grid. Inside a spiral/flute run the
// columns twist with the helix. Outside that run they stay locked to the
// stock (square faces stay square; round ends stay a cylinder).

import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { bakeCutRadii, remainingFromCut, sampleStations, visibleGroovePlacements, grooveAnglesAt, grooveRadiiAtThetas, isRun, isFlute } from './geometry.js';
import { stockMaxRadius } from './stock.js';
import { fluteCutDepth, profileMaxRadius } from './profile.js';

/**
 * @typedef {import('./geometry.js').Model} Model
 */

/**
 * Mill coordinates → Three.js world.
 * Length along −Y so the headstock is at the top (same as 2D: length down).
 * Left-right drag then spins around the spindle. θ = 0° is +X (a square/hex face).
 * @param {number} radius
 * @param {number} thetaDeg
 * @param {number} length
 * @returns {[number, number, number]}
 */
export function millToWorld(radius, thetaDeg, length) {
  const rad = (thetaDeg * Math.PI) / 180;
  return [radius * Math.cos(rad), -length, radius * Math.sin(rad)];
}

/** Saved 3D cameras from older framing are ignored so a new default can fill the pane. */
export const CAMERA3D_LAYOUT = 'headstock-up-fill';

/**
 * Mesh density for the 3D preview. 1 is the original fast/coarse mesh.
 * @typedef {1 | 2 | 3} MeshQuality
 * @typedef {{
 *   nTheta: number,
 *   dense: boolean,
 *   perInch: number,
 *   perInchMax: number,
 *   flutePerInch: number,
 *   flutePosesPerInch: number,
 *   ribbonAcross: number,
 * }} MeshQualityOpts
 */

/** @type {Record<MeshQuality, MeshQualityOpts>} */
export const MESH_QUALITY = {
  1: { nTheta: 96, dense: false, perInch: 4, perInchMax: 240, flutePerInch: 12, flutePosesPerInch: 8, ribbonAcross: 11 },
  2: { nTheta: 180, dense: true, perInch: 12, perInchMax: 560, flutePerInch: 20, flutePosesPerInch: 16, ribbonAcross: 17 },
  3: { nTheta: 288, dense: true, perInch: 24, perInchMax: 960, flutePerInch: 32, flutePosesPerInch: 24, ribbonAcross: 25 },
};

/** @param {unknown} n @returns {MeshQuality} */
export function clampMeshQuality(n) {
  const q = Math.round(Number(n));
  if (q === 2 || q === 3) return /** @type {MeshQuality} */ (q);
  return 1;
}

/** @param {MeshQuality} level */
export function meshQualityLabel(level) {
  if (level === 3) return 'Best';
  if (level === 2) return 'Better';
  return 'Fast';
}

/**
 * Three-quarter view, slightly from above, whole spindle filling ~88% of the pane.
 * @param {number} length
 * @param {number} maxR
 * @param {number} aspect width/height
 * @param {number} [fovDeg]
 */
export function camera3dFramePose(length, maxR, aspect, fovDeg = 32) {
  const len = Math.max(0.5, length);
  const r = Math.max(0.2, maxR);
  const elev = (18 * Math.PI) / 180;
  const azim = (42 * Math.PI) / 180;
  const midY = -len / 2;
  const fovY = (fovDeg * Math.PI) / 180;
  const asp = Math.max(0.2, aspect);
  const projH = len * Math.cos(elev) + 2 * r * Math.sin(elev);
  const projW = 2 * r * (Math.abs(Math.cos(azim)) + Math.abs(Math.sin(azim)));
  const distV = projH / 2 / Math.tan(fovY / 2);
  const distH = projW / 2 / (Math.tan(fovY / 2) * asp);
  const d = Math.max(distV, distH, 6) / 0.88;
  const horiz = d * Math.cos(elev);
  return {
    target: { x: 0, y: midY, z: 0 },
    position: {
      x: horiz * Math.cos(azim),
      y: midY + d * Math.sin(elev),
      z: horiz * Math.sin(azim),
    },
    up: { x: 0, y: 1, z: 0 },
    layout: CAMERA3D_LAYOUT,
  };
}

/**
 * @param {Model} model
 * @param {MeshQuality} [quality]
 * @returns {THREE.BufferGeometry}
 */
export function buildSpindleGeometry(model, quality = 1) {
  const q = MESH_QUALITY[clampMeshQuality(quality)];
  const stock = model.stock;
  const { length } = stock;
  const range = grooveMeshRange(model);
  const xs = sampleStations(model, {
    dense: q.dense,
    perInch: q.perInch,
    perInchMax: q.perInchMax,
    flutePerInch: q.flutePerInch,
  });
  if (range) {
    const pad = 1e-4;
    const set = new Set(xs);
    set.add(range.lo);
    set.add(range.hi);
    set.add(Math.max(0, range.lo - pad));
    set.add(Math.min(length, range.hi + pad));
    xs.length = 0;
    xs.push(...[...set].sort((a, b) => a - b));
  }
  const cuts = bakeCutRadii(model, xs);
  const nTheta = q.nTheta;
  const cols = nTheta + 1;
  const nx = xs.length - 1;
  const grooves = visibleGroovePlacements(model);
  const ref = grooves[0] ?? null;

  const positions = [];
  /** @type {boolean[]} */
  const helical = [];
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const cut = cuts[i];
    const inSweep = Boolean(range && x >= range.lo - 1e-9 && x <= range.hi + 1e-9);
    helical.push(inSweep);
    const base = inSweep && ref ? grooveAnglesAt(ref, x)[0] : 0;
    /** @type {number[]} */
    const thetas = [];
    for (let j = 0; j <= nTheta; j++) thetas.push(base + (360 * j) / nTheta);
    const grooveRow = inSweep ? grooveRadiiAtThetas(model, x, thetas, q.flutePosesPerInch) : null;
    for (let j = 0; j <= nTheta; j++) {
      const theta = thetas[j];
      const groove = grooveRow ? grooveRow[j] : Number.POSITIVE_INFINITY;
      const r = remainingFromCut(stock, theta, Math.min(cut, groove));
      positions.push(...millToWorld(r, theta, x));
    }
  }

  const indices = [];
  for (let i = 0; i < nx; i++) {
    if (helical[i] !== helical[i + 1]) continue;
    for (let j = 0; j < nTheta; j++) {
      const a = i * cols + j;
      const b = a + cols;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  const nRing = cols;
  const headRim = positions.length / 3;
  for (let j = 0; j < nRing; j++) {
    positions.push(positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]);
  }
  const headCenter = positions.length / 3;
  positions.push(0, 0, 0);
  for (let j = 0; j < nTheta; j++) {
    indices.push(headCenter, headRim + j + 1, headRim + j);
    indices.push(headCenter, headRim + j, headRim + j + 1);
  }

  const footSrc = nx * cols;
  const footRim = positions.length / 3;
  for (let j = 0; j < nRing; j++) {
    const s = (footSrc + j) * 3;
    positions.push(positions[s], positions[s + 1], positions[s + 2]);
  }
  const footCenter = positions.length / 3;
  positions.push(0, -length, 0);
  for (let j = 0; j < nTheta; j++) {
    indices.push(footCenter, footRim + j, footRim + j + 1);
    indices.push(footCenter, footRim + j + 1, footRim + j);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  setMeshIndex(geo, indices);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Length range where a flute/spiral actually cuts, including bit reach.
 * @param {Model} model
 * @returns {{ lo: number, hi: number } | null}
 */
function grooveMeshRange(model) {
  const gs = visibleGroovePlacements(model);
  if (!gs.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of gs) {
    const a = p.atLength;
    const b = isRun(p) && p.endAtLength != null ? p.endAtLength : a;
    const reach = grooveReach(p);
    lo = Math.min(lo, Math.min(a, b) - reach);
    hi = Math.max(hi, Math.max(a, b) + reach);
  }
  const { length } = model.stock;
  return { lo: Math.max(0, lo), hi: Math.min(length, hi) };
}

/** @param {import('./geometry.js').Placement} p */
function grooveReach(p) {
  if (isFlute(p)) {
    const d = fluteCutDepth(/** @type {import('./profile.js').FluteProfile} */ (p.profile));
    return d > 0 ? d : 0.25;
  }
  const maxR = profileMaxRadius(p.profile);
  return Number.isFinite(maxR) && maxR !== Infinity ? maxR : 0.5;
}

/**
 * Better/Best meshes exceed 65,535 vertices. A 16-bit index wraps, so the
 * end caps attach to the wrong points and the spindle looks like a pipe.
 * @param {THREE.BufferGeometry} geo
 * @param {number[]} indices
 */
function setMeshIndex(geo, indices) {
  let max = 0;
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] > max) max = indices[i];
  }
  const ArrayType = max > 65535 ? Uint32Array : Uint16Array;
  geo.setIndex(new THREE.BufferAttribute(new ArrayType(indices), 1));
}

/**
 * @param {HTMLElement} container
 */
export function createView3d(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101110);

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 500);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.appendChild(renderer.domElement);

  const controls = new TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 3.2;
  controls.zoomSpeed = 1.2;
  controls.panSpeed = 0.6;
  controls.dynamicDampingFactor = 0.12;

  scene.add(new THREE.AmbientLight(0x554433, 1.15));
  const key = new THREE.DirectionalLight(0xffe8c8, 1.05);
  key.position.set(8, 12, -6);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xc4b49a, 0.4);
  fill.position.set(2, -14, 4);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0x88aacc, 0.45);
  rim.position.set(-10, 4, 8);
  scene.add(rim);

  const material = new THREE.MeshStandardMaterial({
    color: 0xc99a5f,
    roughness: 0.55,
    metalness: 0.04,
    side: THREE.DoubleSide,
  });

  /** @type {THREE.Mesh | null} */
  let mesh = null;
  /** @type {Model | null} */
  let framedModel = null;
  let autoFrame = true;
  /** @type {MeshQuality} */
  let meshQuality = 1;

  controls.addEventListener('start', () => {
    autoFrame = false;
  });

  /**
   * @param {Model} model
   */
  function frame(model) {
    framedModel = model;
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    const pose = camera3dFramePose(model.stock.length, stockMaxRadius(model.stock), camera.aspect, camera.fov);
    camera.up.set(pose.up.x, pose.up.y, pose.up.z);
    controls.target.set(pose.target.x, pose.target.y, pose.target.z);
    camera.position.set(pose.position.x, pose.position.y, pose.position.z);
    const dist = camera.position.distanceTo(controls.target);
    camera.near = Math.max(0.05, dist / 200);
    camera.far = Math.max(400, dist * 6, model.stock.length * 4);
    camera.updateProjectionMatrix();
    controls.handleResize();
    controls.update();
  }

  function getCamera() {
    return {
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: controls.target.x, y: controls.target.y, z: controls.target.z },
      up: { x: camera.up.x, y: camera.up.y, z: camera.up.z },
      layout: CAMERA3D_LAYOUT,
    };
  }

  /**
   * @param {import('./persist.js').Camera3d | null | undefined} state
   * @returns {boolean} whether the saved camera was applied
   */
  function setCamera(state) {
    if (!state?.up || state.layout !== CAMERA3D_LAYOUT) return false;
    autoFrame = false;
    camera.position.set(state.position.x, state.position.y, state.position.z);
    camera.up.set(state.up.x, state.up.y, state.up.z);
    controls.target.set(state.target.x, state.target.y, state.target.z);
    camera.updateProjectionMatrix();
    controls.handleResize();
    controls.update();
    return true;
  }

  /**
   * @param {Model} model
   * @param {{ resetCamera?: boolean, rebuild?: boolean }} [opts]
   */
  function update(model, opts = {}) {
    framedModel = model;
    if (opts.rebuild !== false) {
      const geo = buildSpindleGeometry(model, meshQuality);
      if (mesh) {
        mesh.geometry.dispose();
        mesh.geometry = geo;
      } else {
        mesh = new THREE.Mesh(geo, material);
        scene.add(mesh);
      }
    }
    if (opts.resetCamera) {
      autoFrame = true;
      resize();
      frame(model);
    } else {
      resize();
    }
  }

  function resize() {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    controls.handleResize();
  }

  let raf = 0;
  function tick() {
    raf = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  }
  tick();

  const ro = new ResizeObserver(() => {
    resize();
    if (autoFrame && framedModel) frame(framedModel);
  });
  ro.observe(container);

  return {
    update,
    resize,
    getCamera,
    setCamera,
    /** @param {unknown} level */
    setQuality(level) {
      meshQuality = clampMeshQuality(level);
    },
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      if (mesh) mesh.geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
