import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  availableVideoEncoders,
  clearEncoderCache,
  isX264Like,
  parseEncoderNames,
  selectVideoEncoder,
  videoBitrateKbps,
  videoEncoderArgs,
} from './encoder';

const X264_ROW = ' V....D libx264              H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)';
const OPENH264_ROW = ' V....D libopenh264          OpenH264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)';
const VIDEOTOOLBOX_ROW = ' V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)';
const MF_ROW = ' V....D h264_mf              MediaFoundation H264 encoder (codec h264)';
const NVENC_ROW = ' V....D h264_nvenc           NVIDIA NVENC H.264 encoder (codec h264)';
const AAC_ROW = ' A....D aac                  AAC (Advanced Audio Coding)';
const HEADER = 'Encoders:\n V..... = Video\n A..... = Audio\n ------';

function encoderOutput(rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env.EDITBAY_VIDEO_ENCODER;
  delete process.env.EDITBAY_VIDEO_ENCODER;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env.EDITBAY_VIDEO_ENCODER;
  else process.env.EDITBAY_VIDEO_ENCODER = savedEnv;
  clearEncoderCache();
});

describe('parseEncoderNames', () => {
  it('keeps video encoders and skips audio rows', () => {
    const names = parseEncoderNames(encoderOutput([X264_ROW, OPENH264_ROW, AAC_ROW]));
    expect(names).toEqual(['libx264', 'libopenh264']);
  });

  it('ignores banner noise', () => {
    expect(parseEncoderNames('ffmpeg version 8.1\nEncoders:\n V..... = Video\n')).toEqual([]);
  });
});

describe('selectVideoEncoder', () => {
  it('prefers libx264 when the build has it', () => {
    const choice = selectVideoEncoder({ available: ['aac', 'libx264', 'libopenh264'] });
    expect(choice).toEqual({ encoder: 'libx264', source: 'auto' });
  });

  it('falls back to libopenh264 on an LGPL build and warns', () => {
    const choice = selectVideoEncoder({ available: ['aac', 'libopenh264', 'h264_nvenc'] });
    expect(choice.encoder).toBe('libopenh264');
    expect(choice.warning).toContain('libx264 is not available');
  });

  it('follows the documented preference order', () => {
    expect(selectVideoEncoder({ available: ['h264_nvenc', 'h264_mf'] }).encoder).toBe('h264_mf');
    expect(selectVideoEncoder({ available: ['h264_nvenc', 'h264_videotoolbox'] }).encoder).toBe(
      'h264_videotoolbox',
    );
    expect(selectVideoEncoder({ available: ['h264_nvenc'] }).encoder).toBe('h264_nvenc');
  });

  it('honours EDITBAY_VIDEO_ENCODER above probing', () => {
    process.env.EDITBAY_VIDEO_ENCODER = 'libvpx-vp9';
    const choice = selectVideoEncoder({ available: ['libx264'] });
    expect(choice).toEqual({ encoder: 'libvpx-vp9', source: 'env' });
  });

  it('prefers an explicit option over the environment', () => {
    process.env.EDITBAY_VIDEO_ENCODER = 'libvpx-vp9';
    const choice = selectVideoEncoder({ override: 'libopenh264', available: ['libx264'] });
    expect(choice).toEqual({ encoder: 'libopenh264', source: 'option' });
  });

  it('warns and keeps libx264 when no known encoder is detected', () => {
    const choice = selectVideoEncoder({ available: [] });
    expect(choice.encoder).toBe('libx264');
    expect(choice.source).toBe('fallback');
    expect(choice.warning).toContain('No supported H.264 encoder');
  });

  it('probes the real binary once and reports a usable encoder', () => {
    const available = availableVideoEncoders();
    expect(Array.isArray(available)).toBe(true);
    if (available.length === 0) return;
    const choice = selectVideoEncoder({ available });
    expect(available).toContain(choice.encoder);
  });
});

describe('videoEncoderArgs', () => {
  const preset = { preset: 'medium', crf: '21' };

  it('maps preset and crf for x264-like encoders', () => {
    expect(isX264Like('libx264')).toBe(true);
    expect(isX264Like('libopenh264')).toBe(false);
    const args = videoEncoderArgs({
      encoder: 'libx264',
      quality: 'standard',
      preset,
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(args).toEqual(['-c:v', 'libx264', '-preset', 'medium', '-crf', '21']);
    expect(args).not.toContain('-b:v');
  });

  it('uses a bitrate budget for non-x264 encoders', () => {
    const args = videoEncoderArgs({
      encoder: 'libopenh264',
      quality: 'standard',
      preset,
      width: 1080,
      height: 1920,
      fps: 30,
    });
    expect(args.slice(0, 2)).toEqual(['-c:v', 'libopenh264']);
    expect(args).not.toContain('-crf');
    expect(args).not.toContain('-preset');
    expect(args).toContain('-b:v');
  });

  it('scales the bitrate with quality and resolution', () => {
    const draft = videoBitrateKbps('draft', 1920, 1080, 30);
    const standard = videoBitrateKbps('standard', 1920, 1080, 30);
    const high = videoBitrateKbps('high', 1920, 1080, 30);
    expect(draft).toBeLessThan(standard);
    expect(standard).toBeLessThan(high);
    expect(videoBitrateKbps('standard', 3840, 2160, 30)).toBeGreaterThan(standard);
    expect(videoBitrateKbps('draft', 1, 1, 1)).toBeGreaterThanOrEqual(600);
  });
});
