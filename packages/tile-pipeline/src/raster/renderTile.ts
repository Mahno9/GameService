import type { Feature, Geometry, Position } from 'geojson';
import type { LayeredGeojson } from '../layers.js';
import { lonLatToTilePixel, tileToBbox, type TileCoord } from '../tileMath.js';

/**
 * Minimal structural type for the 2D drawing context. Compatible with both
 * `CanvasRenderingContext2D` (HTMLCanvasElement / OffscreenCanvas) and
 * node-canvas-like contexts used in tests — only the members we touch.
 */
export interface Canvas2DLike {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineJoin?: string;
  lineCap?: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(rule?: 'nonzero' | 'evenodd'): void;
  stroke(): void;
}

const COLORS = {
  background: '#12121f',
  landuse: '#1a1e2e',
  green: '#16321f',
  water: '#10243d',
  waterway: '#1d3a5f',
  roadPath: '#262c44',
  roadStreet: '#2e3450',
  roadMajor: '#3d4466',
  building: '#2a3052',
} as const;

interface Bounds {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

/** Inline bbox of any geometry (ignores empty/Point geometries → null). */
function geometryBounds(geom: Geometry): Bounds | null {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;

  const visit = (pos: Position): void => {
    const lon = pos[0];
    const lat = pos[1];
    if (lon === undefined || lat === undefined) return;
    if (lon < minLon) minLon = lon;
    if (lat < minLat) minLat = lat;
    if (lon > maxLon) maxLon = lon;
    if (lat > maxLat) maxLat = lat;
  };

  const walk = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      visit(coords as Position);
      return;
    }
    for (const c of coords) walk(c);
  };

  if ('coordinates' in geom) walk(geom.coordinates);
  if (minLon === Infinity) return null;
  return { minLon, minLat, maxLon, maxLat };
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.minLon <= b.maxLon && a.maxLon >= b.minLon && a.minLat <= b.maxLat && a.maxLat >= b.minLat;
}

function tracePolygonRings(
  ctx: Canvas2DLike,
  rings: Position[][],
  coord: TileCoord,
  size: number,
): void {
  ctx.beginPath();
  for (const ring of rings) {
    ring.forEach((pos, i) => {
      const lon = pos[0];
      const lat = pos[1];
      if (lon === undefined || lat === undefined) return;
      const { px, py } = lonLatToTilePixel(lon, lat, coord, size);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
  }
}

function fillPolygons(ctx: Canvas2DLike, feature: Feature, coord: TileCoord, size: number): void {
  const geom = feature.geometry;
  if (geom.type === 'Polygon') {
    tracePolygonRings(ctx, geom.coordinates, coord, size);
    ctx.fill('evenodd');
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      tracePolygonRings(ctx, poly, coord, size);
    }
    ctx.fill('evenodd');
  }
}

function traceLine(ctx: Canvas2DLike, line: Position[], coord: TileCoord, size: number): void {
  line.forEach((pos, i) => {
    const lon = pos[0];
    const lat = pos[1];
    if (lon === undefined || lat === undefined) return;
    const { px, py } = lonLatToTilePixel(lon, lat, coord, size);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  });
}

function strokeLines(ctx: Canvas2DLike, feature: Feature, coord: TileCoord, size: number): void {
  const geom = feature.geometry;
  ctx.beginPath();
  if (geom.type === 'LineString') {
    traceLine(ctx, geom.coordinates, coord, size);
  } else if (geom.type === 'MultiLineString') {
    for (const line of geom.coordinates) traceLine(ctx, line, coord, size);
  }
  ctx.stroke();
}

/** Visible road width in px for a class, scaled by zoom and clamped to 1..8. */
function roadWidth(base: number, z: number): number {
  const w = base * Math.max(1, z - 10);
  return Math.min(8, Math.max(1, w));
}

/**
 * Render a single raster tile onto a 2D canvas context. Pure: only draws onto
 * the given context, performs no I/O. Projects lon/lat → tile-local pixels via
 * web-mercator.
 */
export function renderTileToCanvas(
  ctx: Canvas2DLike,
  layers: LayeredGeojson,
  coord: TileCoord,
  size = 512,
): void {
  // Tile bbox + a small buffer for cheap culling.
  const [w, s, e, n] = tileToBbox(coord);
  const bufLon = (e - w) * 0.1;
  const bufLat = (n - s) * 0.1;
  const tileBounds: Bounds = {
    minLon: w - bufLon,
    minLat: s - bufLat,
    maxLon: e + bufLon,
    maxLat: n + bufLat,
  };

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // Background.
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, size, size);

  const drawFill = (feature: Feature): void => {
    const b = geometryBounds(feature.geometry);
    if (b && !intersects(b, tileBounds)) return;
    fillPolygons(ctx, feature, coord, size);
  };

  const drawStroke = (feature: Feature): void => {
    const b = geometryBounds(feature.geometry);
    if (b && !intersects(b, tileBounds)) return;
    strokeLines(ctx, feature, coord, size);
  };

  // Landuse polygons.
  ctx.fillStyle = COLORS.landuse;
  for (const f of layers.landuse.features) drawFill(f);

  // Green polygons.
  ctx.fillStyle = COLORS.green;
  for (const f of layers.green.features) drawFill(f);

  // Water: polygons filled, waterway lines stroked.
  ctx.fillStyle = COLORS.water;
  for (const f of layers.water.features) {
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') drawFill(f);
  }
  ctx.strokeStyle = COLORS.waterway;
  ctx.lineWidth = 2;
  for (const f of layers.water.features) {
    if (f.geometry.type === 'LineString' || f.geometry.type === 'MultiLineString') drawStroke(f);
  }

  // Roads by class, drawn in ascending visual weight.
  const roadStyles: { cls: string; color: string; base: number }[] = [
    { cls: 'path', color: COLORS.roadPath, base: 2 },
    { cls: 'street', color: COLORS.roadStreet, base: 3 },
    { cls: 'major', color: COLORS.roadMajor, base: 5 },
  ];
  for (const style of roadStyles) {
    ctx.strokeStyle = style.color;
    ctx.lineWidth = roadWidth(style.base, coord.z);
    for (const f of layers.road.features) {
      if ((f.properties as { class?: string } | null)?.class !== style.cls) continue;
      drawStroke(f);
    }
  }

  // Buildings (flat in raster mode).
  ctx.fillStyle = COLORS.building;
  for (const f of layers.building.features) drawFill(f);
}

export { COLORS as RASTER_COLORS };
