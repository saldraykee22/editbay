import { describe, expect, it } from 'vitest';
import {
  frontMatterBool,
  frontMatterList,
  frontMatterString,
  parseCommaList,
  parseFrontMatter,
  parseHexList,
  stringifyFrontMatter,
} from '../frontmatter';
import { stripDuplicateHeading } from '../../state/workspace';

describe('renderer front-matter', () => {
  it('keeps unquoted hex colour lists intact', () => {
    const parsed = parseFrontMatter('---\nname: Acme\ncolors: #0B0B0B, #5BE9A6\n---\n\nBody\n');
    if (!parsed) throw new Error('Expected front-matter');

    expect(frontMatterString(parsed.data, 'name')).toBe('Acme');
    expect(frontMatterList(parsed.data, 'colors')).toEqual(['#0B0B0B', '#5BE9A6']);
  });

  it('still strips real inline comments', () => {
    const parsed = parseFrontMatter('---\ntitle: Note # internal comment\n---\n');
    if (!parsed) throw new Error('Expected front-matter');
    expect(frontMatterString(parsed.data, 'title')).toBe('Note');
  });

  it('round-trips arrays, booleans and the body', () => {
    const text = stringifyFrontMatter(
      {
        id: 'default',
        name: 'Acme Coffee',
        colors: ['#0B0B0B', '#5BE9A6'],
        triggers: ['reels', 'hook'],
        builtin: false,
      },
      '\nWarm, direct.\n',
    );
    const parsed = parseFrontMatter(text);
    if (!parsed) throw new Error('Expected front-matter');

    expect(frontMatterList(parsed.data, 'colors')).toEqual(['#0B0B0B', '#5BE9A6']);
    expect(frontMatterList(parsed.data, 'triggers')).toEqual(['reels', 'hook']);
    expect(frontMatterBool(parsed.data, 'builtin')).toBe(false);
    expect(parsed.body.trim()).toBe('Warm, direct.');
  });

  it('parses Windows line endings and quoted values', () => {
    const parsed = parseFrontMatter('---\r\nname: "Acme, Inc."\r\ntags: [one, "two"]\r\n---\r\nBody');
    if (!parsed) throw new Error('Expected front-matter');

    expect(frontMatterString(parsed.data, 'name')).toBe('Acme, Inc.');
    expect(frontMatterList(parsed.data, 'tags')).toEqual(['one', 'two']);
    expect(parsed.body).toBe('Body');
  });

  it('returns null for documents without front-matter', () => {
    expect(parseFrontMatter('# Just markdown\n')).toBeNull();
  });

  it('does not duplicate a note heading in the body', () => {
    expect(stripDuplicateHeading('# Voice\n\nWarm and direct.', 'Voice')).toBe('Warm and direct.');
    expect(stripDuplicateHeading('## Voice\nDetails', 'Voice')).toBe('Details');
    expect(stripDuplicateHeading('Warm and direct.', 'Voice')).toBe('Warm and direct.');
  });

  it('splits comma lists without breaking font names', () => {
    expect(parseCommaList('IBM Plex Sans, Inter')).toEqual(['IBM Plex Sans', 'Inter']);
    expect(parseHexList('#0B0B0B, #5BE9A6')).toEqual(['#0B0B0B', '#5BE9A6']);
  });
});
