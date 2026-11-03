import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const temporary = await mkdtemp(join(tmpdir(), 'branchflow-vscode-'));
await mkdir(join(temporary, 'user', 'User'), { recursive: true });
await writeFile(join(temporary, 'user', 'User', 'settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'azureDevopsPr.enableTelemetry': false, 'workbench.startupEditor': 'none', 'security.workspace.trust.enabled': false }));
await build({ entryPoints: ['test/extension/suite.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node14', external: ['vscode'], outfile: '.test-out/suite.cjs' });
// The Codex host may itself be Electron in Node mode; do not inherit that mode into the test editor.
delete process.env.ELECTRON_RUN_AS_NODE;
await runTests({ version: process.env.VSCODE_TEST_VERSION || '1.60.2', extensionDevelopmentPath: resolve('.'), extensionTestsPath: resolve('.test-out/suite.cjs'),
    launchArgs: ['--user-data-dir', join(temporary, 'user'), '--extensions-dir', join(temporary, 'extensions'), '--disable-extensions', '--disable-telemetry', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', ...(process.env.CI ? ['--no-sandbox', '--disable-dev-shm-usage'] : [])] });
