import * as vscode from 'vscode';
import { AnalyticsService } from '../analytics';

// Azure DevOps API Types
export interface AzureRepository {
    id: string;
    name: string;
    url: string;
    defaultBranch?: string;
    project: {
        id: string;
        name: string;
    };
}

export interface AzureRepositoryListResponse {
    count: number;
    value: AzureRepository[];
}

export interface AzureGitRef {
    name: string;
    objectId: string;
}

export interface AzureGitRefListResponse {
    count: number;
    value: AzureGitRef[];
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

// AI Provider Types
export type AIProvider = 'anthropic' | 'gemini' | 'openai';

export interface AIMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface AnthropicRequestPayload {
    model: string;
    max_tokens: number;
    temperature: number;
    messages: AIMessage[];
}

export interface AnthropicContentBlock {
    type: 'text';
    text: string;
}

export interface AnthropicResponse {
    id: string;
    type: string;
    role: string;
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string;
    usage: {
        input_tokens: number;
        output_tokens: number;
    };
}

export interface AIGenerationResult {
    title?: string;
    text?: string;
    raw?: unknown;
    status?: number;
    error?: string;
    provider?: AIProvider;
}

// Extension Configuration Types
export interface ExtensionConfig {
    orgHost: string;
    project: string;
    useAI: boolean;
    generateDescription: boolean;
    autoAcceptAI: boolean;
    aiProvider: AIProvider;
    aiModel: string;
    aiMaxTokens: number;
    aiTemperature: number;
    apiVersion: string;
}

export interface SecretKeys {
    azurePAT: string;
    anthropicApiKey: string;
    geminiApiKey: string;
    openaiApiKey: string;
}

// Extension State
export interface ExtensionState {
    lastPrUrl?: string;
}

export interface PRHistoryItem {
    id: number;
    title: string;
    description: string;
    url: string;
    sourceBranch: string;
    targetBranch: string;
    repository: string;
    createdAt: string;
    workItems: string[];
}

// Webview Message Types
export interface WebviewMessage {
    command: string;
    key?: string;
    value?: string | boolean | number;
    prompt?: string;
    branch?: string;
    url?: string;
    data?: Record<string, unknown>;
    result?: AIGenerationResult;
    error?: string;
}

// Settings Data for Webview
export interface SettingsData {
    orgHost: string;
    project: string;
    useAI: boolean;
    generateDescription: boolean;
    autoAcceptAI: boolean;
    aiProvider: AIProvider;
    aiModel: string;
    aiMaxTokens: number;
    aiTemperature: number;
    apiVersion: string;
    hasAzurePAT: boolean;
    hasAIKey: boolean;
    enableTelemetry: boolean;
}

// Analytics Event Type
export interface AnalyticsEvent {
    event: string;
    properties?: Record<string, unknown>;
    timestamp?: Date;
}

// Extension Context Wrapper for dependency injection
export interface ExtensionServices {
    context: vscode.ExtensionContext;
    analytics: AnalyticsService;
    getSecret: (key: string) => Promise<string | undefined>;
    setSecret: (key: string, value: string) => Promise<void>;
    deleteSecret: (key: string) => Promise<void>;
    getConfig: <T>(key: string, defaultValue: T) => T;
    setConfig: (key: string, value: unknown) => Promise<void>;
    getState: <T>(key: string) => T | undefined;
    setState: (key: string, value: unknown) => Promise<void>;
}
