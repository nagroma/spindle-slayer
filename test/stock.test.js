import { describe, it, expect } from 'vitest';
import { stockRadius, stockMaxRadius, stockFaceRadius } from '../src/stock.js';

describe('stockRadius', () => {
  const square = { type: 'square', length: 34, size: 3.5 };
  const round = { type: 'round', length: 34, size: 3.5 };
  const hex = { type: 'hex', length: 34, size: 3.5 };

  it('square faces are size/2 from the centerline', () => {
    expect(stockRadius(square, 0)).toBeCloseTo(1.75, 10);
    expect(stockRadius(square, 90)).toBeCloseTo(1.75, 10);
    expect(stockRadius(square, 180)).toBeCloseTo(1.75, 10);
    expect(stockRadius(square, 270)).toBeCloseTo(1.75, 10);
  });

  it('square corners are size/2 * sqrt(2)', () => {
    expect(stockRadius(square, 45)).toBeCloseTo(1.75 * Math.SQRT2, 10);
    expect(stockMaxRadius(square)).toBeCloseTo(1.75 * Math.SQRT2, 10);
  });

  it('round stock is size/2 at every angle (size is diameter)', () => {
    expect(stockRadius(round, 0)).toBeCloseTo(1.75, 10);
    expect(stockRadius(round, 45)).toBeCloseTo(1.75, 10);
    expect(stockFaceRadius(round)).toBeCloseTo(1.75, 10);
  });

  it('hex across-flats is size/2 on a face', () => {
    expect(stockRadius(hex, 0)).toBeCloseTo(1.75, 10);
    expect(stockRadius(hex, 60)).toBeCloseTo(1.75, 10);
    expect(stockFaceRadius(hex)).toBeCloseTo(1.75, 10);
  });

  it('hex vertices are farther than the flats', () => {
    const vertex = stockRadius(hex, 30);
    expect(vertex).toBeGreaterThan(1.75);
    expect(vertex).toBeCloseTo(1.75 / Math.cos(Math.PI / 6), 10);
  });
});
