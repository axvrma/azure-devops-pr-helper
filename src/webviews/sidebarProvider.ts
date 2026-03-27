import * as vscode from 'vscode';
import { ExtensionServices, WebviewMessage } from '../types';
import { COMMANDS, SECRET_KEYS, STATE_KEYS } from '../utils/constants';
import { getCommitMessages, getCurrentBranch, getCurrentRepoName, getGitDiff } from '../utils/git';
import { getNonce } from '../utils/helpers';

export class SidebarProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeSidebarView';
    private view?: vscode.WebviewView;

    constructor(private readonly services: ExtensionServices) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
        };

        webviewView.webview.html = this.getHtml(webviewView.webview);
        this.setupMessageHandler(webviewView);
    }

    private setupMessageHandler(webviewView: vscode.WebviewView): void {
        webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
            switch (message.command) {
                case 'generateTitle':
                    // Get git diff for context
                    const targetBranch = (message as { targetBranch?: string }).targetBranch;
                    const diff = getGitDiff(targetBranch);
                    const commits = getCommitMessages(targetBranch);
                    
                    const result = await vscode.commands.executeCommand(
                        COMMANDS.GENERATE_CLAUDE_TITLE,
                        { 
                            prompt: message.prompt, 
                            branch: message.branch,
                            diff,
                            commits,
                        }
                    );
                    webviewView.webview.postMessage({ command: 'titleResult', result });
                    break;

                case 'getContext':
                    const hasAzure = !!(await this.services.getSecret(SECRET_KEYS.AZURE_PAT));
                    const hasClaude = !!(await this.services.getSecret(SECRET_KEYS.CLAUDE_TOKEN));
                    const branch = getCurrentBranch() ?? '';
                    const repo = getCurrentRepoName() ?? '';
                    const lastPrUrl = this.services.getState<string>(STATE_KEYS.LAST_PR_URL);
                    webviewView.webview.postMessage({
                        command: 'context',
                        data: { hasAzure, hasClaude, branch, repo, lastPrUrl }
                    });
                    break;

                case 'openSettings':
                    vscode.commands.executeCommand(COMMANDS.OPEN_SETTINGS);
                    break;

                case 'copyPrUrl':
                    vscode.commands.executeCommand(COMMANDS.COPY_PR_URL);
                    break;

                case 'raisePR':
                    vscode.commands.executeCommand(COMMANDS.RAISE_PR);
                    break;
                
                case 'openPRCreator':
                    vscode.commands.executeCommand('extension.openPRCreator');
                    break;
            }
        });
    }

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
        * {
            box-sizing: border-box;
        }
        
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
        
        .context-row:last-child {
            margin-bottom: 0;
        }
        
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
        
        .status-ok {
            background: var(--vscode-testing-iconPassed);
        }
        
        .status-warning {
            background: var(--vscode-inputValidation-warningBackground);
        }
        
        textarea {
            width: 100%;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            font-family: inherit;
            font-size: 12px;
            resize: vertical;
            min-height: 60px;
        }
        
        textarea:focus {
            outline: none;
            border-color: var(--vscode-focusBorder);
        }
        
        .button-row {
            display: flex;
            gap: 6px;
            margin: 12px 0;
            flex-wrap: wrap;
        }
        
        button {
            padding: 6px 12px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 4px;
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
            flex: 1;
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-icon {
            padding: 6px 8px;
        }
        
        .result-section {
            margin-top: 16px;
        }
        
        .result-label {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        
        .result-box {
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            padding: 10px;
            min-height: 40px;
            font-size: 13px;
            line-height: 1.4;
            word-break: break-word;
        }
        
        .result-box.error {
            border-color: var(--vscode-inputValidation-errorBorder);
            color: var(--vscode-inputValidation-errorForeground);
        }
        
        .result-box.loading {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        
        .divider {
            height: 1px;
            background: var(--vscode-panel-border);
            margin: 16px 0;
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
        
        .quick-action:hover {
            background: var(--vscode-list-activeSelectionBackground);
        }
        
        .quick-action.primary-action {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .quick-action.primary-action:hover {
            opacity: 0.9;
        }
        
        .quick-action.primary-action .quick-action-desc {
            color: var(--vscode-button-foreground);
            opacity: 0.8;
        }
        
        .quick-action-icon {
            font-size: 16px;
        }
        
        .quick-action-text {
            flex: 1;
        }
        
        .quick-action-title {
            font-weight: 500;
        }
        
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
        
        .hidden {
            display: none !important;
        }
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
            <span class="status-dot" id="claudeStatus"></span>
            <span class="context-label">Claude</span>
        </div>
    </div>
    
    <div id="warningBanner" class="warning-banner hidden">
        <span>⚠️</span>
        <span id="warningText">Configuration needed</span>
        <button id="openSettingsFromWarning">Settings</button>
    </div>
    
    <!-- AI Title Generator - only visible when Claude is configured -->
    <div id="titleGeneratorSection" class="hidden">
        <textarea id="customPrompt" placeholder="Optional: Describe the style you want (e.g., 'Mahishmati style', 'conventional commits format'). The diff will be analyzed automatically..."></textarea>
        
        <div class="form-group" style="margin: 8px 0;">
            <label style="font-size: 11px; color: var(--vscode-descriptionForeground);">Target Branch (for diff comparison)</label>
            <input type="text" id="targetBranch" placeholder="main" style="width: 100%; padding: 6px 8px; font-size: 12px; border: 1px solid var(--vscode-input-border); border-radius: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground);">
        </div>
        
        <div class="button-row">
            <button class="btn-primary" id="generateBtn">
                <span>✨</span> Generate Title
            </button>
            <button class="btn-secondary btn-icon" id="settingsBtn" title="Open Settings">⚙️</button>
        </div>
        
        <div class="result-section">
            <div class="result-label">Generated Result</div>
            <div class="result-box" id="resultBox">Click "Generate Title" to analyze your changes and get an AI-suggested PR title</div>
        </div>
        
        <div class="divider"></div>
    </div>
    
    <div class="quick-actions">
            <div class="quick-action primary-action" id="openPRCreatorAction">
                <span class="quick-action-icon">🚀</span>
                <div class="quick-action-text">
                    <div class="quick-action-title">Create Pull Request</div>
                    <div class="quick-action-desc">Open full PR creation page</div>
                </div>
            </div>
            <div class="quick-action" id="copyUrlAction">
                <span class="quick-action-icon">📋</span>
                <div class="quick-action-text">
                    <div class="quick-action-title">Copy Last PR URL</div>
                    <div class="quick-action-desc" id="lastPrInfo">No PR created yet</div>
                </div>
            </div>
        </div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        
        const elements = {
            branchName: document.getElementById('branchName'),
            repoName: document.getElementById('repoName'),
            azureStatus: document.getElementById('azureStatus'),
            claudeStatus: document.getElementById('claudeStatus'),
            titleGeneratorSection: document.getElementById('titleGeneratorSection'),
            customPrompt: document.getElementById('customPrompt'),
            targetBranch: document.getElementById('targetBranch'),
            generateBtn: document.getElementById('generateBtn'),
            settingsBtn: document.getElementById('settingsBtn'),
            resultBox: document.getElementById('resultBox'),
            warningBanner: document.getElementById('warningBanner'),
            warningText: document.getElementById('warningText'),
            lastPrInfo: document.getElementById('lastPrInfo'),
        };
        
        let isGenerating = false;
        
        // Generate title
        elements.generateBtn.addEventListener('click', () => {
            if (isGenerating) return;
            
            isGenerating = true;
            elements.generateBtn.disabled = true;
            elements.resultBox.textContent = 'Analyzing diff and generating...';
            elements.resultBox.className = 'result-box loading';
            
            vscode.postMessage({
                command: 'generateTitle',
                prompt: elements.customPrompt.value || undefined,
                targetBranch: elements.targetBranch.value || 'main'
            });
        });
        
        // Settings button
        elements.settingsBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });
        
        document.getElementById('openSettingsFromWarning').addEventListener('click', () => {
            vscode.postMessage({ command: 'openSettings' });
        });
        
        // Quick actions
        document.getElementById('openPRCreatorAction').addEventListener('click', () => {
            vscode.postMessage({ command: 'openPRCreator' });
        });
        
        document.getElementById('copyUrlAction').addEventListener('click', () => {
            vscode.postMessage({ command: 'copyPrUrl' });
        });
        
        // Handle messages
        window.addEventListener('message', event => {
            const msg = event.data;
            
            switch (msg.command) {
                case 'context':
                    const ctx = msg.data;
                    elements.branchName.textContent = ctx.branch || 'Not detected';
                    elements.repoName.textContent = ctx.repo || 'Not detected';
                    
                    elements.azureStatus.className = 'status-dot ' + (ctx.hasAzure ? 'status-ok' : 'status-warning');
                    elements.claudeStatus.className = 'status-dot ' + (ctx.hasClaude ? 'status-ok' : 'status-warning');
                    
                    if (ctx.lastPrUrl) {
                        elements.lastPrInfo.textContent = 'Click to copy URL';
                    }
                    
                    // Show/hide title generator based on Claude token
                    if (ctx.hasClaude) {
                        elements.titleGeneratorSection.classList.remove('hidden');
                    } else {
                        elements.titleGeneratorSection.classList.add('hidden');
                    }
                    
                    // Show warning only if Azure is not configured (Claude warning handled by hiding section)
                    if (!ctx.hasAzure) {
                        elements.warningBanner.classList.remove('hidden');
                        elements.warningText.textContent = 'Azure PAT not configured';
                    } else {
                        elements.warningBanner.classList.add('hidden');
                    }
                    break;
                    
                case 'titleResult':
                    isGenerating = false;
                    elements.generateBtn.disabled = false;
                    
                    const result = msg.result;
                    if (result?.title) {
                        elements.resultBox.textContent = result.title;
                        elements.resultBox.className = 'result-box';
                    } else {
                        elements.resultBox.textContent = 'Error: ' + (result?.error || 'Unknown error');
                        elements.resultBox.className = 'result-box error';
                    }
                    break;
            }
        });
        
        // Load context on init
        vscode.postMessage({ command: 'getContext' });
    </script>
</body>
</html>
`;
    }
}
