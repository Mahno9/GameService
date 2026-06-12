import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';

const serverRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
export const minigamesDir = path.join(serverRoot, 'static', 'minigames');

interface MinigameInfo {
  id: string;
  title: string;
  entryUrl: string;
  schemaUrl: string;
}

export function scanMinigames(dir = minigamesDir): MinigameInfo[] {
  if (!fs.existsSync(dir)) return [];
  const out: MinigameInfo[] = [];
  for (const id of fs.readdirSync(dir)) {
    const entry = path.join(dir, id, 'index.js');
    const schemaPath = path.join(dir, id, 'schema.json');
    if (!fs.existsSync(entry) || !fs.existsSync(schemaPath)) continue;
    let title = id;
    try {
      const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as { title?: string };
      if (schema.title) title = schema.title;
    } catch {
      // malformed schema → keep id as title
    }
    out.push({
      id,
      title,
      entryUrl: `/minigames/${id}/index.js`,
      schemaUrl: `/minigames/${id}/schema.json`,
    });
  }
  return out;
}

export async function minigamesRoutes(app: FastifyInstance) {
  app.get('/api/minigames', async () => scanMinigames());

  if (fs.existsSync(minigamesDir)) {
    await app.register(fastifyStatic, {
      root: minigamesDir,
      prefix: '/minigames/',
      decorateReply: false,
      setHeaders(res) {
        res.setHeader('Cache-Control', 'public, max-age=3600');
      },
    });
  }
}
