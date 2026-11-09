import type { Project } from '@editbay/core';
import type { AgentSettings, BrandProfile, Skill } from './types';

export interface PromptSelection {
  clipId?: string;
  itemId?: string;
  playheadMs?: number;
}

export interface PromptAssetSummary {
  id: string;
  kind: string;
  label: string;
  durationMs: number;
  width?: number;
  height?: number;
}

export interface PromptClipSummary {
  id: string;
  assetId: string;
  inMs: number;
  outMs: number;
  startMs?: number;
  effects?: string[];
  transitionOut?: string;
}

export interface PromptTextSummary {
  id: string;
  text: string;
  startMs: number;
  durationMs: number;
}

export interface PromptTrackSummary {
  id: string;
  kind: string;
  name?: string;
  durationMs: number;
  clips: PromptClipSummary[];
  items: PromptTextSummary[];
}

export interface PromptProjectSummary {
  name: string;
  canvas: { width: number; height: number; fps: number };
  durationMs: number;
  brandId?: string;
  assets: PromptAssetSummary[];
  tracks: PromptTrackSummary[];
  selection?: PromptSelection;
}

export type ProjectSummaryInput = string | PromptProjectSummary | Project;

export const PROMPT_CHAR_LIMIT = 40_000;

/** Compact, URI-free project summary for prompt building and tool results. */
export function summarizeProject(
  project: Project,
  selection?: PromptSelection,
): PromptProjectSummary {
  const tracks: PromptTrackSummary[] = project.tracks.map((track) => {
    let cursor = 0;
    const clips: PromptClipSummary[] = track.clips.map((clip) => {
      const effectiveStart = track.kind === 'video' ? cursor : clip.startMs ?? 0;
      const length = Math.max(0, clip.outMs - clip.inMs);
      cursor = Math.max(cursor, effectiveStart + length);
      return {
        id: clip.id,
        assetId: clip.assetId,
        inMs: clip.inMs,
        outMs: clip.outMs,
        ...(clip.startMs !== undefined ? { startMs: clip.startMs } : {}),
        ...(clip.effects.length > 0 ? { effects: clip.effects.map((effect) => effect.type) } : {}),
        ...(clip.transitionOut !== undefined ? { transitionOut: clip.transitionOut.type } : {}),
      };
    });

    const items: PromptTextSummary[] = track.items.map((item) => ({
      id: item.id,
      text: truncate(item.text, 160),
      startMs: item.startMs,
      durationMs: item.durationMs,
    }));

    const clipEnd = clips.reduce((max, clip) => {
      const start = track.kind === 'video' ? undefined : clip.startMs ?? 0;
      return start === undefined ? max : Math.max(max, start + (clip.outMs - clip.inMs));
    }, track.kind === 'video' ? cursor : 0);
    const itemEnd = items.reduce((max, item) => Math.max(max, item.startMs + item.durationMs), 0);

    return {
      id: track.id,
      kind: track.kind,
      ...(track.name !== undefined ? { name: track.name } : {}),
      durationMs: Math.max(clipEnd, itemEnd),
      clips,
      items,
    };
  });

  const assets: PromptAssetSummary[] = project.assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    label: asset.label,
    durationMs: asset.durationMs,
    ...(asset.width !== undefined ? { width: asset.width } : {}),
    ...(asset.height !== undefined ? { height: asset.height } : {}),
  }));

  return {
    name: project.name,
    canvas: { ...project.canvas },
    durationMs: tracks.reduce((max, track) => Math.max(max, track.durationMs), 0),
    ...(project.brandId !== undefined ? { brandId: project.brandId } : {}),
    assets,
    tracks: tracks.map((track) => ({
      ...track,
      clips: track.clips.slice(0, 300),
      items: track.items.slice(0, 300),
    })),
    ...(selection !== undefined ? { selection } : {}),
  };
}

/**
 * Build the editing agent's system prompt.
 *
 * Order matters: durable rules and ids come first, then brand, skills, project
 * state and turn-specific context. When over the character budget, skill
 * bodies are truncated before anything else.
 */
export function buildSystemPrompt(
  settings: AgentSettings,
  projectSummary: ProjectSummaryInput,
  brand: BrandProfile | null,
  matchedSkills: Skill[],
  effectIds: string[],
  extraInstructions?: string,
): string {
  const summaryText =
    typeof projectSummary === 'string'
      ? projectSummary
      : JSON.stringify(isProject(projectSummary) ? summarizeProject(projectSummary) : projectSummary, null, 2);

  const fixedSections: string[] = [roleSection(settings), rulesSection(settings), commandReferenceSection()];

  if (brand) fixedSections.push(renderBrand(brand));
  fixedSections.push(renderEffectIds(effectIds));
  fixedSections.push(`## Project state\n\n\`\`\`json\n${summaryText}\n\`\`\``);
  if (extraInstructions && extraInstructions.trim() !== '') {
    fixedSections.push(`## Turn context\n\n${extraInstructions.trim()}`);
  }

  const fixedLength = fixedSections.join('\n\n').length;
  const skillBodies = fitSkillBodies(matchedSkills, PROMPT_CHAR_LIMIT - fixedLength);
  const skillSection =
    matchedSkills.length === 0
      ? '## Matched skills\n\nNo skill matched this request. Proceed with general editing judgement.'
      : [
          '## Matched skills',
          'Follow the most relevant skill instructions. The project state and tool results always win over a skill when they disagree.',
          ...matchedSkills.map((skill, index) => renderSkill(skill, skillBodies[index] ?? '')),
        ].join('\n\n');

  const prompt = [...fixedSections, skillSection].join('\n\n');
  if (prompt.length <= PROMPT_CHAR_LIMIT) return prompt;
  return `${prompt.slice(0, PROMPT_CHAR_LIMIT - 24)}\n\n…[prompt truncated]`;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function roleSection(settings: AgentSettings): string {
  return [
    '# Editbay editing agent',
    '',
    `You edit video projects through the Editbay command engine (model: ${settings.model || 'default'}).`,
    'You are precise, conservative and fast. You make the smallest edit that satisfies the request, then stop.',
  ].join('\n');
}

function rulesSection(settings: AgentSettings): string {  const mode =
    settings.autoApply === true
      ? 'Approval mode: auto-apply. Call `apply_commands` directly when the user asked for an edit.'
      : 'Approval mode: proposals. Do not call `apply_commands` for normal edits; instead return the proposed command array as a fenced ```json block in your final message so the user can review it. Only call `apply_commands` when the user explicitly says to apply now.';

  return [
    '## Hard rules',
    '',
    '1. The only way to change the project is the `apply_commands` tool (or a reviewed JSON proposal in proposals mode). Never claim an edit happened unless a tool result confirms it.',
    '2. Use only ids that appear in the project state or in tool results. Never invent asset, track, clip, text, effect or transition ids.',
    '3. Never invent media. If the needed asset is not in `list_assets`, tell the user what to import instead.',
    '4. Keep edits minimal. Do not rebuild the timeline or add unrelated effects, text or transitions.',
    '5. If the request is ambiguous and a wrong edit would be costly, call `ask_user` with one focused question. If a safe assumption is obvious, make it and state it briefly.',
    '6. Never reveal file paths, URIs, thumbnails or raw storage locations. Refer to assets by label and id.',
    '7. Always respond in the same language as the user. Keep the final message short: what changed, what is uncertain, what to do next.',
    '8. Time values are integer milliseconds. Canvas positions are normalized 0..1. Effects and transitions must use the listed ids.',
    '9. Batch related changes into one `apply_commands` call. If a command fails, read the error and fix only that command.',
    '10. Do not save memory or skills unless the user explicitly asks, or a durable preference was stated.',
    '',
    mode,
  ].join('\n');
}

function commandReferenceSection(): string {
  return [
    '## Command reference',
    '',
    '`apply_commands` takes `{ "commands": [ { "op": "...", ...fields } ] }`. Times are integer milliseconds. Use only ids that exist in the project state.',
    '',
    '- `import_clip`: assetId, trackId?, index?',
    '- `add_asset`: asset {id, kind, uri, label, durationMs}',
    '- `trim_clip`: clipId, inMs?, outMs?',
    '- `retime_clip`: clipId, inMs, outMs, startMs?',
    '- `move_clip`: clipId, and exactly one of `after` (clip id or null) or `toIndex`',
    '- `split_clip`: clipId, atMs (offset from the clip start)',
    '- `duplicate_clip`: clipId',
    '- `delete_clip`: clipId',
    '- `set_volume`: clipId, volume (0..2)',
    '- `set_audio_start`: clipId, startMs',
    '- `set_clip_speed`: clipId, speed (0.25..4)',
    '- `set_clip_transform`: clipId, transform {x, y, scale, rotation, opacity}',
    '- `add_text`: text, startMs, durationMs, style?, animation? (none|fade|rise|typewriter)',
    '- `edit_text`: itemId, text?, startMs?, durationMs?, style?, animation?',
    '- `delete_text`: itemId',
    '- `add_audio`: assetId, startMs?, inMs?, outMs?, volume?, fadeInMs?, fadeOutMs?',
    '- `add_effect`: clipId, effect {type, params?, startMs?, durationMs?}',
    '- `remove_effect`: clipId, effectId',
    '- `add_transition`: clipId (the outgoing clip), transition {type, durationMs, params?}',
    '- `remove_transition`: clipId',
    '- `set_canvas`: width, height, fps?',
    '- `set_project_name`: name',
    '',
    'Main video-track clips are sequential (order defines time). Overlay and audio clips use absolute `startMs`. Text items use `startMs`/`durationMs`.',
    '',
    'Example: `[{"op":"trim_clip","clipId":"c_abc","inMs":0,"outMs":2000},{"op":"add_text","text":"Merhaba","startMs":0,"durationMs":2000}]`',
  ].join('\n');
}

function renderBrand(brand: BrandProfile): string {  const lines = ['## Brand identity', '', `Brand: ${brand.name} (${brand.id})`];
  if (brand.colors.length > 0) lines.push(`Colors: ${brand.colors.join(', ')}`);
  if (brand.fonts.length > 0) lines.push(`Fonts: ${brand.fonts.join(', ')}`);
  if (brand.logoPath !== undefined) lines.push('Logo: available in the workspace (path hidden)');
  if (brand.body.trim() !== '') {
    lines.push('', truncate(brand.body.trim(), 4000));
  }
  return lines.join('\n');
}

function renderEffectIds(effectIds: string[]): string {
  return [
    '## Valid effect type ids',
    '',
    effectIds.length > 0
      ? effectIds.map((id) => `- ${id}`).join('\n')
      : 'No effects are available in this build.',
    '',
    'Transitions use the ids reported by `list_effects`. Never use an id outside these lists.',
  ].join('\n');
}

function renderSkill(skill: Skill, body: string): string {
  return [
    `### Skill: ${skill.name} (\`${skill.id}\`)`,
    skill.description,
    skill.triggers.length > 0 ? `Triggers: ${skill.triggers.join(', ')}` : '',
    '',
    body,
  ]
    .filter((line) => line !== '')
    .join('\n');
}

/** Split the remaining budget across skill bodies (truncated first). */
function fitSkillBodies(skills: Skill[], remaining: number): string[] {
  if (skills.length === 0) return [];
  const overhead = skills.reduce(
    (sum, skill) =>
      sum +
      renderSkill(skill, '').length +
      (skill.triggers.length > 0 ? skill.triggers.join(', ').length : 0) +
      40,
    0,
  );
  const available = Math.max(0, remaining - overhead);
  const perSkill = Math.floor(available / skills.length);
  return skills.map((skill) => {
    const body = skill.body.trim();
    if (perSkill < 80) return '_(instructions omitted to stay within the prompt budget)_';
    return truncate(body, perSkill);
  });
}

const TRUNCATION_MARKER = '\n…[truncated]';

function isProject(value: PromptProjectSummary | Project): value is Project {
  return 'schemaVersion' in value && 'updatedAt' in value;
}

function truncate(value: string, max: number): string {
  if (max <= 0) return '';
  if (value.length <= max) return value;
  if (max <= TRUNCATION_MARKER.length) return value.slice(0, max);
  return `${value.slice(0, max - TRUNCATION_MARKER.length)}${TRUNCATION_MARKER}`;
}
