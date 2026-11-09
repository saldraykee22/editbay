/**
 * Project lifecycle: `init`, `summary`, `version`.
 */

import { existsSync } from 'node:fs';
import {
  CliError,
  countClips,
  formatCanvas,
  formatDuration,
  openStudio,
  writeJson,
  type CliContext,
} from './context';
import { recordHistory } from './edit';
import packageJson from '../../package.json';

export const CLI_VERSION: string = packageJson.version;

export async function runInit(ctx: CliContext): Promise<number> {
  const existed = existsSync(ctx.projectPath);
  const studio = await openStudio(ctx);

  if (existed && ctx.options.name !== undefined && ctx.options.name !== studio.project.name) {
    const before = studio.project;
    const report = await studio.apply([{ op: 'set_project_name', name: ctx.options.name }]);
    if (!report.ok) {
      const first = report.results[0];
      const message = first !== undefined && !first.ok ? first.error.message : 'invalid name';
      throw new CliError(`Could not rename project: ${message}`);
    }
    await studio.flush();
    await recordHistory(ctx, before);
  }

  const project = studio.project;
  const canvas = formatCanvas(project.canvas);
  const clips = countClips(project.tracks);

  if (ctx.json) {
    writeJson(ctx, {
      path: ctx.projectPath,
      workspace: ctx.workspaceRoot,
      created: !existed,
      name: project.name,
      canvas,
      tracks: project.tracks.length,
      clips,
    });
    return 0;
  }

  ctx.io.out(`${existed ? 'project' : 'initialized'}: ${ctx.projectPath}\n`);
  ctx.io.out(`  name    ${project.name}\n`);
  ctx.io.out(`  canvas  ${canvas}\n`);
  ctx.io.out(`  tracks  ${project.tracks.length}\n`);
  return 0;
}

export async function runSummary(ctx: CliContext): Promise<number> {
  const studio = await openStudio(ctx);
  const project = studio.project;
  const clips = countClips(project.tracks);

  if (ctx.json) {
    writeJson(ctx, {
      name: project.name,
      canvas: formatCanvas(project.canvas),
      durationMs: studio.durationMs,
      tracks: project.tracks.length,
      clips,
      assets: project.assets.length,
      summary: studio.summary(),
    });
    return 0;
  }

  ctx.io.out(`name      ${project.name}\n`);
  ctx.io.out(`canvas    ${formatCanvas(project.canvas)}\n`);
  ctx.io.out(`duration  ${formatDuration(studio.durationMs)}\n`);
  ctx.io.out(`tracks    ${project.tracks.length}\n`);
  ctx.io.out(`clips     ${clips}\n`);
  ctx.io.out(`assets    ${project.assets.length}\n`);
  ctx.io.out(`project   ${ctx.projectPath}\n`);
  ctx.io.out(`summary   ${studio.summary()}\n`);
  return 0;
}

export async function runVersion(ctx: CliContext): Promise<number> {
  if (ctx.json) {
    writeJson(ctx, { name: 'editbay', version: CLI_VERSION });
    return 0;
  }
  ctx.io.out(`editbay ${CLI_VERSION}\n`);
  return 0;
}
