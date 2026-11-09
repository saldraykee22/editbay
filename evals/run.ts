import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Agent, FileMemoryStore, FileSkillStore, NodeWorkspace, createOpenAICompatibleProvider } from '@editbay/harness';
import { effectCatalog } from '@editbay/effects';
import { HeadlessStudio } from '@editbay/kit';
import type { AgentCommand, AgentEvent, AgentRuntime } from '@editbay/harness/types';
import type { Project } from '@editbay/core';
import { CASES, type EvalCase } from './cases';

const ROOT = resolve(import.meta.dirname ?? '.', '..');
const BUILTIN_SKILLS = join(ROOT, 'apps/desktop/resources/skills');
const MEDIA_DIR = join(ROOT, 'evals/.media');
const REPORT_DIR = join(ROOT, 'evals/reports');

interface EvalCaseResult {
  caseId: string;
  model: string;
  pass: boolean;
  detail: string;
  ms: number;
  toolCalls: number;
  appliedCommands: number;
  invalidCommands: number;
  message: string;
  error?: string;
}

function arg(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const inline = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (inline) return inline.slice(name.length + 3);
  return fallback;
}

function evrenKey(): string {
  if (process.env.EVREN_API_KEY) return process.env.EVREN_API_KEY;
  const configPath = join(homedir(), '.config', 'opencode', 'opencode.json');
  if (existsSync(configPath)) {
    try {
      const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
        provider?: Record<string, { options?: { apiKey?: string } }>;
      };
      const key = config.provider?.evren?.options?.apiKey;
      if (key) return key;
    } catch {
      // fall through
    }
  }
  throw new Error('EVREN_API_KEY is not set and no key was found in ~/.config/opencode/opencode.json');
}

function ensureMedia(): { clips: string[]; music: string } {
  const dir = MEDIA_DIR;
  mkdirSync(dir, { recursive: true });
  const clipA = join(dir, 'clip-a.mp4');
  const clipB = join(dir, 'clip-b.mp4');
  const clipC = join(dir, 'clip-c.mp4');
  const music = join(dir, 'music.mp3');
  if (!existsSync(clipA)) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=420', '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipA]);
  }
  if (!existsSync(clipB)) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'smptebars=size=640x360:rate=30', '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipB]);
  }
  if (!existsSync(clipC)) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x1F6F4A:size=640x360:rate=30', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipC]);
  }
  if (!existsSync(music)) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220', '-t', '10', '-c:a', 'libmp3lame', music]);
  }
  return { clips: [clipA, clipB, clipC], music };
}

async function seedProject(media: { clips: string[]; music: string }, dir: string): Promise<HeadlessStudio> {
  const studio = await HeadlessStudio.open({
    projectPath: join(dir, 'editbay.json'),
    workspaceRoot: join(dir, 'workspace'),
    builtinSkillsDir: BUILTIN_SKILLS,
    name: 'Eval project',
  });
  await studio.importMedia(media.clips);
  await studio.importMedia([media.music]);
  await studio.apply([
    { op: 'add_text', text: 'Başlangıç yazısı', startMs: 0, durationMs: 2500 },
    { op: 'add_text', text: 'Kapanış yazısı', startMs: 8000, durationMs: 2500 },
  ]);
  await studio.flush();
  return studio;
}

interface CaseRun {
  events: AgentEvent[];
  result: EvalCaseResult;
}

async function runCase(model: string, evalCase: EvalCase, dir: string, media: { clips: string[]; music: string }): Promise<CaseRun> {
  const verbose = process.argv.includes('--verbose');
  const studio = await seedProject(media, dir);
  const workspaceRoot = join(dir, 'workspace');
  const events: AgentEvent[] = [];
  const started = Date.now();
  let invalidCommands = 0;
  let appliedCommands = 0;

  const provider = createOpenAICompatibleProvider({
    id: 'evren',
    label: 'EVREN',
    requiresApiKey: true,
    defaultBaseUrl: process.env.EVREN_BASE_URL ?? 'https://evren-llmapi.ssyz.org.tr/v1',
    defaultModel: model,
  });

  const runtime: AgentRuntime = {
    project: () => studio.project,
    applyCommands: (commands: AgentCommand[]) => {
      const report = studio.apply(commands);
      appliedCommands += report.results.filter((result) => result.ok).length;
      invalidCommands += report.results.filter((result) => !result.ok).length;
      return { ok: report.ok, project: report.project, results: report.results, changes: report.changes };
    },
    workspace: new NodeWorkspace(workspaceRoot),
    skills: new FileSkillStore({ root: workspaceRoot, builtinDir: BUILTIN_SKILLS }),
    memory: new FileMemoryStore(workspaceRoot),
    effects: effectCatalog,
    settings: { providerId: 'evren', model, autoApply: true, temperature: 0.2, maxTokens: 4000, maxSteps: 8 },
  };

  const agent = new Agent({
    runtime,
    provider,
    providerConfig: {
      apiKey: evrenKey(),
      baseUrl: process.env.EVREN_BASE_URL ?? 'https://evren-llmapi.ssyz.org.tr/v1',
      model,
    },
    maxSteps: 8,
  });

  let message = '';
  let error: string | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout after 240s')), 240_000));
    const run = (async () => {
      for await (const event of agent.run({ text: evalCase.prompt })) {
        events.push(event);
        if (verbose) {
          if (event.type === 'tool_start') console.error(`  -> ${event.call.name} ${JSON.stringify(event.call.arguments).slice(0, 300)}`);
          if (event.type === 'tool_end') console.error(`  <- ${event.call.name} ok=${event.ok} ${event.summary}`);
          if (event.type === 'error') console.error(`  !! ${event.message}`);
        }
        if (event.type === 'message') message = event.text;
        if (event.type === 'error') error = event.message;
      }
    })();
    await Promise.race([run, timeout]);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }

  let pass = false;
  let detail = '';
  if (!error) {
    const check = evalCase.check(studio.project);
    pass = check.pass;
    detail = check.detail;
  } else {
    detail = error;
  }
  await studio.flush().catch(() => undefined);

  return {
    events,
    result: {
      caseId: evalCase.id,
      model,
      pass,
      detail,
      ms: Date.now() - started,
      toolCalls: events.filter((event) => event.type === 'tool_start').length,
      appliedCommands,
      invalidCommands,
      message: message.trim().slice(0, 400),
      error,
    },
  };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

async function main(): Promise<void> {
  const models = (arg('models', 'deepseek-v4.1-flash') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const only = (arg('cases') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  const keep = process.argv.includes('--keep');
  const cases = only.length ? CASES.filter((entry) => only.includes(entry.id)) : CASES;

  if (process.argv.includes('--dry')) {
    console.error(`${cases.length} cases, models: ${models.join(', ')}`);
    for (const evalCase of cases) console.error(`- ${evalCase.id}: ${evalCase.prompt}`);
    return;
  }

  const media = ensureMedia();
  await mkdir(REPORT_DIR, { recursive: true });
  const results: EvalCaseResult[] = [];

  for (const model of models) {
    console.error(`\n== model: ${model}`);
    for (const evalCase of cases) {
      const dir = await mkdtemp(join(tmpdir(), 'editbay-eval-'));
      try {
        const { result } = await runCase(model, evalCase, dir, media);
        results.push(result);
        console.error(
          `${result.pass ? 'PASS' : 'FAIL'} ${pad(evalCase.id, 22)} ${String(result.ms).padStart(6)}ms  tools=${result.toolCalls} ok=${result.appliedCommands} bad=${result.invalidCommands}  ${result.detail}`,
        );
      } finally {
        if (!keep) await rm(dir, { recursive: true, force: true });
        else console.error(`kept ${dir}`);
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `${stamp}.json`);
  const mdPath = join(REPORT_DIR, `${stamp}.md`);
  await writeFile(jsonPath, JSON.stringify({ at: new Date().toISOString(), results }, null, 2), 'utf8');

  const lines: string[] = [];
  lines.push(`# Editbay agent eval — ${new Date().toISOString()}`);
  lines.push('');
  lines.push('| model | case | result | ms | tools | applied | invalid | detail |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const result of results) {
    lines.push(
      `| ${result.model} | ${result.caseId} | ${result.pass ? 'PASS' : 'FAIL'} | ${result.ms} | ${result.toolCalls} | ${result.appliedCommands} | ${result.invalidCommands} | ${result.detail.replace(/\|/g, '/')} |`,
    );
  }
  const passCount = results.filter((result) => result.pass).length;
  lines.push('');
  lines.push(`**Score: ${passCount}/${results.length}**`);
  await writeFile(mdPath, lines.join('\n'), 'utf8');

  console.error(`\nScore: ${passCount}/${results.length}`);
  console.error(`Reports: ${jsonPath}\n         ${mdPath}`);
  if (passCount !== results.length) process.exitCode = 1;
}

await main();
