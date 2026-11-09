import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const exe = resolve(root, 'apps/desktop/release/win-unpacked/Editbay.exe');

const app = await electron.launch({ executablePath: exe, args: [], env: { ...process.env } });
const page = await app.firstWindow();
await page.waitForTimeout(1800);
const info = await page.evaluate(() => window.editbay.appInfo());
const text = await page.evaluate(() => document.body.innerText);
const skills = await page.evaluate(() => window.editbay.workspace.list('skills'));
await page.screenshot({ path: resolve(root, 'docs/screenshots/app-packaged.png') });
console.log(
  JSON.stringify(
    {
      version: info.version,
      userData: info.userData,
      ffmpeg: info.ffmpegVersion?.split(' ')[0] ?? null,
      skills: skills.map((entry) => entry.name),
      hero: text.includes('Say what you want'),
    },
    null,
    2,
  ),
);
await app.close();
