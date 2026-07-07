import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(projectRoot, 'dist');
const docs = path.join(projectRoot, 'docs');

await rm(docs, { recursive: true, force: true });
await cp(dist, docs, { recursive: true });

await rm(path.join(projectRoot, 'assets'), { recursive: true, force: true });
await cp(path.join(dist, 'assets'), path.join(projectRoot, 'assets'), { recursive: true });

for (const file of ['index.html', 'favicon.svg', '.nojekyll']) {
  await cp(path.join(dist, file), path.join(projectRoot, file));
}

// GitHub Pages serves this when a stale shared URL is requested directly.
const index = await readFile(path.join(dist, 'index.html'), 'utf8');
await writeFile(path.join(projectRoot, '404.html'), index);
await mkdir(docs, { recursive: true });
await writeFile(path.join(docs, '404.html'), index);
