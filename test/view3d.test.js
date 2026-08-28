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

  it('clamps 3D quality to Fast / Better / Best', () => {
    expect(clampMeshQuality(1)).toBe(1);
    expect(clampMeshQuality(2.4)).toBe(2);
    expect(clampMeshQuality('3')).toBe(3);
    expect(clampMeshQuality(99)).toBe(1);
  });
});
