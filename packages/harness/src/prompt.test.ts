import { describe, expect, it } from 'vitest';
import type { Project } from '@editbay/core';
import type { BrandProfile, Skill } from './types';
import { buildSystemPrompt, PROMPT_CHAR_LIMIT, summarizeProject } from './prompt';

const project: Project = {
  schemaVersion: 2,
  id: 'project-1',
  name: 'Launch film',
  canvas: { width: 1080, height: 1920, fps: 30 },
  brandId: 'acme',
  assets: [
    {
      id: 'asset-1',
      kind: 'video',
      uri: 'C:\\secret\\footage\\hero.mp4',
      thumbnailUri: 'C:\\secret\\thumbs\\hero.jpg',
      label: 'Hero shot',
      durationMs: 5000,
      width: 1080,
      height: 1920,
    },
  ],
  tracks: [
    {
      id: 'track-1',
      kind: 'video',
      clips: [{ id: 'clip-1', assetId: 'asset-1', inMs: 0, outMs: 5000, effects: [] }],
      items: [],
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const brand: BrandProfile = {
  id: 'acme',
  name: 'Acme',
  body: '# Voice\n\nWarm, direct, never salesy.',
  colors: ['#112233'],
  fonts: ['Inter'],
  logoPath: 'brands/acme/logo.png',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const skill: Skill = {
  id: 'caption-style',
  name: 'Caption style',
  description: 'Write short captions.',
  triggers: ['add captions'],
  body: 'CAPTION_INSTRUCTION: keep captions under seven words.',
  dir: '/skills/caption-style',
  hasCode: false,
  builtin: false,
};

const settings = { providerId: 'openai', model: 'gpt-test' };

describe('buildSystemPrompt', () => {
  it('includes brand, skills, effect ids, project state and selection', () => {
    const prompt = buildSystemPrompt(
      settings,
      summarizeProject(project, { clipId: 'clip-1', playheadMs: 2500 }),
      brand,
      [skill],
      ['fade', 'grain'],
      'The user attached one reference.',
    );

    expect(prompt).toContain('Acme');
    expect(prompt).toContain('#112233');
    expect(prompt).toContain('CAPTION_INSTRUCTION');
    expect(prompt).toContain('- fade');
    expect(prompt).toContain('- grain');
    expect(prompt).toContain('Launch film');
    expect(prompt).toContain('Hero shot');
    expect(prompt).toContain('clip-1');
    expect(prompt).toContain('2500');
    expect(prompt).toContain('The user attached one reference.');
    expect(prompt).toMatch(/same language as the user/i);
  });

  it('never contains asset URIs, thumbnail paths or logo paths', () => {
    const prompt = buildSystemPrompt(
      settings,
      summarizeProject(project, { clipId: 'clip-1' }),
      brand,
      [skill],
      ['fade'],
    );

    expect(prompt).not.toContain('secret');
    expect(prompt).not.toContain('hero.mp4');
    expect(prompt).not.toContain('hero.jpg');
    expect(prompt).not.toContain('logo.png');
    expect(prompt).not.toContain('C:\\');
    expect(prompt).toContain('Hero shot');
  });

  it('caps the prompt near 40k characters by truncating skill bodies first', () => {
    const huge: Skill = { ...skill, body: 'X'.repeat(120_000) };
    const prompt = buildSystemPrompt(settings, summarizeProject(project), brand, [huge], ['fade']);

    expect(prompt.length).toBeLessThanOrEqual(PROMPT_CHAR_LIMIT);
    expect(prompt).toContain('Hard rules');
    expect(prompt).toMatch(/truncated/);
    expect(prompt).toContain('Acme');
  });

  it('switches approval instructions with autoApply', () => {
    const proposal = buildSystemPrompt(settings, summarizeProject(project), null, [], ['fade']);
    const auto = buildSystemPrompt(
      { ...settings, autoApply: true },
      summarizeProject(project),
      null,
      [],
      ['fade'],
    );

    expect(proposal).toContain('Approval mode: proposals');
    expect(proposal).toContain('```json');
    expect(auto).toContain('Approval mode: auto-apply');
    expect(auto).toContain('`apply_commands`');
  });

  it('handles an empty skill set with a clear note', () => {
    const prompt = buildSystemPrompt(settings, summarizeProject(project), null, [], []);
    expect(prompt).toContain('No skill matched');
    expect(prompt).toContain('No effects are available');
  });
});
