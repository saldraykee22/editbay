/**
 * Fetch a distribution-safe FFmpeg build into `apps/desktop/resources/ffmpeg`
 * so electron-builder can bundle it as `resources/ffmpeg` in the installer.
 *
 * Distribution builds must be LGPL (`--disable-gpl --disable-nonfree`); BtbN's
 * `-lgpl` assets qualify. The script refuses any binary whose `-version` output
 * advertises `--enable-gpl`, so a GPL build can never reach a shipped package.
 *
 * Usage:
 *   node scripts/fetch-ffmpeg.mjs --dry-run        print URL + destination only
 *   node scripts/fetch-ffmpeg.mjs                  download for this platform
 *   node scripts/fetch-ffmpeg.mjs --from <path>    copy from a local archive/dir
 *   node scripts/fetch-ffmpeg.mjs --force          overwrite an existing bundle
 *   node scripts/fetch-ffmpeg.mjs --allow-gpl-for-local-testing
 *                                                  LOCAL TESTING ONLY: skip the
 *                                                  GPL rejection (never in CI)
 *
 * No npm dependencies: Node built-ins only.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { get as httpsGet } from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const TARGET_DIR = path.join(REPO_ROOT, 'apps', 'desktop', 'resources', 'ffmpeg');

export const RELEASES_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases';
export const LATEST_RELEASE_API = 'https://api.github.com/repos/BtbN/FFmpeg-Builds/releases/latest';
export const CHECKSUMS_ASSET = 'checksums.sha256';
export const USER_AGENT = 'editbay-fetch-ffmpeg';

const MAX_ARCHIVE_BYTES = 400 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;

/**
 * BtbN asset naming per target. Only LGPL (non-`shared`) archives are accepted:
 * static builds carry every DLL inside the binary, shared ones need a sibling
 * `bin/` with DLLs that we deliberately do not ship.
 *
 * Example asset names:
 *   ffmpeg-n8.0-latest-win64-lgpl-8.0.zip
 *   ffmpeg-n8.0-latest-linux64-lgpl-8.0.tar.xz
 *   ffmpeg-master-latest-win64-lgpl.zip
 */
export const TARGETS = {
  'win32-x64': {
    platformTag: 'win64',
    extension: 'zip',
    archiveArgs: ['-xf'],
    binaries: { ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' },
  },
  'linux-x64': {
    platformTag: 'linux64',
    extension: 'tar.xz',
    archiveArgs: ['-xJf'],
    binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
  },
  'linux-arm64': {
    platformTag: 'linuxarm64',
    extension: 'tar.xz',
    archiveArgs: ['-xJf'],
    binaries: { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' },
  },
};

const MACOS_MESSAGE =
  'BtbN FFmpeg-Builds does not publish macOS binaries. Provide a build yourself with ' +
  '`--from <archive-or-directory>` or `EDITBAY_FFMPEG_ARCHIVE=<archive-or-directory>` ' +
  '(a `--disable-gpl` build), then re-run.';

/** Target key for a platform/arch pair. Throws for unsupported targets (macOS included). */
export function targetKey(platform, arch) {
  if (platform === 'darwin') throw new Error(MACOS_MESSAGE);
  const key = `${platform}-${arch === 'x64' ? 'x64' : arch}`;
  if (!TARGETS[key]) {
    throw new Error(`No BtbN FFmpeg build is mapped for ${platform}/${arch}. Use --from to supply your own build.`);
  }
  return key;
}

/** Regexes for the versioned (preferred) and `master` (fallback) LGPL assets. */
export function assetPatterns(platformTag, extension) {
  const escaped = extension.replace(/\./g, '\\.');
  return {
    versioned: new RegExp(`^ffmpeg-n\\d+(?:\\.\\d+)*-latest-${platformTag}-lgpl-(?!shared)[\\w.-]*\\.${escaped}$`),
    master: new RegExp(`^ffmpeg-master-latest-${platformTag}-lgpl\\.${escaped}$`),
  };
}

function versionParts(name) {
  const match = /^ffmpeg-n(\d+(?:\.\d+)*)-/.exec(name);
  return match ? match[1].split('.').map(Number) : [];
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return a.localeCompare(b);
}

/**
 * Pick the newest versioned LGPL asset for a target, falling back to the
 * `master` build. Pure: takes the release's asset names and returns one.
 */
export function selectAssetName(platform, arch, assetNames) {
  const key = targetKey(platform, arch);
  const target = TARGETS[key];
  const patterns = assetPatterns(target.platformTag, target.extension);

  const versioned = assetNames.filter((name) => patterns.versioned.test(name));
  if (versioned.length > 0) {
    return [...versioned].sort(compareVersions).at(-1);
  }

  const master = assetNames.filter((name) => patterns.master.test(name));
  if (master.length > 0) return master[0];

  return undefined;
}

/** True when `ffmpeg -version` reports a GPL-enabled build. */
export function detectsGplBuild(versionOutput) {
  return /--enable-gpl\b/.test(versionOutput);
}

/** Parse `sha256sum`-style output into `{ filename: hex }`. */
export function parseChecksums(text) {
  const entries = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([a-fA-F0-9]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match) entries.set(path.basename(match[2]), match[1].toLowerCase());
  }
  return entries;
}

/** Constant-time-ish comparison of a digest buffer against a hex string. */
export function verifySha256(digestHex, expectedHex) {
  return Boolean(expectedHex) && digestHex.toLowerCase() === expectedHex.trim().toLowerCase();
}

/** Archive extraction argv for the current platform (Win10+ bsdtar reads zip). */
export function extractionCommand(platform, archivePath, destination) {
  if (platform === 'win32' || platform === 'darwin') {
    return { command: 'tar', args: ['-xf', archivePath, '-C', destination] };
  }
  return { command: 'tar', args: ['-xJf', archivePath, '-C', destination] };
}

/**
 * Locate `ffmpeg` and its sibling `ffprobe` inside an extracted archive or a
 * local build directory. Prefers the shallowest directory that has both.
 */
export function findFfmpegBinaries(root, platform) {
  const names = platform === 'win32' ? { ffmpeg: 'ffmpeg.exe', ffprobe: 'ffprobe.exe' } : { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe' };
  const directories = [];

  const walk = (current, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    const files = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    if (files.has(names.ffmpeg)) directories.push({ directory: current, depth });
    for (const entry of entries) {
      if (entry.isDirectory()) walk(path.join(current, entry.name), depth + 1);
    }
  };

  walk(root, 0);
  if (directories.length === 0) return undefined;

  directories.sort((left, right) => left.depth - right.depth || left.directory.length - right.directory.length);
  const withProbe = directories.find((candidate) => existsSync(path.join(candidate.directory, names.ffprobe)));
  const chosen = withProbe ?? directories[0];
  return {
    directory: chosen.directory,
    ffmpeg: path.join(chosen.directory, names.ffmpeg),
    ffprobe: withProbe ? path.join(chosen.directory, names.ffprobe) : undefined,
  };
}

/** First file in `directory` whose name matches `pattern` (LICENSE/README). */
function findSidecar(directory, pattern) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const match = entries.find((entry) => entry.isFile() && pattern.test(entry.name));
  return match ? path.join(directory, match.name) : undefined;
}

/**
 * BtbN puts LICENSE/README at the archive root while the binaries live in
 * `bin/`, and local builds may be either way; check the directory then its
 * parent.
 */
function findSidecarNear(directory, pattern) {
  return findSidecar(directory, pattern) ?? findSidecar(path.dirname(directory), pattern);
}

function httpGetBuffer(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const request = httpsGet(url, { headers: { 'user-agent': USER_AGENT, accept: '*/*' } }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location) {
        response.resume();
        if (redirects >= 5) {
          reject(new Error(`Too many redirects while fetching ${url}`));
          return;
        }
        resolve(httpGetBuffer(new URL(location, url).toString(), redirects + 1));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`GET ${url} failed with HTTP ${status}`));
        return;
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_ARCHIVE_BYTES) {
          request.destroy(new Error(`Refusing to download more than ${MAX_ARCHIVE_BYTES} bytes from ${url}`));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.setTimeout(120_000, () => request.destroy(new Error(`Timed out fetching ${url}`)));
  });
}

async function fetchText(url) {
  const buffer = await httpGetBuffer(url);
  if (buffer.length > MAX_TEXT_BYTES) throw new Error(`Text response from ${url} is unexpectedly large`);
  return buffer.toString('utf8');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 300_000, ...options });
  if (result.error) throw result.error;
  return result;
}

function cleanup(directory) {
  rmSync(directory, { recursive: true, force: true });
}

function installedBinaries(targetDir, platform) {
  const names = platform === 'win32' ? ['ffmpeg.exe', 'ffprobe.exe'] : ['ffmpeg', 'ffprobe'];
  return names.filter((name) => existsSync(path.join(targetDir, name)));
}

function parseArgs(argv) {
  const options = { dryRun: false, force: false, from: undefined, allowGpl: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--force') options.force = true;
    else if (arg === '--allow-gpl-for-local-testing') options.allowGpl = true;
    else if (arg === '--from') {
      index += 1;
      options.from = argv[index];
      if (!options.from) throw new Error('--from needs an archive or directory path');
    } else if (arg.startsWith('--from=')) {
      options.from = arg.slice('--from='.length);
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/fetch-ffmpeg.mjs [--dry-run] [--force] [--from <path>] [--allow-gpl-for-local-testing]',
    '',
    'Downloads the latest BtbN FFmpeg-Builds LGPL archive for this platform and',
    'extracts ffmpeg, ffprobe, LICENSE and README into apps/desktop/resources/ffmpeg.',
    '--from copies from a local archive or an unpacked build directory instead.',
    '--allow-gpl-for-local-testing is for local packaging smoke tests only.',
  ].join('\n');
}

function describePlan(options, platform, arch) {
  const key = targetKey(platform, arch);
  const target = TARGETS[key];
  const patterns = assetPatterns(target.platformTag, target.extension);
  return [
    `Target      : ${platform}/${arch} (${key})`,
    `Releases    : ${RELEASES_URL}`,
    `Asset       : newest asset matching ${patterns.versioned} (fallback ${patterns.master})`,
    `API         : ${LATEST_RELEASE_API}`,
    `Destination : ${path.relative(REPO_ROOT, TARGET_DIR)} (${TARGET_DIR})`,
    `Source      : ${options.from ?? process.env.EDITBAY_FFMPEG_ARCHIVE ?? 'download from GitHub'}`,
  ].join('\n');
}

/**
 * Copy the binaries (plus LICENSE/README) into the temp staging directory, so
 * the GPL rejection path can delete real files without touching the source.
 */
function stageBinaries(found, stagingDir) {
  const payload = path.join(stagingDir, 'payload');
  mkdirSync(payload, { recursive: true });

  const ffmpeg = path.join(payload, path.basename(found.ffmpeg));
  copyFileSync(found.ffmpeg, ffmpeg);

  let ffprobe;
  if (found.ffprobe) {
    ffprobe = path.join(payload, path.basename(found.ffprobe));
    copyFileSync(found.ffprobe, ffprobe);
  }

  const license = findSidecarNear(found.directory, /^licen[cs]e/i);
  if (license) copyFileSync(license, path.join(payload, 'LICENSE'));
  const readme = findSidecarNear(found.directory, /^readme/i);
  if (readme) copyFileSync(readme, path.join(payload, 'README'));

  return { directory: payload, ffmpeg, ffprobe };
}

/** Copy the staged binaries + license/readme into the bundle directory. */
function install(staged, targetDir, platform) {
  mkdirSync(targetDir, { recursive: true });

  copyFileSync(staged.ffmpeg, path.join(targetDir, path.basename(staged.ffmpeg)));
  if (platform !== 'win32') chmodSync(path.join(targetDir, path.basename(staged.ffmpeg)), 0o755);

  if (staged.ffprobe) {
    copyFileSync(staged.ffprobe, path.join(targetDir, path.basename(staged.ffprobe)));
    if (platform !== 'win32') chmodSync(path.join(targetDir, path.basename(staged.ffprobe)), 0o755);
  } else {
    console.warn('warning: ffprobe was not found in the provided build; only ffmpeg will be bundled.');
  }

  const license = findSidecar(staged.directory, /^licen[cs]e/i);
  if (license) copyFileSync(license, path.join(targetDir, 'LICENSE'));
  else console.warn('warning: no LICENSE file in the build; add the FFmpeg LGPL notice manually.');

  const readme = findSidecar(staged.directory, /^readme/i);
  if (readme) copyFileSync(readme, path.join(targetDir, 'README'));
  else console.warn('warning: no README file in the build.');

  return installedBinaries(targetDir, platform);
}

async function stageFromLocal(source, stagingDir, platform) {
  const stat = statSync(source);
  if (stat.isDirectory()) {
    console.log(`Copying from directory ${source}`);
    return source;
  }

  const { command, args } = extractionCommand(platform, source, stagingDir);
  console.log(`Extracting ${source}`);
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(`Extraction failed (${command} ${args.join(' ')}): ${result.stderr || result.stdout}`);
  }
  return stagingDir;
}

async function stageFromDownload(platform, arch, stagingDir) {
  const key = targetKey(platform, arch);
  const target = TARGETS[key];
  const patterns = assetPatterns(target.platformTag, target.extension);

  console.log(`Querying ${LATEST_RELEASE_API}`);
  const release = JSON.parse(await fetchText(LATEST_RELEASE_API));
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const assetName = selectAssetName(
    platform,
    arch,
    assets.map((asset) => asset.name),
  );
  if (!assetName) {
    throw new Error(
      `No LGPL asset for ${key} in ${release.tag_name ?? 'the latest release'}. ` +
        `Expected ${patterns.versioned} or ${patterns.master}.`,
    );
  }

  const asset = assets.find((candidate) => candidate.name === assetName);
  const archivePath = path.join(stagingDir, assetName);
  console.log(`Downloading ${asset.browser_download_url}`);
  const archive = await httpGetBuffer(asset.browser_download_url);

  const checksumAsset = assets.find((candidate) => candidate.name === CHECKSUMS_ASSET);
  if (checksumAsset) {
    const checksums = parseChecksums(await fetchText(checksumAsset.browser_download_url));
    const expected = checksums.get(assetName);
    if (!expected) {
      console.warn(`warning: ${CHECKSUMS_ASSET} has no entry for ${assetName}; skipping verification.`);
    } else if (!verifySha256(createHash('sha256').update(archive).digest('hex'), expected)) {
      throw new Error(`SHA-256 mismatch for ${assetName}; the download is corrupt or tampered with.`);
    } else {
      console.log(`SHA-256 verified (${expected.slice(0, 16)}…)`);
    }
  } else {
    console.warn(`warning: release has no ${CHECKSUMS_ASSET}; downloaded archive is unverified.`);
  }

  writeFileSync(archivePath, archive);

  const { command, args } = extractionCommand(platform, archivePath, stagingDir);
  const result = run(command, args);
  if (result.status !== 0) {
    throw new Error(`Extraction failed (${command} ${args.join(' ')}): ${result.stderr || result.stdout}`);
  }
  return stagingDir;
}

export async function main(argv = process.argv.slice(2), platform = process.platform, arch = process.arch) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(usage());
    return 0;
  }

  if (options.dryRun) {
    console.log(describePlan(options, platform, arch));
    console.log('Dry run: no network request was made and nothing was written.');
    return 0;
  }

  const source = options.from ?? process.env.EDITBAY_FFMPEG_ARCHIVE;
  if (!source && platform === 'darwin') throw new Error(MACOS_MESSAGE);

  const stagingDir = mkdtempSync(path.join(tmpdir(), 'editbay-ffmpeg-'));
  try {
    const searchRoot = source
      ? await stageFromLocal(path.resolve(source), stagingDir, platform)
      : await stageFromDownload(platform, arch, stagingDir);

    const staged = findFfmpegBinaries(searchRoot, platform);
    if (!staged) throw new Error(`No ${platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'} found in ${searchRoot}`);

    const payload = stageBinaries(staged, stagingDir);

    const version = run(payload.ffmpeg, ['-version']);
    const versionOutput = `${version.stdout ?? ''}${version.stderr ?? ''}`;
    if (version.status !== 0) throw new Error(`The supplied ffmpeg could not run: ${versionOutput.slice(0, 400)}`);

    if (detectsGplBuild(versionOutput)) {
      if (!options.allowGpl) {
        console.error('ERROR: this is a GPL-enabled FFmpeg build (--enable-gpl). GPL builds are not distributed.');
        console.error('Refusing to bundle it. Deleted staged files:');
        for (const entry of readdirSync(path.dirname(payload.ffmpeg))) console.error(`  - ${entry}`);
        rmSync(stagingDir, { recursive: true, force: true });
        console.error('Use a BtbN `-lgpl` build, or pass --allow-gpl-for-local-testing for a local packaging test only.');
        return 1;
      }
      console.warn('WARNING: GPL build allowed for LOCAL TESTING ONLY. Do not distribute this bundle.');
    }

    const existing = installedBinaries(TARGET_DIR, platform);
    if (existing.length > 0 && !options.force) {
      throw new Error(
        `${path.relative(REPO_ROOT, TARGET_DIR)} already contains ${existing.join(', ')}. Re-run with --force to replace it.`,
      );
    }

    const installed = install(payload, TARGET_DIR, platform);
    console.log(`Installed ${installed.join(', ')} into ${path.relative(REPO_ROOT, TARGET_DIR)}`);
    console.log('Remember: only LGPL builds may ship. See docs/licensing.md.');
    return 0;
  } finally {
    cleanup(stagingDir);
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    },
  );
}
