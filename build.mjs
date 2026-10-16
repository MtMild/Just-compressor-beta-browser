import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { COLORS } from './ui/theme.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const bundle = async (entry) => {
  const r = await build({ entryPoints: [path.join(root, entry)], bundle: true, format: 'iife', minify: false, write: false, target: 'es2020' });
  return r.outputFiles[0].text;
};
const safe = (s) => s.replace(/<\/script/gi, '<\\/script');

const kebab = (n) => n.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const tokens = ':root{color-scheme:dark;' + Object.entries(COLORS).map(([k, v]) => `--${kebab(k)}:${v}`).join(';') + '}';
const css = tokens + '\n' + readFileSync(path.join(root, 'ui/style.css'), 'utf8');

const worklet = await bundle('worklet.js');
const app = await bundle('ui/app.js');
let html = readFileSync(path.join(root, 'ui/index.template.html'), 'utf8');
html = html.replace('/*__WORKLET_SRC__*/""', () => safe(JSON.stringify(worklet)));
html = html.replace('/*__APP_JS__*/', () => safe(app));
html = html.replace('/*__CSS__*/', () => css);
mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist/index.html'), html);
// Fragment for publishing as an artifact (the host adds the document skeleton).
const fragment = `<title>Purple Compressor</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>${css}</style>
<div id="app"></div>
<script>window.__WORKLET_SRC__ = ${safe(JSON.stringify(worklet))};</script>
<script>${safe(app)}</script>
`;
writeFileSync(path.join(root, 'dist/artifact.html'), fragment);
console.log('built dist/index.html', html.length, 'bytes');
