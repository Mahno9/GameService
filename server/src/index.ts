import fs from 'node:fs';
import { buildApp } from './app.js';
import { config, paths } from './config.js';

for (const dir of [config.dataDir, paths.tiles(), paths.assets(), paths.osmCache()]) {
  fs.mkdirSync(dir, { recursive: true });
}

const app = buildApp();

app.listen({ host: config.host, port: config.port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
