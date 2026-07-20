import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  build: { outDir: 'dist' },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Self-hosted: reached by whatever hostname/IP the box has, so don't let
    // Vite's host-header check reject it. Dev server only; never in the build.
    allowedHosts: true,
    proxy: { '/api': 'http://127.0.0.1:8686' },
  },
});
