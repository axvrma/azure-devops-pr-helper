import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import { createAIClientFromServices, getAIProviderLabel } from '../api/ai';
import { ExtensionServices, PRHistoryItem, WebviewMessage } from '../types';
import { COMMANDS, SECRET_KEYS, STATE_KEYS } from '../utils/constants';
import { getCurrentBranch, getCurrentRepoName } from '../utils/git';
import { getNonce } from '../utils/helpers';

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
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);
        this.setupMessageHandler(webviewView);

        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                void this.sendContext(webviewView);
            }
        });
    }

    private setupMessageHandler(webviewView: vscode.WebviewView): void {
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            switch (message.command) {
                case 'getContext':
                    await this.sendContext(webviewView);
                    break;

                case 'openSettings':
                    await vscode.commands.executeCommand(COMMANDS.OPEN_SETTINGS);
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
                        await vscode.env.openExternal(vscode.Uri.parse(message.url));
                    }
                    break;

                case 'clearHistory':
                    await this.services.setState(STATE_KEYS.PR_HISTORY, []);
                    webviewView.webview.postMessage({ command: 'historyUpdated', data: [] });
                    break;
            }
        });
    }

    private async sendContext(webviewView: vscode.WebviewView): Promise<void> {
        const hasAzure = !!(await this.services.getSecret(SECRET_KEYS.AZURE_PAT));
        const { client, provider } = await createAIClientFromServices(this.services);
        const branch = getCurrentBranch() ?? '';
        const repo = getCurrentRepoName() ?? '';
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
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PR Helper</title>
    <style>
        * { box-sizing: border-box; }

        body {
            font-family: var(--vscode-font-family);
            padding: 12px;
            color: var(--vscode-foreground);
            font-size: 13px;
        }

        .context-info {
            background: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 12px;
        }

        .context-row {
            display: flex;
            align-items: center;
            gap: 6px;
            margin-bottom: 4px;
        }

        .context-row:last-child { margin-bottom: 0; }

        .context-label {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            min-width: 50px;
        }

        .context-value {
            font-weight: 500;
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            flex-shrink: 0;
        }

        .status-ok { background: var(--vscode-testing-iconPassed); }
        .status-warning { background: var(--vscode-inputValidation-warningBackground); }

        button {
            padding: 6px 10px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-family: inherit;
            font-size: 12px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 4px;
        }

        button:hover { opacity: 0.9; }

        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .quick-actions {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .quick-action {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 10px;
            background: var(--vscode-list-hoverBackground);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
        }

        .quick-action:hover { background: var(--vscode-list-activeSelectionBackground); }

        .quick-action.primary-action {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .quick-action.primary-action:hover { opacity: 0.9; }

        .quick-action.primary-action .quick-action-desc {
            color: var(--vscode-button-foreground);
            opacity: 0.8;
        }

        .quick-action-icon { font-size: 16px; }
        .quick-action-text { flex: 1; min-width: 0; }
        .quick-action-title { font-weight: 500; }

        .quick-action-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
        }

        .warning-banner {
            background: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
            padding: 8px 10px;
            border-radius: 4px;
            margin-bottom: 12px;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .warning-banner button {
            margin-left: auto;
            background: transparent;
            border: 1px solid currentColor;
            color: inherit;
            padding: 4px 8px;
            font-size: 11px;
        }

        .history-section {
            margin-top: 16px;
            padding-top: 14px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 10px;
        }

        .history-title {
            margin: 0;
            font-size: 14px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .pr-card {
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 10px;
            margin-bottom: 8px;
        }

        .pr-card:hover { border-color: var(--vscode-focusBorder); }
        .pr-card:last-child { margin-bottom: 0; }

        .pr-card-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 6px;
        }

        .pr-card-title {
            min-width: 0;
            font-size: 12px;
            font-weight: 600;
            line-height: 1.35;
            word-break: break-word;
        }

        .pr-card-id {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            white-space: nowrap;
        }

        .pr-card-description {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            line-height: 1.35;
            margin-bottom: 8px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .pr-card-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 5px;
            margin-bottom: 8px;
        }

        .pr-card-tag {
            max-width: 100%;
            padding: 2px 6px;
            border-radius: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            font-size: 10px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .pr-card-tag.branch {
            background: var(--vscode-textLink-foreground);
            color: var(--vscode-button-foreground);
        }

        .pr-card-actions {
            display: flex;
            gap: 6px;
        }

        .pr-card-actions button { flex: 1; }

        .empty-state {
            padding: 24px 10px;
            text-align: center;
            color: var(--vscode-descriptionForeground);
        }

        .empty-state-icon {
            font-size: 30px;
            margin-bottom: 8px;
        }

        .empty-state-text {
            font-size: 12px;
            line-height: 1.4;
        }

        .toast {
            position: fixed;
            right: 12px;
            bottom: 12px;
            max-width: calc(100% - 24px);
            padding: 8px 12px;
            border-radius: 4px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            font-size: 12px;
            z-index: 10;
        }

        .hidden { display: none !important; }
    </style>
</head>
<body>
    <div class="context-info">
        <div class="context-row">
            <span class="context-label">Branch:</span>
            <span class="context-value" id="branchName">Detecting...</span>
        </div>
        <div class="context-row">
            <span class="context-label">Repo:</span>
            <span class="context-value" id="repoName">Detecting...</span>
        </div>
        <div class="context-row">
            <span class="status-dot" id="azureStatus"></span>
            <span class="context-label">Azure</span>
            <span class="status-dot" id="aiStatus"></span>
            <span class="context-label" id="aiStatusLabel">AI</span>
        </div>
    </div>

    <div id="warningBanner" class="warning-banner hidden">
        <span>⚠️</span>
        <span>Azure PAT not configured</span>
        <button id="openSettingsFromWarning" type="button">Settings</button>
    </div>

    <div class="quick-actions">
        <div class="quick-action primary-action" id="openPRCreatorAction">
            <span class="quick-action-icon">🚀</span>
            <div class="quick-action-text">
                <div class="quick-action-title">Create Pull Request</div>
                <div class="quick-action-desc">Open full PR creation page</div>
            </div>
        </div>
    </div>

    <section class="history-section" aria-labelledby="recentPRsTitle">
        <div class="history-header">
            <h2 class="history-title" id="recentPRsTitle"><span>📋</span> Recent PRs</h2>
            <button class="btn-secondary" id="clearHistoryBtn" type="button">Clear All</button>
        </div>
        <div id="prHistoryList">
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <div class="empty-state-text">No PRs created yet.<br>Create your first PR!</div>
            </div>
        </div>
    </section>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();

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

        function renderPRHistory(history) {
            if (!history || history.length === 0) {
                elements.prHistoryList.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-text">No PRs created yet.<br>Create your first PR!</div>
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
                            \${workItems.length > 0 ? \`<span class="pr-card-tag">🔗 \${workItems.map(escapeHtml).join(', ')}</span>\` : ''}
                        </div>
                        <div class="pr-card-actions">
                            <button class="btn-primary pr-open-btn" type="button">🔗 Open</button>
                            <button class="btn-secondary pr-copy-btn" type="button">📋 Copy URL</button>
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
                    elements.branchName.textContent = ctx.branch || 'Not detected';
                    elements.repoName.textContent = ctx.repo || 'Not detected';
                    elements.azureStatus.className = 'status-dot ' + (ctx.hasAzure ? 'status-ok' : 'status-warning');
                    elements.aiStatus.className = 'status-dot ' + (ctx.hasAI ? 'status-ok' : 'status-warning');
                    elements.aiStatusLabel.textContent = ctx.aiProviderLabel || 'AI';
                    elements.warningBanner.classList.toggle('hidden', ctx.hasAzure);
                    renderPRHistory(ctx.prHistory);
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
