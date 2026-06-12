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

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  await app.register(fastifyMultipart, {
    limits: { fileSize: 30 * 1024 * 1024, files: 200 },
  });

  await registerAuth(app);
  await app.register(settingsRoutes);
  await app.register(overpassRoutes);
  await app.register(tilesRoutes);
  await app.register(mapStyleRoutes);
  await app.register(minigamesRoutes);
  await app.register(poisRoutes);
  await app.register(sessionRoutes);
  await registerStatic(app);

  return app;
}
