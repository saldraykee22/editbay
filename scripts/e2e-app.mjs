import { _electron as electron } from 'playwright';
import { electronPath as electronPathFor } from './lib/electron-path.mjs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoMedia, buildDemoProject } from './lib/demo.mjs';
import { seedWorkspaceProject } from './lib/workspace.mjs';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const electronPath = electronPathFor(root);

const media = createDemoMedia(resolve(root, '.demo'));
const project = buildDemoProject(media);
seedWorkspaceProject(project);

const app = await electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir });
const page = await app.firstWindow();
await page.waitForTimeout(1800);

const outPath = resolve(root, '.demo/export.mp4');
// The save-dialog handler in the main process honours this for automated checks.
// The main-process inspector context is replaced once during startup; retry
// until it is stable instead of relying on a fixed delay.
for (let attempt = 0; ; attempt += 1) {
  try {
    await app.evaluate(({}, target) => {
      process.env.EDITBAY_TEST_EXPORT = target;
    }, outPath);
    break;
  } catch (error) {
    if (attempt >= 20 || !String(error).includes('Execution context was destroyed')) throw error;
    await page.waitForTimeout(250);
  }
}

await page.getByRole('button', { name: 'Export' }).click();
await page.getByText('Export complete').waitFor({ timeout: 180_000 });
await page.screenshot({ path: resolve(root, 'docs/screenshots/app-export.png') });

const probe = await page.evaluate(async (file) => window.editbay.probeMedia(file), outPath);
console.log(JSON.stringify({ outPath, probe }, null, 2));
await app.close();
