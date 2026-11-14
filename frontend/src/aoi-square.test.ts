import { toMercator } from '@turf/turf';
import { describe, expect, it } from 'vitest';
import { fitAoiSquare } from './aoi-square';
import { inside } from './data';

const corners = [[95.8, 18.2], [96, 18.23], [95.98, 18.36], [95.82, 18.32]];

describe('square AOI drawing', () => {
  it('fits an equal-sided map square that contains all four clicks', () => {
    const fitted = fitAoiSquare(corners);
    expect(fitted).not.toBeNull();
    const [a, b, c, , last] = toMercator(fitted).geometry.coordinates[0];
    expect(b[0] - a[0]).toBeCloseTo(c[1] - b[1], 6);
    expect(last).toEqual(a);
    for (const [lon, lat] of corners) expect(inside({lon, lat} as Parameters<typeof inside>[0], fitted)).toBe(true);
  });

  it('requires exactly four points spanning all four corners', () => {
    expect(fitAoiSquare(corners.slice(0, 3))).toBeNull();
    expect(fitAoiSquare([...corners, [95.9, 18.3]])).toBeNull();
    expect(fitAoiSquare([...corners.slice(0, 3), corners[0]])).toBeNull();
  });
});
