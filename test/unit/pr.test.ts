import { expect, it, vi } from 'vitest';
import { AzureDevOpsClient } from '../../src/api/azureDevOps';
import { PullRequestService } from '../../src/services/pullRequestService';
import type { ExtensionServices, PRHistoryItem } from '../../src/types';
import { A, B } from './fixtures';
const pr = { pullRequestId: 42, artifactId: 'vstfs:///Git/PullRequestId/p/r/42', title: 'Manual title', status: 'active', sourceRefName: 'refs/heads/release/a', targetRefName: 'refs/heads/release/b', repository: { id: 'repo', name: 'Repository' } };
function setup() {
    const api = { findPullRequest: vi.fn().mockResolvedValue(undefined), listBranchRefs: vi.fn().mockResolvedValue([{ name: 'release/a', sha: A }, { name: 'release/b', sha: B }]),
        createPullRequest: vi.fn().mockResolvedValue(pr), linkWorkItem: vi.fn().mockResolvedValue(undefined), getPullRequestWebUrl: vi.fn().mockReturnValue('https://dev.azure.com/org/p/_git/repo/pullrequest/42') };
    const values = new Map<string, unknown>();
    const state = { getState: <T>(key: string): T | undefined => values.get(key) as T | undefined, setState: vi.fn(async (key: string, value: unknown) => { values.set(key, value); }) };
    return { api, state, values, service: new PullRequestService(api as unknown as AzureDevOpsClient, state as Pick<ExtensionServices, 'getState' | 'setState'>, 'org/project') };
}
const input = { repositoryId: 'repo', sourceBranch: 'release/a', targetBranch: 'release/b', title: 'Manual title', description: 'Without AI', workItems: '1, 2, 1' };
it('preserves manual title/description, work-item linking and ten-entry history with no AI dependency', async () => {
    const { service, api, values } = setup();
    values.set('prHistory', Array.from({ length: 10 }, (_, i) => ({ id: i })));
    const result = await service.create(input, 'Repository');
    expect(result.history.id).toBe(42); expect(result.history.workItems).toEqual(['1', '2']);
    expect((values.get('prHistory') as PRHistoryItem[])).toHaveLength(10);
    expect(api.createPullRequest).toHaveBeenCalledWith('repo', expect.objectContaining({ sourceRefName: 'refs/heads/release/a', title: 'Manual title', description: 'Without AI' }));
});
it('prevents matching active duplicates and repeated in-flight submissions', async () => {
    const { service, api } = setup(); api.findPullRequest.mockResolvedValueOnce(pr);
    await expect(service.create(input, 'Repository')).rejects.toThrow('already exists'); expect(api.createPullRequest).not.toHaveBeenCalled();
    let resolve!: () => void; api.findPullRequest.mockImplementationOnce(() => new Promise<void>(r => { resolve = () => r(); }));
    const first = service.create(input, 'Repository'); await expect(service.create(input, 'Repository')).rejects.toThrow('in progress'); resolve(); await first;
});
it('rechecks branch existence immediately before submitting and validates untrusted form values', async () => {
    const { service, api } = setup(); api.listBranchRefs.mockResolvedValue([]);
    await expect(service.create(input, 'Repository')).rejects.toThrow('deleted'); expect(api.createPullRequest).not.toHaveBeenCalled();
    for (const value of [null, { ...input, title: '' }, { ...input, sourceBranch: '--exec=bad' }, { ...input, sourceBranch: input.targetBranch }, { ...input, token: 'oops' }]) {
        await expect(service.create(value, 'Repository')).rejects.toThrow('Check');
    }
});
it('returns the created PR on partial linking/history failure without encouraging duplicate creation', async () => {
    const { service, api, state } = setup(); api.linkWorkItem.mockRejectedValue(new Error('Forbidden')); state.setState.mockRejectedValue(new Error('Disk'));
    const result = await service.create(input, 'Repository'); expect(result.history.id).toBe(42); expect(result.warnings).toHaveLength(3); expect(api.createPullRequest).toHaveBeenCalledTimes(1);
});
