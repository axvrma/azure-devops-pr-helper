// Fixture-only VS Code API. No credentials, filesystem writes or authenticated network calls.
import * as vscode from 'vscode';
import { pathToFileURL } from 'node:url';
export class Uri {
    constructor(readonly value: string) {}
    static file(value: string): Uri { return new Uri(pathToFileURL(value).toString()); }
    static joinPath(base: Uri, ...parts: string[]): Uri { return new Uri(base.toString().replace(/\/$/, '') + '/' + parts.join('/')); }
    toString(): string { return this.value; }
}
export class EventEmitter<T> {
    event = (_listener: (value: T) => void): { dispose(): void } => { void _listener; return { dispose: () => undefined }; };
    fire(_value: T): void { void _value; }
    dispose(): void { /* Fixture only. */ }
}
export function createPanel(): vscode.WebviewPanel {
    const dispose = (): { dispose(): void } => ({ dispose: () => undefined });
    return { webview: { html: '', options: {}, cspSource: 'http://127.0.0.1:4177', asWebviewUri: () => new Uri('http://127.0.0.1:4177/ui/workbench.css'), onDidReceiveMessage: dispose }, onDidDispose: dispose } as unknown as vscode.WebviewPanel;
}
export const window = { createWebviewPanel: createPanel, activeTextEditor: undefined };
export const ViewColumn = { One: 1 };
export const env = { machineId: 'browser-fixture', isTelemetryEnabled: false, clipboard: { writeText: async () => undefined }, openExternal: async () => false };
export const workspace = { workspaceFolders: undefined, getConfiguration: () => ({ get: <T>(key: string, fallback: T): T => { void key; return fallback; } }) };
export const commands = { executeCommand: async () => undefined };
export const version = '1.60.0';
