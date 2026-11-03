import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Match the supported Node ranges of the installed Vitest toolchain.
// This requirement applies to development tools, not VS Code's extension host.
export function isSupportedNodeVersion(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) { return false; }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    return (major === 22 && minor >= 12) || major === 24 || major >= 26;
}

export function checkNode(version = process.versions.node) {
    if (isSupportedNodeVersion(version)) { return true; }
    console.error([
        '',
        `Prism's development tools cannot run on Node.js v${version}.`,
        'Use Node.js 22.12+ in the 22.x release line (recommended), 24.x, or 26+.',
        '',
        'From the repository root, run:',
        '  nvm install',
        '  nvm use',
        '  npm ci',
        '  npm run vscode:package',
        '',
        'If you use another Node version manager, select Node 22.12+ in the 22.x release line.',
        'This requirement applies only to building/testing Prism, not installing the extension.',
        '',
    ].join('\n'));
    return false;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url && !checkNode()) {
    process.exitCode = 1;
}
