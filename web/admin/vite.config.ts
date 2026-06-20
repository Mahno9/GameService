import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backend = `http://localhost:${process.env.PORT ?? 8081}`;

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    host: true,
    port: 5174,
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
