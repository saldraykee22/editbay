/**
 * Bundles the stdio MCP server into a single ESM file with a shebang.
 * Dependencies are bundled so `node dist/server.mjs` works without pnpm.
 *
 * Builtin skills are copied to `dist/skills` so the server resolves them from
 * any working directory. `legalComments: 'linked'` keeps third-party license
 * notices in `dist/server.mjs.LEGAL.txt` when the sources carry them, and
 * `THIRD-PARTY-NOTICES.txt` always records every inlined package.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { writeThirdPartyNotices } from '../../kit/scripts/third-party-notices.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const outfile = path.join(packageRoot, 'dist', 'server.mjs');
const skillsSource = path.resolve(repoRoot, 'apps', 'desktop', 'resources', 'skills');
const skillsTarget = path.join(packageRoot, 'dist', 'skills');

await mkdir(path.dirname(outfile), { recursive: true });

const result = await build({
  entryPoints: [path.join(packageRoot, 'src', 'server.ts')],
  outfile,
  bundle: true,
  absWorkingDir: packageRoot,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  legalComments: 'linked',
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
  metafile: true,
});

await rm(skillsTarget, { recursive: true, force: true });
await cp(skillsSource, skillsTarget, { recursive: true });
const skillDirs = (await readdir(skillsTarget, { withFileTypes: true })).filter((entry) => entry.isDirectory());
if (skillDirs.length === 0) {
  throw new Error(`No builtin skills found in ${skillsSource}; dist/skills would be empty`);
}
for (const entry of skillDirs) {
  await stat(path.join(skillsTarget, entry.name, 'SKILL.md'));
}
process.stdout.write(`copied ${skillDirs.length} builtin skills to ${path.relative(packageRoot, skillsTarget)}\n`);

/* License notices for the inlined packages (see legalComments above). */
const noticesPath = path.join(packageRoot, 'dist', 'THIRD-PARTY-NOTICES.txt');
const notices = await writeThirdPartyNotices(result.metafile, noticesPath, { cwd: packageRoot });
if (notices === 0) {
  await rm(noticesPath, { force: true });
  process.stdout.write('no third-party packages bundled; no notices file needed\n');
} else {
  process.stdout.write(`wrote license notices for ${notices} bundled packages\n`);
}
