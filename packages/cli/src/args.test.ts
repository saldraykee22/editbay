import { describe, expect, it } from 'vitest';
import { parseCliArgs } from './args';

describe('parseCliArgs', () => {
  it('parses the command, positionals and --json output flag', () => {
    const options = parseCliArgs(['summary', '--json']);
    expect(options.command).toBe('summary');
    expect(options.positionals).toEqual([]);
    expect(options.jsonOutput).toBe(true);
  });

  it('treats apply --json as the command payload', () => {
    const options = parseCliArgs(['apply', '--json', '[{"op":"set_project_name","name":"X"}]']);
    expect(options.command).toBe('apply');
    expect(options.payload).toBe('[{"op":"set_project_name","name":"X"}]');
    expect(options.jsonOutput).toBe(false);
  });

  it('accepts apply --file', () => {
    const options = parseCliArgs(['apply', '--file', 'commands.json']);
    expect(options.command).toBe('apply');
    expect(options.file).toBe('commands.json');
    expect(options.payload).toBeUndefined();
  });

  it('keeps repeated positionals for import', () => {
    const options = parseCliArgs(['import', 'a.mp4', 'b.mp4', 'c.mp4']);
    expect(options.command).toBe('import');
    expect(options.positionals).toEqual(['a.mp4', 'b.mp4', 'c.mp4']);
  });

  it('handles --flag=value and boolean flags', () => {
    const options = parseCliArgs(['export', 'out.mp4', '--quality=high', '--quiet']);
    expect(options.command).toBe('export');
    expect(options.positionals).toEqual(['out.mp4']);
    expect(options.quality).toBe('high');
    expect(options.quiet).toBe(true);
    expect(options.jsonOutput).toBe(false);
  });

  it('finds the command after global flags that take a value', () => {
    const options = parseCliArgs(['--project', 'custom.json', '--json', 'summary']);
    expect(options.command).toBe('summary');
    expect(options.project).toBe('custom.json');
    expect(options.jsonOutput).toBe(true);
  });

  it('parses subcommand positionals and dashed flags', () => {
    const options = parseCliArgs([
      'memory',
      'remember',
      'Brand voice',
      '--body-file',
      'note.md',
      '--tags=tone,brand',
      '--limit=7',
    ]);
    expect(options.command).toBe('memory');
    expect(options.positionals).toEqual(['remember', 'Brand voice']);
    expect(options.bodyFile).toBe('note.md');
    expect(options.tags).toBe('tone,brand');
    expect(options.limit).toBe('7');
  });

  it('parses help in long and short form', () => {
    expect(parseCliArgs(['skills', 'list', '--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
  });

  it('returns an empty command for bare flags', () => {
    const options = parseCliArgs(['--json']);
    expect(options.command).toBe('');
    expect(options.positionals).toEqual([]);
  });

  it('rejects unknown flags', () => {
    expect(() => parseCliArgs(['summary', '--nope'])).toThrow();
  });
});
