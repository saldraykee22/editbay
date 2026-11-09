/**
 * Captions ingestion: `captions <file> [--offset ms]`.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CliError,
  openStudio,
  parseIntegerFlag,
  writeJson,
  type CliContext,
} from './context';
import { recordHistory } from './edit';

export async function runCaptions(ctx: CliContext): Promise<number> {
  const input = ctx.options.positionals[0];
  if (input === undefined) {
    throw new CliError('captions needs a subtitle file (.srt or .vtt)');
  }

  const path = resolve(input);
  if (!existsSync(path)) {
    throw new CliError(`Caption file not found: ${path}`);
  }

  const offsetMs = parseIntegerFlag(ctx.options.offset, '--offset');
  const studio = await openStudio(ctx);
  const before = studio.project;

  const result = await studio.importCaptions(path, {
    ...(offsetMs === undefined ? {} : { offsetMs }),
  });

  if (result.added > 0) {
    await recordHistory(ctx, before);
  }

  if (ctx.json) {
    writeJson(ctx, result);
    return 0;
  }

  ctx.io.out(`imported ${result.added} caption${result.added === 1 ? '' : 's'}\n`);
  for (const warning of result.warnings) {
    ctx.io.err(`warning: ${warning}\n`);
  }
  return 0;
}
