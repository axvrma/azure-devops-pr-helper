export const AnalyticsEvents = {
    EXTENSION_ACTIVATED: 'extension_activated',
    EXTENSION_DEACTIVATED: 'extension_deactivated',
    PR_CREATED: 'pr_created',
    PR_CREATION_FAILED: 'pr_creation_failed',
    AI_TITLE_GENERATED: 'ai_title_generated',
    AI_TITLE_FAILED: 'ai_title_failed',
    AI_DESCRIPTION_GENERATED: 'ai_description_generated',
    AI_DESCRIPTION_FAILED: 'ai_description_failed',
    SETTINGS_OPENED: 'settings_opened',
    SETTINGS_SAVED: 'settings_saved',
    WORK_ITEM_LINKED: 'work_item_linked',
    PR_URL_COPIED: 'pr_url_copied',
    PR_CREATOR_OPENED: 'pr_creator_opened',
    SIDEBAR_OPENED: 'sidebar_opened',
    REPOSITORIES_LOADED: 'repositories_loaded',
    CONNECTION_TESTED: 'connection_tested',
    TELEMETRY_TOGGLED: 'telemetry_toggled',
} as const;

export type AnalyticsEventName = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

export interface ExtensionActivatedProperties {
    version: string;
    vscode_version: string;
}

export interface PRCreatedProperties {
    has_ai_title: boolean;
    has_ai_description: boolean;
    work_items_count: number;
    repository?: string;
}

export interface PRCreationFailedProperties {
    error_type: string;
}

export interface AITitleGeneratedProperties {
    model: string;
    has_custom_prompt: boolean;
    has_diff: boolean;
}

export interface AITitleFailedProperties {
    error_type: string;
}

export interface AIDescriptionGeneratedProperties {
    model: string;
}

export interface AIDescriptionFailedProperties {
    error_type: string;
}

export interface SettingsSavedProperties {
    setting_key: string;
}

export interface WorkItemLinkedProperties {
    count: number;
}

export interface PRUrlCopiedProperties {
    source: 'sidebar' | 'panel' | 'command';
}

export interface RepositoriesLoadedProperties {
    count: number;
}

export interface ConnectionTestedProperties {
    type: 'azure' | 'claude';
    success: boolean;
}

export interface TelemetryToggledProperties {
    enabled: boolean;
}

export type AnalyticsEventProperties =
    | ExtensionActivatedProperties
    | PRCreatedProperties
    | PRCreationFailedProperties
    | AITitleGeneratedProperties
    | AITitleFailedProperties
    | AIDescriptionGeneratedProperties
    | AIDescriptionFailedProperties
    | SettingsSavedProperties
    | WorkItemLinkedProperties
    | PRUrlCopiedProperties
    | RepositoriesLoadedProperties
    | ConnectionTestedProperties
    | TelemetryToggledProperties
    | Record<string, unknown>;
