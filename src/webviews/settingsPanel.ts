import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import {
    createAIClientFromServices,
    getAIProviderLabel,
    getAISecret,
    getAISecretKey,
    getConfiguredAIMaxTokens,
    getConfiguredAITemperature,
    getConfiguredAIProvider,
    getConfiguredAIModel,
    isAIProvider,
} from '../api/ai';
import { ExtensionServices, SettingsData, WebviewMessage } from '../types';
import { CONFIG_KEYS, DEFAULT_CONFIG, SECRET_KEYS } from '../utils/constants';
import { getNonce, normalizeBaseUrl } from '../utils/helpers';

export class SettingsPanel {
    public static currentPanel: SettingsPanel | undefined;
    private readonly panel: vscode.WebviewPanel;
    private readonly services: ExtensionServices;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, services: ExtensionServices) {
        this.panel = panel;
        this.services = services;

        this.panel.webview.html = this.getHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.setupMessageHandler();
    }

    public static createOrShow(services: ExtensionServices): void {
        const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

        if (SettingsPanel.currentPanel) {
            SettingsPanel.currentPanel.panel.reveal(column);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            'azureDevOpsSettings',
            'Azure DevOps PR Helper Settings',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        SettingsPanel.currentPanel = new SettingsPanel(panel, services);

        // Track settings panel opened
        services.analytics.track(AnalyticsEvents.SETTINGS_OPENED);
    }

    private dispose(): void {
        SettingsPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }

    private setupMessageHandler(): void {
        this.panel.webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                switch (message.command) {
                    case 'getSettings':
                        await this.sendSettings();
                        break;
                    case 'saveSecret':
                        if (message.key && typeof message.value === 'string') {
                            if (!this.isKnownSecretKey(message.key)) {
                                this.postMessage({ command: 'saveError', error: 'Unknown secret key' });
                                break;
                            }

                            await this.services.setSecret(message.key, message.value.trim());
                            this.postMessage({ command: 'secretSaved', key: message.key });
                        }
                        break;
                    case 'deleteSecret':
                        if (message.key) {
                            if (!this.isKnownSecretKey(message.key)) {
                                this.postMessage({ command: 'saveError', error: 'Unknown secret key' });
                                break;
                            }

                            await this.services.deleteSecret(message.key);
                            this.postMessage({ command: 'secretDeleted', key: message.key });
                        }
                        break;
                    case 'deleteAISecret': {
                        const provider = getConfiguredAIProvider(this.services);
                        await this.services.deleteSecret(getAISecretKey(provider));
                        this.postMessage({ command: 'secretDeleted', key: 'aiSecret' });
                        break;
                    }
                    case 'saveConfig':
                        if (message.key && message.value !== undefined) {
                            const normalized = this.normalizeConfigValue(message.key, message.value);
                            if (typeof normalized === 'string' && normalized.startsWith('error:')) {
                                this.postMessage({ command: 'saveError', error: normalized.slice('error:'.length) });
                                break;
                            }

                            await this.services.setConfig(message.key, normalized);
                            this.postMessage({ command: 'configSaved', key: message.key });
                            
                            // Track settings saved
                            this.services.analytics.track(AnalyticsEvents.SETTINGS_SAVED, {
                                setting_key: message.key,
                            });

                            // Track telemetry toggle specifically
                            if (message.key === CONFIG_KEYS.ENABLE_TELEMETRY) {
                                this.services.analytics.track(AnalyticsEvents.TELEMETRY_TOGGLED, {
                                    enabled: message.value as boolean,
                                });
                            }
                        }
                        break;
                    case 'testConnection':
                        await this.testAzureConnection();
                        break;
                    case 'testAI':
                        await this.testAIConnection();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    private postMessage(message: WebviewMessage): void {
        this.panel.webview.postMessage(message);
    }

    private isKnownSecretKey(key: string): boolean {
        return Object.values(SECRET_KEYS).includes(key as typeof SECRET_KEYS[keyof typeof SECRET_KEYS]);
    }

    private normalizeConfigValue(key: string, value: string | boolean | number): string | boolean | number {
        switch (key) {
            case CONFIG_KEYS.ORG_HOST: {
                const normalized = normalizeBaseUrl(String(value).trim()) || '';
                if (!/^https?:\/\/[^/]+/.test(normalized)) {
                    return 'error:Organization URL must start with http:// or https://';
                }
                return normalized;
            }
            case CONFIG_KEYS.PROJECT: {
                const project = String(value).trim();
                return project ? project : 'error:Project name is required';
            }
            case CONFIG_KEYS.API_VERSION: {
                const apiVersion = String(value).trim();
                return /^\d+(\.\d+)?$/.test(apiVersion) ? apiVersion : 'error:API version must look like 7.1';
            }
            case CONFIG_KEYS.AI_PROVIDER:
                return isAIProvider(value) ? value : 'error:Unknown AI provider';
            case CONFIG_KEYS.AI_MODEL: {
                const model = String(value).trim();
                return model ? model : 'error:Model is required';
            }
            case CONFIG_KEYS.AI_MAX_TOKENS: {
                const maxTokens = Number(value);
                if (!Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 4096) {
                    return 'error:Max tokens must be an integer from 100 to 4096';
                }
                return maxTokens;
            }
            case CONFIG_KEYS.AI_TEMPERATURE: {
                const temperature = Number(value);
                if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
                    return 'error:Temperature must be between 0 and 2';
                }
                return temperature;
            }
            case CONFIG_KEYS.USE_AI:
            case CONFIG_KEYS.GENERATE_DESCRIPTION:
            case CONFIG_KEYS.AUTO_ACCEPT_AI:
            case CONFIG_KEYS.ENABLE_TELEMETRY:
                return Boolean(value);
            default:
                return 'error:Unknown configuration key';
        }
    }

    private async sendSettings(): Promise<void> {
        const hasAzurePAT = !!(await this.services.getSecret(SECRET_KEYS.AZURE_PAT));
        const aiProvider = getConfiguredAIProvider(this.services);
        const aiModel = getConfiguredAIModel(this.services, aiProvider);
        const aiMaxTokens = getConfiguredAIMaxTokens(this.services);
        const aiTemperature = getConfiguredAITemperature(this.services);
        const hasAIKey = !!(await getAISecret(this.services, aiProvider));

        const settings: SettingsData = {
            orgHost: this.services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost),
            project: this.services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project),
            useAI: this.services.getConfig(CONFIG_KEYS.USE_AI, DEFAULT_CONFIG.useAI),
            generateDescription: this.services.getConfig(CONFIG_KEYS.GENERATE_DESCRIPTION, DEFAULT_CONFIG.generateDescription),
            autoAcceptAI: this.services.getConfig(CONFIG_KEYS.AUTO_ACCEPT_AI, DEFAULT_CONFIG.autoAcceptAI),
            aiProvider,
            aiModel,
            aiMaxTokens,
            aiTemperature,
            apiVersion: this.services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion),
            hasAzurePAT,
            hasAIKey,
            enableTelemetry: this.services.getConfig(CONFIG_KEYS.ENABLE_TELEMETRY, DEFAULT_CONFIG.enableTelemetry),
        };

        this.postMessage({ command: 'settings', data: settings as unknown as Record<string, unknown> });
    }

    private async testAzureConnection(): Promise<void> {
        const pat = await this.services.getSecret(SECRET_KEYS.AZURE_PAT);
        if (!pat) {
            this.postMessage({ command: 'testResult', data: { type: 'azure', success: false, message: 'PAT not configured' } });
            return;
        }

        const orgHost = this.services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost);
        const project = this.services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project);
        const apiVersion = this.services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion);

        try {
            const { AzureDevOpsClient } = await import('../api/azureDevOps');
            const client = new AzureDevOpsClient(orgHost, project, pat, apiVersion);
            const repos = await client.listRepositories();
            this.postMessage({
                command: 'testResult',
                data: { type: 'azure', success: true, message: `Connected! Found ${repos.length} repositories.` }
            });

            // Track connection test success
            this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                type: 'azure',
                success: true,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.postMessage({ command: 'testResult', data: { type: 'azure', success: false, message } });

            // Track connection test failure
            this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                type: 'azure',
                success: false,
            });
        }
    }

    private async testAIConnection(): Promise<void> {
        const { client, provider, error } = await createAIClientFromServices(this.services);
        const type = 'ai';
        if (!client) {
            this.postMessage({ command: 'testResult', data: { type, success: false, message: error ?? 'API key not configured' } });
            return;
        }

        try {
            const result = await client.generate('Say "Hello" in one word.');
            if (result.error) {
                this.postMessage({ command: 'testResult', data: { type, success: false, message: result.error } });
                
                // Track connection test failure
                this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                    type: provider,
                    success: false,
                });
            } else {
                this.postMessage({ command: 'testResult', data: { type, success: true, message: `${getAIProviderLabel(provider)} connected successfully!` } });
                
                // Track connection test success
                this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                    type: provider,
                    success: true,
                });
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.postMessage({ command: 'testResult', data: { type, success: false, message } });

            // Track connection test failure
            this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                type: provider,
                success: false,
            });
        }
    }

    private getHtml(): string {
        const nonce = getNonce();
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const cspSource = this.panel.webview.cspSource;

        return /* html */ `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Settings</title>
    <style>
        :root {
            --vscode-font: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
            --section-spacing: 24px;
            --input-padding: 8px 12px;
            --border-radius: 4px;
        }
        
        * {
            box-sizing: border-box;
        }
        
        body {
            font-family: var(--vscode-font);
            padding: 20px;
            max-width: 800px;
            margin: 0 auto;
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
        }
        
        h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 12px;
        }
        
        h1 .icon {
            font-size: 28px;
        }
        
        .subtitle {
            color: var(--vscode-descriptionForeground);
            margin-bottom: var(--section-spacing);
        }
        
        .section {
            background: var(--vscode-sideBar-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: var(--section-spacing);
        }
        
        .section-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 16px;
            padding-bottom: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .section-header h2 {
            font-size: 16px;
            font-weight: 600;
            margin: 0;
        }
        
        .section-header .icon {
            font-size: 20px;
        }
        
        .form-group {
            margin-bottom: 16px;
        }
        
        .form-group:last-child {
            margin-bottom: 0;
        }
        
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        
        @media (max-width: 600px) {
            .form-row {
                grid-template-columns: 1fr;
            }
        }
        
        label {
            display: block;
            font-weight: 500;
            margin-bottom: 6px;
            font-size: 13px;
        }
        
        .label-description {
            font-weight: normal;
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-top: 2px;
        }
        
        input[type="text"],
        input[type="password"],
        input[type="number"],
        select {
            width: 100%;
            padding: var(--input-padding);
            border: 1px solid var(--vscode-input-border);
            border-radius: var(--border-radius);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-size: 13px;
        }
        
        input:focus,
        select:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .input-group {
            display: flex;
            gap: 8px;
        }
        
        .input-group input {
            flex: 1;
        }
        
        button {
            padding: 8px 16px;
            border: none;
            border-radius: var(--border-radius);
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: opacity 0.2s;
        }
        
        button:hover {
            opacity: 0.9;
        }
        
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-danger {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }
        
        .btn-small {
            padding: 6px 12px;
            font-size: 12px;
        }
        
        .toggle-group {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 12px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .toggle-group:last-child {
            border-bottom: none;
            padding-bottom: 0;
        }
        
        .toggle-info {
            flex: 1;
        }
        
        .toggle-label {
            font-weight: 500;
            font-size: 13px;
        }
        
        .toggle-description {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            margin-top: 2px;
        }
        
        .toggle-switch {
            position: relative;
            width: 44px;
            height: 24px;
            flex-shrink: 0;
            margin-left: 16px;
        }
        
        .toggle-switch input {
            opacity: 0;
            width: 0;
            height: 0;
        }
        
        .toggle-slider {
            position: absolute;
            cursor: pointer;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 24px;
            transition: 0.3s;
        }
        
        .toggle-slider:before {
            position: absolute;
            content: "";
            height: 18px;
            width: 18px;
            left: 2px;
            bottom: 2px;
            background: var(--vscode-foreground);
            border-radius: 50%;
            transition: 0.3s;
        }
        
        .toggle-switch input:checked + .toggle-slider {
            background: var(--vscode-button-background);
            border-color: var(--vscode-button-background);
        }
        
        .toggle-switch input:checked + .toggle-slider:before {
            transform: translateX(20px);
            background: var(--vscode-button-foreground);
        }
        
        .status-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        
        .status-configured {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        
        .status-not-configured {
            background: var(--vscode-inputValidation-warningBackground);
            color: var(--vscode-inputValidation-warningForeground);
        }
        
        .test-result {
            margin-top: 12px;
            padding: 10px 14px;
            border-radius: var(--border-radius);
            font-size: 13px;
        }
        
        .test-success {
            background: var(--vscode-testing-iconPassed);
            color: white;
        }
        
        .test-error {
            background: var(--vscode-inputValidation-errorBackground);
            color: var(--vscode-inputValidation-errorForeground);
        }
        
        .actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
        }
        
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
        
        .hidden {
            display: none !important;
        }
        
        .saved-indicator {
            color: var(--vscode-testing-iconPassed);
            font-size: 12px;
            font-weight: 500;
            margin-left: 8px;
        }
        
        .input-hint {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
            font-style: italic;
        }
        
        .input-hint.has-value {
            color: var(--vscode-testing-iconPassed);
        }
        
        .toast {
            position: fixed;
            bottom: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: var(--border-radius);
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            font-size: 13px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            animation: slideIn 0.3s ease;
            z-index: 1000;
        }
        
        @keyframes slideIn {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
    </style>
</head>
<body>
    <h1>
        <span class="icon">⚙️</span>
        Azure DevOps PR Helper
    </h1>
    <p class="subtitle">Configure Azure DevOps and your preferred AI provider in one place.</p>

    <!-- Azure DevOps Section -->
    <div class="section">
        <div class="section-header">
            <span class="icon">🔗</span>
            <h2>Azure DevOps Connection</h2>
            <span id="azure-status" class="status-badge status-not-configured">Not Configured</span>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="orgHost">
                    Organization URL
                    <div class="label-description">Your Azure DevOps organization URL</div>
                </label>
                <input type="text" id="orgHost" placeholder="https://dev.azure.com/your-org">
            </div>
            <div class="form-group">
                <label for="project">
                    Project Name
                    <div class="label-description">The project containing your repositories</div>
                </label>
                <input type="text" id="project" placeholder="MyProject">
            </div>
        </div>
        
        <div class="form-group">
            <label for="azurePAT">
                Personal Access Token (PAT)
                <span id="azurePATSaved" class="saved-indicator hidden">✓ Saved</span>
                <div class="label-description">Requires Code (read & write) and Work Items (read & write) permissions</div>
            </label>
            <div class="input-group">
                <input type="password" id="azurePAT" placeholder="Enter your PAT">
                <button class="btn-secondary btn-small" id="toggleAzurePAT" type="button">Show</button>
            </div>
            <div class="input-hint" id="azurePATHint"></div>
        </div>
        
        <div class="form-group">
            <label for="apiVersion">
                API Version
                <div class="label-description">Azure DevOps REST API version</div>
            </label>
            <input type="text" id="apiVersion" placeholder="7.1">
        </div>
        
        <div class="actions">
            <button class="btn-primary" id="saveAzure">Save Azure Settings</button>
            <button class="btn-secondary" id="testAzure">Test Connection</button>
            <button class="btn-danger btn-small" id="clearAzurePAT">Clear PAT</button>
        </div>
        
        <div id="azureTestResult" class="test-result hidden"></div>
    </div>

    <!-- AI Provider Section -->
    <div class="section">
        <div class="section-header">
            <span class="icon">🤖</span>
            <h2>AI Provider Integration</h2>
            <span id="ai-status" class="status-badge status-not-configured">Not Configured</span>
        </div>

        <div class="form-group">
            <label for="aiProvider">
                Provider
                <div class="label-description">Choose the LLM provider for PR title and description generation</div>
            </label>
            <select id="aiProvider">
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
            </select>
        </div>
        
        <div class="form-group">
            <label for="aiApiKey">
                <span id="apiKeyLabel">API Key</span>
                <span id="aiApiKeySaved" class="saved-indicator hidden">✓ Saved</span>
                <div class="label-description" id="apiKeyDescription">Get your API key from your provider console</div>
            </label>
            <div class="input-group">
                <input type="password" id="aiApiKey" placeholder="Enter your API key">
                <button class="btn-secondary btn-small" id="toggleAIKey" type="button">Show</button>
            </div>
            <div class="input-hint" id="aiApiKeyHint"></div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="aiModel">
                    Model
                    <div class="label-description">Model id to use for generation</div>
                </label>
                <input type="text" id="aiModel" placeholder="Model id">
            </div>
            <div class="form-group">
                <label for="aiMaxTokens">
                    Max Tokens
                    <div class="label-description">Maximum response length</div>
                </label>
                <input type="number" id="aiMaxTokens" min="100" max="4096" value="1024">
            </div>
        </div>
        
        <div class="form-group">
            <label for="aiTemperature">
                Temperature
                <div class="label-description">Creativity level (0 = focused, 2 = most varied)</div>
            </label>
            <input type="number" id="aiTemperature" min="0" max="2" step="0.1" value="0.3">
        </div>
        
        <div class="actions">
            <button class="btn-primary" id="saveAI">Save AI Settings</button>
            <button class="btn-secondary" id="testAI">Test Connection</button>
            <button class="btn-danger btn-small" id="clearAIKey">Clear API Key</button>
        </div>
        
        <div id="aiTestResult" class="test-result hidden"></div>
    </div>

    <!-- AI Behavior Section -->
    <div class="section">
        <div class="section-header">
            <span class="icon">✨</span>
            <h2>AI Behavior</h2>
        </div>
        
        <div class="toggle-group">
            <div class="toggle-info">
                <div class="toggle-label">Enable AI Suggestions</div>
                <div class="toggle-description">Use the selected AI provider to generate PR titles and descriptions</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="useAI">
                <span class="toggle-slider"></span>
            </label>
        </div>
        
        <div class="toggle-group">
            <div class="toggle-info">
                <div class="toggle-label">Generate Description</div>
                <div class="toggle-description">Also generate PR description along with title</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="generateDescription">
                <span class="toggle-slider"></span>
            </label>
        </div>
        
        <div class="toggle-group">
            <div class="toggle-info">
                <div class="toggle-label">Auto-Accept AI Suggestions</div>
                <div class="toggle-description">Skip confirmation and use AI-generated content directly</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="autoAcceptAI">
                <span class="toggle-slider"></span>
            </label>
        </div>
    </div>

    <!-- Privacy Section -->
    <div class="section">
        <div class="section-header">
            <span class="icon">🔒</span>
            <h2>Privacy</h2>
        </div>
        
        <div class="toggle-group">
            <div class="toggle-info">
                <div class="toggle-label">Enable Analytics</div>
                <div class="toggle-description">Help improve the extension by sending anonymous usage data. No personal information or code is ever collected.</div>
            </div>
            <label class="toggle-switch">
                <input type="checkbox" id="enableTelemetry">
                <span class="toggle-slider"></span>
            </label>
        </div>
    </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        // Elements
        const elements = {
            orgHost: document.getElementById('orgHost'),
            project: document.getElementById('project'),
            azurePAT: document.getElementById('azurePAT'),
            azurePATSaved: document.getElementById('azurePATSaved'),
            azurePATHint: document.getElementById('azurePATHint'),
            apiVersion: document.getElementById('apiVersion'),
            aiProvider: document.getElementById('aiProvider'),
            apiKeyLabel: document.getElementById('apiKeyLabel'),
            apiKeyDescription: document.getElementById('apiKeyDescription'),
            aiApiKey: document.getElementById('aiApiKey'),
            aiApiKeySaved: document.getElementById('aiApiKeySaved'),
            aiApiKeyHint: document.getElementById('aiApiKeyHint'),
            aiModel: document.getElementById('aiModel'),
            aiMaxTokens: document.getElementById('aiMaxTokens'),
            aiTemperature: document.getElementById('aiTemperature'),
            useAI: document.getElementById('useAI'),
            generateDescription: document.getElementById('generateDescription'),
            autoAcceptAI: document.getElementById('autoAcceptAI'),
            enableTelemetry: document.getElementById('enableTelemetry'),
            azureStatus: document.getElementById('azure-status'),
            aiStatus: document.getElementById('ai-status'),
            azureTestResult: document.getElementById('azureTestResult'),
            aiTestResult: document.getElementById('aiTestResult'),
        };

        const providers = {
            anthropic: {
                label: 'Anthropic',
                keyLabel: 'Anthropic API Key',
                description: 'Get your API key from console.anthropic.com',
                placeholder: 'sk-ant-...',
                defaultModel: 'claude-sonnet-4-5',
                secretKey: 'anthropicApiKey',
            },
            gemini: {
                label: 'Google Gemini',
                keyLabel: 'Gemini API Key',
                description: 'Get your API key from Google AI Studio',
                placeholder: 'AIza...',
                defaultModel: 'gemini-2.5-flash',
                secretKey: 'geminiApiKey',
            },
            openai: {
                label: 'OpenAI',
                keyLabel: 'OpenAI API Key',
                description: 'Get your API key from platform.openai.com',
                placeholder: 'sk-...',
                defaultModel: 'gpt-4o-mini',
                secretKey: 'openaiApiKey',
            },
        };

        function selectedProvider() {
            return providers[elements.aiProvider.value] ? elements.aiProvider.value : 'anthropic';
        }

        function updateProviderUi(hasKey = false) {
            const provider = providers[selectedProvider()];
            elements.apiKeyLabel.textContent = provider.keyLabel;
            elements.apiKeyDescription.textContent = provider.description;
            if (!elements.aiModel.value) {
                elements.aiModel.value = provider.defaultModel;
            }
            if (!hasKey) {
                elements.aiApiKey.placeholder = provider.placeholder;
            }
        }
        
        // Password toggle
        function setupPasswordToggle(inputId, buttonId) {
            const input = document.getElementById(inputId);
            const button = document.getElementById(buttonId);
            button.addEventListener('click', () => {
                const isPassword = input.type === 'password';
                input.type = isPassword ? 'text' : 'password';
                button.textContent = isPassword ? 'Hide' : 'Show';
            });
        }
        setupPasswordToggle('azurePAT', 'toggleAzurePAT');
        setupPasswordToggle('aiApiKey', 'toggleAIKey');
        
        // Toast notification
        function showToast(message) {
            const existing = document.querySelector('.toast');
            if (existing) existing.remove();
            
            const toast = document.createElement('div');
            toast.className = 'toast';
            toast.textContent = message;
            document.body.appendChild(toast);
            setTimeout(() => toast.remove(), 3000);
        }
        
        // Update status badge
        function updateStatus(element, configured) {
            element.className = 'status-badge ' + (configured ? 'status-configured' : 'status-not-configured');
            element.textContent = configured ? '✓ Configured' : 'Not Configured';
        }
        
        // Show test result
        function showTestResult(element, success, message) {
            element.className = 'test-result ' + (success ? 'test-success' : 'test-error');
            element.textContent = message;
            element.classList.remove('hidden');
        }
        
        // Save Azure settings
        document.getElementById('saveAzure').addEventListener('click', () => {
            const orgHost = elements.orgHost.value.trim();
            const project = elements.project.value.trim();
            const apiVersion = elements.apiVersion.value.trim();

            if (!/^https?:\\/\\/[^/]+/.test(orgHost)) {
                showTestResult(elements.azureTestResult, false, 'Organization URL must start with http:// or https://');
                return;
            }

            if (!project) {
                showTestResult(elements.azureTestResult, false, 'Project name is required');
                return;
            }

            if (!/^\\d+(\\.\\d+)?$/.test(apiVersion)) {
                showTestResult(elements.azureTestResult, false, 'API version must look like 7.1');
                return;
            }

            vscode.postMessage({ command: 'saveConfig', key: 'orgHost', value: orgHost });
            vscode.postMessage({ command: 'saveConfig', key: 'project', value: project });
            vscode.postMessage({ command: 'saveConfig', key: 'apiVersion', value: apiVersion });
            if (elements.azurePAT.value) {
                vscode.postMessage({ command: 'saveSecret', key: 'azureDevOpsPAT', value: elements.azurePAT.value.trim() });
            }
            showToast('Azure settings saved');
        });
        
        // Save AI settings
        document.getElementById('saveAI').addEventListener('click', () => {
            const provider = providers[selectedProvider()];
            const model = (elements.aiModel.value || provider.defaultModel).trim();
            const maxTokens = Number(elements.aiMaxTokens.value);
            const temperature = Number(elements.aiTemperature.value);

            if (!model) {
                showTestResult(elements.aiTestResult, false, 'Model is required');
                return;
            }

            if (!Number.isInteger(maxTokens) || maxTokens < 100 || maxTokens > 4096) {
                showTestResult(elements.aiTestResult, false, 'Max tokens must be an integer from 100 to 4096');
                return;
            }

            if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
                showTestResult(elements.aiTestResult, false, 'Temperature must be between 0 and 2');
                return;
            }

            vscode.postMessage({ command: 'saveConfig', key: 'aiProvider', value: selectedProvider() });
            vscode.postMessage({ command: 'saveConfig', key: 'aiModel', value: model });
            vscode.postMessage({ command: 'saveConfig', key: 'aiMaxTokens', value: maxTokens });
            vscode.postMessage({ command: 'saveConfig', key: 'aiTemperature', value: temperature });
            if (elements.aiApiKey.value) {
                vscode.postMessage({ command: 'saveSecret', key: provider.secretKey, value: elements.aiApiKey.value.trim() });
            }
            showToast('AI settings saved');
        });

        elements.aiProvider.addEventListener('change', () => {
            const provider = providers[selectedProvider()];
            elements.aiApiKey.value = '';
            elements.aiApiKey.placeholder = provider.placeholder;
            elements.aiApiKeySaved.classList.add('hidden');
            elements.aiApiKeyHint.textContent = '';
            elements.aiApiKeyHint.className = 'input-hint';
            elements.aiModel.value = provider.defaultModel;
            vscode.postMessage({ command: 'saveConfig', key: 'aiProvider', value: selectedProvider() });
            vscode.postMessage({ command: 'saveConfig', key: 'aiModel', value: provider.defaultModel });
            updateProviderUi(false);
        });
        
        // Toggle handlers
        ['useAI', 'generateDescription', 'autoAcceptAI', 'enableTelemetry'].forEach(id => {
            document.getElementById(id).addEventListener('change', (e) => {
                vscode.postMessage({ command: 'saveConfig', key: id, value: e.target.checked });
                showToast('Setting updated');
            });
        });
        
        // Test connections
        document.getElementById('testAzure').addEventListener('click', () => {
            elements.azureTestResult.textContent = 'Testing...';
            elements.azureTestResult.className = 'test-result';
            elements.azureTestResult.classList.remove('hidden');
            vscode.postMessage({ command: 'testConnection' });
        });
        
        document.getElementById('testAI').addEventListener('click', () => {
            elements.aiTestResult.textContent = 'Testing...';
            elements.aiTestResult.className = 'test-result';
            elements.aiTestResult.classList.remove('hidden');
            vscode.postMessage({ command: 'testAI' });
        });
        
        // Clear secrets (confirm() doesn't work in webviews, so we clear directly)
        document.getElementById('clearAzurePAT').addEventListener('click', () => {
            vscode.postMessage({ command: 'deleteSecret', key: 'azureDevOpsPAT' });
            elements.azurePAT.value = '';
            elements.azurePAT.placeholder = 'Enter your PAT';
            elements.azurePATSaved.classList.add('hidden');
            elements.azurePATHint.textContent = '';
            updateStatus(elements.azureStatus, false);
            showToast('PAT cleared');
        });
        
        document.getElementById('clearAIKey').addEventListener('click', () => {
            vscode.postMessage({ command: 'deleteAISecret' });
            elements.aiApiKey.value = '';
            elements.aiApiKey.placeholder = providers[selectedProvider()].placeholder;
            elements.aiApiKeySaved.classList.add('hidden');
            elements.aiApiKeyHint.textContent = '';
            updateStatus(elements.aiStatus, false);
            showToast('API key cleared');
        });
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const msg = event.data;
            
            switch (msg.command) {
                case 'settings':
                    const s = msg.data;
                    elements.orgHost.value = s.orgHost || '';
                    elements.project.value = s.project || '';
                    elements.apiVersion.value = s.apiVersion || '7.1';
                    elements.aiProvider.value = s.aiProvider || 'anthropic';
                    updateProviderUi(s.hasAIKey);
                    elements.aiModel.value = s.aiModel || providers[selectedProvider()].defaultModel;
                    elements.aiMaxTokens.value = s.aiMaxTokens || 1024;
                    elements.aiTemperature.value = s.aiTemperature || 0.3;
                    elements.useAI.checked = s.useAI !== false;
                    elements.generateDescription.checked = s.generateDescription !== false;
                    elements.autoAcceptAI.checked = s.autoAcceptAI === true;
                    elements.enableTelemetry.checked = s.enableTelemetry !== false;
                    updateStatus(elements.azureStatus, s.hasAzurePAT);
                    updateStatus(elements.aiStatus, s.hasAIKey);
                    
                    // Show saved indicator and hint for existing secrets
                    if (s.hasAzurePAT) {
                        elements.azurePAT.placeholder = '••••••••••••••••••••••••••••••••';
                        elements.azurePAT.value = '';
                        elements.azurePATSaved.classList.remove('hidden');
                        elements.azurePATHint.textContent = 'PAT is securely stored. Enter a new value to replace it.';
                        elements.azurePATHint.className = 'input-hint has-value';
                    } else {
                        elements.azurePAT.placeholder = 'Enter your PAT';
                        elements.azurePATSaved.classList.add('hidden');
                        elements.azurePATHint.textContent = '';
                        elements.azurePATHint.className = 'input-hint';
                    }
                    
                    if (s.hasAIKey) {
                        elements.aiApiKey.placeholder = '••••••••••••••••••••••••••••••••';
                        elements.aiApiKey.value = '';
                        elements.aiApiKeySaved.classList.remove('hidden');
                        elements.aiApiKeyHint.textContent = 'API key is securely stored. Enter a new value to replace it.';
                        elements.aiApiKeyHint.className = 'input-hint has-value';
                    } else {
                        elements.aiApiKey.placeholder = providers[selectedProvider()].placeholder;
                        elements.aiApiKeySaved.classList.add('hidden');
                        elements.aiApiKeyHint.textContent = '';
                        elements.aiApiKeyHint.className = 'input-hint';
                    }
                    break;
                    
                case 'testResult':
                    const result = msg.data;
                    if (result.type === 'azure') {
                        showTestResult(elements.azureTestResult, result.success, result.message);
                    } else if (result.type === 'ai') {
                        showTestResult(elements.aiTestResult, result.success, result.message);
                    }
                    break;
                    
                case 'secretSaved':
                case 'configSaved':
                    // Refresh settings after save
                    vscode.postMessage({ command: 'getSettings' });
                    break;
                    
                case 'secretDeleted':
                    vscode.postMessage({ command: 'getSettings' });
                    break;

                case 'saveError':
                    showToast('Save failed: ' + (msg.error || 'Invalid value'));
                    break;
            }
        });
        
        // Load settings on init
        vscode.postMessage({ command: 'getSettings' });
    </script>
</body>
</html>
`;
    }
}
