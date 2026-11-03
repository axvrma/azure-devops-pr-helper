import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)), base: './',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: { target: 'chrome91', cssTarget: 'chrome91', outDir: '../media/branch-flow', emptyOutDir: true,
        lib: { entry: fileURLToPath(new URL('src/main.tsx', import.meta.url)), formats: ['iife'], name: 'BranchFlow', fileName: () => 'app.js', cssFileName: 'app' },
        sourcemap: false, chunkSizeWarningLimit: 900 },
});
