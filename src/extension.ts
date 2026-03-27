import * as vscode from 'vscode';
import { AnalyticsEvents, AnalyticsService } from './analytics';
import {
    clearPATCommand,
    copyPrUrlCommand,
    generateClaudeTitleCommand,
    GenerateTitleArgs,
} from './commands';
import { COMMANDS, STATE_KEYS, VIEWS } from './utils/constants';
import { createExtensionServices } from './utils/services';
import { PRCreatorPanel, SettingsPanel, SidebarProvider } from './webviews';

export function activate(context: vscode.ExtensionContext): void {
    console.log('Activating Azure DevOps PR Helper extension');

    try {
        // Create services wrapper for dependency injection
        const services = createExtensionServices(context);

        // Track extension activation
        services.analytics.track(AnalyticsEvents.EXTENSION_ACTIVATED, {
            version: context.extension.packageJSON.version,
            vscode_version: vscode.version,
        });

        // Restore last PR URL from state
        const lastPrUrl = services.getState<string>(STATE_KEYS.LAST_PR_URL);
        if (lastPrUrl) {
            console.log('Restored last PR URL from state');
        }

        // Register commands
        registerCommands(context, services);

        // Register sidebar view
        const sidebarProvider = new SidebarProvider(services);
        context.subscriptions.push(
            vscode.window.registerWebviewViewProvider(VIEWS.SIDEBAR, sidebarProvider)
        );

        console.log('Azure DevOps PR Helper extension activated successfully');
    } catch (err) {
        console.error('Activation error in Azure DevOps PR Helper:', err);
        throw err;
    }
}

function registerCommands(
    context: vscode.ExtensionContext,
    services: ReturnType<typeof createExtensionServices>
): void {
    // Open PR Creator (main page-based PR creation)
    context.subscriptions.push(
        vscode.commands.registerCommand('extension.openPRCreator', () => {
            PRCreatorPanel.createOrShow(services);
        })
    );

    // Raise PR command (now opens the PR Creator page)
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.RAISE_PR, () => {
            PRCreatorPanel.createOrShow(services);
        })
    );

    // Copy PR URL command
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.COPY_PR_URL, () => copyPrUrlCommand(services))
    );

    // Clear PAT command
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.CLEAR_PAT, () => clearPATCommand(services))
    );

    // Open settings command
    context.subscriptions.push(
        vscode.commands.registerCommand(COMMANDS.OPEN_SETTINGS, () => {
            SettingsPanel.createOrShow(services);
        })
    );

    // Generate Claude title command (can be called programmatically)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            COMMANDS.GENERATE_CLAUDE_TITLE,
            (args?: GenerateTitleArgs) => generateClaudeTitleCommand(services, args)
        )
    );
}

export async function deactivate(): Promise<void> {
    console.log('Azure DevOps PR Helper extension deactivated');
    
    // Flush any pending analytics events and shutdown
    await AnalyticsService.shutdown();
}
