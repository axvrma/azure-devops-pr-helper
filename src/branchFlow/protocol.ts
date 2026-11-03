import { z } from 'zod';
import { BranchGraph, BranchRef, EdgeAnalysis, graphSchema, LIMITS } from './domain/model';
const edgeId = z.string().min(1).max(128);
export const hostMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ready') }).strict(),
    z.object({ type: z.literal('edit'), graph: graphSchema }).strict(),
    z.object({ type: z.literal('action'), action: z.enum(['new', 'save', 'saveAs', 'open', 'import', 'export', 'refresh', 'analyze', 'cancel', 'context', 'settings', 'recent', 'reloadExternal', 'keepLocal']) }).strict(),
    z.object({ type: z.literal('edgeAction'), action: z.enum(['analyze', 'createPr', 'openPr', 'details']), edgeId }).strict(),
]);
export type HostMessage = z.infer<typeof hostMessageSchema>;
export type ViewMessage =
    | { type: 'meta'; dirty: boolean; external: boolean }
    | { type: 'state'; graph: BranchGraph; revision: number; dirty: boolean; file?: string; currentBranch?: string; recent: string[]; external: boolean }
    | { type: 'refs'; refs: BranchRef[] }
    | { type: 'progress'; completed: number; total: number; edge?: EdgeAnalysis }
    | { type: 'busy'; value: boolean; label: string }
    | { type: 'error'; message: string; operation?: string }
    | { type: 'notice'; message: string }
    | { type: 'prDetails'; edgeId: string; policyStatuses: string[]; changedFiles: string[] };
export function parseHostMessage(value: unknown): HostMessage {
    if (JSON.stringify(value)?.length > LIMITS.bytes * 2) { throw new Error('Webview message exceeds the size limit.'); }
    const result = hostMessageSchema.safeParse(value);
    if (!result.success) { throw new Error('Invalid Branch Flow action. Reload the editor and try again.'); }
    return result.data;
}
