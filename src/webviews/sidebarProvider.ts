import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import { createAIClientFromServices, getAIProviderLabel } from '../api/ai';
import { ExtensionServices, PRHistoryItem, WebviewMessage } from '../types';
import { COMMANDS, SECRET_KEYS, STATE_KEYS } from '../utils/constants';
import { getCurrentBranch, getCurrentRepoName } from '../utils/git';
import { getNonce } from '../utils/helpers';
import { safeAzureLink } from '../utils/urls';
import { configuredContext } from '../services/pullRequestService';
import { onWorkspaceContextChanged, recentGraphs, selectedRepository } from '../services/workspaceContext';
import * as path from 'path';
import { uiIcon, uiResourceRoot, uiStylesUri } from './ui';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'prHelperSidebarView';

    constructor(private readonly services: ExtensionServices) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _context: vscode.WebviewViewResolveContext,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _token: vscode.CancellationToken
    ): void {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [uiResourceRoot(this.services.context)],
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);
        this.setupMessageHandler(webviewView);

        const subscription = onWorkspaceContextChanged(() => { if (webviewView.visible) { void this.sendContext(webviewView); } });
        webviewView.onDidDispose(() => subscription.dispose());
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                void this.sendContext(webviewView);
            }
        });
    }

    private setupMessageHandler(webviewView: vscode.WebviewView): void {
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            if (!message || typeof message.command !== 'string') { return; }
            try {
            switch (message.command) {
                case 'getContext':
                    await this.sendContext(webviewView);
                    break;

                case 'openSettings':
                    await vscode.commands.executeCommand(COMMANDS.OPEN_SETTINGS);
                    break;

                case 'openBranchFlow':
                    await vscode.commands.executeCommand('extension.openBranchFlow');
                    break;

                case 'openGraph': {
                    const index = message.data?.index;
                    if (typeof index !== 'number' || !Number.isInteger(index)) { return; }
                    const file = recentGraphs(this.services)[index];
                    if (file) { await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(file), 'azureDevopsPr.branchFlow'); }
                    break;
                }

                case 'openGraphPicker':
                    await vscode.commands.executeCommand('extension.openBranchFlowFile');
                    break;

                case 'openPRCreator':
                    await vscode.commands.executeCommand('extension.openPRCreator');
                    break;

                case 'copyUrl':
                    if (message.url) {
                        await vscode.env.clipboard.writeText(message.url);
                        vscode.window.showInformationMessage('PR URL copied to clipboard');
                        this.services.analytics.track(AnalyticsEvents.PR_URL_COPIED, {
                            source: 'sidebar',
                        });
                    }
                    break;

                case 'openUrl':
                    if (message.url) {
                        const url = safeAzureLink(message.url, configuredContext(this.services).organizationUrl);
                        if (url) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
                    }
                    break;

                case 'clearHistory':
                    await this.services.setState(STATE_KEYS.PR_HISTORY, []);
                    webviewView.webview.postMessage({ command: 'historyUpdated', data: [] });
                    break;
            }
            } catch { vscode.window.showErrorMessage('PR Helper action failed. Check Settings and retry.'); }
        });
    }

    private async sendContext(webviewView: vscode.WebviewView): Promise<void> {
        const hasAzure = !!(await this.services.getSecret(SECRET_KEYS.AZURE_PAT));
        const { client, provider } = await createAIClientFromServices(this.services);
        const branch = getCurrentBranch() ?? '';
        const repo = selectedRepository(this.services)?.repositoryName ?? getCurrentRepoName() ?? '';
        const prHistory = this.services.getState<PRHistoryItem[]>(STATE_KEYS.PR_HISTORY) || [];

        await webviewView.webview.postMessage({
            command: 'context',
            data: {
                hasAzure,
                hasAI: !!client,
                aiProviderLabel: getAIProviderLabel(provider),
                branch,
                repo,
                prHistory,
                recentGraphs: recentGraphs(this.services).map(file => ({ name: path.basename(file), path: file })),
            },
        });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private getHtml(webview: vscode.Webview): string {
        const nonce = getNonce();

        return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PR Helper</title>
    <link rel="stylesheet" href="${uiStylesUri(webview, this.services.context)}">
</head>
<body class="prh-sidebar">
    <details class="drawer-section" id="prHelperSection" open>
    <summary>PR Helper</summary>
    <div class="drawer-content">
    <div class="context-info">
        <div class="context-row">
            <span class="context-label">Branch</span>
            <span class="context-value" id="branchName">Detecting...</span>
        </div>
        <div class="context-row">
            <span class="context-label">Repository</span>
            <span class="context-value" id="repoName">Detecting...</span>
        </div>
        <div class="connection-statuses">
            <span class="connection-status"><span class="status-dot" id="azureStatus"></span><span>Azure</span><span class="connection-state" id="azureState">Checking</span></span>
            <span class="connection-status"><span class="status-dot" id="aiStatus"></span><span id="aiStatusLabel">AI</span><span class="connection-state" id="aiState">Optional</span></span>
        </div>
    </div>

    <div id="warningBanner" class="warning-banner hidden">
        <span>Azure connection needs a PAT.</span>
        <button id="openSettingsFromWarning" type="button">Settings</button>
    </div>

    <div class="quick-actions">
        <button type="button" class="btn-primary primary-action" id="openPRCreatorAction">
            ${uiIcon('pullRequest')}<span>Create pull request</span>
        </button>
    </div>

    <section class="history-section" aria-labelledby="recentPRsTitle">
        <div class="history-header">
            <h2 class="history-title" id="recentPRsTitle">Recent pull requests <span class="list-count" id="prCount">0</span></h2>
            <button class="btn-quiet" id="clearHistoryBtn" type="button" disabled title="Clear pull request history">Clear</button>
        </div>
        <div id="prHistoryList">
            <div class="empty-state">
                <div class="empty-state-text"><strong>No pull requests yet</strong>Created pull requests will appear here.</div>
            </div>
        </div>
    </section>

    </div></details>
    <details class="drawer-section" id="branchFlowSection" open>
        <summary>Branch Flow</summary>
        <div class="drawer-content">
            <div class="flow-actions"><button id="openBranchFlow" class="btn-secondary" type="button">${uiIcon('plus')}New graph</button><button id="openGraphPicker" class="btn-secondary" type="button">${uiIcon('folder')}Open graph</button></div>
            <div class="list-heading"><h2 class="history-title">Recent graphs</h2><span class="list-count" id="graphCount">0</span></div>
            <ul id="recentGraphs" aria-label="Recently opened Branch Flow files"></ul>
        </div>
    </details>
    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        document.getElementById('openGraphPicker').addEventListener('click', () => vscode.postMessage({ command: 'openGraphPicker' }));
        const drawerState = vscode.getState?.() || {};
        for (const id of ['prHelperSection', 'branchFlowSection']) {
            const section = document.getElementById(id);
            section.open = drawerState[id] !== false;
            section.addEventListener('toggle', () => { drawerState[id] = section.open; vscode.setState?.(drawerState); });
        }
        document.getElementById('openBranchFlow').addEventListener('click', () => vscode.postMessage({ command: 'openBranchFlow' }));

        const elements = {
            branchName: document.getElementById('branchName'),
            repoName: document.getElementById('repoName'),
            azureStatus: document.getElementById('azureStatus'),
            aiStatus: document.getElementById('aiStatus'),
            aiStatusLabel: document.getElementById('aiStatusLabel'),
            warningBanner: document.getElementById('warningBanner'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
            prHistoryList: document.getElementById('prHistoryList'),
        };

        document.getElementById('openSettingsFromWarning').addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });

        document.getElementById('openPRCreatorAction').addEventListener('click', () => {
            vscode.postMessage({ command: 'openPRCreator' });
        });

        elements.clearHistoryBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'clearHistory' });
        });

        function renderRecentGraphs(files) {
            const list = document.getElementById('recentGraphs');
            list.replaceChildren();
            document.getElementById('graphCount').textContent = String(files?.length || 0);
            if (!files?.length) { const empty = document.createElement('li'); empty.textContent = 'No graphs opened yet. Open a file or save your first graph.'; empty.className = 'empty-recent'; list.appendChild(empty); return; }
            files.forEach((file, index) => {
                const item = document.createElement('li'); const button = document.createElement('button');
                button.type = 'button'; button.title = file.path; button.className = 'graph-file';
                const icon = document.createElement('span'); icon.className = 'file-icon'; icon.innerHTML = '${uiIcon('file')}';
                const text = document.createElement('span'); text.className = 'file-text';
                const name = document.createElement('strong'); name.textContent = file.name.replace(/\\.branchflow\\.json$/, '');
                const location = document.createElement('small'); location.textContent = file.path;
                text.append(name, location); button.append(icon, text); button.addEventListener('click', () => vscode.postMessage({ command: 'openGraph', data: { index } }));
                item.appendChild(button); list.appendChild(item);
            });
        }
        function renderPRHistory(history) {
            document.getElementById('prCount').textContent = String(history?.length || 0);
            elements.clearHistoryBtn.disabled = !history?.length;
            if (!history || history.length === 0) {
                elements.prHistoryList.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-text"><strong>No pull requests yet</strong>Created pull requests will appear here.</div>
                    </div>
                \`;
                return;
            }

            elements.prHistoryList.innerHTML = history.map(pr => {
                const date = new Date(pr.createdAt).toLocaleDateString();
                const workItems = Array.isArray(pr.workItems) ? pr.workItems : [];

                return \`
                    <div class="pr-card" data-pr-url="\${encodeURIComponent(pr.url)}">
                        <div class="pr-card-header">
                            <div class="pr-card-title">\${escapeHtml(pr.title)}</div>
                            <div class="pr-card-id">#\${pr.id}</div>
                        </div>
                        \${pr.description ? \`<div class="pr-card-description">\${escapeHtml(pr.description)}</div>\` : ''}
                        <div class="pr-card-meta">
                            <span class="pr-card-tag branch">\${escapeHtml(pr.sourceBranch)} → \${escapeHtml(pr.targetBranch)}</span>
                            <span class="pr-card-tag">\${escapeHtml(pr.repository)}</span>
                            <span class="pr-card-tag">\${date}</span>
                            \${workItems.length > 0 ? \`<span class="pr-card-tag">\${workItems.map(escapeHtml).join(', ')}</span>\` : ''}
                        </div>
                        <div class="pr-card-actions">
                            <button class="btn-primary pr-open-btn" type="button">Open PR</button>
                            <button class="btn-secondary pr-copy-btn" type="button">Copy URL</button>
                        </div>
                    </div>
                \`;
            }).join('');
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = String(text ?? '');
            return div.innerHTML;
        }

        function showToast(message) {
            document.querySelector('.toast')?.remove();
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 2500);
        }

        elements.prHistoryList.addEventListener('click', event => {
            const button = event.target.closest('button');
            const card = event.target.closest('.pr-card');
            if (!button || !card?.dataset.prUrl) return;

            const url = decodeURIComponent(card.dataset.prUrl);
            if (button.classList.contains('pr-open-btn')) {
                vscode.postMessage({ command: 'openUrl', url });
            } else if (button.classList.contains('pr-copy-btn')) {
                vscode.postMessage({ command: 'copyUrl', url });
                showToast('URL copied to clipboard');
            }
        });

        window.addEventListener('message', event => {
            const msg = event.data;

            switch (msg.command) {
                case 'context': {
                    const ctx = msg.data;
                    elements.branchName.textContent = ctx.branch || 'Not detected'; elements.branchName.title = ctx.branch || '';
                    elements.repoName.textContent = ctx.repo || 'Not detected'; elements.repoName.title = ctx.repo || '';
                    elements.azureStatus.title = ctx.hasAzure ? 'PAT stored. Test the connection in Settings.' : 'Azure PAT is not configured.';
                    elements.azureStatus.className = 'status-dot ' + (ctx.hasAzure ? 'status-ok' : 'status-warning');
                    elements.aiStatus.className = 'status-dot ' + (ctx.hasAI ? 'status-ok' : 'status-optional');
                    document.getElementById('azureState').textContent = ctx.hasAzure ? 'Configured' : 'Not configured';
                    document.getElementById('aiState').textContent = ctx.hasAI ? 'Configured' : 'Optional';
                    elements.aiStatusLabel.textContent = ctx.aiProviderLabel || 'AI';
                    elements.warningBanner.classList.toggle('hidden', ctx.hasAzure);
                    renderPRHistory(ctx.prHistory);
                    renderRecentGraphs(ctx.recentGraphs);
                    break;
                }

                case 'historyUpdated':
                    renderPRHistory(msg.data);
                    showToast('History cleared');
                    break;
            }
        });

        window.addEventListener('focus', () => {
            vscode.postMessage({ command: 'getContext' });
        });

        vscode.postMessage({ command: 'getContext' });
    </script>
</body>
</html>
`;
    }
}
