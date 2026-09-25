import { defineConfig } from 'vite';

// Lecteur autonome utilisé par l'export web : charge le projet depuis ./project/.
export default defineConfig({
  root: 'player',
  base: './',
  build: {
    outDir: '../dist-player',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
  },
});
