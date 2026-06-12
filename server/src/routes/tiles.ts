import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { paths } from '../config.js';
import { getDb } from '../db/connection.js';

const TILE_KINDS = ['vector', 'raster'] as const;
type TileKind = (typeof TILE_KINDS)[number];

const EXT: Record<TileKind, string> = { vector: 'mvt', raster: 'webp' };

interface TileJobRow {
  id: string;
  kind: TileKind;
  bbox_json: string;
  min_zoom: number;
  max_zoom: number;
  status: string;
  completed_zooms_json: string;
  tiles_done: number;
  tiles_total: number;
  osm_cache_key: string | null;
  created_at: number;
  updated_at: number;
}

function jobToDto(row: TileJobRow) {
  return {
    id: row.id,
    kind: row.kind,
    bbox: JSON.parse(row.bbox_json),
    minZoom: row.min_zoom,
    maxZoom: row.max_zoom,
    status: row.status,
    completedZooms: JSON.parse(row.completed_zooms_json),
    tilesDone: row.tiles_done,
    tilesTotal: row.tiles_total,
    osmCacheKey: row.osm_cache_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** `vector/15/19034/10287.mvt` → safe absolute path or null. */
export function tileFilePath(root: string, rel: string): string | null {
  const m = /^(vector|raster)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.(mvt|webp)$/.exec(rel);
  if (!m) return null;
  const [, kind, , , , ext] = m;
  if (EXT[kind as TileKind] !== ext) return null;
  return path.join(root, rel);
}

export async function tilesRoutes(app: FastifyInstance) {
  // static tile serving with immutable cache
  await app.register(fastifyStatic, {
    root: paths.tiles(),
    prefix: '/tiles/',
    decorateReply: false,
    maxAge: '1y',
    immutable: true,
  });

  // ---- tile jobs CRUD ----

  app.get('/api/admin/tile-jobs', { preHandler: app.requireAdmin }, async () => {
    const rows = getDb()
      .prepare('SELECT * FROM tile_jobs ORDER BY created_at DESC')
      .all() as TileJobRow[];
    return rows.map(jobToDto);
  });

  app.post<{
    Body: { kind: TileKind; bbox: number[]; minZoom: number; maxZoom: number; tilesTotal?: number };
  }>(
    '/api/admin/tile-jobs',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          required: ['kind', 'bbox', 'minZoom', 'maxZoom'],
          properties: {
            kind: { enum: TILE_KINDS as unknown as string[] },
            bbox: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
            minZoom: { type: 'integer', minimum: 0, maximum: 22 },
            maxZoom: { type: 'integer', minimum: 0, maximum: 22 },
            tilesTotal: { type: 'integer', minimum: 0 },
          },
        },
      },
    },
    async (req) => {
      const now = Date.now();
      const id = nanoid(10);
      getDb()
        .prepare(
          `INSERT INTO tile_jobs (id, kind, bbox_json, min_zoom, max_zoom, status, tiles_total, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(
          id,
          req.body.kind,
          JSON.stringify(req.body.bbox),
          req.body.minZoom,
          req.body.maxZoom,
          req.body.tilesTotal ?? 0,
          now,
          now,
        );
      const row = getDb().prepare('SELECT * FROM tile_jobs WHERE id = ?').get(id) as TileJobRow;
      return jobToDto(row);
    },
  );

  app.patch<{
    Params: { id: string };
    Body: {
      status?: string;
      completedZooms?: number[];
      tilesDone?: number;
      tilesTotal?: number;
      osmCacheKey?: string;
    };
  }>(
    '/api/admin/tile-jobs/:id',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: {
          type: 'object',
          minProperties: 1,
          properties: {
            status: { enum: ['pending', 'running', 'paused', 'done', 'failed'] },
            completedZooms: { type: 'array', items: { type: 'integer' } },
            tilesDone: { type: 'integer', minimum: 0 },
            tilesTotal: { type: 'integer', minimum: 0 },
            osmCacheKey: { type: 'string' },
          },
        },
      },
    },
    async (req, reply) => {
      const db = getDb();
      const row = db.prepare('SELECT * FROM tile_jobs WHERE id = ?').get(req.params.id) as
        | TileJobRow
        | undefined;
      if (!row) return reply.code(404).send({ error: 'job not found' });

      const b = req.body;
      db.prepare(
        `UPDATE tile_jobs SET
           status = COALESCE(?, status),
           completed_zooms_json = COALESCE(?, completed_zooms_json),
           tiles_done = COALESCE(?, tiles_done),
           tiles_total = COALESCE(?, tiles_total),
           osm_cache_key = COALESCE(?, osm_cache_key),
           updated_at = ?
         WHERE id = ?`,
      ).run(
        b.status ?? null,
        b.completedZooms ? JSON.stringify(b.completedZooms) : null,
        b.tilesDone ?? null,
        b.tilesTotal ?? null,
        b.osmCacheKey ?? null,
        Date.now(),
        req.params.id,
      );
      const updated = db
        .prepare('SELECT * FROM tile_jobs WHERE id = ?')
        .get(req.params.id) as TileJobRow;
      return jobToDto(updated);
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/admin/tile-jobs/:id',
    { preHandler: app.requireAdmin },
    async (req) => {
      getDb().prepare('DELETE FROM tile_jobs WHERE id = ?').run(req.params.id);
      return { ok: true };
    },
  );

  // ---- batch upload ----
  // multipart; each file part's filename is the tile path, e.g. "vector/15/19034/10287.mvt"

  app.post(
    '/api/admin/tiles/batch',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'expected multipart/form-data' });
      }
      const root = paths.tiles();
      let saved = 0;
      const rejected: string[] = [];

      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;
        const dest = tileFilePath(root, part.filename);
        if (!dest) {
          rejected.push(part.filename);
          await part.toBuffer(); // drain
          continue;
        }
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        const buf = await part.toBuffer();
        fs.writeFileSync(dest, buf);
        saved++;
      }

      return { saved, rejected };
    },
  );
}
