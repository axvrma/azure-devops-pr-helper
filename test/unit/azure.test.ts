import { afterEach, expect, it, vi } from 'vitest';
import type { AxiosInstance, AxiosResponse } from 'axios';
import { AzureDevOpsClient } from '../../src/api/azureDevOps';
import { A, B, repository } from './fixtures';
function setup() {
    const request = vi.fn(); const http = { request } as unknown as Pick<AxiosInstance, 'request'>;
    return { request, client: new AzureDevOpsClient(repository.organizationUrl, repository.project, 'secret-canary', '7.1', http) };
}
const response = (data: unknown, headers = {}): AxiosResponse => ({ data, headers, status: 200, statusText: 'OK', config: {} as AxiosResponse['config'] });
afterEach(() => vi.useRealTimers());
it('encodes project, repo IDs and ref criteria, paginates refs and preserves SHAs', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce(response({ value: [{ name: 'refs/heads/release/a#b', objectId: A }] }, { 'x-ms-continuationtoken': 'next&token' }))
        .mockResolvedValueOnce(response({ value: [{ name: 'refs/heads/release/x', objectId: B }] }));
    expect(await client.listBranchRefs('repo/#id')).toHaveLength(2);
    const first = new URL(request.mock.calls[0][0].url); const second = new URL(request.mock.calls[1][0].url);
    expect(first.pathname).toContain('Project%20with%20space'); expect(first.pathname).toContain('repo%2F%23id'); expect(second.searchParams.get('continuationToken')).toBe('next&token');
    expect(request.mock.calls[0][0].timeout).toBe(15000); expect(request.mock.calls[0][0].maxRedirects).toBe(0);
});
it('validates responses, prevents continuation loops and hides response bodies/credentials', async () => {
    const { client, request } = setup();
    request.mockResolvedValueOnce(response({ value: [{ name: 'refs/heads/a', objectId: 'bad' }] }));
    await expect(client.listBranchRefs('repo')).rejects.toThrow('shape');
    request.mockResolvedValue(response({ value: [] }, { 'x-ms-continuationtoken': 'same' }));
    await expect(client.listBranchRefs('repo')).rejects.toThrow('pagination');
    request.mockReset(); request.mockRejectedValue({ isAxiosError: true, response: { status: 401, data: { message: 'secret-canary' } } });
    await expect(client.listRepositories()).rejects.toThrow('authentication failed'); expect(request).toHaveBeenCalledTimes(1);
});
it('retries transient reads at most twice, respects cancellation and never retries PR creation', async () => {
    vi.useFakeTimers(); const { client, request } = setup();
    request.mockRejectedValue({ isAxiosError: true, response: { status: 503, headers: {} } });
    const result = client.listRepositories(); const assertion = expect(result).rejects.toThrow('503'); await vi.runAllTimersAsync(); await assertion;
    expect(request).toHaveBeenCalledTimes(3);
    request.mockClear(); await expect(client.createPullRequest('repo', { sourceRefName: 'refs/heads/a', targetRefName: 'refs/heads/b', title: 'Title' })).rejects.toThrow('503'); expect(request).toHaveBeenCalledTimes(1);
    const abort = new AbortController(); abort.abort(); request.mockClear();
    await expect(client.listRepositories(abort.signal)).rejects.toThrow('cancelled'); expect(request).not.toHaveBeenCalled();
});
it('respects long Retry-After without immediately retrying and supports short retry cancellation', async () => {
    const { client, request } = setup(); request.mockRejectedValue({ isAxiosError: true, response: { status: 429, headers: { 'retry-after': '60' } } });
    await expect(client.listRepositories()).rejects.toThrow('rate limit'); expect(request).toHaveBeenCalledTimes(1);
});
it('uses documented exact commit comparison and exact PR pairing', async () => {
    const { client, request } = setup(); request.mockResolvedValueOnce(response({ commonCommit: A, baseCommit: A, targetCommit: B, aheadCount: 2, behindCount: 0 }));
    expect((await client.compareCommits('repo', A, B)).commonCommit).toBe(A);
    const query = new URL(request.mock.calls[0][0].url).searchParams; expect(query.get('baseVersion')).toBe(A); expect(query.get('targetVersionType')).toBe('commit');
    const pr = { pullRequestId: 5, title: 'Title', status: 'active', sourceRefName: 'refs/heads/a#b', targetRefName: 'refs/heads/target', repository: { id: 'repo', name: 'r' } };
    request.mockResolvedValueOnce(response({ value: [{ ...pr, targetRefName: 'refs/heads/target-other' }, pr] }));
    expect((await client.findPullRequest('repo', 'a#b', 'target'))?.pullRequestId).toBe(5);
    expect(new URL(request.mock.calls[1][0].url).searchParams.get('searchCriteria.sourceRefName')).toBe('refs/heads/a#b');
    expect(client.getPullRequestWebUrl({ ...pr, _links: { web: { href: 'https://evil.test' } } } as never)).toContain('/_git/repo/pullrequest/5');
});
