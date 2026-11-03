import { afterEach, beforeEach, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { gitEnvironment, LocalGitAdapter, parseAzureRemote, runGit } from '../../src/branchFlow/infrastructure/git';
let folder: string;
const git = async (...args: string[]): Promise<string> => {
    const result = await runGit(folder, args); if (result.code !== 0) { throw new Error(`Fixture command ${args[0]} failed: ${result.stderr}`); } return result.stdout.trim();
};
const commit = async (file: string, content: string): Promise<string> => { await fs.writeFile(path.join(folder, file), content); await git('add', '--', file); await git('commit', '-m', 'fixture'); return git('rev-parse', 'HEAD'); };
beforeEach(async () => { folder = await fs.mkdtemp(path.join(os.tmpdir(), 'branchflow-test-')); await git('init', '--template=', '.'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@localhost'); });
afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });
it('simulates a clean merge and rebase with dirty user checkout and leaves branches/index/worktree unchanged', async () => {
    const base = await commit('shared', 'base\n');
    await git('checkout', '-b', 'source'); const source = await commit('source-file', 'from source\n');
    await git('checkout', '-b', 'target', base); const target = await commit('target-file', 'from target\n');
    await fs.writeFile(path.join(folder, 'shared'), 'user dirty work\n');
    await fs.writeFile(path.join(folder, 'untracked'), 'keep me');
    await git('config', 'rebase.updateRefs', 'true');
    await git('config', 'core.hooksPath', path.join(folder, 'dangerous-hooks'));
    await fs.mkdir(path.join(folder, 'dangerous-hooks'));
    await fs.writeFile(path.join(folder, 'dangerous-hooks', 'pre-rebase'), '#!/bin/sh\nexit 42\n', { mode: 0o755 });
    const before = await git('status', '--porcelain=v1'); const head = await git('rev-parse', 'HEAD'); const branches = await git('show-ref');
    const adapter = new LocalGitAdapter(folder);
    expect(await adapter.isAncestor(source, target)).toBe(false);
    expect(await adapter.simulate(source, target, 'merge-pr')).toEqual({ clean: true, conflictFiles: [] });
    expect(await adapter.simulate(source, target, 'rebase')).toEqual({ clean: true, conflictFiles: [] });
    expect(await git('status', '--porcelain=v1')).toBe(before); expect(await git('rev-parse', 'HEAD')).toBe(head); expect(await git('show-ref')).toBe(branches);
    expect(await fs.readFile(path.join(folder, 'untracked'), 'utf8')).toBe('keep me');
});
it('captures actual merge conflicts and failed rebase commit without modifying the local checkout', async () => {
    const base = await commit('shared', 'original\n');
    await git('checkout', '-b', 'source'); const source = await commit('shared', 'source version\n');
    await git('checkout', '-b', 'target', base); const target = await commit('shared', 'target version\n');
    const before = await git('rev-parse', 'HEAD'); const adapter = new LocalGitAdapter(folder);
    const merge = await adapter.simulate(source, target, 'merge-pr'); expect(merge.clean).toBe(false); expect(merge.conflictFiles).toEqual(['shared']);
    const rebase = await adapter.simulate(source, target, 'rebase'); expect(rebase.clean).toBe(false); expect(rebase.conflictFiles).toEqual(['shared']); expect(rebase.failedCommit).toBe(target);
    expect(await git('rev-parse', 'HEAD')).toBe(before); expect(await git('status', '--porcelain=v1')).toBe('');
});
it('does not infer rebase safety from a clean merge', async () => {
    const base = await commit('shared', 'base\n');
    await git('checkout', '-b', 'source'); const source = await commit('shared', 'final\n');
    await git('checkout', '-b', 'target', base); await commit('shared', 'intermediate\n'); const target = await commit('shared', 'final\n');
    const adapter = new LocalGitAdapter(folder);
    expect((await adapter.simulate(source, target, 'merge-pr')).clean).toBe(true);
    expect((await adapter.simulate(source, target, 'rebase')).clean).toBe(false);
});
it('rejects unavailable commits, unrelated histories, partial/shallow clones and ambiguous revisions', async () => {
    const first = await commit('one', 'one'); const adapter = new LocalGitAdapter(folder);
    await expect(adapter.simulate(first, 'f'.repeat(40), 'rebase')).rejects.toThrow('not available');
    await expect(adapter.simulate('--exec=touch', first, 'rebase')).rejects.toThrow();
    await git('checkout', '--orphan', 'orphan'); await git('rm', '-rf', '.'); const orphan = await commit('other', 'two');
    await expect(adapter.simulate(first, orphan, 'rebase')).rejects.toThrow('unrelated');
    await git('config', 'remote.origin.promisor', 'true'); await expect(adapter.simulate(first, orphan, 'rebase')).rejects.toThrow('non-partial');
});
it('cancels/limits process output and never inherits GIT_DIR or command injection', async () => {
    const sha = await commit('one', 'content'); const abort = new AbortController(); abort.abort();
    await expect(runGit(folder, ['show', sha], abort.signal)).rejects.toThrow('cancelled');
    await expect(runGit(folder, ['show', sha], undefined, 30000, 1)).rejects.toThrow('limit');
    process.env.GIT_DIR = '/untrusted'; try { expect(gitEnvironment().GIT_DIR).toBeUndefined(); expect((await runGit(folder, ['rev-parse', 'HEAD'])).stdout.trim()).toBe(sha); } finally { delete process.env.GIT_DIR; }
});
it('uses exact organization/project/repository identity for local analysis', async () => {
    await git('remote', 'add', 'origin', 'git@ssh.dev.azure.com:v3/example/Project/repo');
    expect(await new LocalGitAdapter(folder).matches({ organizationUrl: 'https://dev.azure.com/example', project: 'Project', repositoryId: 'id', repositoryName: 'repo' })).toBe(true);
    expect(await new LocalGitAdapter(folder).matches({ organizationUrl: 'https://dev.azure.com/other', project: 'Project', repositoryId: 'id', repositoryName: 'repo' })).toBe(false);
    expect(parseAzureRemote('https://user:secret@dev.azure.com/example/Project/_git/repo')?.organizationUrl).toBe('https://dev.azure.com/example');
    expect(parseAzureRemote('file:///repo')).toBeUndefined();
});
