import { z } from 'zod';
import { AzureDevOpsClient } from '../api/azureDevOps';
import type { AzurePullRequest, ExtensionServices, PRHistoryItem } from '../types';
import { branchSchema, RepositoryContext, safeOrganizationUrl } from '../branchFlow/domain/model';
import { CONFIG_KEYS, DEFAULT_CONFIG, SECRET_KEYS, STATE_KEYS } from '../utils/constants';
import { parseWorkItemIds } from '../utils/helpers';

export const prFormSchema = z.object({
    repositoryId: z.string().min(1).max(256), sourceBranch: branchSchema, targetBranch: branchSchema,
    title: z.string().trim().min(1).max(200), description: z.string().max(100000).default(''),
    workItems: z.string().max(4096).default(''), generatedByAI: z.boolean().optional(),
}).strict().refine(d => d.sourceBranch !== d.targetBranch, 'Source and target branches must differ.');
export type PullRequestInput = z.infer<typeof prFormSchema>;
export interface PRPrefill { context: RepositoryContext; sourceBranch: string; targetBranch: string }
export class DuplicatePullRequest extends Error {
    constructor(readonly pr: AzurePullRequest) { super(`An active PR #${pr.pullRequestId} already exists for this branch pair. Open it from Branch Flow or Azure DevOps.`); }
}
export function configuredContext(services: ExtensionServices): { organizationUrl: string; project: string } {
    const organizationUrl = safeOrganizationUrl(services.getConfig<string>(CONFIG_KEYS.ORG_HOST, DEFAULT_CONFIG.orgHost));
    const project = services.getConfig<string>(CONFIG_KEYS.PROJECT, DEFAULT_CONFIG.project);
    if (organizationUrl === DEFAULT_CONFIG.orgHost || !project || project === DEFAULT_CONFIG.project) { throw new Error('Configure Azure organization and project in Settings.'); }
    return { organizationUrl, project };
}
export async function azureClient(services: ExtensionServices, context = configuredContext(services)): Promise<AzureDevOpsClient> {
    const pat = await services.getSecret(SECRET_KEYS.AZURE_PAT);
    if (!pat) { throw new Error('Azure PAT is missing. Add it in Settings. Branch Flow analysis only needs Code Read permission.'); }
    return new AzureDevOpsClient(context.organizationUrl, context.project, pat, services.getConfig<string>(CONFIG_KEYS.API_VERSION, DEFAULT_CONFIG.apiVersion));
}

export class PullRequestService {
    private static inFlight = new Set<string>();
    constructor(private readonly client: AzureDevOpsClient, private readonly services: Pick<ExtensionServices, 'getState' | 'setState'>,
        private readonly contextKey: string) {}
    async create(value: unknown, repositoryName: string): Promise<{ history: PRHistoryItem; warnings: string[] }> {
        const parsed = prFormSchema.safeParse(value);
        if (!parsed.success) { throw new Error('Check repository, valid distinct branches, title (1–200 characters) and field lengths.'); }
        const input = parsed.data;
        const key = JSON.stringify([this.contextKey, input.repositoryId, input.sourceBranch, input.targetBranch]);
        if (PullRequestService.inFlight.has(key)) { throw new Error('PR submission for this branch pair is already in progress.'); }
        PullRequestService.inFlight.add(key);
        try {
            const existing = await this.client.findPullRequest(input.repositoryId, input.sourceBranch, input.targetBranch);
            if (existing) { throw new DuplicatePullRequest(existing); }
            // Branch heads are checked immediately before submission, even when an analysis snapshot exists.
            const refs = await this.client.listBranchRefs(input.repositoryId);
            if (![input.sourceBranch, input.targetBranch].every(name => refs.some(r => r.name === name))) { throw new Error('A selected branch was deleted or renamed. Refresh branches before submitting.'); }
            // Writes are never retried. A network failure may have created the PR; duplicate lookup on the next submission recovers safely.
            const pr = await this.client.createPullRequest(input.repositoryId, {
                sourceRefName: `refs/heads/${input.sourceBranch}`, targetRefName: `refs/heads/${input.targetBranch}`,
                title: input.title, description: input.description,
            });
            const warnings: string[] = []; const linked: string[] = [];
            for (const id of [...new Set(parseWorkItemIds(input.workItems))]) {
                if (!pr.artifactId) { warnings.push('PR created; work items could not be linked because Azure returned no artifact ID.'); break; }
                try { await this.client.linkWorkItem(id, pr.artifactId); linked.push(id); }
                catch { warnings.push(`PR created; work item ${id} was not linked. Link it manually after checking permissions.`); }
            }
            const history: PRHistoryItem = { id: pr.pullRequestId, title: input.title, description: input.description,
                url: this.client.getPullRequestWebUrl(pr), sourceBranch: input.sourceBranch, targetBranch: input.targetBranch,
                repository: repositoryName, createdAt: new Date().toISOString(), workItems: linked };
            try {
                await this.services.setState(STATE_KEYS.LAST_PR_URL, history.url);
                const previous = this.services.getState<PRHistoryItem[]>(STATE_KEYS.PR_HISTORY) ?? [];
                await this.services.setState(STATE_KEYS.PR_HISTORY, [history, ...previous].slice(0, 10));
            } catch { warnings.push('PR created, but local history could not be saved. Keep the PR URL.'); }
            return { history, warnings };
        } finally { PullRequestService.inFlight.delete(key); }
    }
}
