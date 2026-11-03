import { defineConfig } from 'vitest/config';
export default defineConfig({ resolve: { alias: { vscode: new URL('./test/unit/vscode.ts', import.meta.url).pathname } }, test: { include: ['test/unit/**/*.test.ts', 'test/unit/**/*.test.tsx'], testTimeout: 30000, hookTimeout: 30000,
    maxWorkers: 3, environment: 'node', clearMocks: true }, oxc: { jsx: { runtime: 'automatic' } } });
