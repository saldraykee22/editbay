import { _electron as electron } from 'playwright';
import { electronPath as electronPathFor } from './lib/electron-path.mjs';
import { createDemoMedia, buildDemoProject } from './lib/demo.mjs';
import { seedWorkspaceProject } from './lib/workspace.mjs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const electronPath = electronPathFor(root);
const demoDir = resolve(root, '.demo');

const media = createDemoMedia(demoDir);
const project = buildDemoProject(media);

seedWorkspaceProject(project);
const app = await electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir });
const page = await app.firstWindow();
await page.waitForTimeout(1800);
const scrub = page.locator('.scrub');
const box = await scrub.boundingBox();
if (box) {
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
}
await page.waitForTimeout(900);
await page.evaluate(() => document.querySelector('.stage-frame')?.scrollIntoView());
await page.screenshot({ path: resolve(root, 'docs/screenshots/app-demo.png') });
const text = await page.evaluate(() => document.body.innerText);
console.log(JSON.stringify({ hasTimeline: text.includes('Timeline') || text.includes('TIMELINE'), clips: text.match(/\d+ clips/)?.[0], text: text.slice(0, 400) }, null, 2));
await app.close();
