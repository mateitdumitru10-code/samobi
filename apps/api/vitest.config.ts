import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup-env.ts'],
    /**
     * One file at a time.
     *
     * These tests share a single cloud database — there is no local stack — so
     * two files running at once compete for the same connection pool and create
     * rows the other one's cleanup does not know about. Slower, and correct.
     */
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
