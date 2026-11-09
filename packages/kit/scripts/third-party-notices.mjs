/**
 * Third-party license notices for the bundled CLI/MCP builds.
 *
 * esbuild's `legalComments: 'linked'` only keeps comments that survived in the
 * published sources; most npm packages ship their dist without them, so the
 * generated `.LEGAL.txt` can be empty. This module walks the esbuild metafile,
 * finds every external package that was inlined and concatenates that package's
 * own LICENSE file into a `THIRD-PARTY-NOTICES.txt` next to the bundle.
 */

import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'LICENCE', 'NOTICE'];

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Nearest ancestor directory that contains a package.json. */
async function packageDirOf(file) {
  let dir = path.dirname(file);
  for (;;) {
    if (await exists(path.join(dir, 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

async function licenseText(dir) {
  for (const name of LICENSE_FILES) {
    const file = path.join(dir, name);
    try {
      return (await readFile(file, 'utf8')).trim();
    } catch {
      // Try the next conventional file name.
    }
  }
  return '';
}

/**
 * Writes bundled dependency notices. Returns the number of packages recorded.
 * `metafile` is the esbuild build result metafile; inputs are relative to cwd.
 */
export async function writeThirdPartyNotices(metafile, outfile, { cwd = process.cwd() } = {}) {
  const seen = new Set();
  const packages = [];
  for (const input of Object.keys(metafile.inputs ?? {})) {
    const absolute = path.resolve(cwd, input);
    if (!absolute.includes(`${path.sep}node_modules${path.sep}`)) continue;
    const dir = await packageDirOf(absolute);
    if (dir === null || seen.has(dir)) continue;
    seen.add(dir);

    let name = path.basename(dir);
    let license = 'see package';
    let repository = '';
    try {
      const manifest = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      if (typeof manifest.name === 'string') name = manifest.name;
      const declared = manifest.license;
      if (typeof declared === 'string') license = declared;
      else if (declared && typeof declared.type === 'string') license = declared.type;
      if (typeof manifest.repository === 'string') repository = manifest.repository;
      else if (manifest.repository && typeof manifest.repository.url === 'string') repository = manifest.repository.url;
    } catch {
      // A malformed manifest still gets a notices entry.
    }
    // Workspace packages are first-party and ship under the same license.
    if (name.startsWith('@editbay/')) continue;
    packages.push({ name, license, repository, text: await licenseText(dir) });
  }

  packages.sort((a, b) => a.name.localeCompare(b.name));
  if (packages.length === 0) return 0;

  // A package can appear in several pnpm store locations; keep one notice.
  const unique = new Map();
  for (const entry of packages) {
    if (!unique.has(entry.name)) unique.set(entry.name, entry);
  }
  const listed = [...unique.values()];

  const header = [
    'Editbay bundles the following third-party packages.',
    'Each section reproduces the license text shipped with that package.',
    '',
    'Editbay itself is licensed under the Apache License 2.0 (see LICENSE).',
    '',
    '',
  ].join('\n');
  const body = listed
    .map((entry) => {
      const meta = [`### ${entry.name}`, `License: ${entry.license}`];
      if (entry.repository) meta.push(`Repository: ${entry.repository}`);
      return `${meta.join('\n')}\n\n${entry.text || '(this package ships no license file)'}\n`;
    })
    .join('\n---\n\n');

  await writeFile(outfile, `${header}${body}`, 'utf8');
  return listed.length;
}
