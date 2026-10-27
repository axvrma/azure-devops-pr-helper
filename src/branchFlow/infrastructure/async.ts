import { AbortController as LegacyAbortController } from 'abort-controller';

// VS Code 1.60 embeds Node 14.16, before the global AbortController API.
export function createAbortController(): AbortController {
    return typeof AbortController !== 'undefined' ? new AbortController() : new LegacyAbortController() as unknown as AbortController;
}

export class OperationCancelled extends Error {
    constructor() { super('Operation cancelled.'); this.name = 'OperationCancelled'; }
}
export function checkCancelled(signal?: AbortSignal): void {
    if (signal?.aborted) { throw new OperationCancelled(); }
}
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
    checkCancelled(signal);
    return new Promise((resolve, reject) => {
        const cancel = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new OperationCancelled()); };
        const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
        signal?.addEventListener('abort', cancel, { once: true });
    });
}
export class Semaphore {
    private active = 0;
    private queue: (() => void)[] = [];
    constructor(private readonly limit: number) {}
    async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
        checkCancelled(signal);
        if (this.active >= this.limit) {
            await new Promise<void>((resolve, reject) => {
                const ready = (): void => { signal?.removeEventListener('abort', cancel); resolve(); };
                const cancel = (): void => {
                    this.queue = this.queue.filter(item => item !== ready);
                    signal?.removeEventListener('abort', cancel); reject(new OperationCancelled());
                };
                this.queue.push(ready); signal?.addEventListener('abort', cancel, { once: true });
            });
        } else { this.active++; }
        try { checkCancelled(signal); return await fn(); }
        finally {
            const next = this.queue.shift();
            if (next) { next(); } else { this.active--; }
        }
    }
}
