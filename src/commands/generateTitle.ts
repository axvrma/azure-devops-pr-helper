import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import { ClaudeClient } from '../api/claude';
import { ClaudeGenerationResult, ExtensionServices } from '../types';
import { CONFIG_KEYS, DEFAULT_CONFIG, SECRET_KEYS } from '../utils/constants';
import { getCurrentBranch, getCurrentRepoName } from '../utils/git';

export interface GenerateTitleArgs {
    prompt?: string;
    branch?: string;
    diff?: string;
    commits?: string;
}

export async function generateClaudeTitleCommand(
    services: ExtensionServices,
    args?: GenerateTitleArgs
): Promise<ClaudeGenerationResult> {
    const claudeToken = await services.getSecret(SECRET_KEYS.CLAUDE_TOKEN);
    
    if (!claudeToken) {
        const openSettings = await vscode.window.showWarningMessage(
            'Claude token not found. Configure it in settings.',
            'Open Settings'
        );
        if (openSettings) {
            vscode.commands.executeCommand('extension.openSettings');
        }
        return { error: 'no-token' };
    }

    const claudeModel = services.getConfig(CONFIG_KEYS.CLAUDE_MODEL, DEFAULT_CONFIG.claudeModel);
    const claudeMaxTokens = services.getConfig(CONFIG_KEYS.CLAUDE_MAX_TOKENS, DEFAULT_CONFIG.claudeMaxTokens);
    const claudeTemperature = services.getConfig(CONFIG_KEYS.CLAUDE_TEMPERATURE, DEFAULT_CONFIG.claudeTemperature);

    const claudeClient = new ClaudeClient({
        apiKey: claudeToken,
        model: claudeModel,
        maxTokens: claudeMaxTokens,
        temperature: claudeTemperature,
    });

    const branch = getCurrentBranch() || args?.branch || 'feature';
    const repo = getCurrentRepoName() || 'repository';

    // Build context-aware prompt
    let prompt: string;
    
    if (args?.prompt) {
        // User provided custom prompt - include diff context
        prompt = args.prompt;
        
        if (args.diff || args.commits) {
            prompt += '\n\n--- Context ---';
            prompt += `\nBranch: ${branch}`;
            prompt += `\nRepository: ${repo}`;
            
            if (args.commits) {
                prompt += `\n\nCommit messages:\n${args.commits}`;
            }
            
            if (args.diff) {
                prompt += `\n\nGit diff:\n${args.diff}`;
            }
        }
    } else {
        // Default prompt with diff context
        prompt = `Generate a clear, concise PR title (max 60 chars) based on the following changes.

Branch: ${branch}
Repository: ${repo}`;

        if (args?.commits) {
            prompt += `\n\nCommit messages:\n${args.commits}`;
        }

        if (args?.diff) {
            prompt += `\n\nGit diff:\n${args.diff}`;
        }

        prompt += `\n\nRequirements:
- Be specific about what changed (not generic like "Update files")
- Use action verbs (Add, Fix, Update, Refactor, Remove, etc.)
- Max 60 characters
- Return only the title, no quotes or explanation`;
    }

    try {
        const result = await claudeClient.generate(prompt);
        
        // Track AI generation success
        if (result.title && !result.error) {
            services.analytics.track(AnalyticsEvents.AI_TITLE_GENERATED, {
                model: claudeModel,
                has_custom_prompt: !!args?.prompt,
                has_diff: !!args?.diff,
            });
        } else if (result.error) {
            services.analytics.track(AnalyticsEvents.AI_TITLE_FAILED, {
                error_type: result.error,
            });
        }
        
        return result;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Claude generation error:', err);
        
        // Track AI generation failure
        services.analytics.track(AnalyticsEvents.AI_TITLE_FAILED, {
            error_type: message,
        });
        
        return { error: message };
    }
}
