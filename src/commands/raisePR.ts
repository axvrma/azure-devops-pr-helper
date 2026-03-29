import * as vscode from 'vscode';
import { AzureDevOpsClient, pickRepository } from '../api/azureDevOps';
import { ClaudeClient } from '../api/claude';
import { ExtensionServices } from '../types';
import { CONFIG_KEYS, DEFAULT_CONFIG, SECRET_KEYS, STATE_KEYS } from '../utils/constants';
import { getCurrentBranch, getCurrentRepoName, isValidBranchName } from '../utils/git';
import { parseWorkItemIds } from '../utils/helpers';

export async function raisePRCommand(services: ExtensionServices): Promise<void> {
    // 1. Ensure Azure PAT is available
    let pat = await services.getSecret(SECRET_KEYS.AZURE_PAT);
    if (!pat) {
        const entry = await vscode.window.showInputBox({
            prompt: 'Enter your Azure DevOps PAT',
            password: true,
            ignoreFocusOut: true,
        });
        if (!entry) {
            return;
        }
        await services.setSecret(SECRET_KEYS.AZURE_PAT, entry);
        pat = entry;
    }

    // 2. Get configuration
    const orgUrl = services.getConfig(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost);
    const project = services.getConfig(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project);
    const apiVersion = services.getConfig(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion);
    const useAI = services.getConfig(CONFIG_KEYS.USE_AI, DEFAULT_CONFIG.useAI);
    const generateDescription = services.getConfig(CONFIG_KEYS.GENERATE_DESCRIPTION, DEFAULT_CONFIG.generateDescription);
    const autoAcceptAI = services.getConfig(CONFIG_KEYS.AUTO_ACCEPT_AI, DEFAULT_CONFIG.autoAcceptAI);

    // Validate configuration
    if (!orgUrl || orgUrl === DEFAULT_CONFIG.orgHost) {
        const openSettings = await vscode.window.showErrorMessage(
            'Azure DevOps organization URL is not configured.',
            'Open Settings'
        );
        if (openSettings) {
            vscode.commands.executeCommand('extension.openSettings');
        }
        return;
    }

    if (!project || project === DEFAULT_CONFIG.project) {
        const openSettings = await vscode.window.showErrorMessage(
            'Azure DevOps project is not configured.',
            'Open Settings'
        );
        if (openSettings) {
            vscode.commands.executeCommand('extension.openSettings');
        }
        return;
    }

    // 3. Create Azure DevOps client and pick repository
    const azureClient = new AzureDevOpsClient(orgUrl, project, pat, apiVersion);
    const currentRepoName = getCurrentRepoName();
    const repoId = await pickRepository(azureClient, currentRepoName);
    if (!repoId) {
        return;
    }

    // 4. Get source and target branches
    const currentBranch = getCurrentBranch();
    const source = await vscode.window.showInputBox({
        prompt: 'Source branch (e.g., feature/xyz)',
        value: currentBranch,
        validateInput: (value) => {
            if (!value) {
                return 'Source branch is required';
            }
            if (!isValidBranchName(value)) {
                return 'Invalid branch name format';
            }
            return null;
        },
    });
    if (!source) {
        return;
    }

    const target = await vscode.window.showInputBox({
        prompt: 'Target branch (e.g., main)',
        validateInput: (value) => {
            if (!value) {
                return 'Target branch is required';
            }
            if (!isValidBranchName(value)) {
                return 'Invalid branch name format';
            }
            return null;
        },
    });
    if (!target) {
        return;
    }

    // 5. Generate AI suggestions if enabled
    let generatedTitle: string | undefined;
    let generatedDescription: string | undefined;

    if (useAI) {
        const claudeToken = await services.getSecret(SECRET_KEYS.CLAUDE_TOKEN);
        if (claudeToken) {
            const claudeModel = services.getConfig(CONFIG_KEYS.CLAUDE_MODEL, DEFAULT_CONFIG.claudeModel);
            const claudeMaxTokens = services.getConfig(CONFIG_KEYS.CLAUDE_MAX_TOKENS, DEFAULT_CONFIG.claudeMaxTokens);
            const claudeTemperature = services.getConfig(CONFIG_KEYS.CLAUDE_TEMPERATURE, DEFAULT_CONFIG.claudeTemperature);

            const claudeClient = new ClaudeClient({
                apiKey: claudeToken,
                model: claudeModel,
                maxTokens: claudeMaxTokens,
                temperature: claudeTemperature,
            });

            const branchName = currentBranch || source;
            const repoName = currentRepoName || 'repository';

            try {
                await vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Generating AI suggestions...' },
                    async () => {
                        // Generate title
                        const titleResult = await claudeClient.generatePRTitle(branchName, repoName);
                        if (titleResult.title && !titleResult.error) {
                            generatedTitle = titleResult.title;
                        } else if (titleResult.error) {
                            vscode.window.showWarningMessage(`AI title generation failed: ${titleResult.error}`);
                        }

                        // Generate description if enabled
                        if (generateDescription) {
                            const descResult = await claudeClient.generatePRDescription(branchName, repoName);
                            if (descResult.title && !descResult.error) {
                                generatedDescription = descResult.title;
                            } else if (descResult.error) {
                                vscode.window.showWarningMessage(`AI description generation failed: ${descResult.error}`);
                            }
                        }
                    }
                );
            } catch (err) {
                console.error('AI generation error:', err);
                vscode.window.showWarningMessage('AI generation failed. Proceeding with manual input.');
            }
        } else {
            vscode.window.showWarningMessage('Claude token not configured. Skipping AI suggestions.');
        }
    }

    // 6. Get PR title (auto-accept or prompt)
    let title: string | undefined;
    if (autoAcceptAI && generatedTitle) {
        title = generatedTitle;
    } else {
        title = await vscode.window.showInputBox({
            prompt: 'PR Title',
            value: generatedTitle,
            placeHolder: generatedTitle ? 'AI-generated — edit as needed' : 'Enter PR title',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'PR title is required';
                }
                if (value.length > 200) {
                    return 'PR title is too long (max 200 characters)';
                }
                return null;
            },
        });
        if (!title) {
            return;
        }
    }

    // 7. Get PR description (auto-accept or prompt)
    let description: string | undefined;
    if (autoAcceptAI && generateDescription && generatedDescription) {
        description = generatedDescription;
    } else {
        description = await vscode.window.showInputBox({
            prompt: 'PR Description (optional)',
            value: generatedDescription,
            placeHolder: generatedDescription ? 'AI-generated — edit as needed' : 'Enter PR description',
        });
        if (description === undefined) {
            return;
        }
    }

    // 8. Create the PR
    let prUrl: string | undefined;
    try {
        const pr = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Creating PR...' },
            () => azureClient.createPullRequest(repoId, {
                sourceRefName: `refs/heads/${source}`,
                targetRefName: `refs/heads/${target}`,
                title: title!,
                description,
            })
        );

        prUrl = azureClient.getPullRequestWebUrl(pr);
        await services.setState(STATE_KEYS.LAST_PR_URL, prUrl);

        // 9. Link work items if provided
        const wiInput = await vscode.window.showInputBox({
            prompt: 'Enter Work Item ID(s) to link (comma-separated), or leave blank',
        });

        if (wiInput) {
            const workItemIds = parseWorkItemIds(wiInput);
            if (workItemIds.length > 0 && pr.artifactId) {
                for (const id of workItemIds) {
                    try {
                        await azureClient.linkWorkItem(id, pr.artifactId);
                        vscode.window.showInformationMessage(`Linked PR to Work Item ${id}`);
                    } catch (err) {
                        const message = err instanceof Error ? err.message : String(err);
                        vscode.window.showErrorMessage(`Failed to link Work Item ${id}: ${message}`);
                    }
                }
            } else if (!pr.artifactId) {
                vscode.window.showWarningMessage('PR created but artifactId missing — work item linking skipped.');
            }
        }

        // 10. Show success notification
        const choice = await vscode.window.showInformationMessage(
            'PR created successfully!',
            'Open in Browser',
            'Copy URL'
        );

        if (choice === 'Open in Browser' && prUrl) {
            vscode.env.openExternal(vscode.Uri.parse(prUrl));
        } else if (choice === 'Copy URL' && prUrl) {
            await vscode.env.clipboard.writeText(prUrl);
            vscode.window.showInformationMessage('PR URL copied to clipboard.');
        }
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`PR creation failed: ${message}`);
    }
}
