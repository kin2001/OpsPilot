import { defineConfig } from 'vitest/config';
// The native Cron scenario temporarily activates a database-wide executor.
export default defineConfig({ test: { include: ['tests/integration/**/*.test.ts'], fileParallelism: false, testTimeout: 30000, hookTimeout: 30000 } });
