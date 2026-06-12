import Fastify from 'fastify';
import { config } from './config.js';
import { registerStatic } from './plugins/static.js';

export async function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  await registerStatic(app);

  return app;
}
