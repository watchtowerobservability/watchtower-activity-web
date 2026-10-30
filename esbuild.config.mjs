import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const common = { entryPoints: ['src/index.ts'], bundle: true, minify: true, target: 'es2020', metafile: true };
const esm = await build({ ...common, format: 'esm', outfile: 'dist/index.js' });
const iife = await build({ ...common, format: 'iife', globalName: 'WtActivity', outfile: 'dist/wt-activity.min.js' });
writeFileSync('dist/meta-iife.json', JSON.stringify(iife.metafile));
writeFileSync('dist/meta-esm.json', JSON.stringify(esm.metafile));
const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json', '--noEmit', 'false', '--emitDeclarationOnly', '--declaration', '--outDir', 'dist', '--rootDir', 'src'], { stdio: 'inherit' });
