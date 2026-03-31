import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import { AzureDevOpsClient } from '../api/azureDevOps';
import { ClaudeClient } from '../api/claude';
import { AzureRepository, ExtensionServices } from '../types';
import { CONFIG_KEYS, DEFAULT_CONFIG, SECRET_KEYS, STATE_KEYS } from '../utils/constants';
import { getCurrentBranch, getCurrentRepoName } from '../utils/git';
import { getNonce, parseWorkItemIds } from '../utils/helpers';

interface PRHistoryItem {
    id: number;
    title: string;
    description: string;
    url: string;
    sourceBranch: string;
    targetBranch: string;
    repository: string;
    createdAt: string;
    workItems: string[];
}

const PR_HISTORY_KEY = 'prHistory';
const MAX_PR_HISTORY = 10;

export class PRCreatorPanel {
    public static currentPanel: PRCreatorPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly services: ExtensionServices;
    private disposables: vscode.Disposable[] = [];
    private repositories: AzureRepository[] = [];

    private constructor(panel: vscode.WebviewPanel, services: ExtensionServices) {
        this.panel = panel;
        this.services = services;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.setupMessageHandler();
    }

    public static createOrShow(services: ExtensionServices): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (PRCreatorPanel.currentPanel) {
            PRCreatorPanel.currentPanel.panel.reveal(column);
            PRCreatorPanel.currentPanel.refreshData();
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'prCreator',
            'Create Pull Request',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        PRCreatorPanel.currentPanel = new PRCreatorPanel(panel, services);

        // Track PR creator panel opened
        services.analytics.track(AnalyticsEvents.PR_CREATOR_OPENED);
    }

    private dispose(): void {
        PRCreatorPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private async refreshData(): Promise<void> {
        await this.sendInitialData();
    }

    private setupMessageHandler(): void {
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'getInitialData':
                        await this.sendInitialData();
                        break;
                    case 'loadRepositories':
                        await this.loadRepositories();
                        break;
                    case 'generateAI':
                        await this.generateAIContent(message.branch, message.repo);
                        break;
                    case 'createPR':
                        await this.createPullRequest(message.data);
                        break;
                    case 'copyUrl':
                        await vscode.env.clipboard.writeText(message.url);
                        vscode.window.showInformationMessage('PR URL copied to clipboard');
                        this.services.analytics.track(AnalyticsEvents.PR_URL_COPIED, {
                            source: 'panel',
                        });
                        break;
                    case 'openUrl':
                        vscode.env.openExternal(vscode.Uri.parse(message.url));
                        break;
                    case 'openSettings':
                        vscode.commands.executeCommand('extension.openSettings');
                        break;
                    case 'deletePRFromHistory':
                        await this.deletePRFromHistory(message.id);
                        break;
                    case 'clearHistory':
                        await this.clearPRHistory();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    private postMessage(message: unknown): void {
        this.panel.webview.postMessage(message);
    }

    private async sendInitialData(): Promise<void> {
        const hasAzurePAT = !!(await this.services.getSecret(SECRET_KEYS.AZURE_PAT));
        const hasClaudeToken = !!(await this.services.getSecret(SECRET_KEYS.CLAUDE_TOKEN));
        const currentBranch = getCurrentBranch() || '';
        const currentRepo = getCurrentRepoName() || '';
        const useAI = this.services.getConfig(CONFIG_KEYS.USE_AI, DEFAULT_CONFIG.useAI);
        const generateDescription = this.services.getConfig(CONFIG_KEYS.GENERATE_DESCRIPTION, DEFAULT_CONFIG.generateDescription);
        const prHistory = this.services.getState<PRHistoryItem[]>(PR_HISTORY_KEY) || [];

        this.postMessage({
            command: 'initialData',
            data: {
                hasAzurePAT,
                hasClaudeToken,
                currentBranch,
                currentRepo,
                useAI,
                generateDescription,
                prHistory,
                repositories: this.repositories.map(r => ({ id: r.id, name: r.name })),
            }
        });
    }

    private async loadRepositories(): Promise<void> {
        const pat = await this.services.getSecret(SECRET_KEYS.AZURE_PAT);
        if (!pat) {
            this.postMessage({ command: 'error', message: 'Azure PAT not configured. Open Settings to configure.' });
            return;
        }

        const orgUrl = this.services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost);
        const project = this.services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project);
        const apiVersion = this.services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion);

        if (orgUrl === DEFAULT_CONFIG.orgHost || project === DEFAULT_CONFIG.project) {
            this.postMessage({ command: 'error', message: 'Azure DevOps not configured. Open Settings to configure org and project.' });
            return;
        }

        try {
            const client = new AzureDevOpsClient(orgUrl, project, pat, apiVersion);
            this.repositories = await client.listRepositories();
            
            const currentRepo = getCurrentRepoName();
            let selectedRepoId = '';
            
            if (currentRepo) {
                const match = this.repositories.find(r => r.name === currentRepo);
                if (match) {
                    selectedRepoId = match.id;
                }
            }

            this.postMessage({
                command: 'repositoriesLoaded',
                data: {
                    repositories: this.repositories.map(r => ({ id: r.id, name: r.name })),
                    selectedRepoId,
                }
            });

            // Track repositories loaded
            this.services.analytics.track(AnalyticsEvents.REPOSITORIES_LOADED, {
                count: this.repositories.length,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.postMessage({ command: 'error', message: `Failed to load repositories: ${message}` });
        }
    }

    private async generateAIContent(branch: string, repo: string): Promise<void> {
        const claudeToken = await this.services.getSecret(SECRET_KEYS.CLAUDE_TOKEN);
        if (!claudeToken) {
            this.postMessage({ command: 'aiGenerated', data: { error: 'Claude token not configured' } });
            return;
        }

        const claudeModel = this.services.getConfig(CONFIG_KEYS.CLAUDE_MODEL, DEFAULT_CONFIG.claudeModel);
        const claudeMaxTokens = this.services.getConfig(CONFIG_KEYS.CLAUDE_MAX_TOKENS, DEFAULT_CONFIG.claudeMaxTokens);
        const claudeTemperature = this.services.getConfig(CONFIG_KEYS.CLAUDE_TEMPERATURE, DEFAULT_CONFIG.claudeTemperature);
        const generateDescription = this.services.getConfig(CONFIG_KEYS.GENERATE_DESCRIPTION, DEFAULT_CONFIG.generateDescription);

        try {
            const client = new ClaudeClient({
                apiKey: claudeToken,
                model: claudeModel,
                maxTokens: claudeMaxTokens,
                temperature: claudeTemperature,
            });

            const titleResult = await client.generatePRTitle(branch, repo);
            let description = '';

            if (generateDescription) {
                const descResult = await client.generatePRDescription(branch, repo);
                if (descResult.title && !descResult.error) {
                    description = descResult.title;
                }
            }

            this.postMessage({
                command: 'aiGenerated',
                data: {
                    title: titleResult.title || '',
                    description,
                    error: titleResult.error,
                }
            });

            // Track AI generation success
            if (titleResult.title && !titleResult.error) {
                this.services.analytics.track(AnalyticsEvents.AI_TITLE_GENERATED, {
                    model: claudeModel,
                    has_custom_prompt: false,
                    has_diff: false,
                });
            } else if (titleResult.error) {
                this.services.analytics.track(AnalyticsEvents.AI_TITLE_FAILED, {
                    error_type: titleResult.error,
                });
            }

            if (generateDescription && description) {
                this.services.analytics.track(AnalyticsEvents.AI_DESCRIPTION_GENERATED, {
                    model: claudeModel,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.postMessage({ command: 'aiGenerated', data: { error: message } });
            
            // Track AI generation failure
            this.services.analytics.track(AnalyticsEvents.AI_TITLE_FAILED, {
                error_type: message,
            });
        }
    }

    private async createPullRequest(data: {
        repositoryId: string;
        sourceBranch: string;
        targetBranch: string;
        title: string;
        description: string;
        workItems: string;
    }): Promise<void> {
        const pat = await this.services.getSecret(SECRET_KEYS.AZURE_PAT);
        if (!pat) {
            this.postMessage({ command: 'prCreateError', message: 'Azure PAT not configured' });
            return;
        }

        const orgUrl = this.services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost);
        const project = this.services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project);
        const apiVersion = this.services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion);

        try {
            const client = new AzureDevOpsClient(orgUrl, project, pat, apiVersion);
            
            const pr = await client.createPullRequest(data.repositoryId, {
                sourceRefName: `refs/heads/${data.sourceBranch}`,
                targetRefName: `refs/heads/${data.targetBranch}`,
                title: data.title,
                description: data.description,
            });

            const prUrl = client.getPullRequestWebUrl(pr);
            await this.services.setState(STATE_KEYS.LAST_PR_URL, prUrl);

            // Link work items
            const workItemIds = parseWorkItemIds(data.workItems);
            const linkedWorkItems: string[] = [];
            
            if (workItemIds.length > 0 && pr.artifactId) {
                for (const id of workItemIds) {
                    try {
                        await client.linkWorkItem(id, pr.artifactId);
                        linkedWorkItems.push(id);
                    } catch (err) {
                        console.error(`Failed to link work item ${id}:`, err);
                    }
                }
            }

            // Get repository name
            const repo = this.repositories.find(r => r.id === data.repositoryId);

            // Save to history
            const historyItem: PRHistoryItem = {
                id: pr.pullRequestId,
                title: data.title,
                description: data.description,
                url: prUrl,
                sourceBranch: data.sourceBranch,
                targetBranch: data.targetBranch,
                repository: repo?.name || 'Unknown',
                createdAt: new Date().toISOString(),
                workItems: linkedWorkItems,
            };

            await this.addToPRHistory(historyItem);

            this.postMessage({
                command: 'prCreated',
                data: historyItem,
            });

            vscode.window.showInformationMessage(`PR #${pr.pullRequestId} created successfully!`);

            // Track PR creation success
            this.services.analytics.track(AnalyticsEvents.PR_CREATED, {
                has_ai_title: false,
                has_ai_description: !!data.description,
                work_items_count: linkedWorkItems.length,
                repository: repo?.name,
            });

            // Track work items linked if any
            if (linkedWorkItems.length > 0) {
                this.services.analytics.track(AnalyticsEvents.WORK_ITEM_LINKED, {
                    count: linkedWorkItems.length,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.postMessage({ command: 'prCreateError', message });

            // Track PR creation failure
            this.services.analytics.track(AnalyticsEvents.PR_CREATION_FAILED, {
                error_type: message,
            });
        }
    }

    private async addToPRHistory(item: PRHistoryItem): Promise<void> {
        const history = this.services.getState<PRHistoryItem[]>(PR_HISTORY_KEY) || [];
        history.unshift(item);
        
        // Keep only last N items
        if (history.length > MAX_PR_HISTORY) {
            history.splice(MAX_PR_HISTORY);
        }
        
        await this.services.setState(PR_HISTORY_KEY, history);
    }

    private async deletePRFromHistory(prId: number): Promise<void> {
        const history = this.services.getState<PRHistoryItem[]>(PR_HISTORY_KEY) || [];
        const filtered = history.filter(item => item.id !== prId);
        await this.services.setState(PR_HISTORY_KEY, filtered);
        this.postMessage({ command: 'historyUpdated', data: filtered });
    }

    private async clearPRHistory(): Promise<void> {
        await this.services.setState(PR_HISTORY_KEY, []);
        this.postMessage({ command: 'historyUpdated', data: [] });
    }

    private getHtml(): string {
        const nonce = getNonce();

        return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Create Pull Request</title>
    <style>
        :root {
            --card-bg: var(--vscode-editor-background);
            --card-border: var(--vscode-panel-border);
            --success-bg: var(--vscode-testing-iconPassed);
            --error-bg: var(--vscode-inputValidation-errorBackground);
        }
        
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font-family);
            padding: 0;
            margin: 0;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        
        .container {
            max-width: 900px;
            margin: 0 auto;
            padding: 24px;
        }
        
        .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .header h1 {
            font-size: 24px;
            font-weight: 600;
            margin: 0;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        .header-actions {
            display: flex;
            gap: 8px;
        }
        
        .status-indicators {
            display: flex;
            gap: 16px;
            margin-bottom: 20px;
        }
        
        .status-item {
            display: flex;
            align-items: center;
            gap: 6px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        
        .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        
        .status-dot.ok { background: var(--vscode-testing-iconPassed); }
        .status-dot.warning { background: var(--vscode-inputValidation-warningBackground); }
        
        .main-content {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 24px;
        }
        
        @media (max-width: 800px) {
            .main-content {
                grid-template-columns: 1fr;
            }
        }
        
        .form-section {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
        }
        
        .section-title {
            font-size: 16px;
            font-weight: 600;
            margin: 0 0 16px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-group:last-child {
            margin-bottom: 0;
        }
        
        label {
            display: block;
            font-size: 13px;
            font-weight: 500;
            margin-bottom: 6px;
        }
        
        .label-hint {
            font-weight: normal;
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
        }
        
        input, select, textarea {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 13px;
            font-family: inherit;
        }
        
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        textarea {
            min-height: 80px;
            resize: vertical;
        }
        
        .input-with-button {
            display: flex;
            gap: 8px;
        }
        
        .input-with-button input,
        .input-with-button select {
            flex: 1;
        }
        
        button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            transition: opacity 0.2s;
        }
        
        button:hover { opacity: 0.9; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-small {
            padding: 6px 10px;
            font-size: 12px;
        }
        
        .btn-icon {
            padding: 6px 8px;
            min-width: 32px;
        }
        
        .btn-success {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        
        .submit-section {
            margin-top: 20px;
            padding-top: 16px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        
        .submit-btn {
            width: 100%;
            padding: 12px;
            font-size: 14px;
        }
        
        /* History Section */
        .history-section {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            max-height: 600px;
            overflow-y: auto;
        }
        
        .history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }
        
        .pr-card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 14px;
            margin-bottom: 12px;
            transition: border-color 0.2s;
        }
        
        .pr-card:hover {
            border-color: var(--vscode-focusBorder);
        }
        
        .pr-card:last-child {
            margin-bottom: 0;
        }
        
        .pr-card-header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 8px;
        }
        
        .pr-card-title {
            font-weight: 600;
            font-size: 14px;
            color: var(--vscode-foreground);
            word-break: break-word;
        }
        
        .pr-card-id {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            white-space: nowrap;
        }
        
        .pr-card-description {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 10px;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }
        
        .pr-card-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 12px;
        }
        
        .pr-card-tag {
            font-size: 11px;
            padding: 2px 8px;
            border-radius: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
        }
        
        .pr-card-tag.branch {
            background: var(--vscode-textLink-foreground);
            color: white;
        }
        
        .pr-card-actions {
            display: flex;
            gap: 8px;
        }
        
        .pr-card-actions button {
            flex: 1;
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        
        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 12px;
        }
        
        .empty-state-text {
            font-size: 14px;
        }
        
        /* Loading & Messages */
        .loading {
            display: inline-block;
            width: 14px;
            height: 14px;
            border: 2px solid transparent;
            border-top-color: currentColor;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .message {
            padding: 10px 14px;
            border-radius: 4px;
            margin-bottom: 16px;
            font-size: 13px;
        }
        
        .message.error {
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
        }
        
        .message.success {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        
        .hidden { display: none !important; }
        
        /* Success Animation */
        .success-card {
            background: linear-gradient(135deg, var(--vscode-testing-iconPassed), #2d8a4e);
            border: none;
            color: white;
            animation: slideIn 0.3s ease;
        }
        
        .success-card .pr-card-title,
        .success-card .pr-card-id,
        .success-card .pr-card-description {
            color: white;
        }
        
        .success-card .pr-card-tag {
            background: rgba(255,255,255,0.2);
            color: white;
        }
        
        @keyframes slideIn {
            from {
                transform: translateY(-10px);
                opacity: 0;
            }
            to {
                transform: translateY(0);
                opacity: 1;
            }
        }
        
        .new-badge {
            background: #ffd700;
            color: #000;
            font-size: 10px;
            padding: 2px 6px;
            border-radius: 3px;
            margin-left: 8px;
            font-weight: 600;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>
                <span>🚀</span>
                Create Pull Request
            </h1>
            <div class="header-actions">
                <button class="btn-secondary btn-small" id="settingsBtn" title="Open Settings">
                    ⚙️ Settings
                </button>
            </div>
        </div>
        
        <div class="status-indicators">
            <div class="status-item">
                <span class="status-dot" id="azureStatus"></span>
                <span>Azure DevOps</span>
            </div>
            <div class="status-item">
                <span class="status-dot" id="claudeStatus"></span>
                <span>Claude AI</span>
            </div>
            <div class="status-item" id="branchInfo">
                <span>📍</span>
                <span id="currentBranchDisplay">Detecting...</span>
            </div>
        </div>
        
        <div id="errorMessage" class="message error hidden"></div>
        
        <div class="main-content">
            <!-- Form Section -->
            <div class="form-section">
                <h2 class="section-title">
                    <span>📝</span>
                    PR Details
                </h2>
                
                <div class="form-group">
                    <label>Repository</label>
                    <div class="input-with-button">
                        <select id="repository" disabled>
                            <option value="">Loading repositories...</option>
                        </select>
                        <button class="btn-secondary btn-icon" id="refreshRepos" title="Refresh">🔄</button>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Source Branch <span class="label-hint">(your feature branch)</span></label>
                    <input type="text" id="sourceBranch" placeholder="feature/my-feature">
                </div>
                
                <div class="form-group">
                    <label>Target Branch <span class="label-hint">(merge into)</span></label>
                    <input type="text" id="targetBranch" placeholder="main">
                </div>
                
                <div class="form-group">
                    <label>Title</label>
                    <div class="input-with-button">
                        <input type="text" id="prTitle" placeholder="Enter PR title">
                        <button class="btn-secondary btn-small" id="generateAI" title="Generate with AI">
                            ✨ AI
                        </button>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Description <span class="label-hint">(optional)</span></label>
                    <textarea id="prDescription" placeholder="Describe your changes..."></textarea>
                </div>
                
                <div class="form-group">
                    <label>Work Items <span class="label-hint">(comma-separated IDs)</span></label>
                    <input type="text" id="workItems" placeholder="12345, 12346">
                </div>
                
                <div class="submit-section">
                    <button class="btn-primary submit-btn" id="createPRBtn">
                        <span id="createBtnText">🚀 Create Pull Request</span>
                        <span id="createBtnLoading" class="loading hidden"></span>
                    </button>
                </div>
            </div>
            
            <!-- History Section -->
            <div class="history-section">
                <div class="history-header">
                    <h2 class="section-title" style="margin-bottom: 0;">
                        <span>📋</span>
                        Recent PRs
                    </h2>
                    <button class="btn-secondary btn-small" id="clearHistoryBtn">Clear All</button>
                </div>
                
                <div id="prHistoryList">
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-text">No PRs created yet.<br>Create your first PR!</div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Elements
        const elements = {
            repository: document.getElementById('repository'),
            sourceBranch: document.getElementById('sourceBranch'),
            targetBranch: document.getElementById('targetBranch'),
            prTitle: document.getElementById('prTitle'),
            prDescription: document.getElementById('prDescription'),
            workItems: document.getElementById('workItems'),
            createPRBtn: document.getElementById('createPRBtn'),
            createBtnText: document.getElementById('createBtnText'),
            createBtnLoading: document.getElementById('createBtnLoading'),
            generateAI: document.getElementById('generateAI'),
            refreshRepos: document.getElementById('refreshRepos'),
            settingsBtn: document.getElementById('settingsBtn'),
            clearHistoryBtn: document.getElementById('clearHistoryBtn'),
            azureStatus: document.getElementById('azureStatus'),
            claudeStatus: document.getElementById('claudeStatus'),
            currentBranchDisplay: document.getElementById('currentBranchDisplay'),
            errorMessage: document.getElementById('errorMessage'),
            prHistoryList: document.getElementById('prHistoryList'),
        };
        
        let isCreating = false;
        let isGenerating = false;
        
        // Event Listeners
        elements.settingsBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });
        
        elements.refreshRepos.addEventListener('click', () => {
            elements.repository.innerHTML = '<option value="">Loading...</option>';
            elements.repository.disabled = true;
            vscode.postMessage({ command: 'loadRepositories' });
        });
        
        elements.generateAI.addEventListener('click', () => {
            if (isGenerating) return;
            
            isGenerating = true;
            elements.generateAI.disabled = true;
            elements.generateAI.innerHTML = '<span class="loading"></span>';
            
            vscode.postMessage({
                command: 'generateAI',
                branch: elements.sourceBranch.value || 'feature',
                repo: elements.repository.options[elements.repository.selectedIndex]?.text || 'repository'
            });
        });
        
        elements.createPRBtn.addEventListener('click', () => {
            if (isCreating) return;
            
            // Validation
            if (!elements.repository.value) {
                showError('Please select a repository');
                return;
            }
            if (!elements.sourceBranch.value) {
                showError('Please enter a source branch');
                return;
            }
            if (!elements.targetBranch.value) {
                showError('Please enter a target branch');
                return;
            }
            if (!elements.prTitle.value) {
                showError('Please enter a PR title');
                return;
            }
            
            isCreating = true;
            elements.createPRBtn.disabled = true;
            elements.createBtnText.classList.add('hidden');
            elements.createBtnLoading.classList.remove('hidden');
            hideError();
            
            vscode.postMessage({
                command: 'createPR',
                data: {
                    repositoryId: elements.repository.value,
                    sourceBranch: elements.sourceBranch.value,
                    targetBranch: elements.targetBranch.value,
                    title: elements.prTitle.value,
                    description: elements.prDescription.value,
                    workItems: elements.workItems.value,
                }
            });
        });
        
        elements.clearHistoryBtn.addEventListener('click', () => {
            // Note: confirm() doesn't work in webviews, so we clear directly
            // Could implement a custom modal if confirmation is needed
            vscode.postMessage({ command: 'clearHistory' });
        });
        
        // Helper Functions
        function showError(message) {
            elements.errorMessage.textContent = message;
            elements.errorMessage.classList.remove('hidden');
        }
        
        function hideError() {
            elements.errorMessage.classList.add('hidden');
        }
        
        function showToast(message) {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            toast.style.cssText = 'position: fixed; bottom: 20px; right: 20px; padding: 12px 20px; border-radius: 4px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 13px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 1000; animation: slideIn 0.3s ease;';
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
        
        function renderPRHistory(history, newPrId = null) {
            if (!history || history.length === 0) {
                elements.prHistoryList.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">📭</div>
                        <div class="empty-state-text">No PRs created yet.<br>Create your first PR!</div>
                    </div>
                \`;
                return;
            }
            
            elements.prHistoryList.innerHTML = history.map((pr, index) => {
                const isNew = pr.id === newPrId;
                const date = new Date(pr.createdAt).toLocaleDateString();
                
                return \`
                    <div class="pr-card \${isNew ? 'success-card' : ''}" data-pr-url="\${encodeURIComponent(pr.url)}">
                        <div class="pr-card-header">
                            <div class="pr-card-title">
                                \${escapeHtml(pr.title)}
                                \${isNew ? '<span class="new-badge">NEW</span>' : ''}
                            </div>
                            <div class="pr-card-id">#\${pr.id}</div>
                        </div>
                        \${pr.description ? \`<div class="pr-card-description">\${escapeHtml(pr.description)}</div>\` : ''}
                        <div class="pr-card-meta">
                            <span class="pr-card-tag branch">\${escapeHtml(pr.sourceBranch)} → \${escapeHtml(pr.targetBranch)}</span>
                            <span class="pr-card-tag">\${escapeHtml(pr.repository)}</span>
                            <span class="pr-card-tag">\${date}</span>
                            \${pr.workItems.length > 0 ? \`<span class="pr-card-tag">🔗 \${pr.workItems.join(', ')}</span>\` : ''}
                        </div>
                        <div class="pr-card-actions">
                            <button class="btn-primary btn-small pr-open-btn">
                                🔗 Open
                            </button>
                            <button class="btn-secondary btn-small pr-copy-btn">
                                📋 Copy URL
                            </button>
                        </div>
                    </div>
                \`;
            }).join('');
            
            // Add event listeners using event delegation
            document.querySelectorAll('.pr-open-btn').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const card = this.closest('.pr-card');
                    if (card && card.dataset.prUrl) {
                        const url = decodeURIComponent(card.dataset.prUrl);
                        vscode.postMessage({ command: 'openUrl', url: url });
                    }
                });
            });
            
            document.querySelectorAll('.pr-copy-btn').forEach(btn => {
                btn.addEventListener('click', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    const card = this.closest('.pr-card');
                    if (card && card.dataset.prUrl) {
                        const url = decodeURIComponent(card.dataset.prUrl);
                        vscode.postMessage({ command: 'copyUrl', url: url });
                        showToast('URL copied to clipboard');
                    }
                });
            });
        }
        
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        
        // Message Handler
        window.addEventListener('message', event => {
            const msg = event.data;
            
            switch (msg.command) {
                case 'initialData':
                    const data = msg.data;
                    
                    // Status indicators
                    elements.azureStatus.className = 'status-dot ' + (data.hasAzurePAT ? 'ok' : 'warning');
                    elements.claudeStatus.className = 'status-dot ' + (data.hasClaudeToken ? 'ok' : 'warning');
                    elements.currentBranchDisplay.textContent = data.currentBranch || 'Not detected';
                    
                    // Pre-fill branch
                    if (data.currentBranch) {
                        elements.sourceBranch.value = data.currentBranch;
                    }
                    
                    // Render history
                    renderPRHistory(data.prHistory);
                    
                    // Load repositories
                    if (data.hasAzurePAT) {
                        vscode.postMessage({ command: 'loadRepositories' });
                    } else {
                        elements.repository.innerHTML = '<option value="">Configure Azure DevOps first</option>';
                    }
                    break;
                    
                case 'repositoriesLoaded':
                    elements.repository.disabled = false;
                    elements.repository.innerHTML = '<option value="">Select repository...</option>' +
                        msg.data.repositories.map(r => 
                            \`<option value="\${r.id}" \${r.id === msg.data.selectedRepoId ? 'selected' : ''}>\${escapeHtml(r.name)}</option>\`
                        ).join('');
                    break;
                    
                case 'aiGenerated':
                    isGenerating = false;
                    elements.generateAI.disabled = false;
                    elements.generateAI.innerHTML = '✨ AI';
                    
                    if (msg.data.error) {
                        showError('AI generation failed: ' + msg.data.error);
                    } else {
                        if (msg.data.title) {
                            elements.prTitle.value = msg.data.title;
                        }
                        if (msg.data.description) {
                            elements.prDescription.value = msg.data.description;
                        }
                    }
                    break;
                    
                case 'prCreated':
                    isCreating = false;
                    elements.createPRBtn.disabled = false;
                    elements.createBtnText.classList.remove('hidden');
                    elements.createBtnLoading.classList.add('hidden');
                    
                    // Clear form
                    elements.prTitle.value = '';
                    elements.prDescription.value = '';
                    elements.workItems.value = '';
                    
                    // Update history with new PR highlighted
                    const history = [msg.data];
                    const existingCards = elements.prHistoryList.querySelectorAll('.pr-card');
                    existingCards.forEach(card => {
                        card.classList.remove('success-card');
                        const badge = card.querySelector('.new-badge');
                        if (badge) badge.remove();
                    });
                    
                    // Re-fetch to get updated history
                    vscode.postMessage({ command: 'getInitialData' });
                    break;
                    
                case 'prCreateError':
                    isCreating = false;
                    elements.createPRBtn.disabled = false;
                    elements.createBtnText.classList.remove('hidden');
                    elements.createBtnLoading.classList.add('hidden');
                    showError(msg.message);
                    break;
                    
                case 'historyUpdated':
                    renderPRHistory(msg.data);
                    showToast('History cleared');
                    break;
                    
                case 'error':
                    showError(msg.message);
                    break;
            }
        });
        
        // Initialize
        vscode.postMessage({ command: 'getInitialData' });
    </script>
</body>
</html>
`;
    }
}
