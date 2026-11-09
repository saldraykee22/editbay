/**
 * `effects`: the builtin effect and transition catalog.
 */

import { openStudio, writeJson, type CliContext } from './context';

export async function runEffects(ctx: CliContext): Promise<number> {
  const studio = await openStudio(ctx);
  const catalog = studio.effects();

  if (ctx.json) {
    writeJson(ctx, catalog);
    return 0;
  }

  ctx.io.out(`effects (${catalog.effects.length})\n`);
  for (const effect of catalog.effects) {
    ctx.io.out(`  ${effect.id.padEnd(14)} ${effect.category.padEnd(8)} ${effect.name} — ${effect.description}\n`);
  }
  ctx.io.out(`transitions (${catalog.transitions.length})\n`);
  for (const transition of catalog.transitions) {
    ctx.io.out(
      `  ${transition.id.padEnd(14)} ${transition.name} (${transition.defaultDurationMs}ms, xfade ${transition.xfade})\n`,
    );
  }
  return 0;
}
