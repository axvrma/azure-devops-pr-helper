import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { vi } from 'vitest';
export class Uri {
    private constructor(private readonly url: URL) {}
    static file(value: string): Uri { return new Uri(pathToFileURL(value)); }
    static parse(value: string): Uri { return new Uri(new URL(value)); }
    static from(value: { scheme: string; path: string }): Uri { return Uri.parse(`${value.scheme}://${value.path}`); }
    static joinPath(base: Uri, ...parts: string[]): Uri { const url = new URL(base.toString()); url.pathname = path.posix.join(url.pathname, ...parts); return new Uri(url); }
    get fsPath(): string { return this.scheme === 'file' ? fileURLToPath(this.url) : this.path; }
    get scheme(): string { return this.url.protocol.slice(0, -1); }
    get path(): string { return decodeURIComponent(this.url.pathname); }
    toString(): string { return this.url.toString(); }
}
export class FileSystemError extends Error { constructor(readonly code: string) { super(code); } }
async function io<T>(work: () => Promise<T>): Promise<T> {
    try { return await work(); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { throw new FileSystemError('FileNotFound'); } throw error; }
}
export class EventEmitter<T> {
    private listeners = new Set<(event: T) => void>();
    readonly event = (listener: (event: T) => void): { dispose(): void } => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
    fire(value: T): void { this.listeners.forEach(fn => fn(value)); }
    dispose(): void { this.listeners.clear(); }
}
const disposable = (): { dispose(): void } => ({ dispose: () => undefined });
export const workspace = {
    isTrusted: true, workspaceFolders: [] as { uri: Uri }[],
    fs: {
        stat: vi.fn((uri: Uri) => io(async () => { const stat = await fs.stat(uri.fsPath); return { size: stat.size, mtime: stat.mtimeMs }; })),
        readFile: vi.fn((uri: Uri) => io(() => fs.readFile(uri.fsPath))),
        writeFile: vi.fn((uri: Uri, bytes: Uint8Array) => io(() => fs.writeFile(uri.fsPath, bytes))),
        delete: vi.fn((uri: Uri) => io(() => fs.unlink(uri.fsPath))),
        rename: vi.fn((source: Uri, target: Uri) => io(() => fs.rename(source.fsPath, target.fsPath))),
        createDirectory: vi.fn((uri: Uri) => io(async () => { await fs.mkdir(uri.fsPath, { recursive: true }); })),
    },
    getConfiguration: () => ({ get: (_: string, fallback: unknown) => fallback }),
    createFileSystemWatcher: () => ({ ...disposable(), onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable }),
    onDidChangeConfiguration: disposable,
};
export class RelativePattern { constructor(readonly base: string, readonly pattern: string) {} }
export const commands = { executeCommand: vi.fn(), registerCommand: vi.fn(disposable) };
export const window = { createWebviewPanel: vi.fn(), showWarningMessage: vi.fn(), showErrorMessage: vi.fn(), showInformationMessage: vi.fn(), showQuickPick: vi.fn(), showInputBox: vi.fn(), registerCustomEditorProvider: vi.fn(disposable), activeTextEditor: undefined };
export const env = { isTelemetryEnabled: false, machineId: 'fixture-id', openExternal: vi.fn(), clipboard: { writeText: vi.fn() } };
export const version = '1.60.0';
export const ViewColumn = { One: 1 };
export const ProgressLocation = { Notification: 15 };
