import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any GitHub Pages sub-path.
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
  },
});
