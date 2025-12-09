import axios from 'axios';
import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { orgConfig } from './org-config';

// Keep previously used PR URL
let lastPrUrl: string | undefined;

/**
 * Sidebar and settings keys used in SecretStorage
 */
const SECRET_KEYS = {
    AZURE_PAT: 'azureDevOpsPAT',
    CLAUDE_TOKEN: 'claudeToken',
    ORG_HOST: 'orgHost', // optional string setting (not secret)
    ORG_PROJECT: 'orgProject' // optional string setting (not secret)
};

function normalizeBaseUrl(u: string | undefined) {
    if (!u) return u;
    return u.replace(/\/+$/, '');
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Activating Azure DevOps PR Helper extension');
    try {
        const restored = context.globalState.get<string>('lastPrUrl');
        if (restored) lastPrUrl = restored;
        // ------- existing commands (unchanged, but slightly refactored) -------
        context.subscriptions.push(
            vscode.commands.registerCommand('extension.copyPrUrl', async () => {
                if (lastPrUrl) {
                    await vscode.env.clipboard.writeText(lastPrUrl);
                    vscode.window.showInformationMessage('PR URL copied to clipboard.');
                } else {
                    vscode.window.showWarningMessage('No PR URL to copy.');
                }
            })
        );

        context.subscriptions.push(
            vscode.commands.registerCommand('extension.clearPAT', async () => {
                await context.secrets.delete(SECRET_KEYS.AZURE_PAT);
                vscode.window.showInformationMessage('Azure DevOps PAT has been cleared.');
            })
        );

        // Keep the raisePR command identical but read PAT from secrets key name
        context.subscriptions.push(
            vscode.commands.registerCommand('extension.raisePR', async () => {
                // 1. Ensure PAT is stored
                let pat = await context.secrets.get(SECRET_KEYS.AZURE_PAT);
                if (!pat) {
                    const entry = await vscode.window.showInputBox({ prompt: 'Enter your Azure DevOps PAT', password: true });
                    if (!entry) { return; }
                    await context.secrets.store(SECRET_KEYS.AZURE_PAT, entry);
                    pat = entry;
                }

                // 2. Pick repository

                // 3. Prompt for source & target branches
                const cfg = vscode.workspace.getConfiguration('azureDevopsPr');
                const orgUrl: any = cfg.get('orgHost', orgConfig.orgHost);
                const project: any = cfg.get('project', orgConfig.project);
                const repoId = await pickRepo(orgUrl, project, pat);
                if (!repoId) { return; }

                const useAI = cfg.get<boolean>('useAI', true);
                const genDescription = cfg.get<boolean>('generateDescription', true);

                const currentBranch = getCurrentBranch();
                const source = await vscode.window.showInputBox({
                    prompt: 'Source branch (e.g. feature/xyz)',
                    value: currentBranch
                });
                if (!source) { return; }

                const target = await vscode.window.showInputBox({
                    prompt: 'Target branch (e.g. main)'
                });
                if (!target) { return; }

                let generatedTitle: string | undefined;
                let generatedDescription: string | undefined;

                // If user enabled AI generation, attempt to get suggestions from Claude
                if (useAI) {
                    const branchName = currentBranch || 'feature';
                    const repoName = getCurrentRepoName() || 'repo';

                    try {
                        // generate title
                        const titleResult: any = await vscode.commands.executeCommand('extension.generateClaudeTitle', {
                            prompt: `Generate a clear concise PR title (max 60 chars) for changes on branch "${branchName}" in repository "${repoName}". Be descriptive and action-oriented.`,
                            branch: branchName
                        });
                        console.log('Claude titleResult:', titleResult);
                        if (titleResult?.title && typeof titleResult.title === 'string' && titleResult.title.trim().length > 0) {
                            generatedTitle = titleResult.title.trim();
                        } else if (titleResult?.error) {
                            // show the error so the user knows why AI didn't populate
                            vscode.window.showWarningMessage(`Claude title generation failed: ${String(titleResult.error)}`);
                        } else {
                            console.warn('Claude returned no title and no error:', titleResult);
                        }

                        // optionally generate description
                        if (genDescription) {
                            const descResult: any = await vscode.commands.executeCommand('extension.generateClaudeTitle', {
                                prompt: `Write a concise PR description for changes on branch "${branchName}" in repository "${repoName}". Include the main intent, what was changed, and a short testing note.`,
                                branch: branchName
                            });
                            console.log('Claude descResult:', descResult);
                            if (descResult?.title && typeof descResult.title === 'string') {
                                generatedDescription = descResult.title.trim();
                            } else if (descResult?.error) {
                                vscode.window.showWarningMessage(`Claude description generation failed: ${String(descResult.error)}`);
                            } else {
                                console.warn('Claude description returned no text and no error:', descResult);
                            }
                        }
                    } catch (err) {
                        console.error('AI generation caught an exception:', err);
                        vscode.window.showWarningMessage('AI generation failed (see console). Proceeding to manual input.');
                    }
                }


                const autoAccept = cfg.get<boolean>('autoAcceptAI', false) || useAI;

                // If autoAccept and AI provided, use generated directly
                let title: string | undefined;
                let description: string | undefined;

                if (useAI && autoAccept && generatedTitle) {
                    title = generatedTitle;
                } else {
                    // Prompt for PR title (prefilled with generated suggestion if available)
                    title = await vscode.window.showInputBox({
                        prompt: 'PR Title',
                        value: generatedTitle ?? undefined,
                        placeHolder: generatedTitle ? 'Generated by Claude — edit as needed' : undefined
                    });
                    if (!title) { return; }
                }

                if (useAI && autoAccept && genDescription && generatedDescription) {
                    description = generatedDescription;
                } else {
                    description = await vscode.window.showInputBox({
                        prompt: 'PR Description',
                        value: generatedDescription ?? undefined,
                        placeHolder: generatedDescription ? 'Generated by Claude — edit as needed' : undefined
                    });
                    if (description === undefined) { return; }
                }


                // 5. Create the PR
                const base = normalizeBaseUrl(orgUrl);
                const prApi = `${base}/${project}/_apis/git/repositories/${repoId}/pullrequests?api-version=7.1`;
                let resp: any;
                try {
                    resp = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Creating PR...' }, async () => {
                        return await axios.post(prApi, {
                            sourceRefName: `refs/heads/${source}`,
                            targetRefName: `refs/heads/${target}`,
                            title,
                            description
                        }, {
                            headers: {
                                Authorization: 'Basic ' + Buffer.from(`:${pat}`).toString('base64'),
                                'Content-Type': 'application/json'
                            }
                        });
                    });
                } catch (err: any) {
                    const status = err.response?.status;
                    const body = err.response?.data;
                    const msg = body?.message ?? (body?.error ?? err.message);
                    console.error('Azure API error', { status, body });
                    vscode.window.showErrorMessage(`PR creation failed${status ? ` (${status})` : ''}: ${msg}`);
                    return;
                }


                // 6. Capture PR URL
                if (!resp || !resp.data) {
                    vscode.window.showErrorMessage('PR creation failed: unexpected response from server.');
                    return;
                }

                const pr = resp.data;
                const webUrl = pr._links?.web?.href
                    ?? `${orgUrl}/${project}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
                lastPrUrl = webUrl;
                await context.globalState.update('lastPrUrl', webUrl);


                // 7. Prompt for Work Item linkage
                const wiInput = await vscode.window.showInputBox({
                    prompt: 'Enter Work Item ID(s) to link (comma-separated), or leave blank'
                });
                if (wiInput) {
                    const ids = wiInput.split(',').map(i => i.trim()).filter(Boolean);
                    for (const id of ids) {
                        if (!pr.artifactId) {
                            console.warn('PR created but artifactId missing. Skipping work item linking.');
                            vscode.window.showWarningMessage('PR created but artifactId missing — work item linking skipped.');
                        } else {
                            await linkWorkItem(orgUrl, project, pat, id, pr.artifactId);
                        }

                    }
                }

                // 8. Notify
                vscode.window.showInformationMessage('PR created', 'Open in browser', 'Copy URL').then(choice => {
                    if (choice === 'Copy URL') {
                        vscode.commands.executeCommand('extension.copyPrUrl');
                    }
                    if (choice === 'Open in browser') {
                        if (lastPrUrl) {
                            vscode.env.openExternal(vscode.Uri.parse(lastPrUrl));
                        } else {
                            vscode.window.showWarningMessage('No PR URL available to open.');
                        }
                    }

                });
            })
        );

        // ------- New: Sidebar view provider (Claude Title) -------
        const claudeViewProvider = new ClaudeSidebarProvider(context);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider('claudeSidebarView', claudeViewProvider)
        );

        // ------- New: Settings webview command -------
        context.subscriptions.push(
            vscode.commands.registerCommand('extension.openClaudeSettings', async () => {
                const panel = vscode.window.createWebviewPanel(
                    'claudeSettings',
                    'Claude & DevOps Settings',
                    vscode.ViewColumn.One,
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true
                    }
                );

                panel.webview.html = getSettingsHtml(panel.webview, context);
                // handle messages from webview
                panel.webview.onDidReceiveMessage(async (msg) => {
                    if (msg.command === 'saveSecret') {
                        await context.secrets.store(msg.key, msg.value);
                        panel.webview.postMessage({ command: 'saved', key: msg.key });
                    } else if (msg.command === 'deleteSecret') {
                        await context.secrets.delete(msg.key);
                        panel.webview.postMessage({ command: 'deleted', key: msg.key });
                    } else if (msg.command === 'getSecrets') {
                        const azure = await context.secrets.get(SECRET_KEYS.AZURE_PAT);
                        const claude = await context.secrets.get(SECRET_KEYS.CLAUDE_TOKEN);
                        panel.webview.postMessage({ command: 'secrets', data: { azure, claude } });
                    } else if (msg.command === 'setSetting') {
                        try {
                            const cfg = vscode.workspace.getConfiguration('azureDevopsPr');
                            // msg.key will be 'orgHost' or 'orgProject'
                            await cfg.update(msg.key, msg.value, vscode.ConfigurationTarget.Global);
                            panel.webview.postMessage({ command: 'settingSaved', key: msg.key });
                        } catch (e) {
                            console.error('Failed saving setting to workspace configuration', e);
                            panel.webview.postMessage({ command: 'settingSaveFailed', key: msg.key, error: String(e) });
                        }
                    } else if (msg.command === 'getSettings') {
                        const cfg = vscode.workspace.getConfiguration('azureDevopsPr');
                        const orgHost = cfg.get<string>('orgHost', orgConfig.orgHost);
                        const project = cfg.get<string>('project', orgConfig.project);
                        panel.webview.postMessage({ command: 'settings', data: { orgHost, project } });
                    }
                });

            })
        );

        // allow webviews to call generate title via a command
        context.subscriptions.push(
            vscode.commands.registerCommand('extension.generateClaudeTitle', async (args) => {
                // args may include prompt override or branch
                const claudeToken = await context.secrets.get(SECRET_KEYS.CLAUDE_TOKEN);
                if (!claudeToken) {
                    vscode.window.showWarningMessage('Claude token not found. Open settings to set it.', 'Open Settings')
                        .then(choice => { if (choice === 'Open Settings') vscode.commands.executeCommand('extension.openClaudeSettings'); });
                    return { error: 'no-token' };
                }

                // craft prompt: by default use current branch name to generate a short title.
                const branch = getCurrentBranch() || args?.branch || 'feature';
                const repo = getCurrentRepoName() || 'repo';
                const prompt = args?.prompt
                    ?? `Generate a clear concise PR title (max 60 chars) for changes on branch "${branch}" in repository "${repo}". Be descriptive and action-oriented.`;

                try {
                    const endpoint = "https://api.anthropic.com/v1/messages";
                    const model = "claude-sonnet-4-5"; // "sonnet-4.5" is typically exposed as claude-3.5-sonnet

                    // Anthropic messages API expects a messages array, not a single prompt string
                    const res = await axios.post(endpoint, {
                        model,
                        max_tokens: 1024,
                        temperature: 0.3,
                        messages: [
                            {
                                role: "user",
                                content: prompt
                            }
                        ]
                    }, {
                        headers: {
                            "Content-Type": "application/json",
                            "x-api-key": claudeToken,
                            "anthropic-version": "2023-06-01"
                        },
                        timeout: 20000
                    });

                    // Extract text
                    let text = "";
                    if (Array.isArray(res.data?.content) && res.data.content.length > 0) {
                        text = res.data.content.map((c: any) => c.text ?? "").join("\n");
                    } else {
                        text = res.data?.content?.[0]?.text ?? JSON.stringify(res.data);
                    }

                    const title = text.split("\n").find(s => s.trim().length > 0) ?? text;
                    return { title: title.trim(), raw: res.data, status: res.status };
                } catch (err: any) {
                    console.error('Claude error', err?.response?.data ?? err.message);
                    return { error: err?.response?.data ?? err.message };
                }
            })
        );

        // Provide the command to open the settings from the sidebar as well
        context.subscriptions.push(
            vscode.commands.registerCommand('extension.openClaudeSidebarSettings', () => {
                vscode.commands.executeCommand('extension.openClaudeSettings');
            })
        );
    } catch (err) {
        console.error('Activation error in Azure DevOps PR Helper:', err);
        // Rethrow so VS Code knows activation failed (useful in dev host logs)
        throw err;
    }
}

// ---------- Webview provider for the sidebar ----------
class ClaudeSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    constructor (private readonly context: vscode.ExtensionContext) { }

    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getSidebarHtml(webviewView.webview, this.context);

        webviewView.webview.onDidReceiveMessage(async (msg) => {
            if (msg.command === 'generateTitle') {
                const result = await vscode.commands.executeCommand('extension.generateClaudeTitle', { prompt: msg.prompt, branch: msg.branch });
                webviewView.webview.postMessage({ command: 'titleResult', result });
            } else if (msg.command === 'getStoredTokens') {
                const azure = await this.context.secrets.get(SECRET_KEYS.AZURE_PAT);
                const claude = await this.context.secrets.get(SECRET_KEYS.CLAUDE_TOKEN);
                const branch = getCurrentBranch() ?? '';
                const repo = getCurrentRepoName() ?? '';
                webviewView.webview.postMessage({ command: 'storedTokens', data: { azure, claude, branch, repo } });
            } else if (msg.command === 'openSettings') {
                vscode.commands.executeCommand('extension.openClaudeSettings');
            } else if (msg.command === 'copyPrUrl') {
                if (lastPrUrl) {
                    await vscode.env.clipboard.writeText(lastPrUrl);
                    vscode.window.showInformationMessage('PR URL copied to clipboard from sidebar.');
                } else {
                    vscode.window.showWarningMessage('No PR URL to copy.');
                }
            }
        });
    }
}

export function deactivate() { }

// ---------------- Helper functions (existing ones reused) ----------------

function getWorkspaceRoot(): string | undefined {
    const ws = vscode.workspace.workspaceFolders;
    return ws && ws.length > 0 ? ws[0].uri.fsPath : undefined;
}

function getCurrentBranch(): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) { return undefined; }
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8', cwd }).trim();
    } catch {
        return undefined;
    }
}

function getCurrentRepoName(): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) return undefined;
    try {
        const url = execSync('git config --get remote.origin.url', { encoding: 'utf8', cwd }).trim();
        // Support formats like: git@ssh.dev.azure.com:v3/org/project/repo or https://dev.azure.com/org/project/_git/repo
        const parts = url.replace(/(^.*[:\/])|(\.git$)/g, '').split('/');
        return parts[parts.length - 1] || undefined;
    } catch {
        return undefined;
    }
}


async function pickRepo(orgUrl: string, project: string, pat: string): Promise<string | undefined> {
    if (!orgUrl || !project) {
        vscode.window.showErrorMessage('Org Host or Project is not configured. Open settings to configure orgHost and orgProject.');
        return undefined;
    }

    const current = getCurrentRepoName();

    const listUrl = `${normalizeBaseUrl(orgUrl)}/${project}/_apis/git/repositories?api-version=7.1`;

    try {
        const resp = await axios.get(listUrl, {
            headers: { Authorization: 'Basic ' + Buffer.from(`:${pat}`).toString('base64') },
            timeout: 15000
        });

        const items = resp.data?.value;
        if (!Array.isArray(items) || items.length === 0) {
            vscode.window.showWarningMessage('No repositories returned from Azure DevOps. Check org/project and PAT permissions.');
            return undefined;
        }

        const picks: Array<{ label: string; id: string }> = items.map((r: any) => ({
            label: r.name,
            id: r.id
        }));

        if (current) {
            const match = picks.find(p => p.label === current);
            if (match) return match.id;
        }

        const sel = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select repository'
        });
        return sel?.id;
    } catch (err: any) {
        const status = err.response?.status;
        const body = err.response?.data;
        const msg = body?.message ?? (body?.error ?? err.message);
        console.error('Failed to list repositories', { listUrl, status, body });
        vscode.window.showErrorMessage(`Failed listing repositories${status ? ` (${status})` : ''}: ${msg}`);
        return undefined;
    }
}


async function linkWorkItem(
    orgUrl: string,
    project: string,
    pat: string,
    workItemId: string,
    artifactId: string
) {
    const patchUrl = `${orgUrl}/${project}/_apis/wit/workitems/${workItemId}?api-version=7.1`;
    const patchBody = [
        {
            op: 'add',
            path: '/relations/-',
            value: {
                rel: 'ArtifactLink',
                url: artifactId,
                attributes: { name: 'Pull Request' }
            }
        }
    ];
    try {
        await axios.patch(patchUrl, patchBody, {
            headers: {
                Authorization: 'Basic ' + Buffer.from(`:${pat}`).toString('base64'),
                'Content-Type': 'application/json-patch+json'
            }
        });
        vscode.window.showInformationMessage(`Linked PR to Work Item ${workItemId}`);
    } catch (err: any) {
        vscode.window.showErrorMessage(`Failed linking Work Item ${workItemId}: ${err.message}`);
    }
}

// ---------------- Webview HTML builders ----------------

function getSidebarHtml(webview: vscode.Webview, context: vscode.ExtensionContext) {
    const nonce = getNonce();
    return /* html */`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https:; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Claude Titles</title>
</head>
<body style="font-family: sans-serif; padding: 10px;">
    <h3>Claude Title Generator</h3>
    <div>
        <label>Branch (auto-detected):</label>
        <div id="branch" style="font-weight:600"></div>
    </div>
    <div style="margin-top:8px;">
        <textarea id="prompt" rows="4" style="width:100%;" placeholder="Optional custom prompt to Claude"></textarea>
    </div>
    <div style="display:flex; gap:8px; margin-top:8px;">
        <button id="gen">Generate Title</button>
        <button id="openSettings">Settings</button>
        <button id="copyPr" title="Copy last created PR URL">Copy PR URL</button>
    </div>

    <hr/>

    <div>
        <strong>Generated Title</strong>
        <div id="result" style="margin-top:8px; padding:8px; border-radius:6px; background:#f3f3f3; min-height:36px;"></div>
    </div>

<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const branchEl = document.getElementById('branch');
    const promptEl = document.getElementById('prompt');
    const resultEl = document.getElementById('result');
    const genBtn = document.getElementById('gen');
    const settingsBtn = document.getElementById('openSettings');
    const copyBtn = document.getElementById('copyPr');

    // initialize branch display
    (async () => {
        // ask extension to provide current branch
        // We can pass a message and expect extension to respond with titleResult asynchronously later,
        // but simpler: let extension determine branch when generating.
        branchEl.textContent = 'Detecting...';
        // Ask extension for stored tokens (so we can hint)
        vscode.postMessage({ command: 'getStoredTokens' });
    })();

    genBtn.addEventListener('click', () => {
        resultEl.textContent = 'Generating…';
        vscode.postMessage({ command: 'generateTitle', prompt: promptEl.value || undefined });
    });

    settingsBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'openSettings' });
    });

    copyBtn.addEventListener('click', () => {
        vscode.postMessage({ command: 'copyPrUrl' });
    });

    window.addEventListener('message', event => {
        const msg = event.data;
        if (msg.command === 'titleResult') {
            const r = msg.result;
            if (r?.title) {
                resultEl.textContent = r.title;
            } else {
                resultEl.textContent = 'Error: ' + (r?.error || 'unknown');
            }
        } else if (msg.command === 'storedTokens') {
    const { azure, claude, branch, repo } = msg.data;
    branchEl.textContent = branch ? (branch + (repo ?  repo : '')) : 'Branch not detected';
    if (!claude) promptEl.placeholder = 'Claude token missing. Open Settings to set it.';
}

    });
</script>
</body>
</html>
`;
}

function getSettingsHtml(webview: vscode.Webview, context: vscode.ExtensionContext) {
    const nonce = getNonce();
    return /* html */`
<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<title>Claude & DevOps Settings</title>
</head>
<body style="font-family: sans-serif; padding: 12px;">
    <h2>Azure DevOps & Claude Settings</h2>
    <p style="margin-top:0;">Secure tokens are stored using VS Code SecretStorage.</p>

    <!-- Host and Project configuration -->
    <div style="margin-top:12px;">
        <label><strong>Host (Org URL)</strong></label><br/>
        <input id="orgHost" placeholder="e.g. https://dpwhotfsonline.visualstudio.com" style="width:70%" />
        <button id="saveOrgHost">Save</button>
    </div>

    <div style="margin-top:12px;">
        <label><strong>Project</strong></label><br/>
        <input id="orgProject" placeholder="e.g. DTLP" style="width:70%" />
        <button id="saveOrgProject">Save</button>
    </div>

    <hr style="margin:20px 0"/>

    <!-- Token configuration -->
    <div>
        <label><strong>Azure DevOps PAT</strong></label><br/>
        <input id="azure" placeholder="Click Load to see if a PAT exists" style="width:70%" type="password"/>
        <button id="saveAzure">Save</button>
        <button id="deleteAzure">Delete</button>
        <button id="loadSecrets">Load</button>
    </div>

    <div style="margin-top:12px;">
        <label><strong>Claude Token (x-api-key)</strong></label><br/>
        <input id="claude" placeholder="Claude token" style="width:70%" type="password"/>
        <button id="saveClaude">Save</button>
        <button id="deleteClaude">Delete</button>
    </div>

    <div id="status" style="margin-top:16px;color:green;"></div>

    <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const azure = document.getElementById('azure');
        const claude = document.getElementById('claude');
        const orgHostEl = document.getElementById('orgHost');
        const orgProjectEl = document.getElementById('orgProject');

        const saveOrgHost = document.getElementById('saveOrgHost');
        const saveOrgProject = document.getElementById('saveOrgProject');
        const loadBtn = document.getElementById('loadSecrets');
        const saveAzureBtn = document.getElementById('saveAzure');
        const deleteAzureBtn = document.getElementById('deleteAzure');
        const saveClaudeBtn = document.getElementById('saveClaude');
        const deleteClaudeBtn = document.getElementById('deleteClaude');
        const status = document.getElementById('status');

        loadBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'getSecrets' });
            vscode.postMessage({ command: 'getSettings' });
        });

        saveAzureBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'saveSecret', key: 'azureDevOpsPAT', value: azure.value });
        });
        deleteAzureBtn.addEventListener('click', () => vscode.postMessage({ command: 'deleteSecret', key: 'azureDevOpsPAT' }));

        saveClaudeBtn.addEventListener('click', () => {
            vscode.postMessage({ command: 'saveSecret', key: 'claudeToken', value: claude.value });
        });
        deleteClaudeBtn.addEventListener('click', () => vscode.postMessage({ command: 'deleteSecret', key: 'claudeToken' }));

        saveOrgHost.addEventListener('click', () => {
            vscode.postMessage({ command: 'setSetting', key: 'orgHost', value: orgHostEl.value });
        });
        saveOrgProject.addEventListener('click', () => {
            vscode.postMessage({ command: 'setSetting', key: 'orgProject', value: orgProjectEl.value });
        });

        window.addEventListener('message', event => {
            const msg = event.data;
            if (msg.command === 'secrets') {
                const { azure: a, claude: c } = msg.data;
                azure.value = a ?? '';
                claude.value = c ?? '';
                status.textContent = 'Secrets loaded.';
                setTimeout(() => status.textContent = '', 2500);
            } else if (msg.command === 'settings') {
                orgHostEl.value = msg.data.orgHost ?? '';
                orgProjectEl.value = msg.data.orgProject ?? '';
            } else if (msg.command === 'saved') {
                status.textContent = 'Saved ' + msg.key;
                setTimeout(() => status.textContent = '', 2000);
            } else if (msg.command === 'deleted') {
                status.textContent = 'Deleted ' + msg.key;
                setTimeout(() => status.textContent = '', 2000);
            } else if (msg.command === 'settingSaved') {
                status.textContent = 'Setting saved: ' + msg.key;
                setTimeout(() => status.textContent = '', 1600);
            }
        });
    </script>
</body>

</html>
`;
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
}
