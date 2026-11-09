/**
 * `export`: render the timeline to a file with ffmpeg.
 */

import { resolve } from 'node:path';
import type { ExportQuality } from '@editbay/engine';
import {
  CliError,
  formatBytes,
  formatDuration,
  openStudio,
  writeJson,
  type CliContext,
} from './context';

const QUALITIES: readonly ExportQuality[] = ['draft', 'standard', 'high'];

function isQuality(value: string): value is ExportQuality {
  return (QUALITIES as readonly string[]).includes(value);
}

export async function runExport(ctx: CliContext): Promise<number> {
  const input = ctx.options.positionals[0];
  if (input === undefined) throw new CliError('export needs an output path');

  const requested = ctx.options.quality ?? 'standard';
  if (!isQuality(requested)) {
    throw new CliError(`--quality must be draft, standard or high (got "${requested}")`);
  }

  const outPath = resolve(input);
  const studio = await openStudio(ctx);

  // Progress goes to stderr so stdout stays a clean result document.
  let lastTenth = 0;
  let report;
  try {
    report = await studio.exportVideo(outPath, {
      quality: requested,
      onProgress: (progress) => {
        if (ctx.quiet) return;
        const tenth = Math.floor(progress.fraction * 10);
        if (tenth <= lastTenth) return;
        lastTenth = tenth;
        ctx.io.err(`export ${tenth * 10}%\n`);
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.io.err(`export failed: ${message}\n`);
    return 3;
  }

  if (ctx.json) {
    writeJson(ctx, {
      path: report.outPath,
      sizeBytes: report.sizeBytes,
      durationMs: report.durationMs,
      elapsedMs: report.elapsedMs,
    });
    return 0;
  }

  ctx.io.out(`${report.outPath}\n`);
  ctx.io.out(`size      ${formatBytes(report.sizeBytes)}\n`);
  ctx.io.out(`duration  ${formatDuration(report.durationMs)}\n`);
  ctx.io.out(`elapsed   ${formatDuration(report.elapsedMs)}\n`);
  return 0;
}
