import type { Project } from '@editbay/core';

export interface CheckResult {
  pass: boolean;
  detail: string;
}

export interface EvalCase {
  id: string;
  prompt: string;
  /** What the agent should have achieved in the resulting project. */
  check: (project: Project) => CheckResult;
  /** Optional extra assertions that need the raw agent transcript. */
  note?: string;
}

function videoClips(project: Project) {
  return project.tracks.find((track) => track.kind === 'video')?.clips ?? [];
}

function audioClips(project: Project) {
  return project.tracks.flatMap((track) => (track.kind === 'audio' ? track.clips : []));
}

function textItems(project: Project) {
  return project.tracks.flatMap((track) => track.items);
}

function clipDuration(project: Project, index: number): number {
  const clip = videoClips(project)[index];
  if (!clip) return 0;
  return (clip.outMs - clip.inMs) / (clip.speed ?? 1);
}

export const CASES: EvalCase[] = [
  {
    id: 'trim-first',
    prompt: 'İlk klibi 2 saniyeye kısalt.',
    note: 'Source clip is 6s; result should be ~2s.',
    check: (project) => {
      const duration = clipDuration(project, 0);
      return {
        pass: duration >= 1500 && duration <= 2600,
        detail: `first clip ${Math.round(duration)}ms (expected ~2000)`,
      };
    },
  },
  {
    id: 'reorder-second-first',
    prompt: 'İkinci klibi en başa al.',
    check: (project) => {
      const clips = videoClips(project);
      const firstAsset = project.assets.find((asset) => asset.id === clips[0]?.assetId)?.label ?? '';
      return {
        pass: firstAsset.includes('clip-b'),
        detail: `first clip is ${firstAsset || 'none'} (expected clip-b)`,
      };
    },
  },
  {
    id: 'warm-grade',
    prompt: 'Tüm videoya sıcak, sinematik bir renk ver.',
    check: (project) => {
      const clips = videoClips(project);
      const graded = clips.filter((clip) => clip.effects.some((effect) => effect.type === 'grade')).length;
      return { pass: clips.length > 0 && graded === clips.length, detail: `${graded}/${clips.length} clips graded` };
    },
  },
  {
    id: 'title-card',
    prompt: "En başa 2 saniyelik 'Merhaba' yazısı ekle.",
    check: (project) => {
      const item = textItems(project).find((entry) => entry.text.toLowerCase().includes('merhaba'));
      return {
        pass: Boolean(item) && (item?.startMs ?? 1e9) < 600 && (item?.durationMs ?? 0) >= 1400,
        detail: item ? `text at ${item.startMs}ms for ${item.durationMs}ms` : 'no Merhaba text',
      };
    },
  },
  {
    id: 'fade-between',
    prompt: 'İlk iki klip arasına yumuşak bir geçiş koy.',
    check: (project) => {
      const first = videoClips(project)[0];
      const ok = Boolean(first?.transitionOut) && (first?.transitionOut?.durationMs ?? 0) >= 150;
      return { pass: ok, detail: first?.transitionOut ? `${first.transitionOut.type} ${first.transitionOut.durationMs}ms` : 'none' };
    },
  },
  {
    id: 'music-volume',
    prompt: 'Müziğin sesini yarıya indir.',
    check: (project) => {
      const clip = audioClips(project)[0];
      const volume = clip?.volume ?? 1;
      return { pass: volume >= 0.35 && volume <= 0.65, detail: `music volume ${volume}` };
    },
  },
  {
    id: 'delete-texts',
    prompt: 'Bütün yazıları sil.',
    check: (project) => {
      const count = textItems(project).length;
      return { pass: count === 0, detail: `${count} text items left` };
    },
  },
  {
    id: 'split-first',
    prompt: 'İlk klibi ortasından ikiye böl.',
    check: (project) => {
      const count = videoClips(project).length;
      return { pass: count >= 4, detail: `${count} video clips (expected >=4)` };
    },
  },
  {
    id: 'square-canvas',
    prompt: 'Videoyu 1080x1080 kare formata çevir.',
    check: (project) => ({
      pass: project.canvas.width === 1080 && project.canvas.height === 1080,
      detail: `${project.canvas.width}x${project.canvas.height}`,
    }),
  },
  {
    id: 'fit-ten-seconds',
    prompt: 'Videoyu 10 saniyeye sığdır.',
    note: 'Ambiguous: trimming or asking are both acceptable, deleting everything is not.',
    check: (project) => {
      const clips = videoClips(project);
      const total = clips.reduce((sum, clip) => sum + (clip.outMs - clip.inMs) / (clip.speed ?? 1), 0);
      return {
        pass: clips.length >= 1 && total <= 11_000,
        detail: `${clips.length} clips, ${Math.round(total)}ms`,
      };
    },
  },
];
