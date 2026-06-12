import Fastify from 'fastify';
import { config } from './config.js';
import { registerAuth } from './plugins/auth.js';
import { registerStatic } from './plugins/static.js';
import { settingsRoutes } from './routes/settings.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  await registerAuth(app);
  await app.register(settingsRoutes);
  await registerStatic(app);

  return app;
}
