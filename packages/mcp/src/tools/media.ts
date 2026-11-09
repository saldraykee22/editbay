/**
 * Media tools: import, probe and frame extraction.
 *
 * Import takes filesystem paths from the invoking agent, but results are
 * ids/labels only. Probed metadata is model-safe. Frame extraction writes an
 * image on disk and returns just the output path.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HeadlessStudio } from '@editbay/kit';
import { availableIds, errorMessage, errorResult, jsonResult } from './shared';

export function registerMediaTools(server: McpServer, studio: HeadlessStudio): void {
  server.registerTool(
    'import_media',
    {
      title: 'Import media',
      description:
        'Import local video, image or audio files into the project and add a clip for each on a track. ' +
        'Use it when the user points at files that are not in get_project yet; pass absolute paths. ' +
        'The response contains assetId/clipId/label/kind/durationMs — use those ids afterwards. ' +
        'File paths are consumed by the server and are never echoed back to the model. Each imported file is one ' +
        'undo step: a single `undo` removes both the asset and its clip.',
      inputSchema: {
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe('Absolute or cwd-relative media file paths. Supported: mp4, mov, mkv, webm, png, jpg, wav, mp3.'),
        trackId: z
          .string()
          .optional()
          .describe(
            'Target track id from get_project (video or audio only). Omit to use the default track for the media kind.',
          ),
        index: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Insert position on sequential tracks (0 = start). Omit to append.'),
      },
    },
    async (args) => {
      try {
        if (args.trackId !== undefined) {
          const target = studio.project.tracks.find((track) => track.id === args.trackId);
          if (!target) {
            return errorResult(`Track not found: ${args.trackId}. Use a trackId from get_project.`, {
              validIds: availableIds(studio.project),
            });
          }
          if (target.kind === 'overlay') {
            return errorResult(
              `Track ${args.trackId} is an overlay track; use the add_overlay command so its position, ` +
                'scale and timing are explicit, or import onto the video or audio track.',
            );
          }
        }
        const imported = await studio.importMedia(args.paths, {
          ...(args.trackId === undefined ? {} : { trackId: args.trackId }),
          ...(args.index === undefined ? {} : { index: args.index }),
        });
        return jsonResult({ imported });
      } catch (error) {
        return errorResult(`${errorMessage(error)} Media import failed. Check that every path exists and is readable.`, {
          validIds: availableIds(studio.project),
        });
      }
    },
  );

  server.registerTool(
    'probe_media',
    {
      title: 'Probe media',
      description:
        'Read technical metadata (duration, width, height, fps, audio, codecs, rotation) for a media file without ' +
        'adding it to the project. Use it to plan trims or to verify a user-supplied file before import. ' +
        'The response never includes filesystem paths.',
      inputSchema: {
        path: z.string().min(1).describe('Absolute or cwd-relative path to the media file.'),
      },
    },
    async (args) => {
      try {
        const probe = await studio.probe(args.path);
        return jsonResult(probe);
      } catch (error) {
        return errorResult(
          `${errorMessage(error)} Could not probe the media. Check that the file exists and that ffprobe is installed ` +
            '(EDITBAY_FFPROBE or PATH).',
        );
      }
    },
  );

  server.registerTool(
    'extract_frame',
    {
      title: 'Extract frame',
      description:
        'Write a single JPEG frame from a project asset to a local file, e.g. for a thumbnail or a still the user ' +
        'asked to see. Use assetId from get_project and a time inside the source asset. ' +
        'The response is only the written outPath; the asset source path is never returned.',
      inputSchema: {
        assetId: z.string().min(1).describe('Asset id from get_project (not a clip id).'),
        atMs: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Source time in milliseconds. Defaults to the first frame (0).'),
        outPath: z.string().min(1).describe('Destination .jpg path. Parent directories are created.'),
      },
    },
    async (args) => {
      const asset = studio.project.assets.find((entry) => entry.id === args.assetId);
      if (!asset) {
        return errorResult(`Asset not found: ${args.assetId}. Use an assetId from get_project.`, {
          validIds: availableIds(studio.project),
        });
      }
      try {
        const outPath = await studio.thumbnailFile(args.assetId, args.outPath, args.atMs ?? 0);
        return jsonResult({ outPath });
      } catch (error) {
        return errorResult(
          `${errorMessage(error)} Frame extraction failed. Check that the asset file still exists and ffmpeg is installed.`,
        );
      }
    },
  );

  server.registerTool(
    'import_captions',
    {
      title: 'Import captions',
      description:
        'Import subtitles from an SRT or WebVTT file into the project text track as a single undoable batch. ' +
        'Optionally shifts all timestamps by offsetMs. Returns { added, warnings }.',
      inputSchema: {
        path: z.string().min(1).describe('Absolute or cwd-relative path to the .srt or .vtt file.'),
        offsetMs: z
          .number()
          .int()
          .optional()
          .describe('Optional millisecond shift to apply to all caption timestamps.'),
      },
    },
    async (args) => {
      try {
        const result = await studio.importCaptions(args.path, {
          ...(args.offsetMs !== undefined ? { offsetMs: args.offsetMs } : {}),
        });
        return jsonResult(result);
      } catch (error) {
        return errorResult(
          `${errorMessage(error)} Caption import failed. Check that the file exists and is valid SRT/WebVTT.`,
        );
      }
    },
  );
}
