import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('./renderer/', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./ui/', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome144',
    license: { fileName: 'third-party-licenses.txt' },
  },
});
