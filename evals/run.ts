import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Agent, FileMemoryStore, FileSkillStore, NodeWorkspace, createOpenAICompatibleProvider } from '@editbay/harness';
import { effectCatalog } from '@editbay/effects';
import type { AgentEvent, AgentRuntime } from '@editbay/harness/types';
import type { AgentCommand, Project } from '@editbay/core';
import { CASES, type EvalCase, type EvalRunContext, type EvalSet } from './cases';
import { ensureMedia, seedProject, type EvalMedia } from './seed';

const ROOT = resolve(import.meta.dirname ?? '.', '..');
const BUILTIN_SKILLS = join(ROOT, 'apps/desktop/resources/skills');
const REPORT_DIR = join(ROOT, 'evals/reports');

interface EvalCaseResult {
  caseId: string;
  set: EvalSet;
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

function withCallTimeout(provider: ReturnType<typeof createOpenAICompatibleProvider>, ms = 90_000): ReturnType<typeof createOpenAICompatibleProvider> {
  return {
    ...provider,
    chat: (request, config) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`provider call timed out after ${ms}ms`)), ms);
        provider
          .chat(request, config)
          .then((response) => {
            clearTimeout(timer);
            resolve(response);
          })
          .catch((error: unknown) => {
            clearTimeout(timer);
            reject(error instanceof Error ? error : new Error(String(error)));
          });
      }),
  };
}

interface CaseRun {
  events: AgentEvent[];
  result: EvalCaseResult;
}

async function runCase(model: string, evalCase: EvalCase, dir: string, media: EvalMedia): Promise<CaseRun> {
  const verbose = process.argv.includes('--verbose');
  const studio = await seedProject(media, dir, evalCase.seed ?? 'base');
  // Snapshot after seeding: cases that assert "nothing changed" compare against it.
  const before = structuredClone(studio.project);
  const workspaceRoot = join(dir, 'workspace');
  const events: AgentEvent[] = [];
  const started = Date.now();
  let invalidCommands = 0;
  let appliedCommands = 0;
  let abandoned = false;

  const baseProvider = createOpenAICompatibleProvider({
    id: 'evren',
    label: 'EVREN',
    requiresApiKey: true,
    defaultBaseUrl: process.env.EVREN_BASE_URL ?? 'https://evren-llmapi.ssyz.org.tr/v1',
    defaultModel: model,
  });
  const timed = withCallTimeout(baseProvider, Number(process.env.EVAL_CALL_TIMEOUT_MS ?? 75_000));
  const provider = {
    ...timed,
    chat: (request: Parameters<typeof timed.chat>[0], config: Parameters<typeof timed.chat>[1]) =>
      abandoned ? Promise.reject(new Error('turn abandoned')) : timed.chat(request, config),
  };

  const runtime: AgentRuntime = {
    project: () => studio.project,
    applyCommands: (commands: AgentCommand[]) => {
      if (abandoned) {
        return { ok: false, project: studio.project, results: [], changes: [] };
      }
      const report = studio.apply(commands);
      appliedCommands += report.results.filter((result) => result.ok).length;
      invalidCommands += report.results.filter((result) => !result.ok).length;
      return { ok: report.ok, project: report.project, results: report.results, changes: report.changes };
    },
    workspace: new NodeWorkspace(workspaceRoot),
    skills: new FileSkillStore({ root: workspaceRoot, builtinDir: BUILTIN_SKILLS }),
    memory: new FileMemoryStore(workspaceRoot),
    effects: effectCatalog,
    settings: { providerId: 'evren', model, autoApply: true, temperature: 0.2, maxTokens: 4000, maxSteps: 6 },
  };

  const agent = new Agent({
    runtime,
    provider,
    providerConfig: {
      apiKey: evrenKey(),
      baseUrl: process.env.EVREN_BASE_URL ?? 'https://evren-llmapi.ssyz.org.tr/v1',
      model,
    },
    maxSteps: 6,
  });

  let message = '';
  let error: string | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout after 180s')), 180_000));    const run = (async () => {
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
    abandoned = true;
    error = caught instanceof Error ? caught.message : String(caught);
  }

  let pass = false;
  let detail = '';
  if (!error) {
    const ctx: EvalRunContext = {
      project: studio.project,
      before,
      appliedCommands,
      invalidCommands,
      message: message.trim(),
      toolCalls: events.filter((event) => event.type === 'tool_start').length,
    };
    const check = evalCase.check(ctx.project);
    const extra = evalCase.verify ? evalCase.verify(ctx) : undefined;
    pass = check.pass && (extra?.pass ?? true);
    detail = extra ? `${check.detail}; ${extra.detail}` : check.detail;
  } else {
    detail = error;
  }
  await studio.flush().catch(() => undefined);

  return {
    events,
    result: {
      caseId: evalCase.id,
      set: evalCase.set,
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
  const setArg = (arg('set', 'v1') ?? 'v1').trim().toLowerCase();
  if (setArg !== 'v1' && setArg !== 'v2' && setArg !== 'all') {
    throw new Error(`--set must be v1, v2 or all (got "${setArg}")`);
  }
  const set = setArg as 'v1' | 'v2' | 'all';
  const cases = CASES.filter((entry) => set === 'all' || entry.set === set).filter(
    (entry) => only.length === 0 || only.includes(entry.id),
  );
  if (cases.length === 0) throw new Error(`No cases matched --set ${set} --cases ${only.join(',')}`);

  if (process.argv.includes('--dry')) {
    console.error(`${cases.length} cases (set: ${set}), models: ${models.join(', ')}`);
    for (const evalCase of cases) {
      const seed = evalCase.seed && evalCase.seed !== 'base' ? ` seed=${evalCase.seed}` : '';
      console.error(`- [${evalCase.set}] ${evalCase.id}${seed}: ${evalCase.prompt}`);
    }
    return;
  }

  const media = ensureMedia();
  await mkdir(REPORT_DIR, { recursive: true });
  const results: EvalCaseResult[] = [];

  for (const model of models) {
    console.error(`\n== model: ${model}`);
    for (const evalCase of cases) {
      const dir = await mkdtemp(join(tmpdir(), 'editbay-eval-'));
      console.error(`CASE ${model} · ${evalCase.id}`);
      try {
        const { result } = await runCase(model, evalCase, dir, media);
        results.push(result);
        console.error(
          `${result.pass ? 'PASS' : 'FAIL'} ${pad(evalCase.id, 22)} ${String(result.ms).padStart(6)}ms  tools=${result.toolCalls} ok=${result.appliedCommands} bad=${result.invalidCommands}  ${result.detail}`,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          caseId: evalCase.id,
          set: evalCase.set,
          model,
          pass: false,
          detail: message,
          ms: 0,
          toolCalls: 0,
          appliedCommands: 0,
          invalidCommands: 0,
          message: '',
          error: message,
        });
        console.error(`FAIL ${pad(evalCase.id, 22)} runner error: ${message}`);
      } finally {
        if (!keep) void rm(dir, { recursive: true, force: true }).catch(() => undefined);
        else console.error(`kept ${dir}`);
      }
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const jsonPath = join(REPORT_DIR, `${stamp}-${set}.json`);
  const mdPath = join(REPORT_DIR, `${stamp}-${set}.md`);
  await writeFile(jsonPath, JSON.stringify({ at: new Date().toISOString(), set, models, results }, null, 2), 'utf8');

  const lines: string[] = [];
  lines.push(`# Editbay agent eval — ${new Date().toISOString()}`);
  lines.push('');
  lines.push(`Set: **${set}** · models: **${models.join(', ')}**`);
  lines.push('');
  lines.push('| set | model | case | result | ms | tools | applied | invalid | detail |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const result of results) {
    lines.push(
      `| ${result.set} | ${result.model} | ${result.caseId} | ${result.pass ? 'PASS' : 'FAIL'} | ${result.ms} | ${result.toolCalls} | ${result.appliedCommands} | ${result.invalidCommands} | ${result.detail.replace(/\|/g, '/')} |`,
    );
  }
  const passCount = results.filter((result) => result.pass).length;
  lines.push('');
  lines.push(`**Score: ${passCount}/${results.length}**`);
  for (const resultSet of ['v1', 'v2'] as const) {
    const inSet = results.filter((result) => result.set === resultSet);
    if (inSet.length === 0) continue;
    lines.push(`**${resultSet} score: ${inSet.filter((result) => result.pass).length}/${inSet.length}**`);
  }
  await writeFile(mdPath, lines.join('\n'), 'utf8');

  console.error(`\nScore: ${passCount}/${results.length}`);
  console.error(`Reports: ${jsonPath}\n         ${mdPath}`);
  if (passCount !== results.length) process.exitCode = 1;
}

await main();
