import { _electron as electron } from 'playwright';
import { electronPath as electronPathFor } from './lib/electron-path.mjs';
import { createDemoMedia, buildDemoProject } from './lib/demo.mjs';
import { seedWorkspaceProject } from './lib/workspace.mjs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const appDir = resolve(root, 'apps/desktop');
const electronPath = electronPathFor(root);

const media = createDemoMedia(resolve(root, '.demo'));
const project = buildDemoProject(media);
seedWorkspaceProject(project);

const app = await electron.launch({ executablePath: electronPath, args: [appDir], cwd: appDir });
const page = await app.firstWindow();
await page.waitForTimeout(1800);

const scrub = page.locator('.scrub');
const scrubBox = await scrub.boundingBox();
if (scrubBox) {
  await page.mouse.click(scrubBox.x + scrubBox.width * 0.2, scrubBox.y + scrubBox.height / 2);
  await page.waitForTimeout(500);
}

const overlayClipLocator = page.locator('.clip.overlay-clip').first();
await overlayClipLocator.waitFor({ state: 'visible', timeout: 15_000 });
await overlayClipLocator.click();

const inspector = page.locator('.overlay-inspector');
await inspector.waitFor({ state: 'visible', timeout: 10_000 });

const opacityInput = inspector.locator('input[name="opacity"]');
await opacityInput.fill('0.5');
await opacityInput.press('Enter');

// Wait for the debounced workspace autosave (700ms) to flush to projects/current.json.
await page.waitForTimeout(950);

const savedRaw = await page.evaluate(() => window.editbay.workspace.read('projects/current.json'));
if (!savedRaw) {
  await app.close();
  throw new Error('projects/current.json was not written after editing overlay opacity');
}

const parsed = JSON.parse(savedRaw);
const savedProject = parsed.project ?? parsed;
const overlayTrack = savedProject.tracks?.find((t) => t.kind === 'overlay');
const overlayClip = overlayTrack?.clips?.find((c) => c.id === 'c_logo') ?? overlayTrack?.clips?.[0];
const opacity = overlayClip?.transform?.opacity;

if (opacity !== 0.5) {
  await app.close();
  throw new Error(`Expected overlay clip opacity === 0.5 in project JSON, got ${String(opacity)}`);
}

const screenshotPath = resolve(root, 'docs/screenshots/app-overlay.png');
await page.screenshot({ path: screenshotPath });

console.log(
  JSON.stringify(
    {
      ok: opacity === 0.5,
      clipId: overlayClip.id,
      opacity,
      transform: overlayClip.transform,
      screenshot: 'docs/screenshots/app-overlay.png',
    },
    null,
    2,
  ),
);

await app.close();
