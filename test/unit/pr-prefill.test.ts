import { afterEach, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { window, Uri } from 'vscode';
import { PRCreatorPanel } from '../../src/webviews/prCreatorPanel';
import type { ExtensionServices } from '../../src/types';
import { repository } from './fixtures';
afterEach(() => { PRCreatorPanel.currentPanel = undefined; vi.restoreAllMocks(); });
it('prefills the existing editable PR form after async repository and branch discovery and preserves AI/work-item controls', () => {
    let html = '';
    const panel = { webview: { asWebviewUri: (uri: Uri) => uri, get html() { return html; }, set html(value: string) { html = value; }, onDidReceiveMessage: vi.fn(), postMessage: vi.fn() }, onDidDispose: vi.fn() };
    vi.mocked(window.createWebviewPanel).mockReturnValue(panel as never);
    PRCreatorPanel.createOrShow({ analytics: { track: vi.fn() }, context: { extensionUri: Uri.file(process.cwd()) } } as unknown as ExtensionServices,
        { context: repository, sourceBranch: 'release/a', targetBranch: 'release/b' });
    const sent: unknown[] = [];
    const dom = new JSDOM(html, { runScripts: 'dangerously', beforeParse: win => {
        Object.assign(win, { acquireVsCodeApi: () => ({ postMessage: (message: unknown) => sent.push(message) }) });
    } });
    const send = (command: string, data: unknown): void => { dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { command, data } })); };
    send('initialData', { hasAzurePAT: true, prefill: { repositoryId: 'repo-id', sourceBranch: 'release/a', targetBranch: 'release/b' }, prHistory: [] });
    send('repositoriesLoaded', { repositories: [{ id: 'repo-id', name: 'Repository' }], selectedRepoId: '' });
    send('branchesLoaded', { repositoryId: 'repo-id', branches: ['release/a', 'release/b', 'main'], defaultBranch: 'main' });
    const doc = dom.window.document;
    expect((doc.getElementById('repository') as HTMLInputElement).value).toBe('repo-id');
    expect((doc.getElementById('sourceBranch') as HTMLInputElement).value).toBe('release/a');
    expect((doc.getElementById('targetBranch') as HTMLInputElement).value).toBe('release/b');
    expect((doc.getElementById('targetBranch') as HTMLInputElement).disabled).toBe(false);
    expect(doc.getElementById('generateAI')).toBeTruthy(); expect(doc.getElementById('workItems')).toBeTruthy();
    expect(sent).toContainEqual({ command: 'loadBranches', repositoryId: 'repo-id' }); dom.window.close();
});
