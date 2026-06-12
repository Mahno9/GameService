import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { paths } from '../config.js';

const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export type Bbox = [west: number, south: number, east: number, north: number];

export function buildOverpassQuery([w, s, e, n]: Bbox): string {
  const bbox = `${s},${w},${n},${e}`;
  return `[out:json][timeout:120];
(
  way["building"](${bbox});
  relation["building"](${bbox});
  way["highway"](${bbox});
  way["waterway"](${bbox});
  way["natural"="water"](${bbox});
  relation["natural"="water"](${bbox});
  way["landuse"](${bbox});
  way["leisure"](${bbox});
  way["natural"~"wood|scrub|grassland"](${bbox});
);
out geom;`;
}

const bboxSchema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 4,
  maxItems: 4,
} as const;

export async function overpassRoutes(app: FastifyInstance) {
  app.post<{ Body: { bbox: Bbox } }>(
    '/api/admin/overpass',
    {
      preHandler: app.requireAdmin,
      schema: {
        body: { type: 'object', required: ['bbox'], properties: { bbox: bboxSchema } },
      },
    },
    async (req, reply) => {
      const { bbox } = req.body;
      const [w, s, e, n] = bbox;
      if (!(w < e && s < n)) {
        return reply.code(400).send({ error: 'invalid bbox: expected [west,south,east,north]' });
      }

      const key = crypto.createHash('sha1').update(JSON.stringify(bbox)).digest('hex');
      const cacheFile = path.join(paths.osmCache(), `${key}.json`);

      if (fs.existsSync(cacheFile)) {
        reply.header('x-osm-cache', 'hit');
        return reply.type('application/json').send(fs.createReadStream(cacheFile));
      }

      const query = `data=${encodeURIComponent(buildOverpassQuery(bbox))}`;
      let body: Buffer | null = null;
      const failures: string[] = [];
      for (const mirror of OVERPASS_MIRRORS) {
        try {
          const res = await fetch(mirror, {
            method: 'POST',
            body: query,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            signal: AbortSignal.timeout(150_000),
          });
          if (!res.ok) {
            failures.push(`${mirror}: ${res.status}`);
            continue;
          }
          body = Buffer.from(await res.arrayBuffer());
          break;
        } catch (err) {
          failures.push(`${mirror}: ${(err as Error).message}`);
        }
      }
      if (!body) {
        req.log.warn({ failures }, 'all overpass mirrors failed');
        return reply.code(502).send({ error: 'all overpass mirrors failed', failures });
      }
      const tmp = `${cacheFile}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, cacheFile);

      reply.header('x-osm-cache', 'miss');
      return reply.type('application/json').send(body);
    },
  );
}
