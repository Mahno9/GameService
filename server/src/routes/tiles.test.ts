import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { tileFilePath } from './tiles.js';

const root = path.resolve('/tiles-root');

describe('tileFilePath', () => {
  it('accepts valid vector and raster paths', () => {
    expect(tileFilePath(root, 'vector/15/19034/10287.mvt')).toBe(
      path.join(root, 'vector/15/19034/10287.mvt'),
    );
    expect(tileFilePath(root, 'raster/12/2378/1285.webp')).toBe(
      path.join(root, 'raster/12/2378/1285.webp'),
    );
  });

  it('rejects traversal and malformed names', () => {
    expect(tileFilePath(root, '../etc/passwd')).toBeNull();
    expect(tileFilePath(root, 'vector/../../x/1/2.mvt')).toBeNull();
    expect(tileFilePath(root, 'vector/15/19034/10287.webp')).toBeNull();
    expect(tileFilePath(root, 'raster/15/19034/10287.mvt')).toBeNull();
    expect(tileFilePath(root, 'other/15/1/2.mvt')).toBeNull();
    expect(tileFilePath(root, 'vector/15/1/2.mvt.exe')).toBeNull();
  });
});
