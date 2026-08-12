// Secret storage keys
export const SECRET_KEYS = {
    AZURE_PAT: 'azureDevOpsPAT',
    ANTHROPIC_API_KEY: 'anthropicApiKey',
    GEMINI_API_KEY: 'geminiApiKey',
    OPENAI_API_KEY: 'openaiApiKey',
} as const;

// Analytics configuration
export const ANALYTICS = {
    POSTHOG_API_KEY: 'phc_8DMji1fYo9QbPuzVIw4Ssi2bfDyd4egdrI7o7zGjXV6', // Replace with your PostHog project API key
    POSTHOG_HOST: 'https://us.i.posthog.com',
} as const;

// Global state keys
export const STATE_KEYS = {
    LAST_PR_URL: 'lastPrUrl',
    PR_HISTORY: 'prHistory',
} as const;

// Configuration keys (under 'azureDevopsPr' namespace)
export const CONFIG_KEYS = {
    ORG_HOST: 'orgHost',
    PROJECT: 'project',
    USE_AI: 'useAI',
    GENERATE_DESCRIPTION: 'generateDescription',
    AUTO_ACCEPT_AI: 'autoAcceptAI',
    AI_PROVIDER: 'aiProvider',
    AI_MODEL: 'aiModel',
    AI_MAX_TOKENS: 'aiMaxTokens',
    AI_TEMPERATURE: 'aiTemperature',
    API_VERSION: 'apiVersion',
    ENABLE_TELEMETRY: 'enableTelemetry',
} as const;

// Configuration namespace
export const CONFIG_NAMESPACE = 'azureDevopsPr';

// Default configuration values
export const DEFAULT_CONFIG = {
    orgHost: 'https://dev.azure.com/your-org',
    project: 'your-project',
    useAI: true,
    generateDescription: true,
    autoAcceptAI: false,
    aiProvider: 'anthropic',
    aiModel: '',
    aiMaxTokens: 1024,
    aiTemperature: 0.3,
    apiVersion: '7.1',
    enableTelemetry: true,
} as const;

// Anthropic API configuration
export const ANTHROPIC_API = {
    ENDPOINT: 'https://api.anthropic.com/v1/messages',
    VERSION: '2023-06-01',
    TIMEOUT: 20000,
} as const;

export const OPENAI_API = {
    ENDPOINT: 'https://api.openai.com/v1/chat/completions',
    TIMEOUT: 20000,
} as const;

export const GEMINI_API = {
    ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/models',
    TIMEOUT: 20000,
} as const;

export const AI_DEFAULT_MODELS = {
    anthropic: 'claude-sonnet-4-5',
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
} as const;

// Command identifiers
export const COMMANDS = {
    RAISE_PR: 'extension.raisePR',
    COPY_PR_URL: 'extension.copyPrUrl',
    CLEAR_PAT: 'extension.clearPAT',
    OPEN_SETTINGS: 'extension.openSettings',
    GENERATE_AI_TITLE: 'extension.generateAITitle',
} as const;

// View identifiers
export const VIEWS = {
    SIDEBAR: 'prHelperSidebarView',
} as const;
