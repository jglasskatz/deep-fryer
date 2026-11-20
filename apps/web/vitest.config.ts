import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname) },
      { find: 'server-only', replacement: path.resolve(import.meta.dirname, 'test/server-only-stub.ts') },
      // next-auth imports Next's subpaths without extensions, which Node's
      // ESM resolver (unlike Next's bundler) rejects.
      { find: /^next\/(server|headers|navigation|cache)$/, replacement: 'next/$1.js' },
    ],
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  } as never,
  // tsconfig keeps JSX for Next ("preserve"); tests compile it the way Next does.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: [
      'lib/**/*.test.ts',
      'app/**/*.test.ts',
      'components/**/*.test.ts',
      'middleware.test.ts',
      'middleware.*.test.ts',
      'instrumentation.test.ts',
    ],
    environment: 'node',
    // DB-backed tests share one database; run files serially.
    fileParallelism: false,
    server: { deps: { inline: ['next-auth', '@auth/core'] } },
  },
});
