import { describe, expect, it } from 'vitest';
import { overpassToLayers, parseRenderHeight } from './layers.js';
import sample from './fixtures/overpass-sample.json';

describe('parseRenderHeight', () => {
  it('prefers explicit height', () => {
    expect(parseRenderHeight({ height: '21.5', 'building:levels': '5' })).toBe(21.5);
  });
  it('falls back to levels * 3', () => {
    expect(parseRenderHeight({ 'building:levels': '5' })).toBe(15);
  });
  it('defaults to 8', () => {
    expect(parseRenderHeight({})).toBe(8);
  });
});

describe('overpassToLayers', () => {
  const layers = overpassToLayers(sample);

  it('buckets buildings with render_height', () => {
    expect(layers.building.features).toHaveLength(2);
    const heights = layers.building.features.map((f) => f.properties?.['render_height']);
    expect(heights).toEqual(expect.arrayContaining([21.5, 15]));
    expect(layers.building.features.every((f) => f.geometry.type === 'Polygon')).toBe(true);
  });

  it('buckets roads with class', () => {
    expect(layers.road.features).toHaveLength(2);
    const classes = layers.road.features.map((f) => f.properties?.['class']);
    expect(classes).toEqual(expect.arrayContaining(['street', 'path']));
  });

  it('buckets water, green and landuse polygons', () => {
    expect(layers.water.features).toHaveLength(1);
    expect(layers.green.features).toHaveLength(1);
    expect(layers.landuse.features).toHaveLength(1);
  });
});
