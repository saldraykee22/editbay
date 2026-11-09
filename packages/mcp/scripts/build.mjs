/**
 * Bundles the stdio MCP server into a single ESM file with a shebang.
 * Dependencies are bundled so `node dist/server.mjs` works without pnpm.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(packageRoot, 'src', 'server.ts')],
  outfile: path.join(packageRoot, 'dist', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  legalComments: 'none',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
});
