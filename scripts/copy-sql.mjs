#!/usr/bin/env node
// Copy SQL files from src → dist so bundled migrations ship with the package.
// Usage: node scripts/copy-sql.mjs <srcDir> <destDir>

import { mkdir, readdir, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { argv, exit } from 'node:process';

const [srcArg, destArg] = argv.slice(2);
if (!srcArg || !destArg) {
  console.error('usage: copy-sql.mjs <srcDir> <destDir>');
  exit(1);
}

const src = resolve(srcArg);
const dest = resolve(destArg);

await mkdir(dest, { recursive: true });

const files = (await readdir(src)).filter((f) => f.endsWith('.sql'));
for (const f of files) {
  await copyFile(join(src, f), join(dest, f));
}
console.log(`[copy-sql] copied ${files.length} .sql file(s) → ${dest}`);
