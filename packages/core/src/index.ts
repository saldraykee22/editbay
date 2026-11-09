/**
 * Public API for `@editbay/core`.
 */

export { createId } from './ids';

export { createEmptyProject, validateProject } from './project';

export {
  audioTrack,
  clipTimelineDurationMs,
  findAsset,
  findClip,
  findTextItem,
  mainVideoTrack,
  textTrack,
  timelineDurationMs,
  videoClipStartMs,
} from './timeline';
export type { ClipLocation, TextLocation } from './timeline';

export { applyCommand, applyCommands } from './commands';
export { describeChanges } from './changes';
export { projectSummary } from './summary';
export { EditSession } from './session';

export { DEFAULT_CANVAS, DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM } from './types';

export type {
  AddAssetCommand,
  AddAudioCommand,
  AddEffectCommand,
  AddTextCommand,
  AddTransitionCommand,
  AgentCommand,
  ApplyFailure,
  ApplyResult,
  ApplySuccess,
  Asset,
  AssetKind,
  AssetOrigin,
  BatchResult,
  Canvas,
  Clip,
  CommandError,
  CommandOp,
  DeleteAssetCommand,
  DeleteClipCommand,
  DeleteTextCommand,
  DuplicateClipCommand,
  EditCommand,
  EditTextCommand,
  EffectInstance,
  EffectParam,
  ErrorCode,
  Id,
  ImportClipCommand,
  MoveClipCommand,
  Project,
  RemoveEffectCommand,
  RemoveTransitionCommand,
  RetimeClipCommand,
  SetAudioStartCommand,
  SetCanvasCommand,
  SetClipSpeedCommand,
  SetClipTransformCommand,
  SetProjectNameCommand,
  SetVolumeCommand,
  SplitClipCommand,
  TextAnimation,
  TextItem,
  TextStyle,
  Track,
  TrackKind,
  Transform,
  TransitionInstance,
  TrimClipCommand,
} from './types';
