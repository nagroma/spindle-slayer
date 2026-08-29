import { describe, it, expect } from 'vitest';
import { millToWorld, buildSpindleGeometry, camera3dFramePose, CAMERA3D_LAYOUT, clampMeshQuality } from '../src/view3d.js';

describe('3D mill axes', () => {
  it('maps length down (−Y) so the headstock is at the top', () => {
    expect(millToWorld(1.5, 0, 0)[0]).toBeCloseTo(1.5, 10);
    expect(millToWorld(1.5, 0, 0)[1]).toBeCloseTo(0, 10);
    expect(millToWorld(1.5, 0, 0)[2]).toBeCloseTo(0, 10);
    expect(millToWorld(1.5, 0, 10)).toEqual([1.5, -10, 0]);
    expect(millToWorld(1, 90, 10)[1]).toBe(-10);
    expect(millToWorld(1, 90, 10)[0]).toBeCloseTo(0, 10);
    expect(millToWorld(1, 90, 10)[2]).toBeCloseTo(1, 10);
  });

  it('builds a mesh with the foot cap at −Y (below the headstock)', () => {
    const model = {
      stock: { type: 'round', length: 12, size: 2 },
      placements: [],
    };
    const geo = buildSpindleGeometry(model);
    const pos = geo.getAttribute('position');
    const last = pos.count - 1;
    expect(pos.getX(last)).toBeCloseTo(0, 8);
    expect(pos.getY(last)).toBeCloseTo(-12, 8);
    expect(pos.getZ(last)).toBeCloseTo(0, 8);
    geo.dispose();
  });

  it('frames the whole spindle to fill a tall pane, looking slightly from above', () => {
    const pose = camera3dFramePose(34, 1.75 * Math.SQRT2, 0.55, 32);
    expect(pose.layout).toBe(CAMERA3D_LAYOUT);
    expect(pose.target.y).toBeCloseTo(-17, 6);
    expect(pose.position.y).toBeGreaterThan(pose.target.y);
    const dist = Math.hypot(
      pose.position.x - pose.target.x,
      pose.position.y - pose.target.y,
      pose.position.z - pose.target.z
    );
    expect(dist).toBeGreaterThan(34);
  });

  it('finer 3D quality builds a denser mesh', () => {
    const model = {
      stock: { type: 'round', length: 12, size: 2 },
      placements: [],
    };
    const fast = buildSpindleGeometry(model, 1);
    const best = buildSpindleGeometry(model, 3);
    expect(best.getAttribute('position').count).toBeGreaterThan(fast.getAttribute('position').count);
    fast.dispose();
    best.dispose();
  });

  it('builds a Fast barley-twist mesh without hanging', () => {
    const model = {
      stock: { type: 'round', length: 24, size: 3 },
      placements: [
        {
          id: 's1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 2,
          circularDistance: 1.25,
          run: true,
          endAtLength: 22,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 2,
          spiralTurns: 1,
          spiralStarts: 4,
          spiralStartDeg: 0,
          spiralDir: 'both',
        },
      ],
    };
    const t0 = performance.now();
    const geo = buildSpindleGeometry(model, 1);
    expect(performance.now() - t0).toBeLessThan(2500);
    expect(geo.getAttribute('position').count).toBeGreaterThan(100);
    geo.dispose();
  });

  it('spiral ribbon follows the helix instead of a constant theta', () => {
    const model = {
      stock: { type: 'round', length: 20, size: 3.5 },
      placements: [
        {
          id: 's1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 8,
          circularDistance: 1.25,
          run: true,
          endAtLength: 14,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 4,
          spiralTurns: 1,
          spiralStarts: 1,
          spiralStartDeg: 17,
          spiralDir: 'cw',
        },
      ],
    };
    const geo = buildSpindleGeometry(model, 1);
    const pos = geo.getAttribute('position');
    /**
     * @param {number} length
     * @param {number} expectDeg
     */
    function deepestNear(length, expectDeg) {
      let bestR = Infinity;
      let theta = 0;
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) + length) > 0.12) continue;
        const rr = Math.hypot(pos.getX(i), pos.getZ(i));
        if (rr < 0.4 || rr > 1.6) continue;
        if (rr < bestR) {
          bestR = rr;
          theta = (Math.atan2(pos.getZ(i), pos.getX(i)) * 180) / Math.PI;
        }
      }
      expect(bestR).toBeLessThan(1.4);
      let d = (theta - expectDeg) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      expect(Math.abs(d)).toBeLessThan(12);
    }
    deepestNear(8, 17);
    deepestNear(10, 197);
    geo.dispose();
  });

  it('does not open the blank outside the spiral', () => {
    const model = {
      stock: { type: 'round', length: 20, size: 3.5 },
      placements: [
        {
          id: 's1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 8,
          circularDistance: 1.25,
          run: true,
          endAtLength: 14,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 4,
          spiralTurns: 1,
          spiralStarts: 1,
          spiralStartDeg: 17,
          spiralDir: 'cw',
        },
      ],
    };
    const geo = buildSpindleGeometry(model, 1);
    const pos = geo.getAttribute('position');
    let minR = Infinity;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i) + 2) > 0.15) continue;
      const rr = Math.hypot(pos.getX(i), pos.getZ(i));
      if (rr < 0.2) continue;
      if (rr < minR) minR = rr;
    }
    expect(minR).toBeGreaterThan(1.6);
    geo.dispose();
  });

  it('uses 32-bit indices when Best has more than 65k vertices', () => {
    const model = {
      stock: { type: 'round', length: 34, size: 3.5 },
      placements: [],
    };
    const geo = buildSpindleGeometry(model, 3);
    const pos = geo.getAttribute('position');
    const idx = geo.getIndex();
    expect(pos.count).toBeGreaterThan(65535);
    expect(idx).toBeTruthy();
    expect(idx.array.BYTES_PER_ELEMENT).toBe(4);
    const last = pos.count - 1;
    let pointsAtLast = false;
    for (let i = 0; i < idx.count; i++) {
      if (idx.getX(i) === last) {
        pointsAtLast = true;
        break;
      }
    }
    expect(pointsAtLast).toBe(true);
    geo.dispose();
  });

  it('does not twist square stock outside the spiral', () => {
    const model = {
      stock: { type: 'square', length: 20, size: 3.5 },
      placements: [
        {
          id: 's1',
          bitId: 'round-half',
          profile: { type: 'round', r: 0.5 },
          atLength: 8,
          circularDistance: 1.25,
          run: true,
          endAtLength: 14,
          endCircularDistance: 1.25,
          spiral: true,
          spiralTravel: 4,
          spiralTurns: 1,
          spiralStarts: 1,
          spiralStartDeg: 17,
          spiralDir: 'cw',
        },
      ],
    };
    const geo = buildSpindleGeometry(model, 1);
    const pos = geo.getAttribute('position');
    /**
     * @param {number} length
     */
    function ringThetas(length) {
      /** @type {number[]} */
      const th = [];
      for (let i = 0; i < pos.count; i++) {
        if (Math.abs(pos.getY(i) + length) > 0.08) continue;
        const rr = Math.hypot(pos.getX(i), pos.getZ(i));
        if (rr < 0.4) continue;
        th.push((Math.atan2(pos.getZ(i), pos.getX(i)) * 180) / Math.PI);
      }
      th.sort((a, b) => a - b);
      return th;
    }
    const a = ringThetas(1);
    const b = ringThetas(2);
    expect(a.length).toBeGreaterThan(8);
    expect(a.length).toBe(b.length);
    for (let i = 0; i < a.length; i++) {
      let d = (a[i] - b[i]) % 360;
      if (d > 180) d -= 360;
      if (d < -180) d += 360;
      expect(Math.abs(d)).toBeLessThan(2);
    }
    geo.dispose();
  });

  it('keeps a round blank’s ends at the stock radius', () => {
    const model = {
      stock: { type: 'round', length: 12, size: 2 },
      placements: [],
    };
    const geo = buildSpindleGeometry(model, 1);
    const pos = geo.getAttribute('position');
    let n = 0;
    for (let i = 0; i < pos.count; i++) {
      if (Math.abs(pos.getY(i)) > 0.02) continue;
      const rr = Math.hypot(pos.getX(i), pos.getZ(i));
      if (rr < 0.4) continue;
      expect(rr).toBeCloseTo(1, 3);
      n += 1;
    }
    expect(n).toBeGreaterThan(8);
    geo.dispose();
  });
});
