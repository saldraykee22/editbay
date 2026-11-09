import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export function electronPath(root) {
  if (process.env.EDITBAY_ELECTRON) return process.env.EDITBAY_ELECTRON;
  const require = createRequire(resolve(root, 'apps/desktop/package.json'));
  return require('electron');
}
