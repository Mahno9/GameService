import Fastify from 'fastify';
import { config } from './config.js';

export function buildApp() {
  const app = Fastify({
    logger: { level: config.logLevel },
  });

  app.get('/api/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  return app;
}
