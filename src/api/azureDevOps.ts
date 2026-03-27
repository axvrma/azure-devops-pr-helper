import axios, { AxiosError } from 'axios';
import * as vscode from 'vscode';
import {
    AzureApiError,
    AzurePullRequest,
    AzurePullRequestCreatePayload,
    AzureRepository,
    AzureRepositoryListResponse,
    AzureWorkItemPatchOperation,
} from '../types';
import { createBasicAuthHeader, normalizeBaseUrl } from '../utils/helpers';

export class AzureDevOpsClient {
    private readonly orgUrl: string;
    private readonly project: string;
    private readonly pat: string;
    private readonly apiVersion: string;

    constructor(orgUrl: string, project: string, pat: string, apiVersion: string = '7.1') {
        this.orgUrl = normalizeBaseUrl(orgUrl) || '';
        this.project = project;
        this.pat = pat;
        this.apiVersion = apiVersion;
    }

    private get authHeader(): string {
        return createBasicAuthHeader(this.pat);
    }

    private buildUrl(path: string): string {
        return `${this.orgUrl}/${this.project}/_apis/${path}?api-version=${this.apiVersion}`;
    }

    private handleError(error: unknown, context: string): never {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<AzureApiError>;
            const status = axiosError.response?.status;
            const body = axiosError.response?.data;
            const message = body?.message ?? body?.error ?? axiosError.message;
            
            console.error(`Azure DevOps API error (${context})`, { status, body });
            throw new Error(`${context} failed${status ? ` (${status})` : ''}: ${message}`);
        }
        
        throw error;
    }

    /**
     * List all repositories in the project
     */
    async listRepositories(): Promise<AzureRepository[]> {
        const url = this.buildUrl('git/repositories');
        
        try {
            const response = await axios.get<AzureRepositoryListResponse>(url, {
                headers: { Authorization: this.authHeader },
                timeout: 15000,
            });

            const items = response.data?.value;
            if (!Array.isArray(items)) {
                throw new Error('Invalid response: expected array of repositories');
            }

            return items;
        } catch (error) {
            this.handleError(error, 'List repositories');
        }
    }

    /**
     * Create a new pull request
     */
    async createPullRequest(
        repositoryId: string,
        payload: AzurePullRequestCreatePayload
    ): Promise<AzurePullRequest> {
        const url = `${this.orgUrl}/${this.project}/_apis/git/repositories/${repositoryId}/pullrequests?api-version=${this.apiVersion}`;
        
        try {
            const response = await axios.post<AzurePullRequest>(url, payload, {
                headers: {
                    Authorization: this.authHeader,
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            });

            if (!response.data) {
                throw new Error('Invalid response: no data returned');
            }

            return response.data;
        } catch (error) {
            this.handleError(error, 'Create pull request');
        }
    }

    /**
     * Link a work item to a pull request
     */
    async linkWorkItem(workItemId: string, artifactId: string): Promise<void> {
        const url = `${this.orgUrl}/${this.project}/_apis/wit/workitems/${workItemId}?api-version=${this.apiVersion}`;
        
        const patchBody: AzureWorkItemPatchOperation[] = [
            {
                op: 'add',
                path: '/relations/-',
                value: {
                    rel: 'ArtifactLink',
                    url: artifactId,
                    attributes: { name: 'Pull Request' },
                },
            },
        ];

        try {
            await axios.patch(url, patchBody, {
                headers: {
                    Authorization: this.authHeader,
                    'Content-Type': 'application/json-patch+json',
                },
                timeout: 15000,
            });
        } catch (error) {
            this.handleError(error, `Link work item ${workItemId}`);
        }
    }

    /**
     * Get the web URL for a pull request
     */
    getPullRequestWebUrl(pr: AzurePullRequest): string {
        return pr._links?.web?.href 
            ?? `${this.orgUrl}/${this.project}/_git/${pr.repository.name}/pullrequest/${pr.pullRequestId}`;
    }
}

/**
 * Show a quick pick to select a repository
 */
export async function pickRepository(
    client: AzureDevOpsClient,
    currentRepoName?: string
): Promise<string | undefined> {
    try {
        const repositories = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: 'Loading repositories...' },
            () => client.listRepositories()
        );

        if (repositories.length === 0) {
            vscode.window.showWarningMessage(
                'No repositories found. Check org/project configuration and PAT permissions.'
            );
            return undefined;
        }

        const picks = repositories.map(repo => ({
            label: repo.name,
            id: repo.id,
            description: repo.project?.name,
        }));

        // Auto-select if current repo matches
        if (currentRepoName) {
            const match = picks.find(p => p.label === currentRepoName);
            if (match) {
                return match.id;
            }
        }

        const selection = await vscode.window.showQuickPick(picks, {
            placeHolder: 'Select repository',
            matchOnDescription: true,
        });

        return selection?.id;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(message);
        return undefined;
    }
}
