import { BranchGraph, LIMITS } from '../../src/branchFlow/domain/model';
export interface History { past: BranchGraph[]; present: BranchGraph; future: BranchGraph[] }
export function remember(history: History, next: BranchGraph): History {
    return { past: [...history.past, history.present].slice(-LIMITS.history), present: next, future: [] };
}
function withoutEvidence(graph: BranchGraph): BranchGraph {
    return { ...graph, edges: graph.edges.map(e => ({ ...e, analysis: undefined })), snapshot: { validatedAt: null, branchHeads: {} } };
}
export function undo(history: History): History {
    if (!history.past.length) { return history; }
    return { past: history.past.slice(0, -1), present: withoutEvidence(history.past[history.past.length - 1]), future: [history.present, ...history.future].slice(0, LIMITS.history) };
}
export function redo(history: History): History {
    if (!history.future.length) { return history; }
    return { past: [...history.past, history.present].slice(-LIMITS.history), present: withoutEvidence(history.future[0]), future: history.future.slice(1) };
}
