import axios, { AxiosError } from 'axios';
import { 
    ClaudeGenerationResult, 
    ClaudeRequestPayload, 
    ClaudeResponse 
} from '../types';
import { CLAUDE_API } from '../utils/constants';

export interface ClaudeClientConfig {
    apiKey: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
}

export class ClaudeClient {
    private readonly apiKey: string;
    private readonly model: string;
    private readonly maxTokens: number;
    private readonly temperature: number;

    constructor(config: ClaudeClientConfig) {
        this.apiKey = config.apiKey;
        this.model = config.model || 'claude-sonnet-4-5';
        this.maxTokens = config.maxTokens || 1024;
        this.temperature = config.temperature || 0.3;
    }

    /**
     * Generate text using Claude API
     */
    async generate(prompt: string): Promise<ClaudeGenerationResult> {
        const payload: ClaudeRequestPayload = {
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

        try {
            const response = await axios.post<ClaudeResponse>(
                CLAUDE_API.ENDPOINT,
                payload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': this.apiKey,
                        'anthropic-version': CLAUDE_API.VERSION,
                    },
                    timeout: CLAUDE_API.TIMEOUT,
                }
            );

            const text = this.extractText(response.data);
            const title = this.extractFirstLine(text);

            return {
                title: title.trim(),
                raw: response.data,
                status: response.status,
            };
        } catch (error) {
            return this.handleError(error);
        }
    }

    /**
     * Generate a PR title based on branch and repo context
     */
    async generatePRTitle(branch: string, repo: string): Promise<ClaudeGenerationResult> {
        const prompt = `Generate a clear concise PR title (max 60 chars) for changes on branch "${branch}" in repository "${repo}". Be descriptive and action-oriented. Return only the title, no quotes or extra text.`;
        return this.generate(prompt);
    }

    /**
     * Generate a PR description based on branch and repo context
     */
    async generatePRDescription(branch: string, repo: string): Promise<ClaudeGenerationResult> {
        const prompt = `Write a concise PR description for changes on branch "${branch}" in repository "${repo}". Include:
- Main intent/purpose (1 sentence)
- What was changed (bullet points)
- Testing notes (brief)

Keep it under 200 words. Return only the description, no quotes.`;
        return this.generate(prompt);
    }

    private extractText(response: ClaudeResponse): string {
        if (Array.isArray(response.content) && response.content.length > 0) {
            return response.content
                .map(block => block.text ?? '')
                .join('\n');
        }
        return '';
    }

    private extractFirstLine(text: string): string {
        const lines = text.split('\n').filter(line => line.trim().length > 0);
        return lines[0] ?? text;
    }

    private handleError(error: unknown): ClaudeGenerationResult {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            const responseData = axiosError.response?.data;
            console.error('Claude API error', responseData ?? axiosError.message);
            return { 
                error: typeof responseData === 'object' 
                    ? JSON.stringify(responseData) 
                    : axiosError.message 
            };
        }

        const message = error instanceof Error ? error.message : String(error);
        console.error('Claude error', message);
        return { error: message };
    }
}

/**
 * Create prompts for PR title and description generation
 */
export const PRPrompts = {
    title: (branch: string, repo: string): string =>
        `Generate a clear concise PR title (max 60 chars) for changes on branch "${branch}" in repository "${repo}". Be descriptive and action-oriented. Return only the title, no quotes or extra text.`,

    description: (branch: string, repo: string): string =>
        `Write a concise PR description for changes on branch "${branch}" in repository "${repo}". Include:
- Main intent/purpose (1 sentence)
- What was changed (bullet points)  
- Testing notes (brief)

Keep it under 200 words. Return only the description, no quotes.`,
};
