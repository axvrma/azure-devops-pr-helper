import { execFileSync } from 'node:child_process';
import { readFile, writeFile, readdir } from 'node:fs/promises';
const tree = JSON.parse(execFileSync(process.execPath, [process.env.npm_execpath || 'node_modules/npm/bin/npm-cli.js', 'ls', '--omit=dev', '--all', '--long', '--json'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
const found = new Map();
function visit(node) {
    for (const [name, pkg] of Object.entries(node.dependencies || {})) {
        if (pkg.path && !found.has(`${name}@${pkg.version}`)) { found.set(`${name}@${pkg.version}`, pkg.path); visit(pkg); }
    }
}
visit(tree);
let text = '# Third-party notices\n\nGenerated from installed production dependencies. The extension is MIT licensed; bundled dependencies retain their respective licenses.\n';
for (const [name, directory] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
    const metadata = JSON.parse(await readFile(directory + '/package.json', 'utf8'));
    text += `\n## ${name}\n\nLicense: ${metadata.license || 'See package license'}\n`;
    const entries = await readdir(directory);
    const files = entries.filter(file => /^(?:licen[sc]e|notice|copying)(?:[.-].*)?$/i.test(file));
    for (const file of files) {
        try { const license = await readFile(directory + '/' + file, 'utf8'); text += `\n\`\`\`text\n${license.trim()}\n\`\`\`\n`; } catch { /* Some packages use a license directory. */ }
    }
}
await writeFile('THIRD_PARTY_NOTICES.md', text);
console.log(`Collected notices for ${found.size} production packages.`);
