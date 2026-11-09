/**
 * Media probing through ffprobe (JSON output).
 */
import { resolveFfprobe, runCommand } from './ffmpeg';
import type { ProbeResult } from './types';

interface FfprobeSideData {
  side_data_type?: string;
  rotation?: number;
  displaymatrix?: string;
}

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  tags?: Record<string, string>;
  side_data_list?: FfprobeSideData[];
}

interface FfprobeFormat {
  duration?: string;
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

/** Parse an ffprobe rational like "30000/1001" into a rounded float. */
export function parseRate(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const [rawNumerator, rawDenominator] = value.split('/');
  const numerator = Number(rawNumerator);
  const denominator = rawDenominator === undefined ? 1 : Number(rawDenominator);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  const rate = numerator / denominator;
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  return Math.round(rate * 1000) / 1000;
}

function parseSeconds(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/** Rotation from a display-matrix side data entry or the `rotate` tag. */
function readRotation(stream: FfprobeStream): number | undefined {
  for (const entry of stream.side_data_list ?? []) {
    if (typeof entry.rotation === 'number' && Number.isFinite(entry.rotation)) return entry.rotation;
  }
  const tagged = stream.tags?.rotate;
  if (tagged !== undefined) {
    const parsed = Number(tagged);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Probe a media file. Throws when the file is missing or unreadable so callers
 * can surface a clear import error instead of a silent zero-duration asset.
 */
export async function probeMedia(filePath: string): Promise<ProbeResult> {
  const ffprobe = resolveFfprobe();
  const result = await runCommand(
    ffprobe,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath],
    { timeoutMs: 30_000 },
  );

  if (result.code !== 0) {
    const detail = result.stderr.trim() || 'no output';
    throw new Error(`ffprobe failed for ${filePath}: ${detail}`);
  }

  let data: FfprobeOutput;
  try {
    data = JSON.parse(result.stdout) as FfprobeOutput;
  } catch {
    throw new Error(`ffprobe returned invalid JSON for ${filePath}`);
  }

  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video');
  const audio = streams.find((stream) => stream.codec_type === 'audio');

  const formatSeconds = parseSeconds(data.format?.duration);
  const streamSeconds = video ? parseSeconds(video.duration) : undefined;
  const durationSec = formatSeconds ?? streamSeconds ?? 0;

  let width = video?.width;
  let height = video?.height;
  const rotation = video ? readRotation(video) : undefined;

  // ffprobe reports coded dimensions; a 90/270 rotation means the display box
  // is transposed. Swapping here keeps every downstream consumer consistent.
  if (rotation !== undefined && Math.abs(Math.round(rotation)) % 180 === 90) {
    const swapped = width;
    width = height;
    height = swapped;
  }

  const fps = video ? parseRate(video.r_frame_rate) ?? parseRate(video.avg_frame_rate) : undefined;

  return {
    durationMs: Math.round(durationSec * 1000),
    width,
    height,
    fps,
    hasAudio: audio !== undefined,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    rotation: rotation === undefined ? undefined : normalizeRotation(rotation),
  };
}

function normalizeRotation(rotation: number): number {
  const mod = rotation % 360;
  return mod > 180 ? mod - 360 : mod < -180 ? mod + 360 : mod;
}
