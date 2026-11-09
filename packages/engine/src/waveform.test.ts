import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isFfmpegAvailable, resolveFfmpeg, runCommand } from './ffmpeg';
import { computePeaksFromPcm, extractPeaks } from './waveform';

function makeS16leBuffer(samples: number[]): Buffer {
  const buf = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i += 1) {
    buf.writeInt16LE(samples[i] ?? 0, i * 2);
  }
  return buf;
}

describe('computePeaksFromPcm (unit)', () => {
  it('returns an empty array when bucket count is zero or negative', () => {
    const pcm = makeS16leBuffer([1000, -1000]);
    expect(computePeaksFromPcm(pcm, 0)).toEqual([]);
    expect(computePeaksFromPcm(pcm, -4)).toEqual([]);
  });

  it('returns zeros when PCM buffer is empty', () => {
    expect(computePeaksFromPcm(Buffer.alloc(0), 4)).toEqual([0, 0, 0, 0]);
  });

  it('normalizes signed 16-bit PCM peaks per bucket into 0..1', () => {
    const pcm = makeS16leBuffer([
      0,
      0,
      16384,
      -8000,
      -32768,
      100,
      8192,
      -8192,
    ]);
    const peaks = computePeaksFromPcm(pcm, 4);
    expect(peaks).toEqual([0, 0.5, 1, 0.25]);
  });
});

const ffmpegAvailable = isFfmpegAvailable();
const e2eSuite = ffmpegAvailable ? describe : describe.skip;

e2eSuite('extractPeaks (e2e with lavfi sine)', () => {
  let tempDir = '';
  let sinePath = '';

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'editbay-waveform-e2e-'));
    sinePath = path.join(tempDir, 'sine.wav');
    const result = await runCommand(
      resolveFfmpeg(),
      [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=1.2',
        '-af',
        'volume=4',
        sinePath,
      ],
      { timeoutMs: 30_000 },
    );
    if (result.code !== 0) {
      throw new Error(`Failed to generate lavfi sine fixture: ${result.stderr}`);
    }
  });

  afterAll(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('extracts normalized bucket peaks > 0.3 from a lavfi sine file', async () => {
    const peaks = await extractPeaks(sinePath, { buckets: 24 });
    expect(peaks).toHaveLength(24);
    for (const value of peaks) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...peaks)).toBeGreaterThan(0.3);
  });
});
