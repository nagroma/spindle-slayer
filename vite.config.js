import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: '.',
  assetsInclude: ['**/*.dxf'],
  server: {
    watch: {
      ignored: ['**/*.~tmp'],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        trace: resolve(root, 'trace.html'),
      },
    },
  },
});
