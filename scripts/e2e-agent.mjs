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

const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir],
  cwd: appDir,
  env: { ...process.env, EDITBAY_FAKE_LLM: '1' },
});
const page = await app.firstWindow();
await page.waitForTimeout(600);
const info = await page.evaluate(() => window.editbay.appInfo());
writeFileSync(resolve(info.workspaceRoot, 'projects/current.json'), JSON.stringify(project, null, 2), 'utf8');
await page.reload();
await page.waitForTimeout(1600);

const before = await page.evaluate(() => document.body.innerText);

await page.locator('.composer textarea').fill('tighten the intro and add a title');
await page.locator('.composer button', { hasText: 'Send' }).click();

await page.getByText('Trimmed the opening and added a title card.').waitFor({ timeout: 60_000 });
await page.waitForTimeout(700);
const after = await page.evaluate(() => document.body.innerText);
await page.screenshot({ path: resolve(root, 'docs/screenshots/app-agent.png') });

const addedText = after.includes('Editbay made this');
const textCount = /text\n(\d+)/.exec(after)?.[1];
console.log(
  JSON.stringify(
    {
      message: after.includes('Trimmed the opening'),
      addedText,
      textCount,
      beforeTextCount: /text\n(\d+)/.exec(before)?.[1],
      toolLine: /apply_commands[^\n]*/.exec(after)?.[0] ?? null,
    },
    null,
    2,
  ),
);
await app.close();
