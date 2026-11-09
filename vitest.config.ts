import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'scripts/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
