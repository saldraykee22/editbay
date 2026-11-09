/**
 * Render and catalog tools.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HeadlessStudio } from '@editbay/kit';
import { errorMessage, errorResult, jsonResult } from './shared';

export function registerRenderTools(server: McpServer, studio: HeadlessStudio): void {
  server.registerTool(
    'export_video',
    {
      title: 'Export video',
      description:
        'Render the project to an mp4 with ffmpeg and return the output path, byte size, media duration and elapsed ' +
        'time. Call it when the user asks for a final file or a preview. quality "draft" is fast and low resolution, ' +
        '"standard" is the normal deliverable, "high" is slow and large. The render uses the same plan as the desktop ' +
        'app; source asset paths are not exposed. Export does not modify the project and cannot be undone.',
      inputSchema: {
        outPath: z.string().min(1).describe('Destination .mp4 path. Parent directories are created.'),
        quality: z
          .enum(['draft', 'standard', 'high'])
          .optional()
          .describe('Render quality. Defaults to standard; use draft for quick previews.'),
      },
    },
    async (args) => {
      try {
        const report = await studio.exportVideo(args.outPath, {
          ...(args.quality === undefined ? {} : { quality: args.quality }),
        });
        return jsonResult(report);
      } catch (error) {
        return errorResult(
          `${errorMessage(error)} Export failed. Check that ffmpeg is installed (EDITBAY_FFMPEG or PATH), that the ` +
            'project has at least one visual clip, and that outPath is writable.',
        );
      }
    },
  );

  server.registerTool(
    'list_effects',
    {
      title: 'List effects and transitions',
      description:
        'List the visual effects and transitions available to add_effect / add_transition, with their parameter ' +
        'specs (key, type, default, range). Call it before styling a clip so you use a real effect type instead of ' +
        'guessing. Effect ids are the `type` values accepted by add_effect; transition ids likewise for add_transition.',
      inputSchema: {},
    },
    async () => {
      try {
        const catalog = studio.effects();
        return jsonResult({
          effects: catalog.effects.map((effect) => ({
            id: effect.id,
            name: effect.name,
            description: effect.description,
            params: effect.params.map((param) => ({
              key: param.key,
              label: param.label,
              type: param.type,
              default: param.default,
              ...(param.min === undefined ? {} : { min: param.min }),
              ...(param.max === undefined ? {} : { max: param.max }),
              ...(param.step === undefined ? {} : { step: param.step }),
              ...(param.unit === undefined ? {} : { unit: param.unit }),
              ...(param.options === undefined ? {} : { options: param.options }),
            })),
          })),
          transitions: catalog.transitions.map((transition) => ({
            id: transition.id,
            name: transition.name,
            description: transition.description,
            defaultDurationMs: transition.defaultDurationMs,
          })),
        });
      } catch (error) {
        return errorResult(`Could not read the effect catalog: ${errorMessage(error)}`);
      }
    },
  );
}
