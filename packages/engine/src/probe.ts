/**
 * Media probing through ffprobe (JSON output).
 *
 * Parsing is separated from the process call (`probeResultFromJson`) so the
 * stream-selection rules are testable with synthetic ffprobe fixtures.
 */
import { resolveFfprobe, runCommand } from './ffmpeg';
import type { ProbeResult } from './types';

interface FfprobeSideData {
  side_data_type?: string;
  rotation?: number;
  displaymatrix?: string;
}

interface FfprobeDisposition {
  attached_pic?: number;
}

export interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  duration?: string;
  disposition?: FfprobeDisposition;
  tags?: Record<string, string>;
  side_data_list?: FfprobeSideData[];
}

export interface FfprobeFormat {
  duration?: string;
  tags?: Record<string, string>;
}

export interface FfprobeOutput {
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

/**
 * Parse a container duration tag (`DURATION=00:01:23.456000000`). MediaRecorder
 * WebM/MKV files commonly report `duration: "N/A"` on the format and stream but
 * carry the real length in this tag.
 */
export function parseClockSeconds(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return parseSeconds(value);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![hours, minutes, seconds].every((part) => Number.isFinite(part))) return undefined;
  return hours * 3600 + minutes * 60 + seconds;
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

function normalizeRotation(rotation: number): number {
  const mod = rotation % 360;
  return mod > 180 ? mod - 360 : mod < -180 ? mod + 360 : mod;
}

/**
 * Turn a parsed ffprobe JSON document into a `ProbeResult`.
 *
 * Cover art (MP3/M4A/FLAC album images) is reported as a video stream with
 * `disposition.attached_pic === 1`; it must not classify the file as video.
 */
export function probeResultFromJson(data: FfprobeOutput): ProbeResult {
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const video = streams.find(
    (stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic !== 1,
  );
  const audio = streams.find((stream) => stream.codec_type === 'audio');

  const formatSeconds = parseSeconds(data.format?.duration);
  const streamSeconds =
    parseSeconds(video?.duration) ?? parseSeconds(audio?.duration);
  const taggedSeconds =
    parseClockSeconds(video?.tags?.DURATION) ??
    parseClockSeconds(data.format?.tags?.DURATION) ??
    parseClockSeconds(audio?.tags?.DURATION);
  const durationSec = formatSeconds ?? streamSeconds ?? taggedSeconds ?? 0;

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
  if (typeof data !== 'object' || data === null) {
    throw new Error(`ffprobe returned invalid JSON for ${filePath}`);
  }

  return probeResultFromJson(data);
}
