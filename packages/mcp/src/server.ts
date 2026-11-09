/**
 * Editbay MCP server (stdio).
 *
 * The server exposes one headless studio as a set of tools. stdout carries only
 * MCP JSON-RPC messages; every diagnostic goes to stderr, because a stray
 * `console.log` would corrupt the protocol stream.
 */
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { HeadlessStudio } from '@editbay/kit';
import { resolveConfig, toStudioOptions } from './config';
import { registerProjectTools } from './tools/project';
import { registerMediaTools } from './tools/media';
import { registerEditTools } from './tools/edit';
import { registerRenderTools } from './tools/render';
import { registerKnowledgeTools } from './tools/knowledge';

const SERVER_INSTRUCTIONS = `Editbay is a local video editor. Read get_project first, write through apply_commands,
render with export_video. Operations are validated and undoable; asset file paths never leave the server.`;

/**
 * Builds the MCP server around an already-open studio. Exported separately from
 * `main` so tests can connect an in-memory transport.
 */
export function createEditbayServer(studio: HeadlessStudio): McpServer {
  const server = new McpServer(
    { name: 'editbay', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS },
  );

  registerProjectTools(server, studio);
  registerMediaTools(server, studio);
  registerEditTools(server, studio);
  registerRenderTools(server, studio);
  registerKnowledgeTools(server, studio);

  return server;
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const self = fileURLToPath(import.meta.url);
  if (process.platform === 'win32') {
    return resolve(entry).toLowerCase() === resolve(self).toLowerCase();
  }
  return resolve(entry) === resolve(self);
}

/**
 * Starts the stdio server. Opens the project once, logs the resolved paths to
 * stderr, and flushes the project to disk on SIGINT/SIGTERM.
 */
export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const config = resolveConfig(argv);
  const studio = await HeadlessStudio.open(toStudioOptions(config));

  console.error(`[editbay-mcp] project: ${studio.projectPath}`);
  console.error(`[editbay-mcp] workspace: ${studio.workspaceRoot}`);
  if (config.builtinSkillsDir !== undefined) {
    console.error(`[editbay-mcp] builtin skills: ${config.builtinSkillsDir}`);
  }

  const server = createEditbayServer(studio);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[editbay-mcp] ready on stdio');

  let shuttingDown = false;
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[editbay-mcp] ${reason} received, flushing`);
    try {
      await studio.flush();
    } catch (error) {
      console.error(`[editbay-mcp] flush failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await server.close();
    } catch {
      // The transport may already be gone; nothing left to close.
    }
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  // Clients signal shutdown by closing our stdin (EOF).
  process.stdin.on('end', () => {
    void shutdown('stdin end');
  });
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error(`[editbay-mcp] fatal: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
