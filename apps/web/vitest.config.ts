import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      'server-only': path.resolve(__dirname, 'test/server-only-stub.ts'),
    },
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  } as never,
  test: {
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
    // DB-backed tests share one database; run files serially.
    fileParallelism: false,
  },
});
