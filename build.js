// Bundles src/main.js (with three.js) and inlines it into src/index.html.
// The result, docs/index.html, is the whole game in one file.
import { build, context } from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
const options = {
  entryPoints: ['src/main.js'], bundle: true, format: 'iife', minify: !watch, write: false,
  target: 'es2020', legalComments: 'none', logLevel: 'warning',
};

function emit(result) {
  const js = result.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
  const html = fs.readFileSync('src/index.html', 'utf8').replace('/*GAME*/', () => js);
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync('docs/index.html', html);
  console.log('built docs/index.html', (html.length / 1024 | 0) + ' KB');
}

if (watch) {
  const ctx = await context({ ...options, plugins: [{ name: 'emit', setup(b) { b.onEnd(r => { if (!r.errors.length) emit(r); }); } }] });
  await ctx.watch();
  fs.watch('src/index.html', () => ctx.rebuild());
  console.log('watching src/');
} else {
  emit(await build(options));
}
