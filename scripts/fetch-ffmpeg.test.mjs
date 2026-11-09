import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assetPatterns,
  detectsGplBuild,
  extractionCommand,
  findFfmpegBinaries,
  parseChecksums,
  selectAssetName,
  targetKey,
  verifySha256,
} from './fetch-ffmpeg.mjs';

const WIN64_VERSIONED = 'ffmpeg-n8.0-latest-win64-lgpl-8.0.zip';
const WIN64_MASTER = 'ffmpeg-master-latest-win64-lgpl.zip';
const LINUX64_VERSIONED = 'ffmpeg-n8.0-latest-linux64-lgpl-8.0.tar.xz';
const LINUX_ARM64_VERSIONED = 'ffmpeg-n8.0-latest-linuxarm64-lgpl-8.0.tar.xz';

describe('asset table', () => {
  it('matches BtbN LGPL names for the supported targets', () => {
    const win = assetPatterns('win64', 'zip');
    expect(win.versioned.test(WIN64_VERSIONED)).toBe(true);
    expect(win.versioned.test(WIN64_MASTER)).toBe(false);
    expect(win.master.test(WIN64_MASTER)).toBe(true);
    expect(win.versioned.test('ffmpeg-n8.0-latest-win64-gpl-8.0.zip')).toBe(false);

    const linux = assetPatterns('linux64', 'tar.xz');
    expect(linux.versioned.test(LINUX64_VERSIONED)).toBe(true);
    expect(linux.versioned.test('ffmpeg-n8.0-latest-linux64-gpl-8.0.tar.xz')).toBe(false);

    const arm = assetPatterns('linuxarm64', 'tar.xz');
    expect(arm.versioned.test(LINUX_ARM64_VERSIONED)).toBe(true);
  });

  it('never matches shared builds, which need DLLs we do not ship', () => {
    const patterns = assetPatterns('win64', 'zip');
    expect(patterns.versioned.test('ffmpeg-n8.0-latest-win64-lgpl-shared-8.0.zip')).toBe(false);
  });

  it('maps platform/arch pairs and refuses macOS', () => {
    expect(targetKey('win32', 'x64')).toBe('win32-x64');
    expect(targetKey('linux', 'arm64')).toBe('linux-arm64');
    expect(() => targetKey('darwin', 'arm64')).toThrow(/macOS/);
    expect(() => targetKey('darwin', 'x64')).toThrow(/EDITBAY_FFMPEG_ARCHIVE/);
  });
});

describe('selectAssetName', () => {
  it('picks the newest versioned LGPL asset and ignores gpl/shared ones', () => {
    const names = [
      'ffmpeg-n7.1-latest-win64-lgpl-7.1.zip',
      WIN64_VERSIONED,
      'ffmpeg-n9.0-latest-win64-gpl-9.0.zip',
      'ffmpeg-n8.0-latest-win64-lgpl-shared-8.0.zip',
      WIN64_MASTER,
    ];
    expect(selectAssetName('win32', 'x64', names)).toBe(WIN64_VERSIONED);
  });

  it('falls back to the master build when no versioned asset exists', () => {
    expect(selectAssetName('win32', 'x64', [WIN64_MASTER, 'ffmpeg-master-latest-win64-gpl.zip'])).toBe(WIN64_MASTER);
  });

  it('returns undefined when the release has no LGPL asset', () => {
    expect(selectAssetName('linux', 'x64', ['ffmpeg-master-latest-linux64-gpl.tar.xz'])).toBeUndefined();
  });

  it('selects the linux64 and linuxarm64 archives', () => {
    expect(selectAssetName('linux', 'x64', [LINUX64_VERSIONED])).toBe(LINUX64_VERSIONED);
    expect(selectAssetName('linux', 'arm64', [LINUX_ARM64_VERSIONED])).toBe(LINUX_ARM64_VERSIONED);
  });
});

describe('GPL detection', () => {
  const LGPL_CONFIG =
    'ffmpeg version n8.0 Copyright (c) 2000-2025 the FFmpeg developers\n' +
    'configuration: --disable-gpl --disable-nonfree --enable-version3';
  const GPL_CONFIG =
    'ffmpeg version 8.1.1-full_build Copyright (c) 2000-2026 the FFmpeg developers\n' +
    'configuration: --enable-gpl --enable-libx264';

  it('accepts an LGPL build', () => {
    expect(detectsGplBuild(LGPL_CONFIG)).toBe(false);
  });

  it('rejects a GPL build', () => {
    expect(detectsGplBuild(GPL_CONFIG)).toBe(true);
  });

  it('does not mistake --disable-gpl for --enable-gpl', () => {
    expect(detectsGplBuild('configuration: --disable-gpl')).toBe(false);
  });
});

describe('checksum handling', () => {
  const hash = 'a'.repeat(64);

  it('parses sha256sum output including the binary marker', () => {
    const parsed = parseChecksums(`${hash}  ffmpeg-n8.0-latest-win64-lgpl-8.0.zip\n${'b'.repeat(64)} *other.zip\n`);
    expect(parsed.get('ffmpeg-n8.0-latest-win64-lgpl-8.0.zip')).toBe(hash);
    expect(parsed.get('other.zip')).toBe('b'.repeat(64));
  });

  it('verifies a digest case-insensitively and rejects a mismatch', () => {
    expect(verifySha256(hash, hash.toUpperCase())).toBe(true);
    expect(verifySha256(hash, 'c'.repeat(64))).toBe(false);
    expect(verifySha256(hash, undefined)).toBe(false);
  });
});

describe('archive extraction', () => {
  it('uses bsdtar for zip on Windows and -xJf for tar.xz on Linux', () => {
    expect(extractionCommand('win32', 'a.zip', 'dest')).toEqual({
      command: 'tar',
      args: ['-xf', 'a.zip', '-C', 'dest'],
    });
    expect(extractionCommand('linux', 'a.tar.xz', 'dest')).toEqual({
      command: 'tar',
      args: ['-xJf', 'a.tar.xz', '-C', 'dest'],
    });
  });
});

describe('findFfmpegBinaries', () => {
  let dir;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('finds ffmpeg and ffprobe inside the archive bin directory', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'editbay-fetch-ffmpeg-'));
    const bin = path.join(dir, 'ffmpeg-n8.0-latest-win64-lgpl-8.0', 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ffmpeg.exe'), '');
    writeFileSync(path.join(bin, 'ffprobe.exe'), '');

    const found = findFfmpegBinaries(dir, 'win32');
    expect(found?.directory).toBe(bin);
    expect(found?.ffmpeg).toBe(path.join(bin, 'ffmpeg.exe'));
    expect(found?.ffprobe).toBe(path.join(bin, 'ffprobe.exe'));
  });

  it('returns undefined when no binary is present', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'editbay-fetch-ffmpeg-'));
    expect(findFfmpegBinaries(dir, 'linux')).toBeUndefined();
  });
});
