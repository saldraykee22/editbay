/**
 * The single write path for agents: a validated, undoable command batch.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { EditCommand } from '@editbay/core';
import type { HeadlessStudio } from '@editbay/kit';
import { availableIds, errorMessage, errorResult, jsonResult } from './shared';

interface CommandResultView {
  ok: boolean;
  op: string;
  error?: string;
  code?: string;
  hint?: string;
}

/**
 * Commands are validated by `@editbay/core`, which is the same engine the
 * desktop UI uses. The schema stays permissive on purpose so the engine can
 * return precise field-level errors instead of a generic schema rejection.
 */
const commandSchema = z
  .record(z.unknown())
  .describe('A single Editbay command object; `op` selects the operation. See get_help for the op list.');

export function registerEditTools(server: McpServer, studio: HeadlessStudio): void {
  server.registerTool(
    'apply_commands',
    {
      title: 'Apply edit commands',
      description:
        'Apply a batch of validated Editbay commands (trim, move, split, text, effects, transitions, canvas, …). ' +
        'This is the ONLY way to change the project; every batch is undoable with one `undo` call and stops at the ' +
        'first invalid command while keeping the successful prefix. Use ids from get_project (clipId, itemId, assetId, ' +
        'trackId) and effect/transition types from list_effects. Times are integer milliseconds. ' +
        'On failure the tool returns isError with the failing op and valid ids; fix the ids and retry. ' +
        'Asset file paths are never accepted or returned here — media enters through import_media.',
      inputSchema: {
        commands: z.array(commandSchema).min(1).describe('Ordered command batch; each object needs an `op` field.'),
      },
    },
    async (args) => {
      const started = Date.now();
      try {
        const report = await studio.apply(args.commands as unknown as EditCommand[]);
        if (report.results.some((result) => result.ok)) await studio.flush();
        const durationMs = Date.now() - started;
        const results: CommandResultView[] = report.results.map((result) => {
          if (result.ok) return { ok: true, op: result.command.op };
          return {
            ok: false,
            op: result.command.op,
            error: result.error.message,
            code: result.error.code,
            ...(result.error.hint === undefined ? {} : { hint: result.error.hint }),
          };
        });

        const payload = {
          ok: report.ok,
          changes: report.changes,
          results,
          durationMs,
          ...(report.fatal === undefined ? {} : { error: report.fatal }),
        };

        if (!report.ok) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  ...payload,
                  validIds: availableIds(studio.project),
                }),
              },
            ],
            isError: true,
          };
        }
        return jsonResult(payload);
      } catch (error) {
        return errorResult(
          `${errorMessage(error)} The command batch was rejected. Call get_help for the schema and get_project for valid ids.`,
          { validIds: availableIds(studio.project) },
        );
      }
    },
  );
}
