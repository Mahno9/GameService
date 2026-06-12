import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';
import type { LayeredGeojson, LayerName } from './layers.js';
import { tilesForBbox, type Bbox, type TileCoord } from './tileMath.js';

export interface MvtTile extends TileCoord {
  data: Uint8Array;
}

export interface MvtGeneratorOptions {
  minZoom: number;
  maxZoom: number;
  /** Tile extent buffer in geojson-vt units (default 64). */
  buffer?: number;
}

type TileIndexes = Partial<Record<LayerName, ReturnType<typeof geojsonvt>>>;

export function buildIndexes(layers: LayeredGeojson, maxZoom: number): TileIndexes {
  const indexes: TileIndexes = {};
  for (const [name, collection] of Object.entries(layers) as [
    LayerName,
    LayeredGeojson[LayerName],
  ][]) {
    if (collection.features.length === 0) continue;
    indexes[name] = geojsonvt(collection, {
      maxZoom,
      indexMaxZoom: maxZoom,
      indexMaxPoints: 0,
      buffer: 64,
      extent: 4096,
    });
  }
  return indexes;
}

export function encodeTile(indexes: TileIndexes, coord: TileCoord): Uint8Array | null {
  const layerTiles: Record<string, unknown> = {};
  for (const [name, index] of Object.entries(indexes)) {
    const tile = index?.getTile(coord.z, coord.x, coord.y);
    if (tile && tile.features.length > 0) {
      layerTiles[name] = tile;
    }
  }
  if (Object.keys(layerTiles).length === 0) return null;
  return vtpbf.fromGeojsonVt(layerTiles as never, { version: 2 });
}

/** Generate all non-empty MVT tiles for bbox across the zoom range. */
export function* generateMvtTiles(
  layers: LayeredGeojson,
  bbox: Bbox,
  { minZoom, maxZoom }: MvtGeneratorOptions,
): Generator<MvtTile> {
  const indexes = buildIndexes(layers, maxZoom);
  for (let z = minZoom; z <= maxZoom; z++) {
    for (const coord of tilesForBbox(bbox, z)) {
      const data = encodeTile(indexes, coord);
      if (data) yield { ...coord, data };
    }
  }
}
