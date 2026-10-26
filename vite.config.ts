import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build works from any GitHub Pages sub-path.
  base: './',
  // Agent worktrees live under .claude/; keep the dev server from watching them.
  server: { watch: { ignored: ['**/.claude/**'] } },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
