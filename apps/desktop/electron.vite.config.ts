import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@editbay/core', '@editbay/engine', '@editbay/harness', '@editbay/effects'] })],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@editbay/core': resolve(__dirname, '../../packages/core/src'),
        '@editbay/effects': resolve(__dirname, '../../packages/effects/src'),
        '@editbay/harness': resolve(__dirname, '../../packages/harness/src'),
        '@editbay/harness/agent': resolve(__dirname, '../../packages/harness/src/agent.ts'),
        '@editbay/harness/tools': resolve(__dirname, '../../packages/harness/src/tools.ts'),
        '@editbay/harness/prompt': resolve(__dirname, '../../packages/harness/src/prompt.ts'),
        '@editbay/harness/types': resolve(__dirname, '../../packages/harness/src/types.ts'),
        '@editbay/harness/receipts': resolve(__dirname, '../../packages/harness/src/receipts.ts'),
        '@editbay/harness/providers': resolve(__dirname, '../../packages/harness/src/providers/index.ts'),
        '@editbay/engine': resolve(__dirname, '../../packages/engine/src'),
        '@editbay/ui': resolve(__dirname, '../../packages/ui/src'),
      },
    },
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      emptyOutDir: true,
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
  },
});
