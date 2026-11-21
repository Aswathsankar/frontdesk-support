import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Run tests in sequence (important for DB tests that share state)
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false },
    },
  },
});
