import { describe, it, expect } from 'vitest';
import { remainingSilhouettePath, bitProfilePath, renderSideSVG, bitIconSVG, viewBoxFitBlank, pinViewBoxLeft, SIDE_MARGIN_PX } from '../src/view-side.js';
import { faceRadiusAt } from '../src/geometry.js';
import { plungeEnvelope, profilePoints } from '../src/profile.js';

const pommel = {
  stock: { type: 'square', length: 34, size: 3.5 },
  placements: [
    {
      id: 'p1',
      bitId: 'round-1',
      profile: { type: 'round', r: 1 },
      atLength: 4,
      circularDistance: 1.5,
    },
  ],
};

describe('side view', () => {
  it('remaining silhouette is a closed path', () => {
    const d = remainingSilhouettePath(pommel);
    expect(d.startsWith('M ')).toBe(true);
    expect(d.endsWith(' Z')).toBe(true);
  });

  it('bit profile path places the tip at circularDistance, atLength', () => {
    const d = bitProfilePath(pommel.placements[0]);
    expect(d.startsWith('M 1.5 4')).toBe(true);
  });

  it('remaining wood at a bit station matches the bit envelope', () => {
    const p = pommel.placements[0];
    const pts = profilePoints(p.profile);
    const mid = pts[Math.floor(pts.length / 2)];
    const x = p.atLength + mid.r;
    const remain = faceRadiusAt(pommel, x);
    const env = plungeEnvelope(p.profile, p.circularDistance, mid.r);
    expect(remain).toBeCloseTo(Math.min(1.75, env), 6);
  });

  it('renders an SVG with centerline, remaining wood, and the bit', () => {
    const svg = renderSideSVG(pommel, { selectedId: 'p1' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('class="centerline"');
    expect(svg).toContain('class="remaining"');
    expect(svg).toContain('data-placement="p1"');
    expect(svg).toContain('class="bit selected"');
  });

  it('a deep plunge removes wood out to the original face, not a buried hole', () => {
    const deep = {
      stock: { type: 'square', length: 10, size: 3.5 },
      placements: [
        {
          id: 'p1',
          bitId: 'round-1',
          profile: { type: 'round', r: 0.5 },
          atLength: 5,
          circularDistance: 0,
        },
      ],
    };
    expect(faceRadiusAt(deep, 5)).toBeLessThan(0.05);
    expect(faceRadiusAt(deep, 0)).toBeCloseTo(1.75, 6);
    const remain = remainingSilhouettePath(deep);
    expect(remain).toContain('0.02 5');
    const svg = renderSideSVG(deep, { selectedId: 'p1' });
    expect(svg).toContain(remain);
    expect(svg).not.toContain('wood-mask');
  });

  it('builds a profile icon svg', () => {
    const icon = bitIconSVG(pommel.placements[0].profile);
    expect(icon).toContain('<svg');
    expect(icon).toContain('<path');
  });

  it('draws a square shoulder on a ½″ endmill, not a long diagonal', () => {
    const model = {
      stock: { type: 'square', length: 10, size: 3.5 },
      placements: [
        {
          id: 'p1',
          bitId: 'Endmill_1_2',
          profile: {
            type: 'points',
            points: [
              { d: 0, r: 0 },
              { d: 0, r: 0.25 },
              { d: 0.5, r: 0.25 },
            ],
          },
          atLength: 4,
          circularDistance: 1.5,
        },
      ],
    };
    const d = remainingSilhouettePath(model);
    const pairs = [...d.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => ({
      r: Number(m[1]),
      x: Number(m[2]),
    }));
    const right = [];
    for (const p of pairs) {
      if (p.r < 0) break;
      right.push(p);
    }
    const shoulder = [];
    for (let i = 1; i < right.length; i++) {
      const a = right[i - 1];
      const b = right[i];
      if (a.x > 3.9 && a.r < 1.6 && b.r > 1.7) shoulder.push([a, b]);
    }
    expect(shoulder.length).toBeGreaterThan(0);
    for (const [a, b] of shoulder) {
      expect(Math.abs(b.x - a.x)).toBeLessThan(0.02);
    }
  });

  it('draws a grabbable end pose when the cut is a run', () => {
    const model = {
      stock: { type: 'square', length: 20, size: 3.5 },
      placements: [
        {
          id: 'p1',
          bitId: 'round-1',
          profile: { type: 'round', r: 1 },
          atLength: 4,
          circularDistance: 1.5,
          run: true,
          endAtLength: 10,
          endCircularDistance: 1.2,
        },
      ],
    };
    const svg = renderSideSVG(model, { selectedId: 'p1' });
    expect(svg).toContain('class="bit-end selected"');
    expect(svg).toContain('data-end="true"');
    expect(svg).toContain('cy="10"');
  });

  it('omits a hidden cut from the drawing but keeps remaining wood uncut', () => {
    const model = {
      stock: { type: 'square', length: 10, size: 3.5 },
      placements: [
        {
          id: 'p1',
          bitId: 'round-1',
          profile: { type: 'round', r: 1 },
          atLength: 4,
          circularDistance: 1.5,
          hidden: true,
        },
      ],
    };
    const svg = renderSideSVG(model, { selectedId: 'p1' });
    expect(svg).not.toContain('data-placement="p1"');
    expect(faceRadiusAt(model, 4)).toBeCloseTo(1.75, 6);
  });

  it('Fit 2D is top-left justified with a small pixel margin, extra space on the right', () => {
    const vb = viewBoxFitBlank(pommel, 400, 800);
    expect(vb.height).toBeGreaterThan(pommel.stock.length);
    expect(vb.yMin).toBeCloseTo(-SIDE_MARGIN_PX * (vb.height / 800), 6);
    expect(vb.xMin).toBeCloseTo(-1.75 - SIDE_MARGIN_PX * (vb.width / 400), 6);
    expect(vb.width / vb.height).toBeCloseTo(400 / 800, 6);
  });

  it('pins extra zoom-out space to the right, not the left', () => {
    const fit = viewBoxFitBlank(pommel, 400, 800);
    const wide = { ...fit, width: fit.width * 2, xMin: fit.xMin - 10 };
    const pinned = pinViewBoxLeft(wide, pommel, 400, 800);
    const margin = SIDE_MARGIN_PX * (wide.width / 400);
    expect(pinned.xMin).toBeCloseTo(-1.75 - margin, 6);
    expect(pinned.xMin).toBeGreaterThan(wide.xMin);
    expect(pinned.width).toBe(wide.width);
  });
});
