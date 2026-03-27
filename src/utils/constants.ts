// Secret storage keys
export const SECRET_KEYS = {
    AZURE_PAT: 'azureDevOpsPAT',
    CLAUDE_TOKEN: 'claudeToken',
} as const;

// Global state keys
export const STATE_KEYS = {
    LAST_PR_URL: 'lastPrUrl',
} as const;

// Configuration keys (under 'azureDevopsPr' namespace)
export const CONFIG_KEYS = {
    ORG_HOST: 'orgHost',
    PROJECT: 'project',
    USE_AI: 'useAI',
    GENERATE_DESCRIPTION: 'generateDescription',
    AUTO_ACCEPT_AI: 'autoAcceptAI',
    CLAUDE_MODEL: 'claudeModel',
    CLAUDE_MAX_TOKENS: 'claudeMaxTokens',
    CLAUDE_TEMPERATURE: 'claudeTemperature',
    API_VERSION: 'apiVersion',
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
    claudeModel: 'claude-sonnet-4-5',
    claudeMaxTokens: 1024,
    claudeTemperature: 0.3,
    apiVersion: '7.1',
} as const;

// Claude API configuration
export const CLAUDE_API = {
    ENDPOINT: 'https://api.anthropic.com/v1/messages',
    VERSION: '2023-06-01',
    TIMEOUT: 20000,
} as const;

// Command identifiers
export const COMMANDS = {
    RAISE_PR: 'extension.raisePR',
    COPY_PR_URL: 'extension.copyPrUrl',
    CLEAR_PAT: 'extension.clearPAT',
    OPEN_SETTINGS: 'extension.openSettings',
    GENERATE_CLAUDE_TITLE: 'extension.generateClaudeTitle',
} as const;

// View identifiers
export const VIEWS = {
    SIDEBAR: 'claudeSidebarView',
} as const;
