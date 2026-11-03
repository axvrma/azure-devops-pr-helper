import * as vscode from 'vscode';
import { RepositoryContext, repositorySchema } from '../branchFlow/domain/model';
import type { ExtensionServices } from '../types';
import { configuredContext } from './pullRequestService';

export const RECENT_GRAPHS_KEY = 'branchFlow.recent';
const REPOSITORY_KEY = 'prHelper.repositoryContext';
const updates = new vscode.EventEmitter<void>();
export const onWorkspaceContextChanged = updates.event;

export function selectedRepository(services: ExtensionServices): RepositoryContext | undefined {
    const parsed = repositorySchema.safeParse(services.getState(REPOSITORY_KEY));
    if (!parsed.success) { return; }
    try {
        const configured = configuredContext(services);
        if (parsed.data.organizationUrl === configured.organizationUrl && parsed.data.project === configured.project) { return parsed.data; }
    } catch { /* Configure the connection before using a remembered repository. */ }
}
export async function rememberRepository(services: ExtensionServices, repository: RepositoryContext): Promise<void> {
    await services.setState(REPOSITORY_KEY, repositorySchema.parse(repository)); updates.fire();
}
export function recentGraphs(services: ExtensionServices): string[] {
    const value = services.getState<unknown>(RECENT_GRAPHS_KEY);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length < 4096).slice(0, 10) : [];
}
export async function rememberGraph(services: ExtensionServices, uri: vscode.Uri): Promise<void> {
    if (uri.scheme !== 'file') { return; }
    await services.setState(RECENT_GRAPHS_KEY, [uri.fsPath, ...recentGraphs(services).filter(p => p !== uri.fsPath)].slice(0, 10));
    updates.fire();
}

/** Forget a recent-list entry only. This never reads, writes, closes, or deletes the graph file. */
export async function forgetGraph(services: ExtensionServices, file: string): Promise<boolean> {
    const before = recentGraphs(services);
    const after = before.filter(value => value !== file);
    if (before.length === after.length) { return false; }
    await services.setState(RECENT_GRAPHS_KEY, after);
    updates.fire();
    return true;
}
