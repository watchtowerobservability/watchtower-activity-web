// Fails when the min+gz single-file bundle exceeds the budget. Bundles in memory, so it needs no prior build.
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const LIMIT = 12 * 1024;
let bad = false;
for (const format of ['iife', 'esm']) {
  const r = await build({ entryPoints: ['src/index.ts'], bundle: true, minify: true, target: 'es2020', format, write: false, metafile: true, ...(format === 'iife' ? { define: { 'import.meta.url': 'undefined' } } : {}) });
  const code = r.outputFiles[0].contents;
  const gz = gzipSync(code, { level: 9 }).length;
  const inputs = Object.keys(r.metafile.inputs).filter((i) => !i.endsWith('.test.ts'));
  console.log(`${format}: ${code.length} B min, ${gz} B gz (limit ${LIMIT}); inputs: ${inputs.join(', ')}`);
  if (gz > LIMIT) bad = true;
}
const x = await build({ entryPoints: ['src/extras.ts'], bundle: true, minify: true, target: 'es2020', format: 'esm', write: false });
console.log(`extras (lazy, not in the budget): ${gzipSync(x.outputFiles[0].contents, { level: 9 }).length} B gz`);
const u = await build({ entryPoints: ['src/ux.ts'], bundle: true, minify: true, target: 'es2020', format: 'esm', write: false });
console.log(`ux (lazy, loaded on connect, not in the budget): ${gzipSync(u.outputFiles[0].contents, { level: 9 }).length} B gz`);
if (bad) { console.error('activity-web exceeds the 12 KB min+gz budget'); process.exit(1); }
