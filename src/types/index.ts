import * as vscode from 'vscode';

// Azure DevOps API Types
export interface AzureRepository {
    id: string;
    name: string;
    url: string;
    project: {
        id: string;
        name: string;
    };
}

export interface AzureRepositoryListResponse {
    count: number;
    value: AzureRepository[];
}

export interface AzurePullRequestLinks {
    web: {
        href: string;
    };
}

export interface AzurePullRequest {
    pullRequestId: number;
    artifactId?: string;
    title: string;
    description?: string;
    sourceRefName: string;
    targetRefName: string;
    status: string;
    repository: {
        id: string;
        name: string;
    };
    _links: AzurePullRequestLinks;
}

export interface AzurePullRequestCreatePayload {
    sourceRefName: string;
    targetRefName: string;
    title: string;
    description?: string;
}

export interface AzureWorkItemPatchOperation {
    op: 'add' | 'remove' | 'replace';
    path: string;
    value: {
        rel: string;
        url: string;
        attributes: {
            name: string;
        };
    };
}

export interface AzureApiError {
    message?: string;
    error?: string;
}

// Claude API Types
export interface ClaudeMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface ClaudeRequestPayload {
    model: string;
    max_tokens: number;
    temperature: number;
    messages: ClaudeMessage[];
}

export interface ClaudeContentBlock {
    type: 'text';
    text: string;
}

export interface ClaudeResponse {
    id: string;
    type: string;
    role: string;
    content: ClaudeContentBlock[];
    model: string;
    stop_reason: string;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

export interface ClaudeGenerationResult {
    title?: string;
    raw?: ClaudeResponse;
    status?: number;
    error?: string;
}

// Extension Configuration Types
export interface ExtensionConfig {
    orgHost: string;
    project: string;
    useAI: boolean;
    generateDescription: boolean;
    autoAcceptAI: boolean;
    claudeModel: string;
    claudeMaxTokens: number;
    claudeTemperature: number;
    apiVersion: string;
}

export interface SecretKeys {
    azurePAT: string;
    claudeToken: string;
}

// Extension State
export interface ExtensionState {
    lastPrUrl?: string;
}

// Webview Message Types
export interface WebviewMessage {
    command: string;
    key?: string;
    value?: string | boolean | number;
    prompt?: string;
    branch?: string;
    data?: Record<string, unknown>;
    result?: ClaudeGenerationResult;
    error?: string;
}

// Settings Data for Webview
export interface SettingsData {
    orgHost: string;
    project: string;
    useAI: boolean;
    generateDescription: boolean;
    autoAcceptAI: boolean;
    claudeModel: string;
    claudeMaxTokens: number;
    claudeTemperature: number;
    apiVersion: string;
    hasAzurePAT: boolean;
    hasClaudeToken: boolean;
}

// Extension Context Wrapper for dependency injection
export interface ExtensionServices {
    context: vscode.ExtensionContext;
    getSecret: (key: string) => Promise<string | undefined>;
    setSecret: (key: string, value: string) => Promise<void>;
    deleteSecret: (key: string) => Promise<void>;
    getConfig: <T>(key: string, defaultValue: T) => T;
    setConfig: (key: string, value: unknown) => Promise<void>;
    getState: <T>(key: string) => T | undefined;
    setState: (key: string, value: unknown) => Promise<void>;
}
