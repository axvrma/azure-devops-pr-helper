import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import { AzureDevOpsClient } from '../api/azureDevOps';
import { createAIClientFromServices, getAIProviderLabel, normalizeGeneratedTitle, PRPrompts } from '../api/ai';
import { AzureRepository, ExtensionServices, PRHistoryItem } from '../types';
import { CONFIG_KEYS, DEFAULT_CONFIG, SECRET_KEYS, STATE_KEYS } from '../utils/constants';
import { getCommitMessages, getCurrentBranch, getCurrentRepoName, getGitDiff, isValidBranchName } from '../utils/git';
import { getNonce, parseWorkItemIds } from '../utils/helpers';

interface CreatePullRequestFormData {
    repositoryId: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
    description: string;
    workItems: string;
    generatedByAI?: boolean;
}

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
                    case 'loadBranches':
                        await this.loadBranches(message.repositoryId);
                        break;
                    case 'generateAI':
                        await this.generateAIContent(message.branch, message.repo, message.targetBranch);
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
        const { client, provider } = await createAIClientFromServices(this.services);
        const hasAIKey = !!client;
        const currentBranch = getCurrentBranch() || '';
        const currentRepo = getCurrentRepoName() || '';
        const useAI = this.services.getConfig(CONFIG_KEYS.USE_AI, DEFAULT_CONFIG.useAI);
        const generateDescription = this.services.getConfig(CONFIG_KEYS.GENERATE_DESCRIPTION, DEFAULT_CONFIG.generateDescription);
        const prHistory = this.services.getState<PRHistoryItem[]>(STATE_KEYS.PR_HISTORY) || [];

        this.postMessage({
            command: 'initialData',
            data: {
                hasAzurePAT,
                hasAIKey,
                aiProviderLabel: getAIProviderLabel(provider),
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
                    repositories: this.repositories.map(r => ({ id: r.id, name: r.name, defaultBranch: this.normalizeBranchName(r.defaultBranch) })),
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

    private async loadBranches(repositoryId: unknown): Promise<void> {
        if (typeof repositoryId !== 'string' || !repositoryId.trim()) {
            this.postMessage({ command: 'branchesLoadError', repositoryId: '', message: 'Select a repository first.' });
            return;
        }

        const repository = this.repositories.find(repo => repo.id === repositoryId);
        if (!repository) {
            this.postMessage({ command: 'branchesLoadError', repositoryId, message: 'The selected repository is no longer available.' });
            return;
        }

        const pat = await this.services.getSecret(SECRET_KEYS.AZURE_PAT);
        if (!pat) {
            this.postMessage({ command: 'branchesLoadError', repositoryId, message: 'Azure PAT not configured.' });
            return;
        }

        const orgUrl = this.services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost);
        const project = this.services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project);
        const apiVersion = this.services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion);

        try {
            const client = new AzureDevOpsClient(orgUrl, project, pat, apiVersion);
            const branches = await client.listBranches(repositoryId);
            this.postMessage({
                command: 'branchesLoaded',
                data: {
                    repositoryId,
                    branches,
                    defaultBranch: this.normalizeBranchName(repository.defaultBranch),
                },
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.postMessage({ command: 'branchesLoadError', repositoryId, message: `Failed to load branches: ${message}` });
        }
    }

    private normalizeBranchName(branch?: string): string {
        return branch?.replace(/^refs\/heads\//, '') ?? '';
    }

    private async generateAIContent(branch: string, repo: string, targetBranch?: string): Promise<void> {
        const { client, provider, model, error } = await createAIClientFromServices(this.services);
        if (!client) {
            this.postMessage({ command: 'aiGenerated', data: { error: error ?? 'AI provider API key not configured' } });
            return;
        }

        const generateDescription = this.services.getConfig(CONFIG_KEYS.GENERATE_DESCRIPTION, DEFAULT_CONFIG.generateDescription);
        const branchName = branch?.trim() || getCurrentBranch() || 'feature';
        const repoName = repo?.trim() || getCurrentRepoName() || 'repository';
        const target = targetBranch?.trim() || 'main';
        const commits = getCommitMessages(target);
        const diff = getGitDiff(target);

        try {
            const titleResult = await client.generate(PRPrompts.title(branchName, repoName, commits, diff));
            let description = '';

            if (generateDescription) {
                const descResult = await client.generate(PRPrompts.description(branchName, repoName, commits, diff));
                if ((descResult.text || descResult.title) && !descResult.error) {
                    description = descResult.text || descResult.title || '';
                }
            }

            this.postMessage({
                command: 'aiGenerated',
                data: {
                    title: titleResult.title ? normalizeGeneratedTitle(titleResult.title) : '',
                    description,
                    error: titleResult.error,
                }
            });

            // Track AI generation success
            if (titleResult.title && !titleResult.error) {
                this.services.analytics.track(AnalyticsEvents.AI_TITLE_GENERATED, {
                    provider,
                    model,
                    has_custom_prompt: false,
                    has_diff: !!diff,
                });
            } else if (titleResult.error) {
                this.services.analytics.track(AnalyticsEvents.AI_TITLE_FAILED, {
                    provider,
                    error_type: titleResult.error,
                });
            }

            if (generateDescription && description) {
                this.services.analytics.track(AnalyticsEvents.AI_DESCRIPTION_GENERATED, {
                    provider,
                    model,
                });
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.postMessage({ command: 'aiGenerated', data: { error: message } });
            
            // Track AI generation failure
            this.services.analytics.track(AnalyticsEvents.AI_TITLE_FAILED, {
                provider,
                error_type: message,
            });
        }
    }

    private async createPullRequest(data: CreatePullRequestFormData): Promise<void> {
        const validationError = this.validatePullRequestInput(data);
        if (validationError) {
            this.postMessage({ command: 'prCreateError', message: validationError });
            return;
        }

        const pat = await this.services.getSecret(SECRET_KEYS.AZURE_PAT);
        if (!pat) {
            this.postMessage({ command: 'prCreateError', message: 'Azure PAT not configured' });
            return;
        }

        const orgUrl = this.services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost);
        const project = this.services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project);
        const apiVersion = this.services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion);

        if (!orgUrl || orgUrl === DEFAULT_CONFIG.orgHost || !project || project === DEFAULT_CONFIG.project) {
            this.postMessage({ command: 'prCreateError', message: 'Azure DevOps organization and project are not configured' });
            return;
        }

        const sourceBranch = data.sourceBranch.trim();
        const targetBranch = data.targetBranch.trim();
        const title = data.title.trim();
        const description = data.description?.trim() || '';

        try {
            const client = new AzureDevOpsClient(orgUrl, project, pat, apiVersion);
            
            const pr = await client.createPullRequest(data.repositoryId, {
                sourceRefName: `refs/heads/${sourceBranch}`,
                targetRefName: `refs/heads/${targetBranch}`,
                title,
                description,
            });

            const prUrl = client.getPullRequestWebUrl(pr);
            await this.services.setState(STATE_KEYS.LAST_PR_URL, prUrl);

            // Link work items
            const workItemIds = parseWorkItemIds(data.workItems || '');
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
                title,
                description,
                url: prUrl,
                sourceBranch,
                targetBranch,
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
                has_ai_title: !!data.generatedByAI,
                has_ai_description: !!data.generatedByAI && !!description,
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

    private validatePullRequestInput(data: CreatePullRequestFormData): string | undefined {
        if (!data || typeof data !== 'object') {
            return 'Invalid pull request form data';
        }

        if (!data.repositoryId?.trim()) {
            return 'Repository is required';
        }

        if (!data.sourceBranch?.trim()) {
            return 'Source branch is required';
        }

        if (!isValidBranchName(data.sourceBranch.trim())) {
            return 'Source branch name is invalid';
        }

        if (!data.targetBranch?.trim()) {
            return 'Target branch is required';
        }

        if (!isValidBranchName(data.targetBranch.trim())) {
            return 'Target branch name is invalid';
        }

        if (data.sourceBranch.trim() === data.targetBranch.trim()) {
            return 'Source and target branches must be different';
        }

        if (!data.title?.trim()) {
            return 'PR title is required';
        }

        if (data.title.trim().length > 200) {
            return 'PR title must be 200 characters or fewer';
        }

        return undefined;
    }

    private async addToPRHistory(item: PRHistoryItem): Promise<void> {
        const history = this.services.getState<PRHistoryItem[]>(STATE_KEYS.PR_HISTORY) || [];
        history.unshift(item);
        
        // Keep only last N items
        if (history.length > MAX_PR_HISTORY) {
            history.splice(MAX_PR_HISTORY);
        }
        
        await this.services.setState(STATE_KEYS.PR_HISTORY, history);
    }

    private async deletePRFromHistory(prId: number): Promise<void> {
        const history = this.services.getState<PRHistoryItem[]>(STATE_KEYS.PR_HISTORY) || [];
        const filtered = history.filter(item => item.id !== prId);
        await this.services.setState(STATE_KEYS.PR_HISTORY, filtered);
        this.postMessage({ command: 'historyUpdated', data: filtered });
    }

    private async clearPRHistory(): Promise<void> {
        await this.services.setState(STATE_KEYS.PR_HISTORY, []);
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

        .searchable-select {
            position: relative;
            width: 100%;
        }

        .input-with-button .searchable-select {
            flex: 1;
            min-width: 0;
        }

        .searchable-select input {
            padding-right: 30px;
        }

        .searchable-select::after {
            content: '▾';
            position: absolute;
            top: 8px;
            right: 11px;
            color: var(--vscode-descriptionForeground);
            pointer-events: none;
        }

        .dropdown-options {
            position: absolute;
            z-index: 20;
            top: calc(100% + 3px);
            left: 0;
            right: 0;
            max-height: 220px;
            overflow-y: auto;
            padding: 4px;
            border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
            border-radius: 4px;
            background: var(--vscode-dropdown-background, var(--vscode-editor-background));
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .dropdown-option {
            display: block;
            width: 100%;
            padding: 7px 9px;
            border-radius: 2px;
            background: transparent;
            color: var(--vscode-dropdown-foreground, var(--vscode-foreground));
            text-align: left;
            font-weight: normal;
            overflow-wrap: anywhere;
        }

        .dropdown-option:hover,
        .dropdown-option.active {
            opacity: 1;
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .dropdown-empty {
            padding: 8px 9px;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
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
                <span class="status-dot" id="aiStatus"></span>
                <span id="aiProviderLabel">AI Provider</span>
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
                        <div class="searchable-select">
                            <input type="hidden" id="repository">
                            <input type="text" id="repositorySearch" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="Loading repositories..." disabled>
                            <div id="repositoryOptions" class="dropdown-options hidden" role="listbox"></div>
                        </div>
                        <button class="btn-secondary btn-icon" id="refreshRepos" title="Refresh">🔄</button>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Source Branch <span class="label-hint">(your feature branch)</span></label>
                    <div class="searchable-select">
                        <input type="text" id="sourceBranch" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="Select a repository first" disabled>
                        <div id="sourceBranchOptions" class="dropdown-options hidden" role="listbox"></div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label>Target Branch <span class="label-hint">(merge into)</span></label>
                    <div class="searchable-select">
                        <input type="text" id="targetBranch" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="Select a repository first" disabled>
                        <div id="targetBranchOptions" class="dropdown-options hidden" role="listbox"></div>
                    </div>
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
            repositorySearch: document.getElementById('repositorySearch'),
            repositoryOptions: document.getElementById('repositoryOptions'),
            sourceBranch: document.getElementById('sourceBranch'),
            sourceBranchOptions: document.getElementById('sourceBranchOptions'),
            targetBranch: document.getElementById('targetBranch'),
            targetBranchOptions: document.getElementById('targetBranchOptions'),
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
            aiStatus: document.getElementById('aiStatus'),
            aiProviderLabel: document.getElementById('aiProviderLabel'),
            currentBranchDisplay: document.getElementById('currentBranchDisplay'),
            errorMessage: document.getElementById('errorMessage'),
            prHistoryList: document.getElementById('prHistoryList'),
        };
        
        let isCreating = false;
        let isGenerating = false;
        let aiGeneratedApplied = false;
        let repositories = [];
        let branches = [];
        let currentBranch = '';
        let currentRepo = '';
        let selectedSourceBranch = '';
        let selectedTargetBranch = '';

        function closeDropdown(input, optionsElement) {
            optionsElement.classList.add('hidden');
            input.setAttribute('aria-expanded', 'false');
        }

        function configureCombobox(input, optionsElement, getOptions, getLabel, onSelect, onQuery) {
            let activeIndex = -1;

            const render = () => {
                const query = input.value.trim().toLowerCase();
                const matches = getOptions().filter(option => getLabel(option).toLowerCase().includes(query));
                optionsElement.replaceChildren();
                activeIndex = -1;

                if (matches.length === 0) {
                    const empty = document.createElement('div');
                    empty.className = 'dropdown-empty';
                    empty.textContent = getOptions().length === 0 ? 'No options available' : 'No matches found';
                    optionsElement.appendChild(empty);
                } else {
                    matches.slice(0, 200).forEach(option => {
                        const button = document.createElement('button');
                        button.type = 'button';
                        button.className = 'dropdown-option';
                        button.setAttribute('role', 'option');
                        button.textContent = getLabel(option);
                        button.addEventListener('mousedown', event => event.preventDefault());
                        button.addEventListener('click', () => {
                            onSelect(option);
                            closeDropdown(input, optionsElement);
                        });
                        optionsElement.appendChild(button);
                    });
                }

                optionsElement.classList.remove('hidden');
                input.setAttribute('aria-expanded', 'true');
            };

            input.addEventListener('focus', render);
            input.addEventListener('click', render);
            input.addEventListener('input', () => {
                onQuery(input.value);
                render();
            });
            input.addEventListener('blur', () => {
                window.setTimeout(() => closeDropdown(input, optionsElement), 100);
            });
            input.addEventListener('keydown', event => {
                const optionButtons = Array.from(optionsElement.querySelectorAll('.dropdown-option'));
                if (event.key === 'Escape') {
                    closeDropdown(input, optionsElement);
                    return;
                }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (optionsElement.classList.contains('hidden')) {
                        render();
                        return;
                    }
                    if (optionButtons.length === 0) return;
                    activeIndex = event.key === 'ArrowDown'
                        ? (activeIndex + 1) % optionButtons.length
                        : (activeIndex - 1 + optionButtons.length) % optionButtons.length;
                    optionButtons.forEach((button, index) => button.classList.toggle('active', index === activeIndex));
                    optionButtons[activeIndex].scrollIntoView({ block: 'nearest' });
                } else if (event.key === 'Enter' && activeIndex >= 0 && optionButtons[activeIndex]) {
                    event.preventDefault();
                    optionButtons[activeIndex].click();
                }
            });
        }

        function resetBranches(message) {
            branches = [];
            selectedSourceBranch = '';
            selectedTargetBranch = '';
            elements.sourceBranch.value = '';
            elements.targetBranch.value = '';
            elements.sourceBranch.disabled = true;
            elements.targetBranch.disabled = true;
            elements.sourceBranch.placeholder = message;
            elements.targetBranch.placeholder = message;
            elements.sourceBranchOptions.replaceChildren();
            elements.targetBranchOptions.replaceChildren();
            closeDropdown(elements.sourceBranch, elements.sourceBranchOptions);
            closeDropdown(elements.targetBranch, elements.targetBranchOptions);
        }

        function selectRepository(repository) {
            elements.repository.value = repository.id;
            elements.repositorySearch.value = repository.name;
            resetBranches('Loading branches...');
            hideError();
            vscode.postMessage({ command: 'loadBranches', repositoryId: repository.id });
        }

        function selectBranch(kind, branch) {
            if (kind === 'source') {
                selectedSourceBranch = branch;
                elements.sourceBranch.value = branch;
            } else {
                selectedTargetBranch = branch;
                elements.targetBranch.value = branch;
            }
        }

        configureCombobox(
            elements.repositorySearch,
            elements.repositoryOptions,
            () => repositories,
            repository => repository.name,
            selectRepository,
            value => {
                const exact = repositories.find(repository => repository.name.toLowerCase() === value.trim().toLowerCase());
                if (exact) {
                    if (elements.repository.value !== exact.id) selectRepository(exact);
                } else if (elements.repository.value) {
                    elements.repository.value = '';
                    resetBranches('Select a repository first');
                }
            }
        );

        configureCombobox(
            elements.sourceBranch,
            elements.sourceBranchOptions,
            () => branches,
            branch => branch,
            branch => selectBranch('source', branch),
            value => {
                const exact = branches.find(branch => branch.toLowerCase() === value.trim().toLowerCase());
                selectedSourceBranch = exact || '';
            }
        );

        configureCombobox(
            elements.targetBranch,
            elements.targetBranchOptions,
            () => branches,
            branch => branch,
            branch => selectBranch('target', branch),
            value => {
                const exact = branches.find(branch => branch.toLowerCase() === value.trim().toLowerCase());
                selectedTargetBranch = exact || '';
            }
        );
        
        // Event Listeners
        elements.settingsBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });
        
        elements.refreshRepos.addEventListener('click', () => {
            repositories = [];
            elements.repository.value = '';
            elements.repositorySearch.value = '';
            elements.repositorySearch.placeholder = 'Loading repositories...';
            elements.repositorySearch.disabled = true;
            resetBranches('Select a repository first');
            vscode.postMessage({ command: 'loadRepositories' });
        });
        
        elements.generateAI.addEventListener('click', () => {
            if (isGenerating) return;
            
            isGenerating = true;
            elements.generateAI.disabled = true;
            elements.generateAI.innerHTML = '<span class="loading"></span>';
            
            vscode.postMessage({
                command: 'generateAI',
                branch: selectedSourceBranch || 'feature',
                repo: repositories.find(repository => repository.id === elements.repository.value)?.name || 'repository',
                targetBranch: selectedTargetBranch || 'main'
            });
        });
        
        elements.createPRBtn.addEventListener('click', () => {
            if (isCreating) return;
            
            // Validation
            if (!elements.repository.value) {
                showError('Please select a repository');
                return;
            }
            if (!selectedSourceBranch) {
                showError('Please select a source branch');
                return;
            }
            if (!selectedTargetBranch) {
                showError('Please select a target branch');
                return;
            }
            if (selectedSourceBranch === selectedTargetBranch) {
                showError('Source and target branches must be different');
                return;
            }
            if (!elements.prTitle.value.trim()) {
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
                    sourceBranch: selectedSourceBranch,
                    targetBranch: selectedTargetBranch,
                    title: elements.prTitle.value.trim(),
                    description: elements.prDescription.value.trim(),
                    workItems: elements.workItems.value.trim(),
                    generatedByAI: aiGeneratedApplied,
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
                    currentBranch = data.currentBranch || '';
                    currentRepo = data.currentRepo || '';
                    
                    // Status indicators
                    elements.azureStatus.className = 'status-dot ' + (data.hasAzurePAT ? 'ok' : 'warning');
                    elements.aiStatus.className = 'status-dot ' + (data.hasAIKey ? 'ok' : 'warning');
                    elements.aiProviderLabel.textContent = data.aiProviderLabel || 'AI Provider';
                    elements.currentBranchDisplay.textContent = data.currentBranch || 'Not detected';
                    
                    // Render history
                    renderPRHistory(data.prHistory);
                    
                    // Load repositories
                    if (data.hasAzurePAT) {
                        vscode.postMessage({ command: 'loadRepositories' });
                    } else {
                        elements.repositorySearch.placeholder = 'Configure Azure DevOps first';
                    }
                    break;
                    
                case 'repositoriesLoaded':
                    repositories = msg.data.repositories || [];
                    elements.repositorySearch.disabled = false;
                    elements.repositorySearch.placeholder = repositories.length > 0
                        ? 'Search and select a repository'
                        : 'No repositories found';

                    const selectedRepository = repositories.find(repository => repository.id === msg.data.selectedRepoId);
                    if (selectedRepository) {
                        selectRepository(selectedRepository);
                    } else {
                        elements.repository.value = '';
                        elements.repositorySearch.value = '';
                        resetBranches('Select a repository first');
                    }
                    break;

                case 'branchesLoaded':
                    if (msg.data.repositoryId !== elements.repository.value) break;

                    branches = msg.data.branches || [];
                    elements.sourceBranch.disabled = branches.length === 0;
                    elements.targetBranch.disabled = branches.length === 0;
                    elements.sourceBranch.placeholder = branches.length > 0
                        ? 'Search and select a source branch'
                        : 'No branches found';
                    elements.targetBranch.placeholder = branches.length > 0
                        ? 'Search and select a target branch'
                        : 'No branches found';

                    const selectedRepo = repositories.find(repository => repository.id === elements.repository.value);
                    const detectedSource = selectedRepo?.name === currentRepo && branches.includes(currentBranch)
                        ? currentBranch
                        : '';
                    const defaultTarget = branches.includes(msg.data.defaultBranch)
                        ? msg.data.defaultBranch
                        : branches.includes('main')
                            ? 'main'
                            : branches.includes('master')
                                ? 'master'
                                : '';

                    if (detectedSource) selectBranch('source', detectedSource);
                    if (defaultTarget) selectBranch('target', defaultTarget);
                    if (branches.length === 0) showError('No branches were found for the selected repository.');
                    break;

                case 'branchesLoadError':
                    if (msg.repositoryId !== elements.repository.value) break;
                    resetBranches('Unable to load branches');
                    showError(msg.message);
                    break;
                    
                case 'aiGenerated':
                    isGenerating = false;
                    elements.generateAI.disabled = false;
                    elements.generateAI.innerHTML = '✨ AI';
                    
                    if (msg.data.error) {
                        showError('AI generation failed: ' + msg.data.error);
                    } else {
                        hideError();
                        if (msg.data.title) {
                            elements.prTitle.value = msg.data.title;
                        }
                        if (msg.data.description) {
                            elements.prDescription.value = msg.data.description;
                        }
                        aiGeneratedApplied = true;
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
                    aiGeneratedApplied = false;
                    
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
