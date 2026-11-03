import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, workspace } from 'vscode';
import { GraphPersistenceService } from '../../src/branchFlow/infrastructure/persistence';
import { graph } from './fixtures';
let directory: string; let uri: Uri; const persistence = new GraphPersistenceService();
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'branchflow-file-test-')); uri = Uri.file(path.join(directory, 'release.branchflow.json')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });
it('saves deterministic JSON by atomic replacement and loads the exact graph', async () => {
    const stamp = await persistence.write(uri, graph()); const stored = await persistence.read(uri);
    expect(stored.stamp).toBe(stamp); expect(stored.graph).toEqual(graph());
    await persistence.write(uri, { ...graph(), name: 'Updated' }, stamp);
    expect((await persistence.read(uri)).graph.name).toBe('Updated');
    expect(await fs.readdir(directory)).toEqual(['release.branchflow.json']);
});
it('refuses stale saves after external edit or deletion', async () => {
    const stamp = await persistence.write(uri, graph());
    await fs.writeFile(uri.fsPath, JSON.stringify({ ...graph(), name: 'External' }));
    await expect(persistence.write(uri, graph(), stamp)).rejects.toThrow('changed outside');
    expect((await persistence.read(uri)).graph.name).toBe('External');
    await fs.unlink(uri.fsPath); await expect(persistence.write(uri, graph(), stamp)).rejects.toThrow('changed outside');
});
it('protects concurrent writers and refuses unexpected existing files', async () => {
    const [first, second] = await Promise.allSettled([persistence.write(uri, graph()), persistence.write(uri, { ...graph(), name: 'Other editor' })]);
    expect([first, second].filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect([first, second].filter(r => r.status === 'rejected')).toHaveLength(1);
    expect((await persistence.read(uri)).graph.schemaVersion).toBe(1);
    await expect(persistence.write(uri, graph())).rejects.toThrow('changed outside');
});
it('preserves the original file and cleans up when replacement fails', async () => {
    const stamp = await persistence.write(uri, graph());
    vi.spyOn(workspace.fs, 'rename').mockRejectedValueOnce(new Error('Disk denied'));
    await expect(persistence.write(uri, { ...graph(), name: 'Lost?' }, stamp)).rejects.toThrow('Disk denied');
    expect((await persistence.read(uri)).graph.name).toBe('Release Flow'); expect(await fs.readdir(directory)).toEqual(['release.branchflow.json']);
});
it('rejects missing, huge, invalid and nonlocal files without writing', async () => {
    await expect(persistence.read(uri)).rejects.toThrow();
    await fs.writeFile(uri.fsPath, ' '.repeat(5 * 1024 * 1024 + 1)); await expect(persistence.read(uri)).rejects.toThrow('limit');
    await fs.writeFile(uri.fsPath, '{}'); await expect(persistence.read(uri)).rejects.toThrow('Invalid');
    await expect(persistence.write(Uri.parse('remote://host/file'), graph())).rejects.toThrow('Atomic replacement');
});
