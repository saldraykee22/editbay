import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
import { electronPath as electronPathFor } from './lib/electron-path.mjs';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const electronPath = electronPathFor(root);

const app = await electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir });
const page = await app.firstWindow();
await page.waitForTimeout(2500);
const info = await page.evaluate(() => {
  const pick = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return {
      color: style.color,
      opacity: style.opacity,
      fontSize: style.fontSize,
      background: style.backgroundColor,
      filter: style.filter,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    };
  };
  return {
    h1: pick('.stage-empty h1'),
    p: pick('.stage-empty p'),
    empty: pick('.stage-empty'),
    stage: pick('.stage'),
    body: pick('body'),
    fonts: [...document.fonts].map((f) => `${f.family} ${f.weight} ${f.status}`).slice(0, 6),
  };
});
console.log(JSON.stringify(info, null, 2));
await page.screenshot({ path: resolve(root, 'docs/screenshots/app.png') });
await app.close();
