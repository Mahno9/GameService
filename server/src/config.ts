import path from 'node:path';

const env = process.env;

export const config = {
  host: env.HOST ?? '0.0.0.0',
  port: Number(env.PORT ?? 8080),
  dataDir: path.resolve(env.DATA_DIR ?? path.join(process.cwd(), '..', 'data')),
  adminLogin: env.ADMIN_LOGIN ?? 'admin',
  adminPassword: env.ADMIN_PASSWORD ?? 'admin',
  cookieSecret: env.COOKIE_SECRET ?? 'dev-secret-change-me',
  logLevel: env.LOG_LEVEL ?? 'info',
} as const;

export const paths = {
  db: () => path.join(config.dataDir, 'app.sqlite'),
  tiles: () => path.join(config.dataDir, 'tiles'),
  assets: () => path.join(config.dataDir, 'assets'),
  osmCache: () => path.join(config.dataDir, 'osm-cache'),
};
