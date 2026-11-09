/**
 * Media ingestion: `import` and `probe`.
 */

import { resolve } from 'node:path';
import type { ImportResult } from '@editbay/kit';
import {
  CliError,
  formatDuration,
  openStudio,
  parseIntegerFlag,
  writeJson,
  type CliContext,
} from './context';
import { recordHistory } from './edit';

interface ImportedEntry extends ImportResult {
  /** Absolute source path (never printed as part of model-safe summaries). */
  path: string;
}

export async function runImport(ctx: CliContext): Promise<number> {
  const inputs = ctx.options.positionals;
  if (inputs.length === 0) throw new CliError('import needs at least one media file');

  const trackId = ctx.options.track;
  const baseIndex = parseIntegerFlag(ctx.options.index, '--index');
  const studio = await openStudio(ctx);
  const before = studio.project;
  const entries: ImportedEntry[] = [];
  const paths = inputs.map((input) => resolve(input));

  for (let offset = 0; offset < paths.length; offset += 1) {
    const path = paths[offset];
    if (path === undefined) continue;
    // Increment the insert index so a multi-file import keeps its file order.
    const index = baseIndex === undefined ? undefined : baseIndex + offset;
    const imported = await studio.importMedia([path], {
      ...(trackId === undefined ? {} : { trackId }),
      ...(index === undefined ? {} : { index }),
    });
    for (const result of imported) entries.push({ ...result, path });
  }

  if (entries.length > 0) await recordHistory(ctx, before);

  if (ctx.json) {
    writeJson(ctx, entries);
    return 0;
  }

  ctx.io.out(`imported ${entries.length} file${entries.length === 1 ? '' : 's'}\n`);
  for (const entry of entries) {
    ctx.io.out(`  ${entry.label}\n`);
    ctx.io.out(`    asset     ${entry.assetId}\n`);
    ctx.io.out(`    clip      ${entry.clipId ?? '-'}\n`);
    ctx.io.out(`    kind      ${entry.kind}\n`);
    ctx.io.out(`    duration  ${formatDuration(entry.durationMs)}\n`);
    ctx.io.out(`    path      ${entry.path}\n`);
  }
  return 0;
}

export async function runProbe(ctx: CliContext): Promise<number> {
  const input = ctx.options.positionals[0];
  if (input === undefined) throw new CliError('probe needs a media file');

  const path = resolve(input);
  const studio = await openStudio(ctx);
  const result = await studio.probe(path);

  if (ctx.json) {
    writeJson(ctx, { path, ...result });
    return 0;
  }

  ctx.io.out(`file      ${path}\n`);
  ctx.io.out(`duration  ${formatDuration(result.durationMs)}\n`);
  const resolution =
    result.width !== undefined && result.height !== undefined ? `${result.width}x${result.height}` : 'n/a';
  const fps = result.fps === undefined ? '' : ` @${result.fps}fps`;
  ctx.io.out(`video     ${resolution}${fps}${result.videoCodec === undefined ? '' : ` ${result.videoCodec}`}\n`);
  ctx.io.out(`audio     ${result.hasAudio ? result.audioCodec ?? 'yes' : 'none'}\n`);
  return 0;
}
