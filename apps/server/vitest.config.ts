import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 30_000,
    pool: 'forks',
  },
});
