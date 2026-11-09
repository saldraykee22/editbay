/**
 * Audio waveform peak extraction using FFmpeg raw s16le mono 8kHz PCM output.
 */
import { isFfmpegAvailable, resolveFfmpeg, runCommandBuffer } from './ffmpeg';

export interface ExtractPeaksOptions {
  buckets: number;
  ffmpegPath?: string;
  inMs?: number;
  outMs?: number;
}

const MAX_BUCKETS = 2048;
const SAMPLE_MAX = 32768;

/**
 * Pure helper that buckets signed 16-bit little-endian mono PCM samples into
 * `buckets` normalized peak values in the range `0..1`.
 */
export function computePeaksFromPcm(pcm: Buffer | Uint8Array, buckets: number): number[] {
  if (!Number.isFinite(buckets) || buckets <= 0) return [];
  const count = Math.min(MAX_BUCKETS, Math.max(1, Math.floor(buckets)));
  const totalSamples = Math.floor(pcm.byteLength / 2);
  if (totalSamples <= 0) {
    return new Array<number>(count).fill(0);
  }

  const view = new DataView(pcm.buffer, pcm.byteOffset, totalSamples * 2);
  const peaks: number[] = new Array<number>(count);

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.min(totalSamples - 1, Math.floor((bucket * totalSamples) / count));
    const end = Math.min(totalSamples, Math.max(start + 1, Math.floor(((bucket + 1) * totalSamples) / count)));
    let maxAbs = 0;
    for (let i = start; i < end; i += 1) {
      const sample = Math.abs(view.getInt16(i * 2, true));
      if (sample > maxAbs) maxAbs = sample;
    }
    const normalized = Math.min(1, maxAbs / SAMPLE_MAX);
    peaks[bucket] = Math.round(normalized * 10000) / 10000;
  }

  return peaks;
}

export { computePeaksFromPcm as computePeaks };

/**
 * Decode an audio/video file to mono 8kHz s16le PCM via FFmpeg and compute
 * `buckets` normalized peak values (`0..1`).
 */
export async function extractPeaks(filePath: string, opts: ExtractPeaksOptions): Promise<number[]> {
  const buckets = opts.buckets;
  if (!Number.isFinite(buckets) || buckets <= 0) return [];

  const resolveOpts = opts.ffmpegPath ? { bundledDir: opts.ffmpegPath } : {};
  if (!isFfmpegAvailable(resolveOpts)) {
    throw new Error('ffmpeg is not available');
  }
  const ffmpeg = resolveFfmpeg(resolveOpts);

  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (opts.inMs !== undefined && Number.isFinite(opts.inMs) && opts.inMs > 0) {
    args.push('-ss', (opts.inMs / 1000).toFixed(3));
  }
  if (
    opts.outMs !== undefined &&
    Number.isFinite(opts.outMs) &&
    opts.outMs > Math.max(0, opts.inMs ?? 0)
  ) {
    const durationSec = (opts.outMs - Math.max(0, opts.inMs ?? 0)) / 1000;
    args.push('-t', durationSec.toFixed(3));
  }
  args.push('-i', filePath, '-vn', '-f', 's16le', '-ac', '1', '-ar', '8000', 'pipe:1');

  const result = await runCommandBuffer(ffmpeg, args, { timeoutMs: 30_000 });
  if (result.code !== 0) {
    throw new Error(`Waveform extraction failed for ${filePath}: ${result.stderr.trim() || 'unknown ffmpeg error'}`);
  }
  return computePeaksFromPcm(result.stdout, buckets);
}
