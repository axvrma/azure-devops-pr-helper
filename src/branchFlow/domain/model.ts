/* eslint-disable no-control-regex -- Trust-boundary input validation explicitly rejects control characters. */
import { z } from 'zod';

// Runtime validators must work under the Webview CSP without probing eval/new Function.
z.config({ jitless: true });

export const LIMITS = { bytes: 5 * 1024 * 1024, nodes: 1000, edges: 4000, history: 50 } as const;
export const operations = ['merge-pr', 'rebase', 'cherry-pick'] as const;
export const statuses = ['SYNCED', 'ACTION_REQUIRED', 'CONFLICT', 'PR_ACTIVE', 'DRIFTED', 'ANALYZING', 'UNKNOWN', 'ERROR'] as const;
export type IntegrationOperation = typeof operations[number];
export type EdgeStatus = typeof statuses[number];

// Equivalent to check-ref-format for fully qualified branch refs, without invoking Git.
export function validBranch(name: string): boolean {
    return name.length > 0 && name.length <= 1024 && name !== '@' && !name.startsWith('-') &&
        !name.includes('..') && !name.includes('@{') && !/[\x00-\x20\x7f~^:?*[\\]/.test(name) &&
        !name.endsWith('.') && name.split('/').every(p => !!p && !p.startsWith('.') && !p.endsWith('.lock'));
}

export function safeOrganizationUrl(value: string): string {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        /[\x00-\x20\\]/.test(value) || !url.hostname) {
        throw new Error('Use an HTTPS organization URL without credentials, query or fragment.');
    }
    return url.toString().replace(/\/+$/, '');
}

export const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const id = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/);
const label = z.string().min(1).max(1024);
export const branchSchema = label.refine(validBranch, 'Invalid Git branch name');
export const repositorySchema = z.object({
    organizationUrl: z.string().max(2048).refine(v => { try { return safeOrganizationUrl(v) === v; } catch { return false; } }, 'Invalid organization URL'),
    project: z.string().min(1).max(256).refine(v => !/[\x00-\x1f]/.test(v)),
    repositoryId: z.string().min(1).max(256),
    repositoryName: z.string().max(256).optional(),
    projectId: z.string().max(128).optional(),
}).strict();
export type RepositoryContext = z.infer<typeof repositorySchema>;
export const prSummarySchema = z.object({
    id: z.number().int().positive(), title: z.string().max(4096),
    status: z.enum(['active', 'completed', 'abandoned']),
    mergeStatus: z.string().max(128).optional(),
    sourceSha: shaSchema.optional(), targetSha: shaSchema.optional(),
    policyStatuses: z.array(z.string().max(128)).max(1000).optional(),
}).strict();
export type PullRequestSummary = z.infer<typeof prSummarySchema>;
export const analysisSchema = z.object({
    edgeId: id, operation: z.enum(operations), sourceSha: shaSchema.nullable(), targetSha: shaSchema.nullable(),
    status: z.enum(statuses), verified: z.boolean(), validationMethod: z.string().max(128),
    existingPr: prSummarySchema.optional(), outstandingCommits: z.number().int().nonnegative().optional(),
    conflictFiles: z.array(z.string().max(4096)).max(10000).optional(), failedCommit: shaSchema.optional(),
    checkedAt: z.iso.datetime(), reasons: z.array(z.string().max(4096)).max(30), warnings: z.array(z.string().max(4096)).max(30),
}).strict();
export type EdgeAnalysis = z.infer<typeof analysisSchema>;
export const nodeSchema = z.object({
    id, branch: branchSchema,
    position: z.object({ x: z.number().finite().min(-1e6).max(1e6), y: z.number().finite().min(-1e6).max(1e6) }).strict(),
}).strict();
export const edgeSchema = z.object({ id, source: id, target: id, operation: z.enum(operations), analysis: analysisSchema.optional() }).strict();
export type BranchNode = z.infer<typeof nodeSchema>;
export type BranchEdge = z.infer<typeof edgeSchema>;
export const graphSchema = z.object({
    schemaVersion: z.literal(1), graphId: id, name: z.string().min(1).max(200), repository: repositorySchema.nullable(),
    nodes: z.array(nodeSchema).max(LIMITS.nodes), edges: z.array(edgeSchema).max(LIMITS.edges),
    snapshot: z.object({ validatedAt: z.iso.datetime().nullable(), branchHeads: z.record(branchSchema, shaSchema) }).strict(),
    ui: z.object({ viewport: z.object({ x: z.number().finite().min(-1e6).max(1e6), y: z.number().finite().min(-1e6).max(1e6), zoom: z.number().min(0.1).max(4) }).strict(), snapToGrid: z.boolean().default(true) }).strict(),
}).strict();
export type BranchGraph = z.infer<typeof graphSchema>;
export interface BranchRef { name: string; sha: string }

export function emptyGraph(graphId: string): BranchGraph {
    return { schemaVersion: 1, graphId, name: 'Untitled Branch Flow', repository: null, nodes: [], edges: [],
        snapshot: { validatedAt: null, branchHeads: {} }, ui: { viewport: { x: 0, y: 0, zoom: 1 }, snapToGrid: true } };
}

export function operationLabel(operation: IntegrationOperation, source: string, target: string): string {
    if (operation === 'rebase') { return `Replay ${target}-only commits onto ${source} (temporary repository)`; }
    if (operation === 'cherry-pick') { return `Cherry-pick from ${source} into ${target} (unverified in V1)`; }
    return `Merge ${source} into ${target} through a pull request`;
}
