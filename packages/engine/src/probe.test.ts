import { describe, expect, it } from 'vitest';
import { parseClockSeconds, probeResultFromJson } from './probe';
import type { FfprobeOutput } from './probe';

describe('probeResultFromJson', () => {
  it('ignores cover art reported as an attached picture', () => {
    const data: FfprobeOutput = {
      format: { duration: '123.456' },
      streams: [
        { codec_type: 'audio', codec_name: 'mp3' },
        {
          codec_type: 'video',
          codec_name: 'mjpeg',
          width: 600,
          height: 600,
          disposition: { attached_pic: 1 },
        },
      ],
    };
    const result = probeResultFromJson(data);
    expect(result.width).toBeUndefined();
    expect(result.height).toBeUndefined();
    expect(result.videoCodec).toBeUndefined();
    expect(result.fps).toBeUndefined();
    expect(result.hasAudio).toBe(true);
    expect(result.audioCodec).toBe('mp3');
    expect(result.durationMs).toBe(123_456);
  });

  it('still selects a normal video stream', () => {
    const data: FfprobeOutput = {
      format: { duration: '2.000' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          r_frame_rate: '30000/1001',
          disposition: { attached_pic: 0 },
        },
        { codec_type: 'audio', codec_name: 'aac' },
      ],
    };
    const result = probeResultFromJson(data);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.videoCodec).toBe('h264');
    expect(result.fps).toBe(29.97);
    expect(result.durationMs).toBe(2000);
  });

  it('falls back to the stream DURATION tag when the format duration is N/A', () => {
    const data: FfprobeOutput = {
      format: { duration: 'N/A' },
      streams: [
        {
          codec_type: 'video',
          codec_name: 'vp9',
          width: 1280,
          height: 720,
          duration: 'N/A',
          tags: { DURATION: '00:00:12.345000000' },
        },
        { codec_type: 'audio', codec_name: 'opus', duration: 'N/A' },
      ],
    };
    expect(probeResultFromJson(data).durationMs).toBe(12_345);
  });

  it('uses the audio DURATION tag for audio-only media', () => {
    const data: FfprobeOutput = {
      format: { duration: 'N/A' },
      streams: [{ codec_type: 'audio', codec_name: 'opus', duration: 'N/A', tags: { DURATION: '00:00:45.500000000' } }],
    };
    const result = probeResultFromJson(data);
    expect(result.durationMs).toBe(45_500);
    expect(result.hasAudio).toBe(true);
    expect(result.width).toBeUndefined();
  });

  it('prefers the format duration over tags', () => {
    const data: FfprobeOutput = {
      format: { duration: '3.500' },
      streams: [{ codec_type: 'video', codec_name: 'h264', width: 10, height: 10, tags: { DURATION: '00:00:99.000000000' } }],
    };
    expect(probeResultFromJson(data).durationMs).toBe(3500);
  });

  it('swaps dimensions for 90 degree rotation and normalises the angle', () => {
    const data: FfprobeOutput = {
      streams: [
        {
          codec_type: 'video',
          codec_name: 'h264',
          width: 1920,
          height: 1080,
          side_data_list: [{ side_data_type: 'Display Matrix', rotation: -90 }],
        },
      ],
    };
    const result = probeResultFromJson(data);
    expect(result.width).toBe(1080);
    expect(result.height).toBe(1920);
    expect(result.rotation).toBe(-90);
  });

  it('returns a zero duration when nothing reports one', () => {
    const result = probeResultFromJson({ streams: [{ codec_type: 'audio' }] });
    expect(result.durationMs).toBe(0);
  });
});

describe('parseClockSeconds', () => {
  it('parses HH:MM:SS fractions', () => {
    expect(parseClockSeconds('00:00:12.345000000')).toBe(12.345);
    expect(parseClockSeconds('01:02:03.500000000')).toBe(3723.5);
  });

  it('accepts a plain number and rejects junk', () => {
    expect(parseClockSeconds('2.5')).toBe(2.5);
    expect(parseClockSeconds('N/A')).toBeUndefined();
    expect(parseClockSeconds('')).toBeUndefined();
  });
});
