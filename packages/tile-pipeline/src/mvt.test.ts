import { describe, expect, it } from 'vitest';
import Protobuf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { overpassToLayers } from './layers.js';
import { generateMvtTiles } from './mvt.js';
import { countTiles, latToTileY, lonToTileX, tileToBbox, tilesForBbox } from './tileMath.js';
import sample from './fixtures/overpass-sample.json';

const SAMPLE_BBOX: [number, number, number, number] = [37.614, 55.752, 37.62, 55.757];

describe('tileMath', () => {
  it('computes known tile for Moscow center at z14', () => {
    // Red Square ~ (37.6208, 55.7539) → tile 9904/5121 at z14
    expect(lonToTileX(37.6208, 14)).toBe(9904);
    expect(latToTileY(55.7539, 14)).toBe(5121);
  });

  it('tileToBbox inverts tile coords', () => {
    const [w, s, e, n] = tileToBbox({ z: 14, x: 9904, y: 5121 });
    expect(w).toBeLessThan(37.6208);
    expect(e).toBeGreaterThan(37.6208);
    expect(s).toBeLessThan(55.7539);
    expect(n).toBeGreaterThan(55.7539);
  });

  it('tilesForBbox covers the area and countTiles agrees', () => {
    const tiles = tilesForBbox(SAMPLE_BBOX, 16);
    expect(tiles.length).toBeGreaterThan(0);
    expect(countTiles(SAMPLE_BBOX, [16])).toBe(tiles.length);
  });
});

describe('generateMvtTiles', () => {
  it('produces decodable MVT tiles containing the fixture layers', () => {
    const layers = overpassToLayers(sample);
    const tiles = [...generateMvtTiles(layers, SAMPLE_BBOX, { minZoom: 14, maxZoom: 16 })];
    expect(tiles.length).toBeGreaterThan(0);

    const seenLayers = new Set<string>();
    for (const tile of tiles) {
      const decoded = new VectorTile(new Protobuf(tile.data));
      for (const name of Object.keys(decoded.layers)) seenLayers.add(name);
    }
    expect([...seenLayers]).toEqual(
      expect.arrayContaining(['building', 'road', 'water', 'green', 'landuse']),
    );

    // building feature carries render_height
    const withBuildings = tiles
      .map((t) => new VectorTile(new Protobuf(t.data)))
      .filter((vt) => vt.layers['building']);
    expect(withBuildings.length).toBeGreaterThan(0);
    const layer = withBuildings[0]!.layers['building']!;
    const heights = Array.from({ length: layer.length }, (_, i) =>
      layer.feature(i).properties['render_height'],
    );
    expect(heights).toEqual(expect.arrayContaining([21.5]));
  });

  it('yields nothing for an empty area', () => {
    const layers = overpassToLayers({ elements: [] });
    const tiles = [...generateMvtTiles(layers, SAMPLE_BBOX, { minZoom: 14, maxZoom: 14 })];
    expect(tiles).toEqual([]);
  });
});
