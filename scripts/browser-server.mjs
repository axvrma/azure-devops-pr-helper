import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
await build({ entryPoints: ['test/browser/legacyFixtures.ts'], platform: 'node', format: 'cjs', target: 'node22', bundle: true, alias: { vscode: resolve('test/browser/vscodeFixture.ts') }, outfile: '.test-out/legacy-fixtures.cjs' });
const { pages } = createRequire(import.meta.url)(resolve('.test-out/legacy-fixtures.cjs'));
const sidebarContext = { hasAzure: true, hasAI: false, aiProviderLabel: 'Anthropic', branch: 'feature/release-integration', repo: 'platform-services', prHistory: [], recentGraphs: [{ name: 'Release readiness.branchflow.json', path: '/workspaces/platform/Release readiness.branchflow.json' }, { name: 'Release integration.branchflow.json', path: '/workspaces/platform/Release integration.branchflow.json' }] };
const legacyBridge = `window.messages=[];window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:m=>{window.messages.push(m);if(m.command==='getContext')queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{data:{command:'context',data:${JSON.stringify(sidebarContext)}}})));}});`;
const themes = {
    dark: ':root{color-scheme:dark;--vscode-font-family:system-ui;--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-sideBar-background:#181818;--vscode-sideBarSectionHeader-background:#181818;--vscode-panel-border:#303030;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-list-hoverBackground:#2a2d2e;--vscode-focusBorder:#0078d4}',
    light: ':root{color-scheme:light;--vscode-font-family:system-ui;--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-sideBar-background:#f8f8f8;--vscode-sideBarSectionHeader-background:#f8f8f8;--vscode-panel-border:#dddddd;--vscode-button-background:#0078d4;--vscode-button-foreground:#ffffff;--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#333333;--vscode-list-hoverBackground:#e8e8e8;--vscode-focusBorder:#005fb8}',
    contrast: ':root{color-scheme:dark;--vscode-font-family:system-ui;--vscode-foreground:#ffffff;--vscode-descriptionForeground:#ffffff;--vscode-editor-background:#000000;--vscode-sideBar-background:#000000;--vscode-panel-border:#6fc3df;--vscode-button-background:#000000;--vscode-button-foreground:#ffffff;--vscode-button-secondaryBackground:#000000;--vscode-button-secondaryForeground:#ffffff;--vscode-contrastBorder:#6fc3df;--vscode-focusBorder:#f38518;--vscode-list-hoverBackground:#111111}',
};
const nonce = 'branchflow-browser-test-nonce';
const fixture = { schemaVersion: 1, graphId: 'browser-fixture', name: 'Release Train', repository: { organizationUrl: 'https://dev.azure.com/example', project: 'Platform', repositoryId: 'repo', repositoryName: 'Release services' },
    nodes: [ { id: 'a', branch: 'release/2.1.0', position: { x: 0, y: 0 } }, { id: 'b', branch: 'release/2.2.0', position: { x: 350, y: 0 } }, { id: 'c', branch: 'release/2.3.0', position: { x: 700, y: 0 } } ],
    edges: [ { id: 'ab', source: 'a', target: 'b', operation: 'merge-pr' }, { id: 'bc', source: 'b', target: 'c', operation: 'merge-pr' } ],
    snapshot: { validatedAt: null, branchHeads: {} }, ui: { viewport: { x: 40, y: 200, zoom: 0.65 }, snapToGrid: true } };
fixture.edges[0].analysis = { edgeId: 'ab', operation: 'merge-pr', sourceSha: 'a'.repeat(40), targetSha: 'b'.repeat(40), status: 'ACTION_REQUIRED', verified: false, validationMethod: 'git-ancestry', checkedAt: '2026-10-26T00:00:00.000Z', outstandingCommits: 4, reasons: ['Source history is missing from the target. A merge is required; conflict status is unverified.'], warnings: ['Merge conflicts have not been checked.'] };
fixture.edges[1].analysis = { ...fixture.edges[0].analysis, edgeId: 'bc', sourceSha: 'b'.repeat(40), targetSha: 'c'.repeat(40), status: 'PR_ACTIVE', validationMethod: 'azure-active-pr', reasons: ['A matching source/target pull request is active. This does not prove integration or readiness.'], existingPr: { id: 124, title: 'Propagate release updates', status: 'active', mergeStatus: 'queued' } };
const refs = [...fixture.nodes.map((n, i) => ({ name: n.branch, sha: 'abc'[i].repeat(40) })), { name: 'hotfix/urgent', sha: 'd'.repeat(40) }];
const bridge = `window.edits=[];window.hostActions=[];const fixture=${JSON.stringify(fixture)};window.acquireVsCodeApi=()=>({getState:()=>null,setState:()=>{},postMessage:m=>{window.hostActions.push(m);if(m.type==='ready'){queueMicrotask(()=>{window.dispatchEvent(new MessageEvent('message',{data:{type:'state',graph:fixture,revision:0,dirty:false,external:false,recent:[]}}));window.dispatchEvent(new MessageEvent('message',{data:{type:'refs',refs:${JSON.stringify(refs)}}}));});}if(m.type==='edit'){window.edits.push(m.graph);}}});`;
createServer(async (req, res) => {
    try {
        const requestUrl = new URL(req.url, 'http://127.0.0.1:4177');
        if (requestUrl.pathname === '/ui/workbench.css') { res.setHeader('Content-Type', 'text/css'); res.end(await readFile('media/ui/workbench.css')); return; }
        if (requestUrl.pathname === '/theme.css') { res.setHeader('Content-Type', 'text/css'); res.end(themes[requestUrl.searchParams.get('theme')] || themes.dark); return; }
        if (requestUrl.pathname === '/legacy-bridge.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(legacyBridge); return; }
        const key = requestUrl.pathname.slice(1);
        if (pages[key]) {
            const theme = requestUrl.searchParams.get('theme') || 'dark';
            let html = pages[key]; const pageNonce = /<script nonce="([^"]+)"/.exec(html)[1];
            html = html.replace('<script nonce=', `<script nonce="${pageNonce}" src="/legacy-bridge.js"></script><script nonce=`).replace('</head>', `<link rel="stylesheet" href="/theme.css?theme=${theme}"></head>`);
            html = html.replace(/<body([^>]*)>/, (match, attributes) => `<body ${attributes.replace(/class="([^"]*)"/, '')} class="${/class="([^"]*)"/.exec(attributes)?.[1] || ''} ${theme === 'contrast' ? 'vscode-high-contrast' : `vscode-${theme}`}">`);
            res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html); return;
        }
        if (req.url === '/app.js' || req.url === '/app.css') { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8'); res.end(await readFile('media/branch-flow' + req.url)); }
        else if (req.url === '/bridge.js') { res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); res.end(bridge); }
        else if (req.url === '/') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; base-uri 'none'; form-action 'none'`);
            res.end(`<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="/app.css"></head><body class="vscode-dark"><div id="root"></div><script nonce="${nonce}" src="/bridge.js"></script><script nonce="${nonce}" src="/app.js"></script></body></html>`);
        } else { res.writeHead(404); res.end(); }
    } catch { res.writeHead(500); res.end(); }
}).listen(4177, '127.0.0.1');
