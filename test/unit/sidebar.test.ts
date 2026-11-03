import { expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { SidebarProvider } from '../../src/webviews/sidebarProvider';
import type { ExtensionServices } from '../../src/types';
import type * as vscode from 'vscode';
import { Uri } from 'vscode';
it('renders independent collapsible sections and safe, clickable recent graph files', () => {
    let receive!: (message: unknown) => void; let dispose!: () => void;
    const view = { visible: true, webview: { html: '', options: {}, asWebviewUri: (uri: Uri) => uri, onDidReceiveMessage: (handler: (message: unknown) => void) => { receive = handler; } }, onDidChangeVisibility: vi.fn(), onDidDispose: (handler: () => void) => { dispose = handler; } };
    new SidebarProvider({ context: { extensionUri: Uri.file(process.cwd()) } } as ExtensionServices).resolveWebviewView(view as unknown as vscode.WebviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    const sent: unknown[] = []; const savedState = { prHelperSection: false };
    const dom = new JSDOM(view.webview.html, { runScripts: 'dangerously', beforeParse: win => { Object.assign(win, { acquireVsCodeApi: () => ({ postMessage: (m: unknown) => sent.push(m), getState: () => savedState, setState: vi.fn() }) }); } });
    const document = dom.window.document;
    expect((document.getElementById('prHelperSection') as HTMLDetailsElement).open).toBe(false);
    expect((document.getElementById('branchFlowSection') as HTMLDetailsElement).open).toBe(true);
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', { data: { command: 'context', data: { hasAzure: true, prHistory: [], recentGraphs: [{ id: 'sample-one', name: '<unsafe>.branchflow.json', path: '/graphs/<unsafe>.branchflow.json' }] } } }));
    const recent = document.querySelector('#recentGraphs button') as HTMLButtonElement;
    expect(recent.textContent).toContain('<unsafe>'); expect(document.querySelector('unsafe')).toBeNull(); recent.click();
    expect(sent).toContainEqual({ command: 'openGraph', data: { index: 0 } });
    expect(typeof receive).toBe('function'); dom.window.close(); dispose();
});

function hostSidebar(initial: string[]) {
    let receive!: (message: unknown) => Promise<void>;
    let dispose!: () => void;
    const sent: { command: string; data: { recentGraphs?: { id: string; name: string; path: string }[]; files?: { id: string; path: string }[]; removedId?: string; message?: string } }[] = [];
    const state = new Map<string, unknown>([['branchFlow.recent', initial]]);
    const services = {
        context: { extensionUri: Uri.file(process.cwd()) },
        getState: <T>(key: string): T | undefined => state.get(key) as T | undefined,
        setState: vi.fn(async (key: string, value: unknown) => { state.set(key, value); }),
        getSecret: async () => undefined,
        getConfig: <T>(_key: string, fallback: T): T => fallback,
    } as unknown as ExtensionServices;
    const view = { visible: false, webview: { html: '', options: {}, asWebviewUri: (uri: Uri) => uri, postMessage: async (message: typeof sent[number]) => { sent.push(message); return true; }, onDidReceiveMessage: (handler: typeof receive) => { receive = handler; } }, onDidChangeVisibility: vi.fn(), onDidDispose: (handler: () => void) => { dispose = handler; } };
    new SidebarProvider(services).resolveWebviewView(view as unknown as vscode.WebviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
    return { state, services, sent, send: (message: unknown) => receive(message), dispose: () => dispose() };
}
it('removes a host-issued graph identity after reordering, preserves the file, and persists only history', async () => {
    const { promises: fs } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { workspace } = await import('vscode');
    const directory = await fs.mkdtemp(join(tmpdir(), 'prism-recent-test-'));
    const file = join(directory, 'keep.branchflow.json');
    await fs.writeFile(file, 'unchanged graph content');
    const other = join(directory, 'other.branchflow.json');
    const host = hostSidebar([file, other]);
    try {
        await host.send({ command: 'getContext' });
        const items = host.sent.find(message => message.command === 'context')!.data.recentGraphs!;
        host.state.set('branchFlow.recent', [other, file]);
        await host.send({ command: 'removeRecentGraph', data: { id: items[0].id } });
        expect(host.state.get('branchFlow.recent')).toEqual([other]);
        expect(await fs.readFile(file, 'utf8')).toBe('unchanged graph content');
        expect(workspace.fs.delete).not.toHaveBeenCalled();
        expect(host.services.setState).toHaveBeenCalledExactlyOnceWith('branchFlow.recent', [other]);
        expect(host.sent.at(-1)?.command).toBe('recentGraphsUpdated');
        expect(host.sent.at(-1)?.data.files?.map(item => item.path)).toEqual([other]);
        await host.send({ command: 'getContext' });
        expect(host.sent.at(-1)?.data.recentGraphs?.[0].id).toBe(items[1].id);
    } finally { host.dispose(); await fs.rm(directory, { recursive: true, force: true }); }
});
it('rejects arbitrary paths, list indices, unknown identities, and already removed entries', async () => {
    const host = hostSidebar(['/graphs/keep.branchflow.json']);
    try {
        await host.send({ command: 'getContext' });
        const id = host.sent[0].data.recentGraphs![0].id;
        for (const data of [{ path: '/graphs/keep.branchflow.json' }, { index: 0 }, { id: '/graphs/keep.branchflow.json' }, { id: null }, { id: 'x'.repeat(129) }]) {
            await host.send({ command: 'removeRecentGraph', data });
        }
        expect(host.services.setState).not.toHaveBeenCalled();
        host.state.set('branchFlow.recent', []);
        await host.send({ command: 'removeRecentGraph', data: { id } });
        expect(host.services.setState).not.toHaveBeenCalled();
    } finally { host.dispose(); }
});
it('keeps the recent entry when storing history fails and returns a recoverable error', async () => {
    const host = hostSidebar(['/graphs/keep.branchflow.json']);
    try {
        await host.send({ command: 'getContext' });
        const id = host.sent[0].data.recentGraphs![0].id;
        vi.mocked(host.services.setState).mockRejectedValueOnce(new Error('Storage failed'));
        await host.send({ command: 'removeRecentGraph', data: { id } });
        expect(host.state.get('branchFlow.recent')).toEqual(['/graphs/keep.branchflow.json']);
        expect(host.sent.at(-1)).toMatchObject({ command: 'recentGraphError', data: { message: expect.stringContaining('file has not been changed') } });
    } finally { host.dispose(); }
});
