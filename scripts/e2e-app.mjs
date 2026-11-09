import { _electron as electron } from 'playwright';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createDemoMedia, buildDemoProject } from './lib/demo.mjs';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const electronPath =
  process.env.EDITBAY_ELECTRON ?? resolve(root, 'node_modules/.pnpm/electron@33.4.11/node_modules/electron/dist/electron.exe');

const media = createDemoMedia(resolve(root, '.demo'));
const project = buildDemoProject(media);

const app = await electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir });
const page = await app.firstWindow();
await page.waitForTimeout(600);
const info = await page.evaluate(() => window.editbay.appInfo());
writeFileSync(resolve(info.workspaceRoot, 'projects/current.json'), JSON.stringify(project, null, 2), 'utf8');
await page.reload();
await page.waitForTimeout(1800);

const outPath = resolve(root, '.demo/export.mp4');
// The save-dialog handler in the main process honours this for automated checks.
await app.evaluate(({}, target) => {
  process.env.EDITBAY_TEST_EXPORT = target;
}, outPath);

await page.getByRole('button', { name: 'Export' }).click();
await page.getByText('Export complete').waitFor({ timeout: 180_000 });
await page.screenshot({ path: resolve(root, 'docs/screenshots/app-export.png') });

const probe = await page.evaluate(async (file) => window.editbay.probeMedia(file), outPath);
console.log(JSON.stringify({ outPath, probe }, null, 2));
await app.close();
