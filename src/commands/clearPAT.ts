import * as vscode from 'vscode';
import { ExtensionServices } from '../types';
import { SECRET_KEYS } from '../utils/constants';

export async function clearPATCommand(services: ExtensionServices): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to clear your Azure DevOps PAT?',
        { modal: true },
        'Yes, Clear'
    );

    if (confirm === 'Yes, Clear') {
        await services.deleteSecret(SECRET_KEYS.AZURE_PAT);
        vscode.window.showInformationMessage('Azure DevOps PAT has been cleared.');
    }
}

export async function clearClaudeTokenCommand(services: ExtensionServices): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
        'Are you sure you want to clear your Claude API token?',
        { modal: true },
        'Yes, Clear'
    );

    if (confirm === 'Yes, Clear') {
        await services.deleteSecret(SECRET_KEYS.CLAUDE_TOKEN);
        vscode.window.showInformationMessage('Claude API token has been cleared.');
    }
}
