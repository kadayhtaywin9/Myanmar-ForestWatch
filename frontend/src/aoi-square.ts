import { point, polygon, toMercator, toWgs84 } from '@turf/turf';
import { validateAoi } from './data';

export const SQUARE_CORNERS = 4;

// Fit an axis-aligned square in the same projection used to display the map.
export function fitAoiSquare(corners: number[][]) {
  if (corners.length !== SQUARE_CORNERS) return null;
  const projected = corners.map(corner => toMercator(point(corner)).geometry.coordinates);
  const xs = projected.map(([x]) => x);
  const ys = projected.map(([, y]) => y);
  const west = Math.min(...xs);
  const east = Math.max(...xs);
  const south = Math.min(...ys);
  const north = Math.max(...ys);
  const centerX = (west + east) / 2;
  const centerY = (south + north) / 2;
  const quadrants = new Set(projected.map(([x, y]) => (x > centerX ? 1 : 0) + (y > centerY ? 2 : 0)));
  if (quadrants.size !== SQUARE_CORNERS) return null;
  const halfSide = Math.max(east - west, north - south) / 2;
  const left = centerX - halfSide;
  const right = centerX + halfSide;
  const bottom = centerY - halfSide;
  const top = centerY + halfSide;
  const fitted = toWgs84(polygon([[[left, bottom], [right, bottom], [right, top], [left, top], [left, bottom]]]));
  try {
    return validateAoi(fitted);
  } catch {
    return null;
  }
}
