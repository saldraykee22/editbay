import { describe, expect, it } from 'vitest';
import { parseFrontMatter, stringifyFrontMatter } from './frontmatter';

describe('front-matter', () => {
  it('parses strings, numbers, booleans and inline arrays', () => {
    const parsed = parseFrontMatter(
      ['---', 'id: demo', 'count: 3', 'active: true', 'score: -1.5', 'tags: ["a", "b"]', '---', '# Body'].join('\n'),
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.data).toEqual({
      id: 'demo',
      count: 3,
      active: true,
      score: -1.5,
      tags: ['a', 'b'],
    });
    expect(parsed?.body).toBe('# Body');
  });

  it('parses block arrays and block scalars', () => {
    const parsed = parseFrontMatter(
      ['---', 'triggers:', '  - add captions', '  - subtitle', 'notes: |', '  first', '  second', '---', 'Body'].join('\n'),
    );

    expect(parsed?.data.triggers).toEqual(['add captions', 'subtitle']);
    expect(parsed?.data.notes).toBe('first\nsecond');
  });

  it('keeps commas inside quoted inline array items', () => {
    const parsed = parseFrontMatter('---\ntags: ["one, two", \'three\']\n---\n');
    expect(parsed?.data.tags).toEqual(['one, two', 'three']);
  });

  it('unescapes double-quoted strings and single quotes', () => {
    const parsed = parseFrontMatter(
      ['---', 'a: "line\\nnext"', "b: 'it''s fine'", '---', ''].join('\n'),
    );
    expect(parsed?.data.a).toBe('line\nnext');
    expect(parsed?.data.b).toBe("it's fine");
  });

  it('returns null when there is no front-matter', () => {
    expect(parseFrontMatter('# Just markdown')).toBeNull();
    expect(parseFrontMatter('')).toBeNull();
  });

  it('round-trips data and body exactly', () => {
    const data = {
      id: 'brand-voice',
      name: 'Brand voice',
      version: 2,
      builtin: false,
      triggers: ['write copy', 'tone: warm'],
    };
    const body = '# Instructions\n\nKeep it short.\n\n---\n\nStill the body.';
    const text = stringifyFrontMatter(data, body);
    const parsed = parseFrontMatter(text);

    expect(parsed?.data).toEqual(data);
    expect(parsed?.body).toBe(body);
  });

  it('quotes values that would otherwise become numbers, booleans or comments', () => {
    const text = stringifyFrontMatter({ n: '42', flag: 'true', hash: 'value # not a comment' }, '');
    const parsed = parseFrontMatter(text);
    expect(parsed?.data).toEqual({ n: '42', flag: 'true', hash: 'value # not a comment' });
  });

  it('throws a clear error for unterminated front-matter', () => {
    expect(() => parseFrontMatter('---\nid: demo\nbody')).toThrow(/missing closing/);
  });

  it('throws a clear error for malformed lines', () => {
    expect(() => parseFrontMatter('---\nthis is not a key\n---\n')).toThrow(/expected "key: value"/);
    expect(() => parseFrontMatter('---\n  indented: value\n---\n')).toThrow(/unexpected indentation/);
  });
});
