import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(projectRoot, 'dist');
let html = await readFile(path.join(dist, 'index.html'), 'utf8');
const css = await readFile(path.join(dist, 'assets', 'app.css'), 'utf8');
const javascript = await readFile(path.join(dist, 'assets', 'app.js'), 'utf8');

// Replacer callbacks are intentional: minified JavaScript can contain `$&`,
// which String.replace would otherwise interpret as the matched HTML.
html = html
  .replace(/\s*<link rel="icon"[^>]*>/, () => '')
  .replace(
    /\s*<link rel="stylesheet"[^>]*href="\.\/assets\/app\.css"[^>]*>/,
    () => `\n    <style>${css.replace(/<\/style/gi, '<\\/style')}</style>`,
  )
  .replace(
    /\s*<script type="module"[^>]*src="\.\/assets\/app\.js"[^>]*><\/script>/,
    () => `\n    <script type="module">${javascript.replace(/<\/script/gi, '<\\/script')}</script>`,
  );

html = `<!-- Aquarium Maker standalone build. Open this file directly; no server is required. -->\n${html}`;
await writeFile(path.join(projectRoot, 'standalone.html'), html);
