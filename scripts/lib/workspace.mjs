import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function workspaceRootPath() {
  const base = process.env.APPDATA ?? join(homedir(), '.config');
  return join(base, 'Editbay', 'workspace');
}

export function workspaceProjectPath() {
  return join(workspaceRootPath(), 'projects', 'current.json');
}

export function seedWorkspaceProject(project) {
  const file = workspaceProjectPath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(project, null, 2), 'utf8');
  return file;
}

export function clearWorkspaceProject() {
  rmSync(workspaceProjectPath(), { force: true });
}
