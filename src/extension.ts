import axios from 'axios';
import { execSync } from 'child_process';
import * as vscode from 'vscode';
import { orgConfig } from './org-config';

let lastPrUrl: string | undefined;

export function activate(context: vscode.ExtensionContext) {
    // Command: Copy Last PR URL
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

    // Command: Raise PR
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.raisePR', async () => {
            // 1. Ensure PAT is stored
            let pat = await context.secrets.get('azureDevOpsPAT');
            if (!pat) {
                const entry = await vscode.window.showInputBox({ prompt: 'Enter your Azure DevOps PAT' });
                if (!entry) { return; }
                await context.secrets.store('azureDevOpsPAT', entry);
                pat = entry;
            }

            // 2. Pick repository (auto if current matches)
            const orgUrl = orgConfig.orgHost;
            const project = orgConfig.project;
            const repoId = await pickRepo(orgUrl, project, pat);
            if (!repoId) { return; }

            // 3. Prompt for source & target branches (prefill source)
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

            // 4. Prompt for title & description
            const title = await vscode.window.showInputBox({ prompt: 'PR Title' });
            if (!title) { return; }
            const description = await vscode.window.showInputBox({ prompt: 'PR Description' });
            if (description === undefined) { return; }

            // 5. Create the PR
            const prApi = `${orgUrl}/${project}/_apis/git/repositories/${repoId}/pullrequests?api-version=7.1`;
            let resp;
            try {
                resp = await axios.post(prApi, {
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
            } catch (err: any) {
                const msg = err.response?.data?.message || err.message;
                vscode.window.showErrorMessage(`PR creation failed: ${msg}`);
                return;
            }

            // 6. Capture web URL
            const pr = resp.data;
            const webUrl = pr._links?.web?.href
                ?? `${orgUrl}/${project}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
            lastPrUrl = webUrl;

            // 7. Prompt for Work Item linkage
            const wiInput = await vscode.window.showInputBox({
                prompt: 'Enter Work Item ID(s) to link (comma-separated), or leave blank'
            });
            if (wiInput) {
                const ids = wiInput.split(',').map(i => i.trim()).filter(Boolean);
                for (const id of ids) {
                    await linkWorkItem(orgUrl, project, pat, id, pr.artifactId);
                }
            }

            // 8. Notify & offer Copy URL
            vscode.window.showInformationMessage('PR created', 'Copy URL').then(choice => {
                if (choice === 'Copy URL') {
                    vscode.commands.executeCommand('extension.copyPrUrl');
                }
            });
        })
    );
}

export function deactivate() { /* no-op */ }

// ——— Helpers ———

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
    if (!cwd) { return undefined; }
    try {
        const url = execSync('git config --get remote.origin.url', { encoding: 'utf8', cwd }).trim();
        const match = url.match(/[:\/]([^\/:]+?)(?:\.git)?$/);
        return match ? match[1] : undefined;
    } catch {
        return undefined;
    }
}

async function pickRepo(orgUrl: string, project: string, pat: string): Promise<string | undefined> {
    const current = getCurrentRepoName();

    // Fetch all repos
    const listUrl = `${orgUrl}/${project}/_apis/git/repositories?api-version=7.1`;
    const resp = await axios.get(listUrl, {
        headers: { Authorization: 'Basic ' + Buffer.from(`:${pat}`).toString('base64') }
    });
    const picks: Array<{ label: string; id: string }> = resp.data.value.map((r: any) => ({
        label: r.name,
        id: r.id
    }));

    // If current repo matches, return it
    if (current) {
        const match = picks.find(p => p.label === current);
        if (match) {
            return match.id;
        }
    }

    // Otherwise prompt
    const sel = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Select repository'
    });
    return sel?.id;
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
