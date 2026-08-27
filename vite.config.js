import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  assetsInclude: ['**/*.dxf'],
  build: {
    outDir: 'dist',
  },
});
