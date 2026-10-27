import { build, context } from 'esbuild';
const options = { entryPoints: ['src/extension.ts'], bundle: true, platform: 'node', target: 'node14', format: 'cjs',
    external: ['vscode'], outfile: 'out/extension.js', sourcemap: true, logLevel: 'info' };
if (process.argv.includes('--watch')) {
    const ctx = await context(options); await ctx.watch();
    const { spawn } = await import('node:child_process');
    spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--watch', '--config', 'webview/vite.config.mts'], { stdio: 'inherit' });
} else { await build(options); }
