import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const common = { entryPoints: ['src/index.ts'], bundle: true, minify: true, target: 'es2020', metafile: true };
const esm = await build({ ...common, format: 'esm', outfile: 'dist/index.js' });
// import.meta is empty in an IIFE: the element falls back to its <script> src to find extras.js
const iife = await build({ ...common, format: 'iife', globalName: 'WtActivity', outfile: 'dist/wt-activity.min.js', define: { 'import.meta.url': 'undefined' } });
// Lazy chunk (verify, proofs, column chooser, saved views, sparkline), loaded by both builds at runtime.
await build({ ...common, entryPoints: ['src/extras.ts'], format: 'esm', outfile: 'dist/extras.js' });
// UX chunk (locales, grouping, bookmarks, live, ...), loaded on connect by both builds; its locale files beside it.
await build({ ...common, entryPoints: ['src/ux.ts'], format: 'esm', outfile: 'dist/ux.js' });
cpSync('src/locales', 'dist/locales', { recursive: true, filter: (f) => !f.endsWith('en.json') });
// React wrapper: react and the element stay external (the element is imported from ./index.js at runtime).
await build({ ...common, entryPoints: ['src/react.ts'], format: 'esm', outfile: 'dist/react.js', external: ['react', './index'],
  plugins: [{ name: 'idx', setup: (b) => b.onResolve({ filter: /^\.\/index$/ }, () => ({ path: './index.js', external: true })) }] });
writeFileSync('dist/meta-iife.json', JSON.stringify(iife.metafile));
writeFileSync('dist/meta-esm.json', JSON.stringify(esm.metafile));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit', 'false', '--emitDeclarationOnly', '--declaration', '--outDir', 'dist', '--rootDir', 'src'], { stdio: 'inherit' });
