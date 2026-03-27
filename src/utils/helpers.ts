/**
 * Normalize a base URL by removing trailing slashes
 */
export function normalizeBaseUrl(url: string | undefined): string | undefined {
    if (!url) {
        return url;
    }
    return url.replace(/\/+$/, '');
}

/**
 * Generate a cryptographic nonce for CSP
 */
export function getNonce(): string {
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

/**
 * Create Basic Auth header value from PAT
 */
export function createBasicAuthHeader(pat: string): string {
    return 'Basic ' + Buffer.from(`:${pat}`).toString('base64');
}

/**
 * Validate a work item ID (should be a positive integer)
 */
export function isValidWorkItemId(id: string): boolean {
    const trimmed = id.trim();
    if (!trimmed) {
        return false;
    }
    const num = parseInt(trimmed, 10);
    return !isNaN(num) && num > 0 && String(num) === trimmed;
}

/**
 * Parse comma-separated work item IDs
 */
export function parseWorkItemIds(input: string): string[] {
    return input
        .split(',')
        .map(id => id.trim())
        .filter(id => isValidWorkItemId(id));
}

/**
 * Truncate text to a maximum length with ellipsis
 */
export function truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text;
    }
    return text.slice(0, maxLength - 3) + '...';
}

/**
 * Delay execution for a specified number of milliseconds
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 1000
): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            
            if (attempt < maxRetries - 1) {
                const delayMs = initialDelayMs * Math.pow(2, attempt);
                await delay(delayMs);
            }
        }
    }
    
    throw lastError;
}
