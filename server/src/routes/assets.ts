import fs from 'node:fs';
import path from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { nanoid } from 'nanoid';
import { paths } from '../config.js';
import { getDb } from '../db/connection.js';

// ---------------------------------------------------------------------------
// MIME → kind + ext mapping
// ---------------------------------------------------------------------------

type AssetKind = 'image' | 'audio' | 'gif';

interface MimeMeta {
  kind: AssetKind;
  ext: string;
}

const MIME_MAP: Record<string, MimeMeta> = {
  'image/png': { kind: 'image', ext: 'png' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/gif': { kind: 'gif', ext: 'gif' },
  'audio/mpeg': { kind: 'audio', ext: 'mp3' },
  'audio/ogg': { kind: 'audio', ext: 'ogg' },
  'audio/wav': { kind: 'audio', ext: 'wav' },
  'audio/webm': { kind: 'audio', ext: 'webm' },
  'audio/webm;codecs=opus': { kind: 'audio', ext: 'webm' },
};

// ---------------------------------------------------------------------------
// Row / DTO types
// ---------------------------------------------------------------------------

interface AssetRow {
  id: string;
  kind: AssetKind;
  mime: string;
  ext: string;
  original_name: string;
  size_bytes: number;
  created_at: number;
}

interface AssetDto {
  id: string;
  url: string;
  kind: AssetKind;
  originalName: string;
  sizeBytes: number;
}

function rowToDto(row: AssetRow): AssetDto {
  return {
    id: row.id,
    url: `/assets-store/${row.id}.${row.ext}`,
    kind: row.kind,
    originalName: row.original_name,
    sizeBytes: row.size_bytes,
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

export async function assetsRoutes(app: FastifyInstance) {
  // Static serving for uploaded assets.
  // /assets-store/ prefix avoids clashing with Vite's bundled /assets/ chunks.
  await app.register(fastifyStatic, {
    root: paths.assets(),
    prefix: '/assets-store/',
    decorateReply: false,
    maxAge: '30d',
  });

  // POST /api/admin/assets — multipart upload, one or more files
  app.post(
    '/api/admin/assets',
    { preHandler: app.requireAdmin },
    async (req, reply) => {
      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'expected multipart/form-data' });
      }

      const assetsDir = paths.assets();
      fs.mkdirSync(assetsDir, { recursive: true });

      const accepted: AssetDto[] = [];
      const rejected: string[] = [];
      const db = getDb();

      for await (const part of req.parts()) {
        if (part.type !== 'file') continue;

        const mime = part.mimetype;
        const meta = MIME_MAP[mime];

        if (!meta) {
          rejected.push(part.filename);
          await part.toBuffer(); // drain disallowed part
          continue;
        }

        const id = nanoid(10);
        const filename = `${id}.${meta.ext}`;
        const dest = path.join(assetsDir, filename);
        const buf = await part.toBuffer();

        fs.writeFileSync(dest, buf);

        const now = Date.now();
        db.prepare(
          `INSERT INTO assets (id, kind, mime, ext, original_name, size_bytes, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).run(id, meta.kind, mime, meta.ext, part.filename, buf.length, now);

        const row = db
          .prepare('SELECT * FROM assets WHERE id = ?')
          .get(id) as AssetRow;
        accepted.push(rowToDto(row));
      }

      return { accepted, rejected };
    },
  );

  // GET /api/admin/assets — list all assets
  app.get('/api/admin/assets', { preHandler: app.requireAdmin }, async () => {
    const rows = getDb()
      .prepare('SELECT * FROM assets ORDER BY created_at DESC')
      .all() as AssetRow[];
    return rows.map(rowToDto);
  });

  // DELETE /api/admin/assets/:id
  app.delete<{ Params: { id: string } }>(
    '/api/admin/assets/:id',
    { preHandler: app.requireAdmin },
    async (req) => {
      const db = getDb();
      const row = db
        .prepare('SELECT * FROM assets WHERE id = ?')
        .get(req.params.id) as AssetRow | undefined;

      if (row) {
        db.prepare('DELETE FROM assets WHERE id = ?').run(req.params.id);
        const filePath = path.join(paths.assets(), `${row.id}.${row.ext}`);
        try {
          fs.unlinkSync(filePath);
        } catch {
          // ignore fs errors (file may already be gone)
        }
      }

      return { ok: true };
    },
  );
}
