import * as vscode from 'vscode';
import { ExtensionServices } from '../types';
import { STATE_KEYS } from '../utils/constants';

export async function copyPrUrlCommand(services: ExtensionServices): Promise<void> {
    const lastPrUrl = services.getState<string>(STATE_KEYS.LAST_PR_URL);
    
    if (lastPrUrl) {
        await vscode.env.clipboard.writeText(lastPrUrl);
        vscode.window.showInformationMessage('PR URL copied to clipboard.');
    } else {
        vscode.window.showWarningMessage('No PR URL to copy. Create a PR first.');
    }
}

export async function openPrUrlCommand(services: ExtensionServices): Promise<void> {
    const lastPrUrl = services.getState<string>(STATE_KEYS.LAST_PR_URL);
    
    if (lastPrUrl) {
        await vscode.env.openExternal(vscode.Uri.parse(lastPrUrl));
    } else {
        vscode.window.showWarningMessage('No PR URL available. Create a PR first.');
    }
}
