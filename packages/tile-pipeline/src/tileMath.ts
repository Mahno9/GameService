export type Bbox = [west: number, south: number, east: number, north: number];

export interface TileCoord {
  z: number;
  x: number;
  y: number;
}

export function lonToTileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z);
}

export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z);
}

export function tileXToLon(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}

export function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** [west, south, east, north] of a tile. */
export function tileToBbox({ z, x, y }: TileCoord): Bbox {
  return [tileXToLon(x, z), tileYToLat(y + 1, z), tileXToLon(x + 1, z), tileYToLat(y, z)];
}

/** All tile coords covering bbox at one zoom. */
export function tilesForBbox(bbox: Bbox, z: number): TileCoord[] {
  const [w, s, e, n] = bbox;
  const minX = lonToTileX(w, z);
  const maxX = lonToTileX(e, z);
  const minY = latToTileY(n, z);
  const maxY = latToTileY(s, z);
  const out: TileCoord[] = [];
  for (let x = minX; x <= maxX; x++) {
    for (let y = minY; y <= maxY; y++) {
      out.push({ z, x, y });
    }
  }
  return out;
}

export function countTiles(bbox: Bbox, zooms: number[]): number {
  let total = 0;
  for (const z of zooms) {
    const [w, s, e, n] = bbox;
    const cols = lonToTileX(e, z) - lonToTileX(w, z) + 1;
    const rows = latToTileY(s, z) - latToTileY(n, z) + 1;
    total += cols * rows;
  }
  return total;
}
