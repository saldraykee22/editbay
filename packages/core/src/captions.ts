/**
 * Subtitle and caption parsing (SRT / WebVTT) and command generation.
 */

import type { AddTextCommand, TextStyle } from './types';

export interface Cue {
  startMs: number;
  endMs: number;
  text: string;
}

export interface CaptionParseResult {
  cues: Cue[];
  warnings: string[];
}

export interface CaptionsToCommandsOptions {
  offsetMs?: number;
  style?: Partial<TextStyle>;
  projectDurationMs?: number;
  warnings?: string[];
}

export const DEFAULT_CAPTION_STYLE: Partial<TextStyle> = {
  fontFamily: 'IBM Plex Sans',
  fontSize: 56,
  fontWeight: 600,
  color: '#FFFFFF',
  align: 'center',
  x: 0.5,
  y: 0.82,
  background: '#000000BF',
  padding: 8,
  radius: 4,
  lineHeight: 1.15,
};

/**
 * Parses a timestamp into integer milliseconds.
 * Supports:
 * - HH:MM:SS,mmm or HH:MM:SS.mmm
 * - MM:SS,mmm or MM:SS.mmm
 */
export function parseTimestampMs(raw: string): number | null {
  const trimmed = raw.trim();
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/.exec(trimmed);
  if (!match) return null;

  const hours = match[1] !== undefined ? parseInt(match[1], 10) : 0;
  const minutes = parseInt(match[2]!, 10);
  const seconds = parseInt(match[3]!, 10);
  const millisRaw = match[4]!;
  const millis = parseInt(millisRaw.padEnd(3, '0'), 10);

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(millis)) return null;

  return (hours * 3600 + minutes * 60 + seconds) * 1000 + millis;
}

/**
 * Cleans simple styling tags (HTML tags, ASS/SSA override tags) and trims text.
 */
export function cleanCaptionText(raw: string): string {
  let text = raw;
  // Strip ASS/SSA tags like {\an8}, {\pos(100,200)}, {\b1}
  text = text.replace(/\{[^}]+\}/g, '');
  // Strip HTML / WebVTT tags like <i>, <b>, </u>, <c.color>, </c>, <v Speaker>
  text = text.replace(/<[^>]+>/g, '');
  // Unescape standard HTML entities
  text = text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
  return text.trim();
}

/**
 * Normalizes text by removing BOM and converting all line endings to \n.
 */
function normalizeText(text: string): string {
  return text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Parses an SRT subtitle file content.
 */
export function parseSrt(text: string): CaptionParseResult {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const cues: Cue[] = [];
  const warnings: string[] = [];

  let index = 0;
  while (index < lines.length) {
    // Skip empty lines
    while (index < lines.length && (lines[index] ?? '').trim() === '') {
      index += 1;
    }
    if (index >= lines.length) break;

    const blockStartLine = index + 1;
    let timingLine = lines[index] ?? '';

    // If current line does not contain '-->', it might be a cue index
    if (!timingLine.includes('-->')) {
      index += 1;
      if (index < lines.length) {
        timingLine = lines[index] ?? '';
      }
    }

    if (!timingLine.includes('-->')) {
      warnings.push(`Line ${blockStartLine}: Missing time separator "-->", skipping block`);
      // Advance to next empty line
      while (index < lines.length && (lines[index] ?? '').trim() !== '') {
        index += 1;
      }
      continue;
    }

    const arrowIdx = timingLine.indexOf('-->');
    const startPart = timingLine.slice(0, arrowIdx).trim();
    const restPart = timingLine.slice(arrowIdx + 3).trim();
    const endPart = restPart.split(/\s+/)[0] ?? '';

    const startMs = parseTimestampMs(startPart);
    const endMs = parseTimestampMs(endPart);

    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim() !== '') {
      textLines.push(lines[index]!);
      index += 1;
    }

    if (startMs === null || endMs === null) {
      warnings.push(`Line ${blockStartLine}: Invalid timestamp format "${timingLine.trim()}", skipping cue`);
      continue;
    }

    if (endMs <= startMs) {
      warnings.push(`Line ${blockStartLine}: Cue end time (${endMs}ms) is not after start time (${startMs}ms), skipping cue`);
      continue;
    }

    const cleaned = cleanCaptionText(textLines.join('\n'));
    if (cleaned.length === 0) {
      warnings.push(`Line ${blockStartLine}: Cue has empty text after cleaning, skipping cue`);
      continue;
    }

    cues.push({ startMs, endMs, text: cleaned });
  }

  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return { cues, warnings };
}

/**
 * Parses a WebVTT subtitle file content.
 */
export function parseVtt(text: string): CaptionParseResult {
  const normalized = normalizeText(text);
  const lines = normalized.split('\n');
  const cues: Cue[] = [];
  const warnings: string[] = [];

  let index = 0;

  // Check header
  while (index < lines.length && (lines[index] ?? '').trim() === '') {
    index += 1;
  }

  if (index < lines.length && (lines[index] ?? '').startsWith('WEBVTT')) {
    index += 1;
    // Skip header metadata until first blank line
    while (index < lines.length && (lines[index] ?? '').trim() !== '') {
      index += 1;
    }
  }

  while (index < lines.length) {
    // Skip empty lines
    while (index < lines.length && (lines[index] ?? '').trim() === '') {
      index += 1;
    }
    if (index >= lines.length) break;

    const currentLine = (lines[index] ?? '').trim();

    // Ignore NOTE, STYLE, REGION blocks
    if (currentLine.startsWith('NOTE') || currentLine.startsWith('STYLE') || currentLine.startsWith('REGION')) {
      while (index < lines.length && (lines[index] ?? '').trim() !== '') {
        index += 1;
      }
      continue;
    }

    const blockStartLine = index + 1;
    let timingLine = lines[index] ?? '';

    // If current line does not contain '-->', it might be an identifier
    if (!timingLine.includes('-->')) {
      index += 1;
      if (index < lines.length) {
        timingLine = lines[index] ?? '';
      }
    }

    if (!timingLine.includes('-->')) {
      warnings.push(`Line ${blockStartLine}: Missing time separator "-->", skipping block`);
      while (index < lines.length && (lines[index] ?? '').trim() !== '') {
        index += 1;
      }
      continue;
    }

    const arrowIdx = timingLine.indexOf('-->');
    const startPart = timingLine.slice(0, arrowIdx).trim();
    const restPart = timingLine.slice(arrowIdx + 3).trim();
    // VTT cue settings may follow the end timestamp, e.g. "00:04.000 align:start line:90%"
    const endPart = restPart.split(/\s+/)[0] ?? '';

    const startMs = parseTimestampMs(startPart);
    const endMs = parseTimestampMs(endPart);

    index += 1;
    const textLines: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim() !== '') {
      textLines.push(lines[index]!);
      index += 1;
    }

    if (startMs === null || endMs === null) {
      warnings.push(`Line ${blockStartLine}: Invalid timestamp format "${timingLine.trim()}", skipping cue`);
      continue;
    }

    if (endMs <= startMs) {
      warnings.push(`Line ${blockStartLine}: Cue end time (${endMs}ms) is not after start time (${startMs}ms), skipping cue`);
      continue;
    }

    const cleaned = cleanCaptionText(textLines.join('\n'));
    if (cleaned.length === 0) {
      warnings.push(`Line ${blockStartLine}: Cue has empty text after cleaning, skipping cue`);
      continue;
    }

    cues.push({ startMs, endMs, text: cleaned });
  }

  cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  return { cues, warnings };
}

/**
 * Parses captions from text, auto-detecting WebVTT or SRT format if format is omitted.
 */
export function parseCaptions(text: string, format?: 'srt' | 'vtt'): CaptionParseResult {
  const chosenFormat = format ?? (normalizeText(text).trimStart().startsWith('WEBVTT') ? 'vtt' : 'srt');
  return chosenFormat === 'vtt' ? parseVtt(text) : parseSrt(text);
}

/**
 * Converts cues into add_text commands for Editbay text tracks.
 */
export function captionsToCommands(
  cues: Cue[],
  opts: CaptionsToCommandsOptions = {},
): AddTextCommand[] & { warnings: string[] } {
  const warnings: string[] = [];
  const offset = opts.offsetMs ?? 0;
  const mergedStyle: Partial<TextStyle> = {
    ...DEFAULT_CAPTION_STYLE,
    ...(opts.style ?? {}),
  };

  const commands: AddTextCommand[] = [];

  for (const cue of cues) {
    let startMs = cue.startMs + offset;
    let endMs = cue.endMs + offset;

    // Project duration boundary checks
    if (opts.projectDurationMs !== undefined) {
      const maxMs = opts.projectDurationMs;
      if (startMs >= maxMs) {
        warnings.push(`Cue "${cue.text}" is outside project duration (${startMs}ms >= ${maxMs}ms), skipping`);
        continue;
      }
      if (endMs > maxMs) {
        warnings.push(`Cue "${cue.text}" exceeds project duration (${endMs}ms > ${maxMs}ms), clamped to ${maxMs}ms`);
        endMs = maxMs;
      }
    }

    if (endMs <= 0) {
      warnings.push(`Cue "${cue.text}" ends before timeline start (${endMs}ms <= 0ms), skipping`);
      continue;
    }

    if (startMs < 0) {
      warnings.push(`Cue "${cue.text}" starts before timeline start (${startMs}ms < 0ms), clamped to 0ms`);
      startMs = 0;
    }

    let durationMs = endMs - startMs;
    // Core command engine requires durationMs >= 200
    if (durationMs < 200) {
      durationMs = 200;
    }

    commands.push({
      op: 'add_text',
      text: cue.text,
      startMs,
      durationMs,
      style: mergedStyle,
    });
  }

  if (opts.warnings) {
    opts.warnings.push(...warnings);
  }

  const result = commands as AddTextCommand[] & { warnings: string[] };
  result.warnings = warnings;
  return result;
}
