/**
 * Read-only project tools plus the agent orientation help.
 *
 * `get_project` is the canonical snapshot for an agent: ids, labels, timeline
 * numbers and a compact summary. Asset URIs and filesystem paths are never
 * included, because models should never see them.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { HeadlessStudio } from '@editbay/kit';
import { clipView, errorResult, jsonResult, textView } from './shared';

const HELP_MARKDOWN = `# Editbay MCP — agent quick start

Editbay is a video editor. You edit a project by sending validated JSON commands;
you never touch media bytes. Work in this order:

1. \`get_project\` — read ids, labels, timeline and duration.
2. \`import_media\` — only when the user supplies new files (returns new asset/clip ids).
3. \`apply_commands\` — every edit, in batches.
4. \`export_video\` — render the result to an mp4.

## Ids
- \`assetId\`: source media (listed by \`get_project\`).
- \`clipId\`: one placement of an asset on a track.
- \`itemId\`: a text overlay.
- \`trackId\`: a track; omit it to use the default track for the asset kind.
Only use ids returned by tools. Never invent ids and never ask for file paths:
asset paths stay inside the server.

## Commands
All commands are validated by the Editbay engine. A batch is undoable and stops
at the first failure while keeping the successful prefix. Times are integer
milliseconds; \`inMs\`/\`outMs\` are source points, \`startMs\` is timeline placement.

| op | required fields | notes |
| --- | --- | --- |
| import_clip | assetId | optional trackId, index |
| add_asset | asset | rarely needed; \`import_media\` is safer |
| delete_asset | assetId | removes the asset and its clips |
| trim_clip | clipId, inMs?/outMs? | source in/out |
| retime_clip | clipId, inMs, outMs | trim + start in one step |
| move_clip | clipId, after?/toIndex? | reorder on a track |
| delete_clip | clipId | |
| split_clip | clipId, atMs | offset from timeline start |
| duplicate_clip | clipId | |
| set_volume | clipId, volume | 0..2 |
| set_audio_start | clipId, startMs | audio tracks |
| set_audio_fade | clipId, fadeInMs/fadeOutMs | clip audio on audio and main video clips; 0..10000 ms, never longer than the clip |
| set_clip_speed | clipId, speed | 0.25..4 |
| set_clip_transform | clipId, transform | x, y, scale, rotation, opacity |
| add_overlay | assetId, startMs, durationMs, x, y, scale | logo / PiP; x,y are 0..1 canvas coordinates, scale is a fraction of canvas width |
| set_overlay | clipId | startMs/durationMs/x/y/scale/opacity |
| add_text | text, startMs, durationMs | optional style, animation |
| edit_text | itemId | text/startMs/durationMs/style |
| delete_text | itemId | |
| add_audio | assetId | optional trackId, inMs, outMs, volume, startMs |
| add_effect | clipId, effect | effect.type from \`list_effects\`; video effects only, audio fades use set_audio_fade |
| remove_effect | clipId, effectId | |
| add_transition | clipId, transition | transition.type from \`list_effects\` |
| remove_transition | clipId | |
| set_canvas | width, height, fps? | |
| set_project_name | name | |

## Tracks
Edit clips on the main video track and audio tracks; text lives on the text
track. Overlay clips render above the main picture and below text: place a logo
or picture-in-picture with \`add_overlay\` and adjust it with \`set_overlay\`. An
overlay video's own audio is not mixed yet.

## Example batch
\`\`\`json
{ "commands": [
  { "op": "add_text", "text": "New drop", "startMs": 0, "durationMs": 1200,
    "style": { "fontSize": 72, "color": "#F2F7F4", "align": "center" },
    "animation": "rise" },
  { "op": "trim_clip", "clipId": "c_ab12cd", "inMs": 500, "outMs": 4200 },
  { "op": "add_effect", "clipId": "c_ab12cd",
    "effect": { "type": "kenburns", "params": { "zoom": 1.12 } } }
] }
\`\`\`

On failure the payload lists the failing op plus valid ids. Fix the ids and retry;
\`undo\` reverses one batch, \`redo\` reapplies it.
`;

export function registerProjectTools(server: McpServer, studio: HeadlessStudio): void {
  server.registerTool(
    'get_project',
    {
      title: 'Get project',
      description:
        'Read the current Editbay project: name, canvas, duration, assets, tracks, clips and texts. ' +
        'Call this first in every session and after any external change. All ids here are the ids to use in ' +
        'apply_commands. Asset file paths/URIs are deliberately omitted; use labels and ids only. ' +
        'The `summary` field is a compact JSON string that is safe to quote back to the user.',
      inputSchema: {},
    },
    async () => {
      try {
        const project = studio.project;
        const tracks = project.tracks.map((track) => ({
          id: track.id,
          kind: track.kind,
          ...(track.name === undefined ? {} : { name: track.name }),
          muted: track.muted === true,
          hidden: track.hidden === true,
          clips: track.clips.map((clip, index) => clipView(project, track, clip, index)),
        }));
        const texts = project.tracks.flatMap((track) =>
          track.kind === 'text' ? track.items.map((item) => textView(item)) : [],
        );

        return jsonResult({
          name: project.name,
          canvas: { width: project.canvas.width, height: project.canvas.height, fps: project.canvas.fps },
          durationMs: studio.durationMs,
          assets: project.assets.map((asset) => ({
            id: asset.id,
            label: asset.label,
            kind: asset.kind,
            durationMs: asset.durationMs,
          })),
          tracks,
          texts,
          summary: studio.summary(),
        });
      } catch (error) {
        return errorResult(`Could not read the project: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  server.registerTool(
    'undo',
    {
      title: 'Undo',
      description:
        'Undo the last applied command batch (one apply_commands call = one undo step). ' +
        'Use it when the user rejects a change or when a batch produced an unexpected result. ' +
        'Import and export are not part of the edit history.',
      inputSchema: {},
    },
    async () => {
      const started = Date.now();
      try {
        const ok = await studio.undo();
        return jsonResult({ ok, durationMs: Date.now() - started });
      } catch (error) {
        return errorResult(`Undo failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  server.registerTool(
    'redo',
    {
      title: 'Redo',
      description:
        'Reapply the batch that the last undo removed. Fails with ok:false when there is no redo history. ' +
        'Call get_project afterwards if you need the current ids, because redo can restore older entities.',
      inputSchema: {},
    },
    async () => {
      const started = Date.now();
      try {
        const ok = await studio.redo();
        return jsonResult({ ok, durationMs: Date.now() - started });
      } catch (error) {
        return errorResult(`Redo failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  );

  server.registerTool(
    'get_help',
    {
      title: 'Get editing help',
      description:
        'Return a short markdown cheat sheet for this server: the supported command ops, their required fields, ' +
        'id semantics and an example batch. Call it once at the start of a session or whenever you are unsure ' +
        'which op to use.',
      inputSchema: {},
    },
    async () => ({ content: [{ type: 'text', text: HELP_MARKDOWN }] }),
  );
}
