import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import * as path from 'path';
import { AzureDevOpsClient } from '../api/azureDevOps';
import { ExtensionServices } from '../types';
import { azureClient, configuredContext } from '../services/pullRequestService';
import { PRCreatorPanel } from '../webviews/prCreatorPanel';
import { getNonce } from '../utils/helpers';
import { getCurrentRepoName } from '../utils/git';
import { recentGraphs, rememberGraph, selectedRepository } from '../services/workspaceContext';
import { BranchGraph, BranchRef, emptyGraph, RepositoryContext, safeOrganizationUrl } from './domain/model';
import { parseGraph, serializeGraph, validateGraph } from './domain/graph';
import { GraphValidationService, ValidationCoordinator } from './application/analysis';
import { LocalGitAdapter } from './infrastructure/git';
import { GraphPersistenceService } from './infrastructure/persistence';
import { createAbortController, OperationCancelled } from './infrastructure/async';
import { parseHostMessage, ViewMessage } from './protocol';

const VIEW_TYPE = 'azureDevopsPr.branchFlow';
const freshId = (): string => randomBytes(16).toString('hex');

export class FlowDocument implements vscode.CustomDocument {
    readonly coordinator = new ValidationCoordinator();
    readonly subscriptions: vscode.Disposable[] = [];
    readonly panels = new Set<vscode.WebviewPanel>();
    readonly approvedOrganizations = new Set<string>();
    graph: BranchGraph;
    savedUri?: vscode.Uri;
    stamp?: string;
    external = false;
    dirty = false;
    revision = 0;
    currentBranch?: string;
    refs: BranchRef[] = [];
    disposed = false;
    service?: GraphValidationService;
    client?: AzureDevOpsClient;
    refreshTimer?: ReturnType<typeof setTimeout>;
    polling?: ReturnType<typeof setInterval>;
    running = false;
    requestGeneration = 0;
    initialized = false;
    constructor(readonly uri: vscode.Uri, graph: BranchGraph) { this.graph = graph; }
    dispose(): void {
        this.disposed = true; this.coordinator.cancel();
        if (this.refreshTimer) { clearTimeout(this.refreshTimer); }
        if (this.polling) { clearInterval(this.polling); }
        this.subscriptions.forEach(d => d.dispose()); this.panels.clear();
    }
}

export class BranchFlowProvider implements vscode.CustomEditorProvider<FlowDocument>, vscode.Disposable {
    private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentContentChangeEvent<FlowDocument>>();
    readonly onDidChangeCustomDocument = this.changed.event;
    private readonly persistence = new GraphPersistenceService();
    private readonly seeds = new Map<string, BranchGraph>();
    private readonly documents = new Set<FlowDocument>();
    constructor(private readonly services: ExtensionServices) {}
    register(): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(VIEW_TYPE, this, { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: false });
    }
    async openNew(seed?: BranchGraph): Promise<void> {
        // An absolute untitled path is treated by VS Code as an associated destination and can bypass the filename prompt.
        const uri = vscode.Uri.from({ scheme: 'untitled', path: `Branch-Flow-${freshId().slice(0, 8)}.branchflow.json` });
        if (seed) { this.seeds.set(uri.toString(), seed); }
        await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    }
    async openCustomDocument(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext): Promise<FlowDocument> {
        let graph = this.seeds.get(uri.toString()) ?? emptyGraph(freshId());
        const imported = this.seeds.delete(uri.toString());
        if (!imported && !context.backupId && uri.scheme === 'untitled') { graph = { ...graph, repository: selectedRepository(this.services) ?? null }; }
        let stamp: string | undefined;
        if (context.backupId) {
            const bytes = await vscode.workspace.fs.readFile(vscode.Uri.parse(context.backupId));
            if (bytes.byteLength > 6 * 1024 * 1024) { throw new Error('Backup exceeds the recovery size limit.'); }
            const backup: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
            if (!backup || typeof backup !== 'object' || !('backupVersion' in backup) || backup.backupVersion !== 1 || !('graph' in backup)) { throw new Error('Unsupported Branch Flow recovery backup.'); }
            graph = validateGraph(backup.graph);
            stamp = 'stamp' in backup && typeof backup.stamp === 'string' && /^[a-f0-9]{64}$/.test(backup.stamp) ? backup.stamp : undefined;
        } else if (uri.scheme !== 'untitled') {
            const stored = await this.persistence.read(uri); graph = stored.graph; stamp = stored.stamp;
        } else if (context.untitledDocumentData) { graph = parseGraph(Buffer.from(context.untitledDocumentData).toString('utf8')); }
        // Imported/cached green is never displayed as current truth.
        graph = { ...graph, edges: graph.edges.map(e => ({ ...e, analysis: e.analysis ? { ...e.analysis, status: 'DRIFTED', verified: false,
            reasons: ['Saved evidence must be revalidated against Azure before it can be trusted.'] } : undefined })) };
        const doc = new FlowDocument(uri, graph); doc.stamp = stamp;
        doc.savedUri = uri.scheme === 'untitled' ? undefined : uri;
        doc.dirty = !!context.backupId || imported;
        if (context.backupId && doc.savedUri && await this.persistence.stamp(doc.savedUri) !== stamp) { doc.external = true; }
        try { doc.approvedOrganizations.add(configuredContext(this.services).organizationUrl); } catch { /* Settings needed. */ }
        this.documents.add(doc);
        doc.subscriptions.push({ dispose: () => this.documents.delete(doc) });
        this.watch(doc); this.configurePolling(doc);
        if (doc.savedUri) { await rememberGraph(this.services, doc.savedUri); }
        return doc;
    }
    async resolveCustomEditor(doc: FlowDocument, panel: vscode.WebviewPanel): Promise<void> {
        doc.panels.add(panel);
        const root = vscode.Uri.joinPath(this.services.context.extensionUri, 'media', 'branch-flow');
        panel.webview.options = { enableScripts: true, localResourceRoots: [root] };
        const nonce = getNonce(); const source = panel.webview.cspSource;
        panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src ${source}; style-src-attr 'unsafe-inline'; img-src ${source} data:; font-src ${source}; connect-src 'none'; base-uri 'none'; form-action 'none';">
<link rel="stylesheet" href="${panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'app.css'))}"><title>Branch Flow Manager</title></head><body><div id="root"></div><script nonce="${nonce}" src="${panel.webview.asWebviewUri(vscode.Uri.joinPath(root, 'app.js'))}"></script></body></html>`;
        // React Flow uses style attributes for positions; no inline style blocks or inline script execution are allowed.
        doc.subscriptions.push(panel.webview.onDidReceiveMessage(value => {
            const operation = value && typeof value === 'object' && typeof value.action === 'string' ? value.action : 'Graph action';
            void this.message(doc, value).catch(error => this.error(doc, error, operation));
        }), panel.onDidChangeViewState(() => { if (panel.visible) { this.scheduleRefresh(doc); } }),
        panel.onDidDispose(() => { doc.panels.delete(panel); if (!doc.panels.size) { doc.coordinator.cancel(); doc.running = false; } }),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('azureDevopsPr.branchFlow')) { this.configurePolling(doc); }
            if (event.affectsConfiguration('azureDevopsPr')) {
                this.cancel(doc); doc.service = undefined;
                if (event.affectsConfiguration('azureDevopsPr.orgHost')) {
                    doc.approvedOrganizations.clear();
                    try { doc.approvedOrganizations.add(configuredContext(this.services).organizationUrl); } catch { /* Configure first. */ }
                }
                this.scheduleRefresh(doc);
            }
        }), this.services.context.secrets.onDidChange(() => { this.cancel(doc); doc.service = undefined; this.scheduleRefresh(doc); }));
    }
    private send(doc: FlowDocument, message: ViewMessage): void {
        if (!doc.disposed) { for (const panel of doc.panels) { void panel.webview.postMessage(message); } }
    }
    private state(doc: FlowDocument): void {
        this.send(doc, { type: 'state', graph: doc.graph, revision: doc.revision, dirty: doc.dirty, external: doc.external,
            file: doc.savedUri?.fsPath, currentBranch: doc.currentBranch, recent: recentGraphs(this.services) });
    }
    private error(doc: FlowDocument, error: unknown, operation = 'Extension action'): void {
        if (error instanceof OperationCancelled || doc.disposed) { return; }
        this.send(doc, { type: 'error', operation, message: error instanceof Error ? error.message : 'Branch Flow action failed. Retry or reopen the graph.' });
    }
    private markChanged(doc: FlowDocument): void {
        doc.dirty = true; doc.revision++; this.changed.fire({ document: doc });
    }
    private async message(doc: FlowDocument, value: unknown): Promise<void> {
        const message = parseHostMessage(value);
        if (doc.disposed) { return; }
        if (message.type === 'ready') {
            if (!doc.initialized) {
                doc.initialized = true;
                if (!doc.graph.repository && doc.uri.scheme === 'untitled') { await this.inheritRepository(doc); }
                this.send(doc, { type: 'notice', message: doc.savedUri ? `Opened ${path.basename(doc.savedUri.fsPath)}.` : 'New graph ready.' });
            }
            this.state(doc); if (doc.dirty) { this.changed.fire({ document: doc }); }
            if (doc.graph.repository) { await this.refresh(doc); } return;
        }
        if (message.type === 'edit') {
            const graph = validateGraph(message.graph);
            if (graph.graphId !== doc.graph.graphId || JSON.stringify(graph.repository) !== JSON.stringify(doc.graph.repository)) {
                throw new Error('Change repository through Choose Repository. Cross-repository graphs are unsupported in V1.');
            }
            const previous = new Map(doc.graph.edges.map(e => [e.id, e]));
            const previousNodes = new Map(doc.graph.nodes.map(n => [n.id, n.branch]));
            graph.edges = graph.edges.map(e => {
                const old = previous.get(e.id);
                const same = old?.source === e.source && old.target === e.target && old.operation === e.operation &&
                    graph.nodes.every(n => n.id !== e.source && n.id !== e.target || previousNodes.get(n.id) === n.branch);
                return { ...e, analysis: same ? old?.analysis : undefined };
            });
            const topologyChanged = JSON.stringify(graph.nodes.map(n => [n.id, n.branch])) !== JSON.stringify(doc.graph.nodes.map(n => [n.id, n.branch])) ||
                JSON.stringify(graph.edges.map(e => [e.id, e.source, e.target, e.operation])) !== JSON.stringify(doc.graph.edges.map(e => [e.id, e.source, e.target, e.operation]));
            if (topologyChanged) {
                this.cancel(doc);
                graph.edges = graph.edges.map(e => ({ ...e, analysis: e.analysis?.status === 'ANALYZING' ? undefined : e.analysis }));
            }
            doc.graph = { ...graph, snapshot: doc.graph.snapshot }; this.markChanged(doc);
            this.send(doc, { type: 'meta', dirty: true, external: doc.external });
            if (topologyChanged) { this.scheduleRefresh(doc); }
            return;
        }
        if (message.type === 'edgeAction') {
            const edge = doc.graph.edges.find(e => e.id === message.edgeId);
            if (!edge || !doc.graph.repository) { throw new Error('Select an existing relationship first.'); }
            if (message.action === 'analyze') { await this.refresh(doc, true); return; }
            const context = doc.graph.repository; const client = await this.client(doc);
            const source = doc.graph.nodes.find(n => n.id === edge.source)!.branch;
            const target = doc.graph.nodes.find(n => n.id === edge.target)!.branch;
            const pr = await client.findPullRequest(context.repositoryId, source, target);
            if (message.action === 'details') {
                if (!pr) { throw new Error('No matching active PR exists.'); }
                const policies = context.projectId ? client.getPolicyEvaluations(context.projectId, pr.pullRequestId) : Promise.resolve(['Project ID unavailable; review policies in Azure DevOps.']);
                const results = await Promise.allSettled([policies, client.getPullRequestChanges(context.repositoryId, pr.pullRequestId)]);
                this.send(doc, { type: 'prDetails', edgeId: edge.id,
                    policyStatuses: results[0].status === 'fulfilled' ? results[0].value : ['Policy lookup unavailable; review in Azure DevOps.'],
                    changedFiles: results[1].status === 'fulfilled' ? results[1].value : ['Change list unavailable; review in Azure DevOps.'] }); return;
            }
            if (message.action === 'openPr' || pr) {
                if (!pr) { throw new Error('No matching active PR exists. Refresh the relationship.'); }
                await vscode.env.openExternal(vscode.Uri.parse(client.getPullRequestWebUrl(pr))); this.send(doc, { type: 'notice', message: `Opened PR #${pr.pullRequestId}.` }); return;
            }
            if (edge.operation !== 'merge-pr') { throw new Error('PR creation is available only for merge/PR relationships.'); }
            const panel = PRCreatorPanel.createOrShow(this.services, { context, sourceBranch: source, targetBranch: target });
            const listener = panel.onDidCreate(() => { this.scheduleRefresh(doc); listener.dispose(); });
            doc.subscriptions.push(listener); this.send(doc, { type: 'notice', message: 'PR Creator opened with editable branch selections.' }); return;
        }
        switch (message.action) {
            case 'new': await this.openNew(); break;
            case 'save': await vscode.commands.executeCommand(doc.savedUri ? 'workbench.action.files.save' : 'workbench.action.files.saveAs'); break;
            case 'saveAs': await vscode.commands.executeCommand('workbench.action.files.saveAs'); break;
            case 'open': case 'import': await this.pickOpen(message.action === 'import'); break;
            case 'recent': {
                const recent = recentGraphs(this.services);
                const pick = await vscode.window.showQuickPick(recent, { placeHolder: 'Open recent Branch Flow graph' });
                if (pick) { await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(pick), VIEW_TYPE); } break;
            }
            case 'export': {
                const uri = await vscode.window.showSaveDialog({ filters: { 'Branch Flow JSON': ['branchflow.json'] }, saveLabel: 'Export JSON' });
                if (uri) { const stamp = await this.persistence.stamp(uri); await this.persistence.write(uri, doc.graph, stamp); this.send(doc, { type: 'notice', message: `Exported ${path.basename(uri.fsPath)}.` }); } break;
            }
            case 'refresh': case 'analyze': await this.refresh(doc, true); break;
            case 'cancel': this.cancel(doc); this.state(doc); this.send(doc, { type: 'notice', message: 'Analysis cancelled.' }); break;
            case 'context': await this.chooseContext(doc); break;
            case 'settings': await vscode.commands.executeCommand('extension.openSettings'); break;
            case 'reloadExternal': await this.reload(doc); break;
            case 'keepLocal': this.send(doc, { type: 'notice', message: 'Your local graph is preserved. Use Save As; the changed file will not be overwritten.' }); break;
        }
    }
    async pickOpen(importing: boolean): Promise<void> {
        const files = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { 'Branch Flow JSON': importing ? ['json'] : ['branchflow.json', 'json'] } });
        if (!files?.[0]) { return; }
        if (importing) { const { graph } = await this.persistence.read(files[0]); await this.openNew({ ...graph, graphId: freshId() }); }
        else { await vscode.commands.executeCommand('vscode.openWith', files[0], VIEW_TYPE); }
    }
    private async inheritRepository(doc: FlowDocument): Promise<void> {
        // Use the PR Creator's remembered selection first; only auto-detect an unambiguous fallback.
        const remembered = selectedRepository(this.services);
        if (remembered) { doc.graph = { ...doc.graph, repository: remembered }; return; }
        try {
            const context = configuredContext(this.services); const client = await azureClient(this.services, context);
            const repositories = await client.listRepositories(); const name = getCurrentRepoName();
            const repository = repositories.find(repo => repo.name === name) ?? (repositories.length === 1 ? repositories[0] : undefined);
            if (repository) { doc.graph = { ...doc.graph, repository: { ...context, repositoryId: repository.id, repositoryName: repository.name, projectId: repository.project.id } }; }
        } catch { /* The empty state offers explicit setup if no connection/selection is available. */ }
    }
    private async client(doc: FlowDocument): Promise<AzureDevOpsClient> {
        const context = doc.graph.repository;
        if (!context) { throw new Error('Choose an Azure repository to begin.'); }
        if (!doc.approvedOrganizations.has(context.organizationUrl)) {
            throw new Error('This graph references an organization different from Settings. Choose Repository to explicitly authorize its context before the stored PAT can be used.');
        }
        return azureClient(this.services, context);
    }
    private async chooseContext(doc: FlowDocument): Promise<void> {
        const configured = (() => { try { return configuredContext(this.services); } catch { return undefined; } })();
        const organization = await vscode.window.showInputBox({ prompt: 'Azure organization HTTPS URL', value: doc.graph.repository?.organizationUrl ?? configured?.organizationUrl,
            validateInput: v => { try { safeOrganizationUrl(v); return undefined; } catch { return 'Enter a credential-free HTTPS organization URL.'; } } });
        if (!organization) { return; } const organizationUrl = safeOrganizationUrl(organization);
        const project = await vscode.window.showInputBox({ prompt: 'Azure project', value: doc.graph.repository?.project ?? configured?.project, validateInput: v => !v.trim() ? 'Project is required.' : undefined });
        if (!project) { return; }
        if (!doc.approvedOrganizations.has(organizationUrl)) {
            const action = await vscode.window.showWarningMessage(`Use the PAT from SecretStorage for ${organizationUrl}? Imported files cannot authorize credential use.`, { modal: true }, 'Use PAT');
            if (action !== 'Use PAT') { return; }
        }
        const client = await azureClient(this.services, { organizationUrl, project });
        const repos = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Loading Azure repositories…', cancellable: true }, (_progress, token) => {
            const abort = createAbortController();
            const subscription = token.onCancellationRequested(() => abort.abort());
            if (token.isCancellationRequested) { abort.abort(); }
            return client.listRepositories(abort.signal).finally(() => subscription.dispose());
        });
        const selected = await vscode.window.showQuickPick(repos.map(r => ({ label: r.name, repo: r })), { placeHolder: 'Choose one repository for this graph' });
        if (!selected) { return; }
        const context: RepositoryContext = { organizationUrl, project, repositoryId: selected.repo.id, repositoryName: selected.repo.name, projectId: selected.repo.project.id };
        if (doc.graph.nodes.length && JSON.stringify(context) !== JSON.stringify(doc.graph.repository)) {
            const action = await vscode.window.showWarningMessage('Changing repositories clears this graph. Save it first if you want to keep its nodes.', { modal: true }, 'Clear Graph');
            if (action !== 'Clear Graph') { return; }
        }
        this.cancel(doc); doc.service = undefined; doc.approvedOrganizations.add(organizationUrl);
        doc.graph = { ...emptyGraph(doc.graph.graphId), name: doc.graph.name, repository: context };
        this.markChanged(doc); this.state(doc); this.send(doc, { type: 'notice', message: `Repository changed to ${selected.repo.name}.` }); await this.refresh(doc);
    }
    private cancel(doc: FlowDocument): void {
        doc.requestGeneration++; doc.coordinator.cancel(); doc.running = false;
        doc.graph = { ...doc.graph, edges: doc.graph.edges.map(e => ({ ...e, analysis: e.analysis?.status === 'ANALYZING'
            ? { ...e.analysis, status: 'UNKNOWN', verified: false, reasons: ['Analysis cancelled. Revalidate to obtain current evidence.'] } : e.analysis })) };
        this.send(doc, { type: 'busy', value: false, label: '' });
    }
    private scheduleRefresh(doc: FlowDocument): void {
        if (doc.refreshTimer) { clearTimeout(doc.refreshTimer); }
        doc.refreshTimer = setTimeout(() => { if (!doc.disposed && doc.graph.repository && !doc.running) { void this.refresh(doc).catch(e => this.error(doc, e)); } }, 500);
    }
    private async refresh(doc: FlowDocument, notify = false): Promise<void> {
        if (doc.disposed || !doc.graph.repository) { return; }
        const generation = ++doc.requestGeneration;
        doc.coordinator.cancel();
        const client = await this.client(doc); const context = doc.graph.repository;
        if (generation !== doc.requestGeneration || doc.disposed) { return; }
        if (!doc.service) {
            let git: LocalGitAdapter | undefined;
            if (vscode.workspace.isTrusted && this.services.getConfig('branchFlow.localAnalysis', true)) {
                for (const folder of vscode.workspace.workspaceFolders ?? []) {
                    if (folder.uri.scheme !== 'file') { continue; }
                    const candidate = new LocalGitAdapter(folder.uri.fsPath);
                    try { if (await candidate.matches(context)) { git = candidate; doc.currentBranch = await candidate.currentBranch(); break; } } catch { /* No suitable clone in this folder. */ }
                }
            }
            if (generation !== doc.requestGeneration || doc.disposed) { return; }
            doc.service = new GraphValidationService({
                refs: signal => client.listBranchRefs(context.repositoryId, signal),
                activePrs: async signal => new Map((await client.listPullRequests(context.repositoryId, 'active', signal)).filter(pr => !pr.forkSource || pr.forkSource.repository.id === context.repositoryId).map(pr =>
                    [JSON.stringify([pr.sourceRefName.replace(/^refs\/heads\//, ''), pr.targetRefName.replace(/^refs\/heads\//, '')]), client.summary(pr)])),
                compare: async (source, target, signal) => {
                    const comparison = await client.compareCommits(context.repositoryId, source, target, signal);
                    return { ancestor: comparison.commonCommit ? comparison.commonCommit === source : undefined, outstandingCommits: comparison.behindCount };
                },
            }, git);
        }
        if (generation !== doc.requestGeneration || doc.disposed) { return; }
        doc.running = true; this.send(doc, { type: 'busy', value: true, label: 'Validating branches…' });
        try {
            const result = await doc.coordinator.run(doc.service, doc.graph, update => {
                if (update.refs) { doc.refs = update.refs; this.send(doc, { type: 'refs', refs: update.refs }); }
                if (update.edge) { doc.graph = { ...doc.graph, edges: doc.graph.edges.map(e => e.id === update.edge!.edgeId ? { ...e, analysis: update.edge } : e) }; }
                this.send(doc, { type: 'progress', completed: update.completed, total: update.total, edge: update.edge });
            });
            if (result && !doc.disposed && generation === doc.requestGeneration) {
                // Preserve positions/names/viewport edited during validation; topology edits cancel the run.
                doc.graph = { ...doc.graph, edges: result.edges, snapshot: result.snapshot };
                this.markChanged(doc); this.state(doc);
                if (notify) { this.send(doc, { type: 'notice', message: `Validated ${result.edges.length} relationships.` }); }
            }
        } catch (error) {
            if (generation !== doc.requestGeneration || doc.disposed) { return; }
            doc.graph = { ...doc.graph, edges: doc.graph.edges.map(e => ({ ...e, analysis: e.analysis ? { ...e.analysis, status: 'ERROR', verified: false,
                reasons: ['Remote validation failed. Retry after checking connectivity and permissions.'] } : undefined })) };
            this.state(doc); this.error(doc, error);
        } finally { if (generation === doc.requestGeneration) { doc.running = false; this.send(doc, { type: 'busy', value: false, label: '' }); } }
    }
    private configurePolling(doc: FlowDocument): void {
        if (doc.polling) { clearInterval(doc.polling); }
        const seconds = this.services.getConfig<number>('branchFlow.pollIntervalSeconds', 0);
        if (Number.isFinite(seconds) && seconds > 0) {
            doc.polling = setInterval(() => { if ([...doc.panels].some(p => p.visible) && !doc.running) { this.scheduleRefresh(doc); } }, Math.max(30, Math.min(3600, seconds)) * 1000);
        }
    }
    private watch(doc: FlowDocument): void {
        if (!doc.savedUri || doc.savedUri.scheme !== 'file') { return; }
        const uri = doc.savedUri;
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(path.dirname(uri.fsPath), '*'));
        let timer: ReturnType<typeof setTimeout> | undefined;
        const inspect = (changed: vscode.Uri): void => {
            if (changed.toString() !== uri.toString()) { return; }
            if (timer) { clearTimeout(timer); }
            timer = setTimeout(() => {
                void this.persistence.stamp(uri).then(stamp => {
                    if (stamp !== doc.stamp && !doc.disposed) { doc.external = true; this.send(doc, { type: 'meta', dirty: doc.dirty, external: true }); }
                }).catch(error => this.error(doc, error));
            }, 300);
        };
        doc.subscriptions.push(watcher, watcher.onDidChange(inspect), watcher.onDidCreate(inspect), watcher.onDidDelete(inspect),
            { dispose: () => { if (timer) { clearTimeout(timer); } } });
    }
    async saveCustomDocument(doc: FlowDocument): Promise<void> {
        try {
            if (!doc.savedUri) { throw new Error('Use Save As to choose a local .branchflow.json file.'); }
            await this.write(doc, doc.savedUri, doc.stamp);
        } catch (error) { this.error(doc, error, 'Save graph'); throw error; }
    }
    async saveCustomDocumentAs(doc: FlowDocument, destination: vscode.Uri): Promise<void> {
        try {
            if (!destination.path.endsWith('.branchflow.json')) { throw new Error('Use the .branchflow.json filename extension.'); }
            const expected = await this.persistence.stamp(destination);
            await this.write(doc, destination, expected);
        } catch (error) { this.error(doc, error, 'Save graph as'); throw error; }
    }
    private async write(doc: FlowDocument, destination: vscode.Uri, expected?: string): Promise<void> {
        const revision = doc.revision; const graph = doc.graph;
        const stamp = await this.persistence.write(destination, graph, expected);
        doc.stamp = stamp; doc.external = false;
        const different = destination.toString() !== doc.savedUri?.toString(); doc.savedUri = destination;
        if (different) { this.watch(doc); }
        if (revision === doc.revision) { doc.dirty = false; }
        else { setTimeout(() => { if (!doc.disposed && doc.dirty) { this.changed.fire({ document: doc }); } }, 0); }
        await rememberGraph(this.services, destination);
        this.send(doc, { type: 'notice', message: `Saved ${path.basename(destination.fsPath)}.` });
        this.state(doc);
    }
    async revertCustomDocument(doc: FlowDocument): Promise<void> { await this.reload(doc, false); }
    private async reload(doc: FlowDocument, confirm = true): Promise<void> {
        if (!doc.savedUri) { return; }
        if (confirm && doc.dirty && await vscode.window.showWarningMessage('Discard local graph edits and reload the file?', { modal: true }, 'Reload') !== 'Reload') { return; }
        const stored = await this.persistence.read(doc.savedUri);
        this.cancel(doc); doc.graph = stored.graph; doc.stamp = stored.stamp; doc.external = false; doc.dirty = false;
        doc.graph.edges = doc.graph.edges.map(e => ({ ...e, analysis: e.analysis ? { ...e.analysis, status: 'DRIFTED', verified: false } : undefined }));
        doc.service = undefined; doc.revision++; this.state(doc); this.scheduleRefresh(doc);
    }
    async backupCustomDocument(doc: FlowDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(context.destination, '..'));
        await vscode.workspace.fs.writeFile(context.destination, Buffer.from(JSON.stringify({ backupVersion: 1, graph: JSON.parse(serializeGraph(doc.graph)), stamp: doc.stamp })));
        return { id: context.destination.toString(), delete: async () => { try { await vscode.workspace.fs.delete(context.destination); } catch { /* Already removed. */ } } };
    }
    dispose(): void { this.changed.dispose(); this.documents.forEach(d => d.dispose()); this.documents.clear(); }
}
