import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: '/admin/',
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:8080',
      '/tiles': 'http://localhost:8080',
      '/assets-store': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
