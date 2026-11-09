/**
 * Editbay project model — the single source of truth.
 *
 * Everything that edits a project (UI, agent, CLI, tests) goes through the
 * command engine in `commands.ts`/`session.ts`. The model is plain JSON so it
 * can be saved, diffed, replayed and inspected by an LLM without adapters.
 *
 * Units: all times are integer milliseconds unless stated otherwise.
 * Canvas coordinates are normalized 0..1 (0,0 = top-left).
 */

export type Id = string;

export type AssetKind = 'video' | 'image' | 'audio';

export type TrackKind = 'video' | 'overlay' | 'text' | 'audio';

export interface Canvas {
  width: number;
  height: number;
  fps: number;
}

/** Placement of a clip inside the canvas. All values are normalized / relative. */
export interface Transform {
  /** Horizontal center offset, 0 = canvas center, -0.5 = left edge. */
  x: number;
  /** Vertical center offset, 0 = canvas center, -0.5 = top edge. */
  y: number;
  /** 1 = fill (cover) the canvas. */
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** 0..1 */
  opacity: number;
}

export type EffectParam = number | string | boolean;

export interface EffectInstance {
  id: Id;
  /** Effect definition id, e.g. "fade", "kenburns", "grain". */
  type: string;
  params: Record<string, EffectParam>;
  /** Optional local window inside the clip. Defaults to the whole clip. */
  startMs?: number;
  durationMs?: number;
}

export interface TransitionInstance {
  id: Id;
  type: string;
  durationMs: number;
  params?: Record<string, EffectParam>;
}

export interface Clip {
  id: Id;
  assetId: Id;
  /** Source in-point (ms). */
  inMs: number;
  /** Source out-point (ms), exclusive. */
  outMs: number;
  /**
   * Timeline start (ms). Only meaningful on overlay/audio tracks; the main
   * video track is sequential and derives its start from clip order.
   */
  startMs?: number;
  /** 0..2, 1 = original. Applies to the clip's own audio. */
  volume?: number;
  /** 0.25..4, 1 = normal. */
  speed?: number;
  transform?: Transform;
  effects: EffectInstance[];
  /** Transition into the NEXT clip on the same track. */
  transitionOut?: TransitionInstance;
  audioFadeInMs?: number;
  audioFadeOutMs?: number;
}

export type TextAnimation = 'none' | 'fade' | 'rise' | 'typewriter';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** Normalized anchor. */
  x: number;
  y: number;
  background?: string;
  padding?: number;
  radius?: number;
  letterSpacing?: number;
  shadow?: boolean;
  lineHeight?: number;
}

export interface TextItem {
  id: Id;
  text: string;
  startMs: number;
  durationMs: number;
  style: TextStyle;
  animation?: TextAnimation;
}

export interface Track {
  id: Id;
  kind: TrackKind;
  name?: string;
  muted?: boolean;
  hidden?: boolean;
  /** Used by video / overlay / audio tracks. */
  clips: Clip[];
  /** Used by text tracks. */
  items: TextItem[];
}

export type AssetOrigin = 'imported' | 'generated' | 'stock';

export interface Asset {
  id: Id;
  kind: AssetKind;
  /** Absolute file path or file:// URI. Never sent to model providers. */
  uri: string;
  /** Human label; safe to send to providers. */
  label: string;
  durationMs: number;
  width?: number;
  height?: number;
  fps?: number;
  hasAudio?: boolean;
  /** Cached thumbnail as data URL or file path. */
  thumbnailUri?: string;
  origin?: AssetOrigin;
  createdAt?: string;
}

export interface Project {
  schemaVersion: 2;
  id: Id;
  name: string;
  canvas: Canvas;
  assets: Asset[];
  tracks: Track[];
  /** Brand workspace id (see harness memory). */
  brandId?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export interface BaseCommand {
  op: string;
}

export interface ImportClipCommand extends BaseCommand {
  op: 'import_clip';
  assetId: Id;
  /** Defaults to the main video track (or first audio track for audio assets). */
  trackId?: Id;
  /** Insert position on sequential tracks. */
  index?: number;
}

export interface AddAssetCommand extends BaseCommand {
  op: 'add_asset';
  asset: Asset;
}

export interface DeleteAssetCommand extends BaseCommand {
  op: 'delete_asset';
  assetId: Id;
}

export interface TrimClipCommand extends BaseCommand {
  op: 'trim_clip';
  clipId: Id;
  inMs?: number;
  outMs?: number;
}

export interface MoveClipCommand extends BaseCommand {
  op: 'move_clip';
  clipId: Id;
  /** Move directly after this clip id; `null` = move to the start. */
  after?: Id | null;
  /** 0-based target index (alternative to `after`). */
  toIndex?: number;
}

export interface DeleteClipCommand extends BaseCommand {
  op: 'delete_clip';
  clipId: Id;
}

export interface SplitClipCommand extends BaseCommand {
  op: 'split_clip';
  clipId: Id;
  /** Offset from the clip's timeline start, in ms. */
  atMs: number;
}

export interface DuplicateClipCommand extends BaseCommand {
  op: 'duplicate_clip';
  clipId: Id;
}

export interface SetVolumeCommand extends BaseCommand {
  op: 'set_volume';
  clipId: Id;
  /** 0..2 */
  volume: number;
}

export interface SetAudioStartCommand extends BaseCommand {
  op: 'set_audio_start';
  clipId: Id;
  startMs: number;
}

export interface SetClipSpeedCommand extends BaseCommand {
  op: 'set_clip_speed';
  clipId: Id;
  /** 0.25..4 */
  speed: number;
}

export interface SetClipTransformCommand extends BaseCommand {
  op: 'set_clip_transform';
  clipId: Id;
  transform: Partial<Transform>;
}

export interface AddTextCommand extends BaseCommand {
  op: 'add_text';
  trackId?: Id;
  text: string;
  startMs: number;
  durationMs: number;
  style?: Partial<TextStyle>;
  animation?: TextAnimation;
}

export interface EditTextCommand extends BaseCommand {
  op: 'edit_text';
  itemId: Id;
  text?: string;
  startMs?: number;
  durationMs?: number;
  style?: Partial<TextStyle>;
  animation?: TextAnimation;
}

export interface DeleteTextCommand extends BaseCommand {
  op: 'delete_text';
  itemId: Id;
}

export interface AddAudioCommand extends BaseCommand {
  op: 'add_audio';
  assetId: Id;
  trackId?: Id;
  inMs?: number;
  outMs?: number;
  volume?: number;
  startMs?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

export interface AddEffectCommand extends BaseCommand {
  op: 'add_effect';
  clipId: Id;
  effect: {
    type: string;
    params?: Record<string, EffectParam>;
    startMs?: number;
    durationMs?: number;
  };
}

export interface RemoveEffectCommand extends BaseCommand {
  op: 'remove_effect';
  clipId: Id;
  effectId: Id;
}

export interface AddTransitionCommand extends BaseCommand {
  op: 'add_transition';
  clipId: Id;
  transition: {
    type: string;
    durationMs: number;
    params?: Record<string, EffectParam>;
  };
}

export interface RemoveTransitionCommand extends BaseCommand {
  op: 'remove_transition';
  clipId: Id;
}

export interface SetCanvasCommand extends BaseCommand {
  op: 'set_canvas';
  width: number;
  height: number;
  fps?: number;
}

export interface SetProjectNameCommand extends BaseCommand {
  op: 'set_project_name';
  name: string;
}

/** Trim + start in one step, used by the timeline drag interactions. */
export interface RetimeClipCommand extends BaseCommand {
  op: 'retime_clip';
  clipId: Id;
  inMs: number;
  outMs: number;
  startMs?: number;
}

export type EditCommand =
  | ImportClipCommand
  | AddAssetCommand
  | DeleteAssetCommand
  | TrimClipCommand
  | MoveClipCommand
  | DeleteClipCommand
  | SplitClipCommand
  | DuplicateClipCommand
  | SetVolumeCommand
  | SetAudioStartCommand
  | SetClipSpeedCommand
  | SetClipTransformCommand
  | AddTextCommand
  | EditTextCommand
  | DeleteTextCommand
  | AddAudioCommand
  | AddEffectCommand
  | RemoveEffectCommand
  | AddTransitionCommand
  | RemoveTransitionCommand
  | SetCanvasCommand
  | SetProjectNameCommand
  | RetimeClipCommand;

export type CommandOp = EditCommand['op'];

/** Non-mutating agent replies. */
export interface ClarifyCommand extends BaseCommand {
  op: 'clarify';
  question: string;
}

export interface UnsupportedCommand extends BaseCommand {
  op: 'unsupported';
  reason: string;
}

export type AgentCommand = EditCommand | ClarifyCommand | UnsupportedCommand;

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export type ErrorCode =
  | 'not_found'
  | 'invalid'
  | 'out_of_range'
  | 'unsupported'
  | 'conflict';

export interface CommandError {
  code: ErrorCode;
  message: string;
  /** Optional machine-readable hint for the agent, e.g. valid ids. */
  hint?: string;
}

export interface ApplySuccess {
  ok: true;
  command: EditCommand;
  project: Project;
  changes: string[];
  /** Newly created entity ids, keyed by role: `clip`, `text`, `asset`. */
  createdIds: Record<string, Id>;
}

export interface ApplyFailure {
  ok: false;
  command: EditCommand;
  error: CommandError;
}

export type ApplyResult = ApplySuccess | ApplyFailure;

export interface BatchResult {
  ok: boolean;
  project: Project;
  results: ApplyResult[];
  changes: string[];
}

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_CANVAS: Canvas = { width: 1080, height: 1920, fps: 30 };

export const DEFAULT_TRANSFORM: Transform = {
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  opacity: 1,
};

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'IBM Plex Sans',
  fontSize: 64,
  fontWeight: 600,
  color: '#F2F7F4',
  align: 'center',
  x: 0.5,
  y: 0.82,
  lineHeight: 1.15,
};
