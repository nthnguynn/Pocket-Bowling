import { defineConfig } from 'vitest/config';

// Một lệnh `npm test` chạy test của thư viện chung và của mọi site.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'packages/*/tests/**/*.test.ts', 'sites/*/tests/**/*.test.ts'],
  },
});
