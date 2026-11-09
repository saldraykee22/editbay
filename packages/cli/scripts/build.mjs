#!/usr/bin/env node
/**
 * Bundles the CLI into a single ESM file: dist/cli.mjs.
 *
 * Everything except node builtins is inlined, so the published binary runs on
 * a plain `node` install with no node_modules next to it. esbuild treats
 * `node:*` imports as external automatically for platform=node.
 */

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outfile = path.join(packageDir, 'dist', 'cli.mjs');

await mkdir(path.dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [path.join(packageDir, 'src', 'cli.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: [],
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  metafile: true,
});

const outputs = Object.entries(result.metafile.outputs);
for (const [file, meta] of outputs) {
  process.stdout.write(`built ${path.relative(packageDir, file)} (${meta.bytes} bytes)\n`);
}
