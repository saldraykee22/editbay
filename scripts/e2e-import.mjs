import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { createDemoMedia } from './lib/demo.mjs';
import { electronPath as electronPathFor } from './lib/electron-path.mjs';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const media = createDemoMedia(resolve(root, '.demo'));

const app = await electron.launch({
  executablePath: electronPathFor(root),
  args: [appDir],
  cwd: appDir,
  env: { ...process.env, EDITBAY_TEST_IMPORT: [media.clip1, media.clip2, media.music].join(';') },
});
const page = await app.firstWindow();
await page.waitForTimeout(600);
const info = await page.evaluate(() => window.editbay.appInfo());
await page.evaluate(() => window.editbay.workspace.remove('projects/current.json'));
await page.reload();
await page.waitForTimeout(1200);

await page.getByRole('button', { name: 'Import', exact: true }).click();
await page.waitForTimeout(2500);
await page.screenshot({ path: resolve(root, 'docs/screenshots/app-import.png') });

const text = await page.evaluate(() => document.body.innerText);
const assets = /(\d+) assets/.exec(text)?.[1];
const clips = /(\d+) clips/.exec(text)?.[1];
const hasThumb = await page.evaluate(() => document.querySelectorAll('.clip .thumb').length);
console.log(JSON.stringify({ assets, clips, thumbnails: hasThumb, duration: /(\d+\.\d+)s/.exec(text)?.[1] ?? null }, null, 2));
await app.close();
