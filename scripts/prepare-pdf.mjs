import { cp, mkdir } from 'node:fs/promises';
const output = new URL('../renderer/public/pdfjs/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['cmaps', 'standard_fonts', 'wasm']) {
  await cp(new URL(`../node_modules/pdfjs-dist/${name}/`, import.meta.url), new URL(`${name}/`, output), { recursive: true });
}
