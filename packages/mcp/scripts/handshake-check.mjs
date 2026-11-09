/**
 * Real stdio handshake check for the bundled server.
 *
 * Spawns `dist/server.mjs`, performs MCP initialize + tools/list over
 * newline-delimited JSON-RPC, and verifies every stdout line is valid
 * JSON-RPC 2.0 with no stray output.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPath = path.join(packageRoot, 'dist', 'server.mjs');

const TIMEOUT_MS = 30_000;
const root = await mkdtemp(path.join(tmpdir(), 'editbay-mcp-handshake-'));
const projectPath = path.join(root, 'editbay.json');
const workspaceRoot = path.join(root, 'workspace');

const child = spawn(
  process.execPath,
  [serverPath, '--project', projectPath, '--workspace', workspaceRoot],
  { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
);

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString();
});

/** id -> resolver for the pending request */
const pending = new Map();
const protocolProblems = [];
let stdoutLines = 0;

const rl = readline.createInterface({ input: child.stdout });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (trimmed === '') return;
  stdoutLines += 1;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    protocolProblems.push(`stdout line is not JSON: ${trimmed.slice(0, 200)}`);
    return;
  }

  if (message.jsonrpc !== '2.0') {
    protocolProblems.push(`message is not JSON-RPC 2.0: ${trimmed.slice(0, 200)}`);
    return;
  }

  if (message.id === undefined) return;
  const resolve = pending.get(message.id);
  if (!resolve) return;
  pending.delete(message.id);
  resolve(message);
});

let nextId = 1;
function request(method, params) {
  const id = nextId;
  nextId += 1;
  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for ${method}`));
    }, TIMEOUT_MS);
    pending.set(id, (message) => {
      clearTimeout(timer);
      if (message.error) reject(new Error(`${method} failed: ${JSON.stringify(message.error)}`));
      else resolve(message.result);
    });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  return response;
}

function notify(method, params) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

let exitCode = 0;
try {
  const initialize = await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'handshake-check', version: '0.0.0' },
  });
  notify('notifications/initialized', {});

  const listed = await request('tools/list', {});
  const tools = Array.isArray(listed.tools) ? listed.tools.map((tool) => tool.name) : [];

  const summary = {
    server: initialize.serverInfo,
    protocolVersion: initialize.protocolVersion,
    stdoutLines,
    toolCount: tools.length,
    tools,
    projectCreated: existsSync(projectPath),
  };

  if (tools.length < 15) protocolProblems.push(`expected at least 15 tools, got ${tools.length}`);
  if (!tools.includes('apply_commands')) protocolProblems.push('apply_commands is missing');
  if (!tools.includes('get_project')) protocolProblems.push('get_project is missing');
  if (!existsSync(projectPath)) protocolProblems.push('project file was not created');
  if (!stderr.includes(projectPath)) protocolProblems.push('server did not log the resolved project path to stderr');

  console.log(JSON.stringify({ ...summary, problems: protocolProblems }, null, 2));

  if (protocolProblems.length > 0) exitCode = 1;
} catch (error) {
  console.error(`handshake failed: ${error instanceof Error ? error.message : String(error)}`);
  if (stderr.trim() !== '') console.error(`server stderr:\n${stderr.trim()}`);
  exitCode = 1;
} finally {
  rl.close();
  child.kill();
  await rm(root, { recursive: true, force: true });
}

process.exit(exitCode);
