import * as vscode from 'vscode';
import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { BranchGraph, LIMITS } from '../domain/model';
import { parseGraph, serializeGraph } from '../domain/graph';

export class FileConflict extends Error {
    constructor() { super('This graph changed outside this editor. Reload it, or use Save As to preserve your changes.'); this.name = 'FileConflict'; }
}
export interface StoredGraph { graph: BranchGraph; stamp: string }
export function contentStamp(bytes: Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export class GraphPersistenceService {
    async read(uri: vscode.Uri): Promise<StoredGraph> {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > LIMITS.bytes) { throw new Error('Graph exceeds the 5 MiB limit.'); }
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (bytes.byteLength > LIMITS.bytes) { throw new Error('Graph exceeds the 5 MiB limit.'); }
        return { graph: parseGraph(Buffer.from(bytes).toString('utf8')), stamp: contentStamp(bytes) };
    }
    async stamp(uri: vscode.Uri): Promise<string | undefined> {
        try { const stat = await vscode.workspace.fs.stat(uri); if (stat.size > LIMITS.bytes) { return 'oversized'; }
            return contentStamp(await vscode.workspace.fs.readFile(uri));
        } catch (error) { if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') { return undefined; } throw error; }
    }
    async write(uri: vscode.Uri, graph: BranchGraph, expected?: string): Promise<string> {
        if (uri.scheme !== 'file') { throw new Error('Save Branch Flow graphs to a local filesystem path. Atomic replacement is unavailable for this filesystem provider.'); }
        const bytes = Buffer.from(serializeGraph(graph));
        const lockPath = uri.fsPath + '.lock';
        let lock;
        try { lock = await fs.open(lockPath, 'wx', 0o600); }
        catch { throw new Error('Another editor is saving this graph, or a lock remains after a crash. Save As, or inspect the sibling .lock file before removing it manually.'); }
        const temporary = vscode.Uri.file(uri.fsPath + '.' + randomBytes(8).toString('hex') + '.tmp');
        try {
            if (await this.stamp(uri) !== expected) { throw new FileConflict(); }
            await vscode.workspace.fs.writeFile(temporary, bytes);
            // Flush the sibling temporary file before the same-directory replacement.
            const handle = await fs.open(temporary.fsPath, 'r+');
            try { await handle.sync(); } finally { await handle.close(); }
            if (await this.stamp(uri) !== expected) { throw new FileConflict(); }
            await vscode.workspace.fs.rename(temporary, uri, { overwrite: true });
            return contentStamp(bytes);
        } finally {
            try { await vscode.workspace.fs.delete(temporary); } catch { /* Renamed, or write never started. */ }
            await lock.close(); await fs.unlink(lockPath);
        }
    }
}
