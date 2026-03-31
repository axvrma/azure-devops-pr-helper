import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import { ExtensionServices, SettingsData, WebviewMessage } from '../types';
import { CONFIG_KEYS, DEFAULT_CONFIG, SECRET_KEYS } from '../utils/constants';
import { getNonce } from '../utils/helpers';

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
                            await this.services.setSecret(message.key, message.value);
                            this.postMessage({ command: 'secretSaved', key: message.key });
                        }
                        break;
                    case 'deleteSecret':
                        if (message.key) {
                            await this.services.deleteSecret(message.key);
                            this.postMessage({ command: 'secretDeleted', key: message.key });
                        }
                        break;
                    case 'saveConfig':
                        if (message.key && message.value !== undefined) {
                            await this.services.setConfig(message.key, message.value);
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
                    case 'testClaude':
                        await this.testClaudeConnection();
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

    private async sendSettings(): Promise<void> {
        const hasAzurePAT = !!(await this.services.getSecret(SECRET_KEYS.AZURE_PAT));
        const hasClaudeToken = !!(await this.services.getSecret(SECRET_KEYS.CLAUDE_TOKEN));

        const settings: SettingsData = {
            orgHost: this.services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost),
            project: this.services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project),
            useAI: this.services.getConfig(CONFIG_KEYS.USE_AI, DEFAULT_CONFIG.useAI),
            generateDescription: this.services.getConfig(CONFIG_KEYS.GENERATE_DESCRIPTION, DEFAULT_CONFIG.generateDescription),
            autoAcceptAI: this.services.getConfig(CONFIG_KEYS.AUTO_ACCEPT_AI, DEFAULT_CONFIG.autoAcceptAI),
            claudeModel: this.services.getConfig(CONFIG_KEYS.CLAUDE_MODEL, DEFAULT_CONFIG.claudeModel),
            claudeMaxTokens: this.services.getConfig(CONFIG_KEYS.CLAUDE_MAX_TOKENS, DEFAULT_CONFIG.claudeMaxTokens),
            claudeTemperature: this.services.getConfig(CONFIG_KEYS.CLAUDE_TEMPERATURE, DEFAULT_CONFIG.claudeTemperature),
            apiVersion: this.services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion),
            hasAzurePAT,
            hasClaudeToken,
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

    private async testClaudeConnection(): Promise<void> {
        const token = await this.services.getSecret(SECRET_KEYS.CLAUDE_TOKEN);
        if (!token) {
            this.postMessage({ command: 'testResult', data: { type: 'claude', success: false, message: 'Token not configured' } });
            return;
        }

        try {
            const { ClaudeClient } = await import('../api/claude');
            const client = new ClaudeClient({
                apiKey: token,
                model: this.services.getConfig(CONFIG_KEYS.CLAUDE_MODEL, DEFAULT_CONFIG.claudeModel),
                maxTokens: 50,
                temperature: 0,
            });
            const result = await client.generate('Say "Hello" in one word.');
            if (result.error) {
                this.postMessage({ command: 'testResult', data: { type: 'claude', success: false, message: result.error } });
                
                // Track connection test failure
                this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                    type: 'claude',
                    success: false,
                });
            } else {
                this.postMessage({ command: 'testResult', data: { type: 'claude', success: true, message: 'Connected successfully!' } });
                
                // Track connection test success
                this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                    type: 'claude',
                    success: true,
                });
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.postMessage({ command: 'testResult', data: { type: 'claude', success: false, message } });

            // Track connection test failure
            this.services.analytics.track(AnalyticsEvents.CONNECTION_TESTED, {
                type: 'claude',
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
    <p class="subtitle">Configure your Azure DevOps and Claude AI settings in one place.</p>

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

    <!-- Claude AI Section -->
    <div class="section">
        <div class="section-header">
            <span class="icon">🤖</span>
            <h2>Claude AI Integration</h2>
            <span id="claude-status" class="status-badge status-not-configured">Not Configured</span>
        </div>
        
        <div class="form-group">
            <label for="claudeToken">
                Claude API Key
                <span id="claudeTokenSaved" class="saved-indicator hidden">✓ Saved</span>
                <div class="label-description">Get your API key from console.anthropic.com</div>
            </label>
            <div class="input-group">
                <input type="password" id="claudeToken" placeholder="sk-ant-...">
                <button class="btn-secondary btn-small" id="toggleClaudeToken" type="button">Show</button>
            </div>
            <div class="input-hint" id="claudeTokenHint"></div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="claudeModel">
                    Model
                    <div class="label-description">Claude model to use for generation</div>
                </label>
                <select id="claudeModel">
                    <option value="claude-sonnet-4-5">Claude Sonnet 4.5</option>
                    <option value="claude-3-5-sonnet-20241022">Claude 3.5 Sonnet</option>
                    <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                    <option value="claude-3-haiku-20240307">Claude 3 Haiku</option>
                </select>
            </div>
            <div class="form-group">
                <label for="claudeMaxTokens">
                    Max Tokens
                    <div class="label-description">Maximum response length</div>
                </label>
                <input type="number" id="claudeMaxTokens" min="100" max="4096" value="1024">
            </div>
        </div>
        
        <div class="form-group">
            <label for="claudeTemperature">
                Temperature
                <div class="label-description">Creativity level (0 = focused, 1 = creative)</div>
            </label>
            <input type="number" id="claudeTemperature" min="0" max="1" step="0.1" value="0.3">
        </div>
        
        <div class="actions">
            <button class="btn-primary" id="saveClaude">Save Claude Settings</button>
            <button class="btn-secondary" id="testClaude">Test Connection</button>
            <button class="btn-danger btn-small" id="clearClaudeToken">Clear Token</button>
        </div>
        
        <div id="claudeTestResult" class="test-result hidden"></div>
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
                <div class="toggle-description">Use Claude AI to generate PR titles and descriptions</div>
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
            claudeToken: document.getElementById('claudeToken'),
            claudeTokenSaved: document.getElementById('claudeTokenSaved'),
            claudeTokenHint: document.getElementById('claudeTokenHint'),
            claudeModel: document.getElementById('claudeModel'),
            claudeMaxTokens: document.getElementById('claudeMaxTokens'),
            claudeTemperature: document.getElementById('claudeTemperature'),
            useAI: document.getElementById('useAI'),
            generateDescription: document.getElementById('generateDescription'),
            autoAcceptAI: document.getElementById('autoAcceptAI'),
            enableTelemetry: document.getElementById('enableTelemetry'),
            azureStatus: document.getElementById('azure-status'),
            claudeStatus: document.getElementById('claude-status'),
            azureTestResult: document.getElementById('azureTestResult'),
            claudeTestResult: document.getElementById('claudeTestResult'),
        };
        
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
        setupPasswordToggle('claudeToken', 'toggleClaudeToken');
        
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
            vscode.postMessage({ command: 'saveConfig', key: 'orgHost', value: elements.orgHost.value });
            vscode.postMessage({ command: 'saveConfig', key: 'project', value: elements.project.value });
            vscode.postMessage({ command: 'saveConfig', key: 'apiVersion', value: elements.apiVersion.value });
            if (elements.azurePAT.value) {
                vscode.postMessage({ command: 'saveSecret', key: 'azureDevOpsPAT', value: elements.azurePAT.value });
            }
            showToast('Azure settings saved');
        });
        
        // Save Claude settings
        document.getElementById('saveClaude').addEventListener('click', () => {
            vscode.postMessage({ command: 'saveConfig', key: 'claudeModel', value: elements.claudeModel.value });
            vscode.postMessage({ command: 'saveConfig', key: 'claudeMaxTokens', value: parseInt(elements.claudeMaxTokens.value) });
            vscode.postMessage({ command: 'saveConfig', key: 'claudeTemperature', value: parseFloat(elements.claudeTemperature.value) });
            if (elements.claudeToken.value) {
                vscode.postMessage({ command: 'saveSecret', key: 'claudeToken', value: elements.claudeToken.value });
            }
            showToast('Claude settings saved');
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
        
        document.getElementById('testClaude').addEventListener('click', () => {
            elements.claudeTestResult.textContent = 'Testing...';
            elements.claudeTestResult.className = 'test-result';
            elements.claudeTestResult.classList.remove('hidden');
            vscode.postMessage({ command: 'testClaude' });
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
        
        document.getElementById('clearClaudeToken').addEventListener('click', () => {
            vscode.postMessage({ command: 'deleteSecret', key: 'claudeToken' });
            elements.claudeToken.value = '';
            elements.claudeToken.placeholder = 'sk-ant-...';
            elements.claudeTokenSaved.classList.add('hidden');
            elements.claudeTokenHint.textContent = '';
            updateStatus(elements.claudeStatus, false);
            showToast('Token cleared');
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
                    elements.claudeModel.value = s.claudeModel || 'claude-sonnet-4-5';
                    elements.claudeMaxTokens.value = s.claudeMaxTokens || 1024;
                    elements.claudeTemperature.value = s.claudeTemperature || 0.3;
                    elements.useAI.checked = s.useAI !== false;
                    elements.generateDescription.checked = s.generateDescription !== false;
                    elements.autoAcceptAI.checked = s.autoAcceptAI === true;
                    elements.enableTelemetry.checked = s.enableTelemetry !== false;
                    updateStatus(elements.azureStatus, s.hasAzurePAT);
                    updateStatus(elements.claudeStatus, s.hasClaudeToken);
                    
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
                    
                    if (s.hasClaudeToken) {
                        elements.claudeToken.placeholder = '••••••••••••••••••••••••••••••••';
                        elements.claudeToken.value = '';
                        elements.claudeTokenSaved.classList.remove('hidden');
                        elements.claudeTokenHint.textContent = 'API key is securely stored. Enter a new value to replace it.';
                        elements.claudeTokenHint.className = 'input-hint has-value';
                    } else {
                        elements.claudeToken.placeholder = 'sk-ant-...';
                        elements.claudeTokenSaved.classList.add('hidden');
                        elements.claudeTokenHint.textContent = '';
                        elements.claudeTokenHint.className = 'input-hint';
                    }
                    break;
                    
                case 'testResult':
                    const result = msg.data;
                    if (result.type === 'azure') {
                        showTestResult(elements.azureTestResult, result.success, result.message);
                    } else if (result.type === 'claude') {
                        showTestResult(elements.claudeTestResult, result.success, result.message);
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
