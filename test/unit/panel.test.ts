import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { Uri } from 'vscode';
import type * as vscode from 'vscode';
import { BranchFlowProvider } from '../../src/branchFlow/panel';
import type { ExtensionServices } from '../../src/types';
import { GraphPersistenceService } from '../../src/branchFlow/infrastructure/persistence';
import { graph } from './fixtures';
let directory: string;
function services(): ExtensionServices {
    return { context: { extensionUri: Uri.file(process.cwd()), secrets: { onDidChange: () => ({ dispose: () => undefined }) } },
        getConfig: (key: string, fallback: unknown) => key === 'orgHost' ? 'https://dev.azure.com/example' : key === 'project' ? 'Project' : fallback,
        getSecret: async () => 'secret-canary', getState: () => undefined, setState: async () => undefined,
    } as unknown as ExtensionServices;
}
function panel() {
    const sent: unknown[] = []; let receive!: (value: unknown) => void;
    return { sent, send: async (value: unknown) => { receive(value); await new Promise(r => setTimeout(r, 10)); },
        value: { webview: { options: {}, html: '', asWebviewUri: (uri: Uri) => uri, postMessage: (value: unknown) => { sent.push(value); return Promise.resolve(true); }, onDidReceiveMessage: (listener: (value: unknown) => void) => { receive = listener; return { dispose: () => undefined }; } },
            onDidChangeViewState: () => ({ dispose: () => undefined }), onDidDispose: () => ({ dispose: () => undefined }) } as unknown as vscode.WebviewPanel };
}
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'branchflow-panel-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });
it('marks imported evidence stale, restricts bundled assets, validates edit messages and never sends credentials', async () => {
    const uri = Uri.file(path.join(directory, 'graph.branchflow.json'));
    await new GraphPersistenceService().write(uri, graph());
    const provider = new BranchFlowProvider(services()); const doc = await provider.openCustomDocument(uri, {}); const view = panel(); await provider.resolveCustomEditor(doc, view.value);
    expect(view.value.webview.html).toContain("connect-src 'none'"); expect(view.value.webview.html).toContain('script-src \'nonce-');
    expect(view.value.webview.options.localResourceRoots).toHaveLength(1);
    await view.send({ type: 'edit', graph: { ...graph(), repository: { ...graph().repository, organizationUrl: 'https://evil.test' } } });
    expect(JSON.stringify(view.sent)).toContain('Change repository'); expect(doc.graph.repository?.organizationUrl).toBe('https://dev.azure.com/example');
    expect(JSON.stringify(view.sent)).not.toContain('secret-canary');
    await view.send({ type: 'edit', graph: { ...graph(), name: 'Edited' } }); expect(doc.dirty).toBe(true); expect(doc.graph.name).toBe('Edited');
    doc.dispose(); provider.dispose();
});
it('restores dirty crash backups with their original file stamp and refuses to overwrite newer external edits', async () => {
    const uri = Uri.file(path.join(directory, 'graph.branchflow.json')); const backup = Uri.file(path.join(directory, 'backups', 'graph'));
    const persistence = new GraphPersistenceService(); await persistence.write(uri, graph());
    const provider = new BranchFlowProvider(services()); const doc = await provider.openCustomDocument(uri, {});
    doc.graph = { ...doc.graph, name: 'Unsaved work' }; await provider.backupCustomDocument(doc, { destination: backup }); doc.dispose();
    await fs.writeFile(uri.fsPath, JSON.stringify({ ...graph(), name: 'External edit' }));
    const restored = await provider.openCustomDocument(uri, { backupId: backup.toString() });
    expect(restored.graph.name).toBe('Unsaved work'); expect(restored.dirty).toBe(true); expect(restored.external).toBe(true);
    await expect(provider.saveCustomDocument(restored)).rejects.toThrow('changed outside');
    expect((await persistence.read(uri)).graph.name).toBe('External edit'); restored.dispose(); provider.dispose();
});
it('denies credential use for imported organizations that differ from Settings', async () => {
    const uri = Uri.file(path.join(directory, 'foreign.branchflow.json')); const value = graph(); value.repository!.organizationUrl = 'https://evil.test';
    await new GraphPersistenceService().write(uri, value);
    const provider = new BranchFlowProvider(services()); const doc = await provider.openCustomDocument(uri, {}); const view = panel(); await provider.resolveCustomEditor(doc, view.value);
    await view.send({ type: 'ready' }); expect(JSON.stringify(view.sent)).toContain('explicitly authorize'); expect(JSON.stringify(view.sent)).not.toContain('secret-canary');
    doc.dispose(); provider.dispose();
});

it('starts a new flow using the PR Helper selection without another picker or network lookup', async () => {
    const { rememberRepository } = await import('../../src/services/workspaceContext');
    const svc = services(); const values = new Map<string, unknown>();
    svc.getConfig = <T>(key: string, fallback: T): T => (key === 'orgHost' ? graph().repository!.organizationUrl : key === 'project' ? graph().repository!.project : fallback) as T;
    svc.getState = <T>(key: string): T | undefined => values.get(key) as T | undefined;
    svc.setState = async (key, value) => { values.set(key, value); };
    await rememberRepository(svc, graph().repository!);
    const provider = new BranchFlowProvider(svc); const doc = await provider.openCustomDocument(Uri.from({ scheme: 'untitled', path: '/new.branchflow.json' }), {});
    expect(doc.graph.repository).toEqual(graph().repository); doc.dispose(); provider.dispose();
});
it('asks for a filename on first Save and reports save failures to the error inspector', async () => {
    const { commands } = await import('vscode');
    const provider = new BranchFlowProvider(services()); const doc = await provider.openCustomDocument(Uri.from({ scheme: 'untitled', path: '/new.branchflow.json' }), {});
    const view = panel(); await provider.resolveCustomEditor(doc, view.value);
    await view.send({ type: 'action', action: 'save' }); expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.saveAs');
    await expect(provider.saveCustomDocumentAs(doc, Uri.file(path.join(directory, 'wrong.txt')))).rejects.toThrow('filename extension');
    expect(view.sent).toContainEqual(expect.objectContaining({ type: 'error', operation: 'Save graph as' })); doc.dispose(); provider.dispose();
});
it('records files opened from disk in recent graphs, including files not saved in this window', async () => {
    const svc = services(); const updates = vi.fn(); svc.setState = updates;
    const uri = Uri.file(path.join(directory, 'opened.branchflow.json')); await new GraphPersistenceService().write(uri, graph());
    const provider = new BranchFlowProvider(svc); const doc = await provider.openCustomDocument(uri, {});
    expect(updates).toHaveBeenCalledWith('branchFlow.recent', [uri.fsPath]); doc.dispose(); provider.dispose();
});
