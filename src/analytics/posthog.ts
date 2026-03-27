import { PostHog } from 'posthog-node';
import * as vscode from 'vscode';
import { ANALYTICS, CONFIG_KEYS, CONFIG_NAMESPACE } from '../utils/constants';

export class AnalyticsService {
    private static instance: AnalyticsService | null = null;
    private client: PostHog | null = null;
    private distinctId: string;
    private enabled: boolean = true;
    private extensionVersion: string;

    private constructor(context: vscode.ExtensionContext) {
        this.distinctId = vscode.env.machineId;
        this.extensionVersion = context.extension.packageJSON.version;
        this.initializeClient();
    }

    public static initialize(context: vscode.ExtensionContext): AnalyticsService {
        if (!AnalyticsService.instance) {
            AnalyticsService.instance = new AnalyticsService(context);
        }
        return AnalyticsService.instance;
    }

    public static getInstance(): AnalyticsService | null {
        return AnalyticsService.instance;
    }

    public static async shutdown(): Promise<void> {
        if (AnalyticsService.instance?.client) {
            await AnalyticsService.instance.client.shutdown();
            AnalyticsService.instance.client = null;
        }
        AnalyticsService.instance = null;
    }

    private initializeClient(): void {
        if (!this.isTelemetryEnabled()) {
            this.enabled = false;
            return;
        }

        try {
            this.client = new PostHog(ANALYTICS.POSTHOG_API_KEY, {
                host: ANALYTICS.POSTHOG_HOST,
                flushAt: 10,
                flushInterval: 30000,
            });
            this.enabled = true;
        } catch (error) {
            console.error('Failed to initialize PostHog client:', error);
            this.enabled = false;
        }
    }

    private isTelemetryEnabled(): boolean {
        if (!vscode.env.isTelemetryEnabled) {
            return false;
        }

        const config = vscode.workspace.getConfiguration(CONFIG_NAMESPACE);
        return config.get<boolean>(CONFIG_KEYS.ENABLE_TELEMETRY, true);
    }

    public track(event: string, properties?: Record<string, unknown>): void {
        if (!this.enabled || !this.client) {
            return;
        }

        if (!this.isTelemetryEnabled()) {
            this.enabled = false;
            return;
        }

        try {
            this.client.capture({
                distinctId: this.distinctId,
                event,
                properties: {
                    ...properties,
                    extension_version: this.extensionVersion,
                    vscode_version: vscode.version,
                    platform: process.platform,
                },
            });
        } catch (error) {
            console.error('Failed to track event:', error);
        }
    }

    public identify(properties?: Record<string, unknown>): void {
        if (!this.enabled || !this.client) {
            return;
        }

        try {
            this.client.identify({
                distinctId: this.distinctId,
                properties: {
                    ...properties,
                    extension_version: this.extensionVersion,
                    vscode_version: vscode.version,
                    platform: process.platform,
                },
            });
        } catch (error) {
            console.error('Failed to identify user:', error);
        }
    }

    public async flush(): Promise<void> {
        if (this.client) {
            await this.client.flush();
        }
    }

    public setEnabled(enabled: boolean): void {
        this.enabled = enabled && this.isTelemetryEnabled();
    }
}
