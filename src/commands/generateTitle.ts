import * as vscode from 'vscode';
import { AnalyticsEvents } from '../analytics';
import { createAIClientFromServices, getAIProviderLabel, normalizeGeneratedTitle } from '../api/ai';
import { AIGenerationResult, ExtensionServices } from '../types';
import { getCurrentBranch, getCurrentRepoName } from '../utils/git';

export interface GenerateTitleArgs {
    prompt?: string;
    branch?: string;
    diff?: string;
    commits?: string;
}

export async function generateAITitleCommand(
    services: ExtensionServices,
    args?: GenerateTitleArgs
): Promise<AIGenerationResult> {
    const { client, provider, model, error } = await createAIClientFromServices(services);

    if (!client) {
        const openSettings = await vscode.window.showWarningMessage(
            `${error ?? 'AI provider API key not found'}. Configure it in settings.`,
            'Open Settings'
        );
        if (openSettings) {
            vscode.commands.executeCommand('extension.openSettings');
        }
        return { error: 'no-token', provider };
    }

    const branch = args?.branch || getCurrentBranch() || 'feature';
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
        const result = await client.generate(prompt);
        if (result.title && !result.error) {
            result.title = normalizeGeneratedTitle(result.title);
        }
        
        // Track AI generation success
        if (result.title && !result.error) {
            services.analytics.track(AnalyticsEvents.AI_TITLE_GENERATED, {
                provider,
                model,
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
        console.error(`${getAIProviderLabel(provider)} generation error:`, err);
        
        // Track AI generation failure
        services.analytics.track(AnalyticsEvents.AI_TITLE_FAILED, {
            provider,
            error_type: message,
        });
        
        return { error: message, provider };
    }
}
