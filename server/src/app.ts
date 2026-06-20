import Fastify from 'fastify';
import { config } from './config.js';
import { registerAuth } from './plugins/auth.js';
import { registerStatic } from './plugins/static.js';
import fastifyMultipart from '@fastify/multipart';
import { overpassRoutes } from './routes/overpass.js';
import { settingsRoutes } from './routes/settings.js';
import { tilesRoutes } from './routes/tiles.js';
import { mapStyleRoutes } from './routes/mapStyle.js';
import { minigamesRoutes } from './routes/minigames.js';
import { poisRoutes } from './routes/pois.js';
import { sessionRoutes } from './routes/session.js';
import { assetsRoutes } from './routes/assets.js';
import { leaderboardRoutes } from './routes/leaderboard.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  // Allow cross-origin access to public read-only assets (tiles, stored files,
  // minigames). Needed in dev where player (5173) and admin (5174) are on
  // different origins from the backend (8081). Harmless in prod (same-origin).
  app.addHook('onSend', async (req, reply) => {
    const { url } = req;
    if (url.startsWith('/tiles/') || url.startsWith('/assets-store/') || url.startsWith('/minigames/')) {
      void reply.header('Access-Control-Allow-Origin', '*');
    }
  });

  await app.register(fastifyMultipart, {
    limits: { fileSize: 200 * 1024 * 1024, files: 200 },
    // tile uploads encode the tile path (vector/z/x/y.mvt) in the filename
    preservePath: true,
  });

  await registerAuth(app);
  await app.register(settingsRoutes);
  await app.register(overpassRoutes);
  await app.register(tilesRoutes);
  await app.register(mapStyleRoutes);
  await app.register(minigamesRoutes);
  await app.register(poisRoutes);
  await app.register(sessionRoutes);
  await app.register(assetsRoutes);
  await app.register(leaderboardRoutes);
  await registerStatic(app);

  return app;
}
