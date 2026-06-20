import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    host: true,
    port: 5174,
    proxy: {
      '/api': 'http://localhost:8081',
      '/tiles': 'http://localhost:8081',
      '/assets-store': 'http://localhost:8081',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
