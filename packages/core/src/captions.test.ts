import { describe, expect, it } from 'vitest';
import {
  cleanCaptionText,
  DEFAULT_CAPTION_STYLE,
  captionsToCommands,
  parseCaptions,
  parseSrt,
  parseTimestampMs,
  parseVtt,
  type Cue,
} from './captions';
import { createEmptyProject } from './project';
import { EditSession } from './session';

describe('captions parsing and commands', () => {
  it('1. parses basic SRT correctly', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
First subtitle

2
00:00:05,500 --> 00:00:08,250
Second subtitle
`;
    const result = parseSrt(srt);
    expect(result.warnings).toHaveLength(0);
    expect(result.cues).toEqual([
      { startMs: 1000, endMs: 4000, text: 'First subtitle' },
      { startMs: 5500, endMs: 8250, text: 'Second subtitle' },
    ]);
  });

  it('2. parses basic WebVTT correctly, ignoring header and cue settings', () => {
    const vtt = `WEBVTT - Sample File

NOTE
This is a comment block that must be ignored

STYLE
::cue { color: yellow; }

00:00:01.000 --> 00:00:04.000 align:start size:50%
First WebVTT subtitle

00:00:05.500 --> 00:00:08.000 line:90% position:50%
Second WebVTT subtitle
`;
    const result = parseVtt(vtt);
    expect(result.warnings).toHaveLength(0);
    expect(result.cues).toEqual([
      { startMs: 1000, endMs: 4000, text: 'First WebVTT subtitle' },
      { startMs: 5500, endMs: 8000, text: 'Second WebVTT subtitle' },
    ]);
  });

  it('3. handles UTF-8 BOM and CRLF line endings in both SRT and VTT', () => {
    const srtWithBom = '\uFEFF1\r\n00:00:01,000 --> 00:00:03,000\r\nHello BOM\r\n';
    const vttWithBom = '\uFEFFWEBVTT\r\n\r\n00:00:01.000 --> 00:00:03.000\r\nHello VTT BOM\r\n';

    const srtRes = parseSrt(srtWithBom);
    expect(srtRes.warnings).toHaveLength(0);
    expect(srtRes.cues).toEqual([{ startMs: 1000, endMs: 3000, text: 'Hello BOM' }]);

    const vttRes = parseVtt(vttWithBom);
    expect(vttRes.warnings).toHaveLength(0);
    expect(vttRes.cues).toEqual([{ startMs: 1000, endMs: 3000, text: 'Hello VTT BOM' }]);
  });

  it('4. preserves multiline cue text joined with newline', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
Line one of cue
Line two of cue
Line three of cue
`;
    const result = parseSrt(srt);
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0]?.text).toBe('Line one of cue\nLine two of cue\nLine three of cue');
  });

  it('5. cleans tags (HTML tags, ASS/SSA override tags, entity references)', () => {
    const srt = `1
00:00:01,000 --> 00:00:04,000
<i>Italic</i> and <b>Bold</b> and <c.yellow>colored</c> and <v Speaker>spoken</v>
{\\an8}{\\pos(192,200)}Top &amp; Center &lt;tag&gt;
`;
    const result = parseSrt(srt);
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0]?.text).toBe('Italic and Bold and colored and spoken\nTop & Center <tag>');
  });

  it('6. parses WebVTT timestamps without hours (MM:SS.mmm)', () => {
    const vtt = `WEBVTT

00:01.000 --> 00:04.500
Subtitle without hour

01:23.456 --> 02:00.000
Another without hour
`;
    const result = parseVtt(vtt);
    expect(result.warnings).toHaveLength(0);
    expect(result.cues).toEqual([
      { startMs: 1000, endMs: 4500, text: 'Subtitle without hour' },
      { startMs: 83456, endMs: 120000, text: 'Another without hour' },
    ]);
  });

  it('7. skips corrupt / invalid cues with warnings and does not throw', () => {
    const srt = `1
NOT_A_TIMESTAMP
Corrupt line

2
00:00:05,000 --> 00:00:03,000
End time before start time

3
00:00:06,000 --> 00:00:09,000
<i>   </i>

4
00:00:10,000 --> 00:00:12,000
Valid cue
`;
    const result = parseSrt(srt);
    expect(result.cues).toHaveLength(1);
    expect(result.cues[0]).toEqual({ startMs: 10000, endMs: 12000, text: 'Valid cue' });
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('8. applies offsetMs correctly and clamps / skips if starts before 0', () => {
    const cues: Cue[] = [
      { startMs: 1000, endMs: 3000, text: 'First' },
      { startMs: 4000, endMs: 6000, text: 'Second' },
    ];

    // Positive offset
    const shifted = captionsToCommands(cues, { offsetMs: 500 });
    expect(shifted[0]?.startMs).toBe(1500);
    expect(shifted[0]?.durationMs).toBe(2000);
    expect(shifted[1]?.startMs).toBe(4500);

    // Negative offset with clamp and skip
    const earlyCues: Cue[] = [
      { startMs: 500, endMs: 1000, text: 'Completely before 0' },
      { startMs: 1500, endMs: 3000, text: 'Partially before 0' },
    ];
    const clamped = captionsToCommands(earlyCues, { offsetMs: -2000 });
    // First cue: endMs = -1000 <= 0 -> skipped
    // Second cue: startMs = -500 -> clamped to 0, endMs = 1000 -> duration 1000
    expect(clamped).toHaveLength(1);
    expect(clamped[0]?.startMs).toBe(0);
    expect(clamped[0]?.durationMs).toBe(1000);
    expect(clamped.warnings.length).toBeGreaterThan(0);
  });

  it('9. clamps cues exceeding projectDurationMs and skips cues outside completely with warnings', () => {
    const cues: Cue[] = [
      { startMs: 1000, endMs: 3000, text: 'Within range' },
      { startMs: 4000, endMs: 6000, text: 'Exceeding end' },
      { startMs: 7000, endMs: 9000, text: 'Completely outside' },
    ];

    const commands = captionsToCommands(cues, { projectDurationMs: 5000 });
    expect(commands).toHaveLength(2);
    // 1st cue untouched
    expect(commands[0]?.startMs).toBe(1000);
    expect(commands[0]?.durationMs).toBe(2000);
    // 2nd cue clamped from 6000 to 5000
    expect(commands[1]?.startMs).toBe(4000);
    expect(commands[1]?.durationMs).toBe(1000);
    // Warnings recorded for both clamped and skipped cues
    expect(commands.warnings).toHaveLength(2);
    expect(commands.warnings[0]).toContain('exceeds project duration');
    expect(commands.warnings[1]).toContain('is outside project duration');
  });

  it('10. handles empty input and whitespace-only files gracefully', () => {
    const emptySrt = parseSrt('');
    expect(emptySrt.cues).toEqual([]);
    expect(emptySrt.warnings).toEqual([]);

    const whitespaceVtt = parseVtt('   \n\n\r\n  ');
    expect(whitespaceVtt.cues).toEqual([]);

    const justHeader = parseVtt('WEBVTT\n\n');
    expect(justHeader.cues).toEqual([]);
    expect(justHeader.warnings).toEqual([]);
  });

  it('11. sorts out-of-order cues by startMs', () => {
    const unsortedSrt = `1
00:00:10,000 --> 00:00:12,000
Third

2
00:00:01,000 --> 00:00:03,000
First

3
00:00:05,000 --> 00:00:08,000
Second
`;
    const result = parseSrt(unsortedSrt);
    expect(result.cues.map((c) => c.text)).toEqual(['First', 'Second', 'Third']);
    expect(result.cues[0]?.startMs).toBe(1000);
    expect(result.cues[1]?.startMs).toBe(5000);
    expect(result.cues[2]?.startMs).toBe(10000);
  });

  it('12. generates command array that EditSession.applyBatch applies to create text track items', () => {
    const srt = `1
00:00:00,500 --> 00:00:02,500
Caption Alpha

2
00:00:03,000 --> 00:00:05,000
Caption Beta
`;
    const { cues } = parseSrt(srt);
    expect(cues).toHaveLength(2);

    const commands = captionsToCommands(cues);
    expect(commands).toHaveLength(2);
    expect(commands[0]?.op).toBe('add_text');
    expect(commands[0]?.style?.background).toBe(DEFAULT_CAPTION_STYLE.background);

    const project = createEmptyProject('Captions test');
    const session = new EditSession(project);
    const batch = session.applyBatch(commands);

    expect(batch.ok).toBe(true);
    expect(batch.results).toHaveLength(2);
    expect(batch.results.every((r) => r.ok)).toBe(true);

    const textTrack = session.project.tracks.find((t) => t.kind === 'text');
    expect(textTrack).toBeDefined();
    expect(textTrack?.items).toHaveLength(2);
    expect(textTrack?.items[0]?.text).toBe('Caption Alpha');
    expect(textTrack?.items[0]?.startMs).toBe(500);
    expect(textTrack?.items[0]?.durationMs).toBe(2000);
    expect(textTrack?.items[1]?.text).toBe('Caption Beta');
  });

  it('13. parseCaptions auto-detects WebVTT vs SRT', () => {
    const vtt = 'WEBVTT\n\n00:01.000 --> 00:02.000\nVTT text';
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nSRT text';

    const vttRes = parseCaptions(vtt);
    expect(vttRes.cues[0]?.text).toBe('VTT text');

    const srtRes = parseCaptions(srt);
    expect(srtRes.cues[0]?.text).toBe('SRT text');
  });
});
