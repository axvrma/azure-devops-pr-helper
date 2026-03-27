import * as vscode from 'vscode';
import { AnalyticsService } from '../analytics';
import { ExtensionServices } from '../types';
import { CONFIG_NAMESPACE } from './constants';

/**
 * Create extension services wrapper for dependency injection
 */
export function createExtensionServices(context: vscode.ExtensionContext): ExtensionServices {
    const analytics = AnalyticsService.initialize(context);

    return {
        context,
        analytics,

        async getSecret(key: string): Promise<string | undefined> {
            return context.secrets.get(key);
        },

        async setSecret(key: string, value: string): Promise<void> {
            await context.secrets.store(key, value);
        },

        async deleteSecret(key: string): Promise<void> {
            await context.secrets.delete(key);
        },

        getConfig<T>(key: string, defaultValue: T): T {
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            return config.get<T>(key, defaultValue);
        },

        async setConfig(key: string, value: unknown): Promise<void> {
            const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
            await config.update(key, value, vscode.ConfigurationTarget.Global);
        },

        getState<T>(key: string): T | undefined {
            return context.globalState.get<T>(key);
        },

        async setState(key: string, value: unknown): Promise<void> {
            await context.globalState.update(key, value);
        },
    };
}
