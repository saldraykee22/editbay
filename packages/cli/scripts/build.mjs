#!/usr/bin/env node
/**
 * Bundles the CLI into a single ESM file: dist/cli.mjs.
 *
 * Everything except node builtins is inlined, so the published binary runs on
 * a plain `node` install with no node_modules next to it. esbuild treats
 * `node:*` imports as external automatically for platform=node.
 *
 * Builtin skills are copied to `dist/skills` so `editbay skills list` works
 * from any working directory, not just inside the monorepo. esbuild runs with
 * `legalComments: 'linked'`, which keeps third-party license notices in a
 * `dist/cli.mjs.LEGAL.txt` sidecar instead of dropping them.
 */

import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { writeThirdPartyNotices } from '../../kit/scripts/third-party-notices.mjs';

const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageDir, '..', '..');
const outfile = path.join(packageDir, 'dist', 'cli.mjs');
const skillsSource = path.resolve(repoRoot, 'apps', 'desktop', 'resources', 'skills');
const skillsTarget = path.join(packageDir, 'dist', 'skills');

await mkdir(path.dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [path.join(packageDir, 'src', 'cli.ts')],
  outfile,
  bundle: true,
  absWorkingDir: packageDir,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: '#!/usr/bin/env node' },
  external: [],
  sourcemap: false,
  legalComments: 'linked',
  logLevel: 'info',
  metafile: true,
});

const outputs = Object.entries(result.metafile.outputs);
for (const [file, meta] of outputs) {
  process.stdout.write(`built ${path.relative(packageDir, file)} (${meta.bytes} bytes)\n`);
}

/* Builtin skills: required at runtime, so a missing copy fails the build. */
await rm(skillsTarget, { recursive: true, force: true });
await cp(skillsSource, skillsTarget, { recursive: true });
const skillDirs = (await readdir(skillsTarget, { withFileTypes: true })).filter((entry) => entry.isDirectory());
if (skillDirs.length === 0) {
  throw new Error(`No builtin skills found in ${skillsSource}; dist/skills would be empty`);
}
for (const entry of skillDirs) {
  await stat(path.join(skillsTarget, entry.name, 'SKILL.md'));
}
process.stdout.write(`copied ${skillDirs.length} builtin skills to ${path.relative(packageDir, skillsTarget)}\n`);

/* License notices for the inlined packages (see legalComments above). */
const noticesPath = path.join(packageDir, 'dist', 'THIRD-PARTY-NOTICES.txt');
const notices = await writeThirdPartyNotices(result.metafile, noticesPath, { cwd: packageDir });
if (notices === 0) {
  await rm(noticesPath, { force: true });
  process.stdout.write('no third-party packages bundled; no notices file needed\n');
} else {
  process.stdout.write(`wrote license notices for ${notices} bundled packages\n`);
}
