import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const backend = `http://localhost:${process.env.PORT ?? 8081}`;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html}'],
        runtimeCaching: [
          {
            urlPattern: /^.*\/tiles\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tiles',
              expiration: { maxEntries: 5000 },
            },
          },
          {
            urlPattern: /^.*\/assets-store\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'assets',
              expiration: { maxEntries: 500 },
            },
          },
          {
            urlPattern: /^.*\/minigames\/.*/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'minigames',
              expiration: { maxEntries: 200 },
            },
          },
          {
            urlPattern: /\/api\/(settings|pois|minigames|map)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api',
              networkTimeoutSeconds: 4,
            },
          },
        ],
        navigateFallbackDenylist: [/^\/admin/, /^\/api/],
      },
      manifest: {
        name: 'Quest',
        short_name: 'Quest',
        start_url: '/',
        display: 'standalone',
        background_color: '#1a1a2e',
        theme_color: '#1a1a2e',
        icons: [],
      },
    }),
  ],
  base: '/',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': backend,
      '/tiles': backend,
      '/assets-store': backend,
      '/minigames': backend,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
