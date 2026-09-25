import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.FORGE_API ?? 'http://127.0.0.1:8787';

// Éditeur Forge : l'API est servie par @forge/server (proxy en développement).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 4000,
  },
});
