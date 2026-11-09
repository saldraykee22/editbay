import { _electron as electron } from 'playwright';
import { electronPath as electronPathFor } from './lib/electron-path.mjs';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const electronPath = electronPathFor(root);

const app = await electron.launch({
  executablePath: electronPath,
  args: [appDir],
  cwd: appDir,
  env: { ...process.env, NODE_ENV: 'production' },
});

const problems = [];
app.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
app.on('page', (page) => {
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
});

const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(1200);
const title = await page.title();
const text = await page.evaluate(() => document.body.innerText);
const api = await page.evaluate(() => typeof window.editbay);

mkdirSync(resolve(root, 'docs/screenshots'), { recursive: true });
await page.screenshot({ path: resolve(root, 'docs/screenshots/app.png') });

console.log(JSON.stringify({ title, api, problems, text: text.slice(0, 600) }, null, 2));

const ok = title === 'Editbay' && api === 'object' && text.includes('Editbay');
await app.close();
process.exit(ok && problems.length === 0 ? 0 : 1);
