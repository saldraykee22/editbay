import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs, resolveConfig, toStudioOptions } from './config';

const CWD = process.cwd();

describe('mcp config', () => {
  it('parses --flag value pairs', () => {
    const values = parseArgs(['--project', 'demo.json', '--workspace', 'ws']);
    expect(values.project).toBe('demo.json');
    expect(values.workspace).toBe('ws');
  });

  it('parses --flag=value pairs', () => {
    const values = parseArgs(['--project=demo.json', '--builtin-skills=skills']);
    expect(values.project).toBe('demo.json');
    expect(values.builtinSkills).toBe('skills');
  });

  it('ignores unknown and malformed flags instead of throwing', () => {
    const values = parseArgs(['--unknown', 'x', '--project', '--workspace']);
    expect(values.project).toBeUndefined();
    expect(values.workspace).toBeUndefined();
  });

  it('defaults the project to ./editbay.json', () => {
    const config = resolveConfig([], {}, CWD);
    expect(config.projectPath).toBe(resolve(CWD, 'editbay.json'));
    expect(config.workspaceRoot).toBeUndefined();
  });

  it('discovers builtin skills when no flag or env is set', () => {
    const config = resolveConfig([], {}, CWD);
    expect(config.builtinSkillsDir).toBeDefined();
    expect(existsSync(join(config.builtinSkillsDir ?? '', 'captions', 'SKILL.md'))).toBe(true);
  });

  it('reads environment variables when flags are absent', () => {
    const config = resolveConfig([], {
      EDITBAY_PROJECT: 'env/project.json',
      EDITBAY_WORKSPACE: 'env-workspace',
      EDITBAY_BUILTIN_SKILLS: 'env-skills',
    }, CWD);
    expect(config.projectPath).toBe(resolve(CWD, 'env/project.json'));
    expect(config.workspaceRoot).toBe(resolve(CWD, 'env-workspace'));
    expect(config.builtinSkillsDir).toBe(resolve(CWD, 'env-skills'));
  });

  it('lets flags win over the environment', () => {
    const config = resolveConfig(['--project', 'flag.json'], { EDITBAY_PROJECT: 'env.json' }, CWD);
    expect(config.projectPath).toBe(resolve(CWD, 'flag.json'));
  });

  it('maps config onto studio options without empty fields', () => {
    const options = toStudioOptions({ projectPath: resolve(CWD, 'p.json') });
    expect(options.projectPath).toBe(resolve(CWD, 'p.json'));
    expect(Object.keys(options)).toEqual(['projectPath']);
  });
});
