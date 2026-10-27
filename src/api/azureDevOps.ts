/* eslint-disable no-control-regex -- Trust-boundary input validation explicitly rejects control characters. */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { z } from 'zod';
import type { AzurePullRequest, AzurePullRequestCreatePayload, AzureRepository } from '../types';
import { BranchRef, branchSchema, PullRequestSummary, safeOrganizationUrl, shaSchema } from '../branchFlow/domain/model';
import { checkCancelled, OperationCancelled, pause, Semaphore } from '../branchFlow/infrastructure/async';
import { createBasicAuthHeader } from '../utils/helpers';

const requests = new Semaphore(4);
const repository = z.object({ id: z.string().min(1), name: z.string(), url: z.string(), defaultBranch: z.string().optional(), project: z.object({ id: z.string(), name: z.string() }) });
const ref = z.object({ name: z.string().startsWith('refs/heads/'), objectId: shaSchema });
const commit = z.object({ commitId: shaSchema });
const pullRequest = z.object({
    pullRequestId: z.number().int().positive(), artifactId: z.string().optional(), title: z.string(), description: z.string().optional(),
    sourceRefName: z.string(), targetRefName: z.string(), status: z.enum(['active', 'completed', 'abandoned']),
    repository: z.object({ id: z.string(), name: z.string() }),
    forkSource: z.object({ repository: z.object({ id: z.string() }) }).optional(),
    mergeStatus: z.string().optional(), lastMergeSourceCommit: commit.optional(), lastMergeTargetCommit: commit.optional(),
    _links: z.object({ web: z.object({ href: z.string() }) }).optional(),
});
export interface CommitComparison { baseCommit?: string; targetCommit?: string; commonCommit?: string; aheadCount?: number; behindCount?: number }
export class AzureRequestError extends Error {
    constructor(readonly status?: number) {
        super(status === 401 ? 'Azure authentication failed. Update your PAT in Settings.' :
            status === 403 ? 'Azure access denied. Check PAT scopes and repository permissions.' :
            status === 404 ? 'Azure resource not found. Check organization, project, repository and branch names.' :
            status === 429 ? 'Azure rate limit reached. Wait before refreshing.' :
            status ? `Azure request failed (HTTP ${status}). Retry when the service is available.` :
                'Azure request could not complete. Check the connection and configured HTTPS organization URL.');
        this.name = 'AzureRequestError';
    }
}

export class AzureDevOpsClient {
    private readonly orgUrl: string;
    constructor(orgUrl: string, private readonly project: string, private readonly pat: string,
        private readonly apiVersion = '7.1', private readonly http: Pick<AxiosInstance, 'request'> = axios.create()) {
        this.orgUrl = safeOrganizationUrl(orgUrl);
        if (!project || project.length > 256 || /[\x00-\x1f]/.test(project) || !/^\d+(\.\d+)?$/.test(apiVersion)) { throw new Error('Invalid Azure project or API version.'); }
    }
    private url(path: string, params: Record<string, string> = {}, version = this.apiVersion): string {
        return `${this.orgUrl}/${encodeURIComponent(this.project)}/_apis/${path}?${new URLSearchParams({ ...params, 'api-version': version })}`;
    }
    private repo(id: string): string { return `git/repositories/${encodeURIComponent(id)}`; }
    private async request(method: 'GET' | 'POST' | 'PATCH', url: string, signal?: AbortSignal, data?: unknown,
        contentType = 'application/json'): Promise<AxiosResponse<unknown>> {
        return requests.run(async () => {
            for (let attempt = 0; ; attempt++) {
                checkCancelled(signal);
                try {
                    const config: AxiosRequestConfig = { method, url, data, signal,
                        headers: { Authorization: createBasicAuthHeader(this.pat), 'Content-Type': contentType },
                        timeout: 15000, maxContentLength: 10 * 1024 * 1024, maxBodyLength: 1024 * 1024, maxRedirects: 0 };
                    return await this.http.request(config);
                } catch (error) {
                    if (signal?.aborted || axios.isCancel(error)) { throw new OperationCancelled(); }
                    const status = axios.isAxiosError(error) ? error.response?.status : undefined;
                    const retry = method === 'GET' && attempt < 2 && (!status || status === 429 || status >= 500);
                    if (!retry) { throw new AzureRequestError(status); }
                    const header = axios.isAxiosError(error) ? error.response?.headers?.['retry-after'] : undefined;
                    const seconds = Number(header);
                    const retryMs = header ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(header)) - Date.now()) : 500 * 2 ** attempt;
                    // Do not hammer the service if it requests a longer wait than the interactive budget.
                    if (retryMs > 10000) { throw new AzureRequestError(status); }
                    await pause(Math.max(100, Number.isFinite(retryMs) ? retryMs : 1000), signal);
                }
            }
        }, signal);
    }
    private parse<T>(schema: z.ZodType<T>, data: unknown): T {
        const parsed = schema.safeParse(data);
        if (!parsed.success) { throw new Error('Azure returned an unexpected response shape. Check API version compatibility.'); }
        return parsed.data;
    }
    private async pages<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal, params: Record<string, string> = {}): Promise<T[]> {
        const items: T[] = []; const seen = new Set<string>(); let token: string | undefined;
        for (let page = 0; page < 200; page++) {
            const response = await this.request('GET', this.url(path, { ...params, ...(token ? { continuationToken: token } : {}) }), signal);
            items.push(...this.parse(z.object({ value: z.array(schema).max(10000) }), response.data).value);
            if (items.length > 100000) { throw new Error('Azure discovery exceeds the 100,000-item limit. Narrow the repository scope.'); }
            const raw = response.headers['x-ms-continuationtoken']; token = Array.isArray(raw) ? raw[0] : raw === undefined ? undefined : String(raw);
            if (!token) { return items; }
            if (seen.has(token)) { throw new Error('Azure repeated a pagination token. Retry discovery.'); } seen.add(token);
        }
        throw new Error('Azure discovery exceeded 200 pages. Narrow the repository scope.');
    }
    async listRepositories(signal?: AbortSignal): Promise<AzureRepository[]> {
        return this.pages('git/repositories', repository, signal);
    }
    async listBranchRefs(repositoryId: string, signal?: AbortSignal): Promise<BranchRef[]> {
        const refs = await this.pages(`${this.repo(repositoryId)}/refs`, ref, signal, { filter: 'heads/', '$top': '1000' });
        const unique = new Map<string, BranchRef>();
        for (const item of refs) {
            const name = item.name.slice(11);
            if (!branchSchema.safeParse(name).success) { throw new Error('Azure returned an invalid branch ref.'); }
            if (!/^0+$/.test(item.objectId)) { unique.set(name, { name, sha: item.objectId }); }
        }
        return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
    }
    async listBranches(repositoryId: string, signal?: AbortSignal): Promise<string[]> {
        return (await this.listBranchRefs(repositoryId, signal)).map(r => r.name);
    }
    async compareCommits(repositoryId: string, source: string, target: string, signal?: AbortSignal): Promise<CommitComparison> {
        shaSchema.parse(source); shaSchema.parse(target);
        const response = await this.request('GET', this.url(`${this.repo(repositoryId)}/diffs/commits`, {
            baseVersion: source, baseVersionType: 'commit', targetVersion: target, targetVersionType: 'commit', diffCommonCommit: 'true', '$top': '1',
        }), signal);
        return this.parse(z.object({ baseCommit: shaSchema.optional(), targetCommit: shaSchema.optional(), commonCommit: shaSchema.optional(),
            aheadCount: z.number().int().nonnegative().optional(), behindCount: z.number().int().nonnegative().optional() }), response.data);
    }
    async listPullRequests(repositoryId: string, status: 'active' | 'completed' = 'active', signal?: AbortSignal,
        pair?: { source: string; target: string }): Promise<AzurePullRequest[]> {
        const items: AzurePullRequest[] = []; const pageSize = 100;
        if (pair) { branchSchema.parse(pair.source); branchSchema.parse(pair.target); }
        for (let page = 0; page < 200; page++) {
            const response = await this.request('GET', this.url(`${this.repo(repositoryId)}/pullrequests`, {
                'searchCriteria.status': status, '$top': String(pageSize), '$skip': String(page * pageSize),
                ...(pair ? { 'searchCriteria.sourceRefName': `refs/heads/${pair.source}`, 'searchCriteria.targetRefName': `refs/heads/${pair.target}` } : {}),
            }), signal);
            const batch = this.parse(z.object({ value: z.array(pullRequest) }), response.data).value;
            items.push(...batch);
            if (batch.length < pageSize) { return items; }
        }
        throw new Error('Too many pull requests. Narrow the branch pair.');
    }
    async findPullRequest(repositoryId: string, source: string, target: string, signal?: AbortSignal): Promise<AzurePullRequest | undefined> {
        const items = await this.listPullRequests(repositoryId, 'active', signal, { source, target });
        return items.find(pr => pr.repository.id === repositoryId && (!pr.forkSource || pr.forkSource.repository.id === repositoryId) && pr.sourceRefName === `refs/heads/${source}` && pr.targetRefName === `refs/heads/${target}`);
    }
    async getPullRequest(repositoryId: string, prId: number, signal?: AbortSignal): Promise<AzurePullRequest> {
        this.validPrId(prId);
        return this.parse(pullRequest, (await this.request('GET', this.url(`${this.repo(repositoryId)}/pullrequests/${prId}`), signal)).data);
    }
    async getPolicyEvaluations(projectId: string, prId: number, signal?: AbortSignal): Promise<string[]> {
        this.validPrId(prId);
        const statuses: string[] = [];
        for (let page = 0; page < 100; page++) {
            const response = await this.request('GET', this.url('policy/evaluations', {
                artifactId: `vstfs:///CodeReview/CodeReviewId/${projectId}/${prId}`, '$top': '100', '$skip': String(page * 100),
            }, '7.1-preview.1'), signal);
            const values = this.parse(z.object({ value: z.array(z.object({ status: z.string() })) }), response.data).value;
            statuses.push(...values.map(p => p.status));
            if (values.length < 100) { return statuses; }
        }
        throw new Error('Policy evaluation list exceeded the size limit. Review policies in Azure DevOps.');
    }
    async getPullRequestChanges(repositoryId: string, prId: number, signal?: AbortSignal): Promise<string[]> {
        this.validPrId(prId);
        const path = `${this.repo(repositoryId)}/pullrequests/${prId}/iterations`;
        const iterations = this.parse(z.object({ value: z.array(z.object({ id: z.number().int().positive() })) }),
            (await this.request('GET', this.url(path), signal)).data).value;
        const last = Math.max(0, ...iterations.map(i => i.id)); if (!last) { return []; }
        const files = new Set<string>(); let skip = 0;
        for (let page = 0; page < 100; page++) {
            const response = await this.request('GET', this.url(`${path}/${last}/changes`, { '$top': '1000', '$skip': String(skip) }), signal);
            const data = this.parse(z.object({ changeEntries: z.array(z.object({ item: z.object({ path: z.string().max(4096).optional() }).optional() })),
                nextSkip: z.number().int().nonnegative().optional(), nextTop: z.number().int().nonnegative().optional() }), response.data);
            data.changeEntries.forEach(c => { if (c.item?.path) { files.add(c.item.path); } });
            if (!data.nextSkip || !data.nextTop) { return [...files]; }
            if (data.nextSkip <= skip) { throw new Error('Azure repeated a changes page.'); } skip = data.nextSkip;
        }
        throw new Error('Pull request change list exceeded the size limit.');
    }
    async createPullRequest(repositoryId: string, payload: AzurePullRequestCreatePayload): Promise<AzurePullRequest> {
        return this.parse(pullRequest, (await this.request('POST', this.url(`${this.repo(repositoryId)}/pullrequests`), undefined, payload)).data);
    }
    async linkWorkItem(workItemId: string, artifactId: string): Promise<void> {
        if (!/^[1-9]\d{0,14}$/.test(workItemId) || !artifactId.startsWith('vstfs:///Git/PullRequestId/')) { throw new Error('Invalid work item or PR artifact.'); }
        await this.request('PATCH', this.url(`wit/workitems/${encodeURIComponent(workItemId)}`), undefined,
            [{ op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: artifactId, attributes: { name: 'Pull Request' } } }], 'application/json-patch+json');
    }
    getPullRequestWebUrl(pr: Pick<AzurePullRequest, 'pullRequestId' | 'repository'>): string {
        this.validPrId(pr.pullRequestId);
        // Construct from the approved origin; never trust a response-provided link.
        return `${this.orgUrl}/${encodeURIComponent(this.project)}/_git/${encodeURIComponent(pr.repository.id)}/pullrequest/${pr.pullRequestId}`;
    }
    summary(pr: AzurePullRequest): PullRequestSummary {
        return { id: pr.pullRequestId, title: pr.title.slice(0, 4096), status: pr.status as PullRequestSummary['status'], mergeStatus: pr.mergeStatus,
            sourceSha: pr.lastMergeSourceCommit?.commitId, targetSha: pr.lastMergeTargetCommit?.commitId };
    }
    private validPrId(id: number): void { if (!Number.isSafeInteger(id) || id < 1) { throw new Error('Invalid pull request ID.'); } }
}

export async function pickRepository(client: AzureDevOpsClient, currentRepoName?: string): Promise<string | undefined> {
    const vscode = await import('vscode');
    try {
        const repositories = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Loading repositories…' }, () => client.listRepositories());
        if (!repositories.length) { vscode.window.showWarningMessage('No repositories found. Check project and PAT permissions.'); return; }
        const match = repositories.find(r => r.name === currentRepoName); if (match) { return match.id; }
        return (await vscode.window.showQuickPick(repositories.map(r => ({ label: r.name, id: r.id })), { placeHolder: 'Select repository' }))?.id;
    } catch (error) { vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Repository discovery failed.'); return; }
}
