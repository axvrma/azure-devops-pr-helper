import axios, { AxiosError } from 'axios';
import { AIGenerationResult, AIProvider, AnthropicRequestPayload, AnthropicResponse, ExtensionServices } from '../types';
import {
    AI_DEFAULT_MODELS,
    ANTHROPIC_API,
    CONFIG_KEYS,
    DEFAULT_CONFIG,
    GEMINI_API,
    OPENAI_API,
    SECRET_KEYS,
} from '../utils/constants';

export interface AIClientConfig {
    provider: AIProvider;
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
}

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
            }>;
        };
    }>;
}

interface OpenAIResponse {
    choices?: Array<{
        message?: {
            content?: string;
        };
        text?: string;
    }>;
}

export const AI_PROVIDER_LABELS: Record<AIProvider, string> = {
    anthropic: 'Anthropic',
    gemini: 'Google Gemini',
    openai: 'OpenAI',
};

export function isAIProvider(value: unknown): value is AIProvider {
    return value === 'anthropic' || value === 'gemini' || value === 'openai';
}

export function getAIProviderLabel(provider: AIProvider): string {
    return AI_PROVIDER_LABELS[provider];
}

export function normalizeGeneratedTitle(title: string): string {
    const maxTitleLength = 60;
    const normalized = title
        .trim()
        .replace(/^["'`]+|["'`]+$/g, '')
        .replace(/\s+/g, ' ');

    if (normalized.length <= maxTitleLength) {
        return normalized;
    }

    return normalized.slice(0, maxTitleLength - 3).trimEnd() + '...';
}

export function getDefaultAIModel(provider: AIProvider): string {
    return AI_DEFAULT_MODELS[provider];
}

export function getAISecretKey(provider: AIProvider): string {
    switch (provider) {
        case 'anthropic':
            return SECRET_KEYS.ANTHROPIC_API_KEY;
        case 'gemini':
            return SECRET_KEYS.GEMINI_API_KEY;
        case 'openai':
            return SECRET_KEYS.OPENAI_API_KEY;
    }
}

export async function getAISecret(services: ExtensionServices, provider: AIProvider): Promise<string | undefined> {
    const secret = await services.getSecret(getAISecretKey(provider));
    if (secret) {
        return secret;
    }

    return undefined;
}

export function getConfiguredAIProvider(services: ExtensionServices): AIProvider {
    const configured = services.getConfig(CONFIG_KEYS.AI_PROVIDER, DEFAULT_CONFIG.aiProvider);
    return isAIProvider(configured) ? configured : DEFAULT_CONFIG.aiProvider;
}

export function getConfiguredAIModel(services: ExtensionServices, provider: AIProvider): string {
    const model = services.getConfig(CONFIG_KEYS.AI_MODEL, DEFAULT_CONFIG.aiModel).trim();
    if (model) {
        return model;
    }

    return getDefaultAIModel(provider);
}

export function getConfiguredAIMaxTokens(services: ExtensionServices): number {
    return services.getConfig(CONFIG_KEYS.AI_MAX_TOKENS, DEFAULT_CONFIG.aiMaxTokens);
}

export function getConfiguredAITemperature(services: ExtensionServices): number {
    return services.getConfig(CONFIG_KEYS.AI_TEMPERATURE, DEFAULT_CONFIG.aiTemperature);
}

export async function createAIClientFromServices(
    services: ExtensionServices
): Promise<{ client?: AIClient; provider: AIProvider; model: string; error?: string }> {
    const provider = getConfiguredAIProvider(services);
    const model = getConfiguredAIModel(services, provider);
    const apiKey = await getAISecret(services, provider);

    if (!apiKey) {
        return {
            provider,
            model,
            error: `${getAIProviderLabel(provider)} API key not configured`,
        };
    }

    return {
        provider,
        model,
        client: new AIClient({
            provider,
            apiKey,
            model,
            maxTokens: getConfiguredAIMaxTokens(services),
            temperature: getConfiguredAITemperature(services),
        }),
    };
}

export class AIClient {
    private readonly provider: AIProvider;
    private readonly apiKey: string;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;

    constructor(config: AIClientConfig) {
        this.provider = config.provider;
        this.apiKey = config.apiKey;
        this.model = config.model || getDefaultAIModel(config.provider);
        this.maxTokens = config.maxTokens || DEFAULT_CONFIG.aiMaxTokens;
        this.temperature = config.temperature ?? DEFAULT_CONFIG.aiTemperature;
    }

    async generate(prompt: string): Promise<AIGenerationResult> {
        try {
            switch (this.provider) {
                case 'anthropic':
                    return await this.generateWithAnthropic(prompt);
                case 'gemini':
                    return await this.generateWithGemini(prompt);
                case 'openai':
                    return await this.generateWithOpenAI(prompt);
            }
        } catch (error) {
            return this.handleError(error);
        }
    }

    async generatePRTitle(branch: string, repo: string): Promise<AIGenerationResult> {
        const result = await this.generate(PRPrompts.title(branch, repo));
        if (result.title && !result.error) {
            return {
                ...result,
                title: normalizeGeneratedTitle(result.title),
            };
        }
        return result;
    }

    async generatePRDescription(branch: string, repo: string): Promise<AIGenerationResult> {
        const result = await this.generate(PRPrompts.description(branch, repo));
        if (result.text && !result.error) {
            return {
                ...result,
                title: result.text,
            };
        }
        return result;
    }

    private async generateWithAnthropic(prompt: string): Promise<AIGenerationResult> {
        const payload: AnthropicRequestPayload = {
            model: this.model,
            max_tokens: this.maxTokens,
            temperature: this.temperature,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
        };

        const response = await axios.post<AnthropicResponse>(
            ANTHROPIC_API.ENDPOINT,
            payload,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': ANTHROPIC_API.VERSION,
                },
                timeout: ANTHROPIC_API.TIMEOUT,
            }
        );

        return this.toResult(this.extractAnthropicText(response.data), response.data, response.status);
    }

    private async generateWithGemini(prompt: string): Promise<AIGenerationResult> {
        const response = await axios.post<GeminiResponse>(
            `${GEMINI_API.ENDPOINT}/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
            {
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: prompt }],
                    },
                ],
                generationConfig: {
                    temperature: this.temperature,
                    maxOutputTokens: this.maxTokens,
                },
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                timeout: GEMINI_API.TIMEOUT,
            }
        );

        return this.toResult(this.extractGeminiText(response.data), response.data, response.status);
    }

    private async generateWithOpenAI(prompt: string): Promise<AIGenerationResult> {
        const response = await axios.post<OpenAIResponse>(
            OPENAI_API.ENDPOINT,
            {
                model: this.model,
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                max_tokens: this.maxTokens,
                temperature: this.temperature,
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${this.apiKey}`,
                },
                timeout: OPENAI_API.TIMEOUT,
            }
        );

        return this.toResult(this.extractOpenAIText(response.data), response.data, response.status);
    }

    private toResult(text: string, raw: unknown, status: number): AIGenerationResult {
        const cleanText = this.cleanGeneratedText(text);
        if (!cleanText) {
            return {
                error: `${getAIProviderLabel(this.provider)} returned an empty response`,
                raw,
                status,
                provider: this.provider,
            };
        }

        const title = this.extractFirstLine(cleanText);

        return {
            title,
            text: cleanText,
            raw,
            status,
            provider: this.provider,
        };
    }

    private extractAnthropicText(response: AnthropicResponse): string {
        if (Array.isArray(response.content) && response.content.length > 0) {
            return response.content
                .map(block => block.text ?? '')
                .join('\n');
        }
        return '';
    }

    private extractGeminiText(response: GeminiResponse): string {
        return response.candidates?.[0]?.content?.parts
            ?.map(part => part.text ?? '')
            .join('\n') ?? '';
    }

    private extractOpenAIText(response: OpenAIResponse): string {
        return response.choices?.[0]?.message?.content ?? response.choices?.[0]?.text ?? '';
    }

    private extractFirstLine(text: string): string {
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        return lines[0] ?? text;
    }

    private cleanGeneratedText(text: string): string {
        return text
            .trim()
            .replace(/^["'`]+|["'`]+$/g, '')
            .trim();
    }

    private handleError(error: unknown): AIGenerationResult {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            const responseData = axiosError.response?.data;
            console.error(`${getAIProviderLabel(this.provider)} API error`, responseData ?? axiosError.message);
            return {
                error: typeof responseData === 'object'
                    ? JSON.stringify(responseData)
                    : axiosError.message,
                provider: this.provider,
            };
        }

        const message = error instanceof Error ? error.message : String(error);
        console.error(`${getAIProviderLabel(this.provider)} error`, message);
        return { error: message, provider: this.provider };
    }
}

export const PRPrompts = {
    title: (branch: string, repo: string, commits?: string, diff?: string): string =>
        `Generate a clear, concise PR title (max 60 chars) based on the following changes.

Branch: ${branch}
Repository: ${repo}
${commits ? `\nCommit messages:\n${commits}` : ''}
${diff ? `\nGit diff:\n${diff}` : ''}

Requirements:
- Be specific about what changed
- Use action verbs
- Max 60 characters
- Return only the title, no quotes or explanation`,

    description: (branch: string, repo: string, commits?: string, diff?: string): string =>
        `Write a concise PR description based on the following changes.

Branch: ${branch}
Repository: ${repo}
${commits ? `\nCommit messages:\n${commits}` : ''}
${diff ? `\nGit diff:\n${diff}` : ''}

Include:
- Main intent/purpose
- What changed
- Testing notes, or "Not run" if unknown

Keep it under 200 words. Return only the description, no quotes.`,
};
