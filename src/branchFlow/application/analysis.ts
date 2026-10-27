import { BranchGraph, BranchRef, EdgeAnalysis, PullRequestSummary } from '../domain/model';
import { affectedEdges, orderedEdges } from '../domain/graph';
import { analyzeEvidence, AnalysisEvidence } from '../domain/status';
import { checkCancelled, createAbortController, OperationCancelled } from '../infrastructure/async';

export interface AnalysisRemote {
    refs(signal?: AbortSignal): Promise<BranchRef[]>;
    activePrs(signal?: AbortSignal): Promise<Map<string, PullRequestSummary>>;
    compare(source: string, target: string, signal?: AbortSignal): Promise<{ ancestor?: boolean; outstandingCommits?: number }>;
}
export interface AnalysisGit {
    simulate(source: string, target: string, operation: 'merge-pr' | 'rebase', signal?: AbortSignal): Promise<{ clean: boolean; conflictFiles: string[]; failedCommit?: string }>;
}
export interface ValidationProgress { completed: number; total: number; edge?: EdgeAnalysis; refs?: BranchRef[] }

export class GraphValidationService {
    // Comparisons describe immutable commit pairs; PR state is fetched once per validation, never cached across refreshes.
    private comparisons = new Map<string, { ancestor?: boolean; outstandingCommits?: number }>();
    constructor(private readonly remote: AnalysisRemote, private readonly git?: AnalysisGit) {}
    async validate(input: BranchGraph, signal: AbortSignal, progress: (update: ValidationProgress) => void): Promise<BranchGraph> {
        const graph: BranchGraph = { ...input, nodes: input.nodes.map(n => ({ ...n })), edges: input.edges.map(e => ({ ...e })), snapshot: { ...input.snapshot } };
        const refs = await this.remote.refs(signal); checkCancelled(signal);
        const heads = new Map(refs.map(r => [r.name, r.sha]));
        const nodes = new Map(graph.nodes.map(n => [n.id, n]));
        const changed = graph.nodes.filter(n => graph.snapshot.branchHeads[n.branch] !== heads.get(n.branch)).map(n => n.id);
        const affected = affectedEdges(graph, changed);
        progress({ completed: 0, total: graph.edges.length, refs });
        for (const edge of graph.edges) {
            if (affected.has(edge.id) && edge.analysis) {
                edge.analysis = { ...edge.analysis, status: 'DRIFTED', verified: false, reasons: ['Branch state or an upstream dependency changed. Validation is stale.'] };
                progress({ completed: 0, total: graph.edges.length, edge: edge.analysis });
            }
        }
        let prs = new Map<string, PullRequestSummary>(); let prWarning: string | undefined;
        try { prs = await this.remote.activePrs(signal); }
        catch (error) { checkCancelled(signal); prWarning = error instanceof Error ? error.message : 'Active PR lookup failed.'; }
        let completed = 0;
        const usedKeys = new Set<string>();
        for (const edge of orderedEdges(graph)) {
            checkCancelled(signal);
            const source = nodes.get(edge.source)!.branch; const target = nodes.get(edge.target)!.branch;
            const sourceSha = heads.get(source) ?? null; const targetSha = heads.get(target) ?? null;
            const evidence: AnalysisEvidence = { sourceSha, targetSha, warnings: prWarning ? ['Active PR lookup unavailable: ' + prWarning] : [] };
            progress({ completed, total: graph.edges.length, edge: { ...analyzeEvidence(edge, evidence), status: 'ANALYZING', reasons: ['Validating exact branch heads…'] } });
            if (sourceSha && targetSha && edge.operation !== 'cherry-pick') {
                const key = `${sourceSha}:${targetSha}`; usedKeys.add(key);
                evidence.pr = prs.get(JSON.stringify([source, target]));
                try {
                    if (sourceSha === targetSha) { evidence.ancestor = true; evidence.outstandingCommits = 0; }
                    else {
                        let comparison = this.comparisons.get(key);
                        if (!comparison) { comparison = await this.remote.compare(sourceSha, targetSha, signal); this.comparisons.set(key, comparison); }
                        Object.assign(evidence, comparison);
                    }
                } catch (error) {
                    checkCancelled(signal);
                    evidence.warnings!.push(error instanceof Error ? error.message : 'Commit comparison unavailable.');
                    evidence.error = 'Current commit comparison failed. Retry validation; no Git conflict is implied.';
                }
                if (evidence.ancestor !== true && this.git) {
                    try { evidence.simulation = await this.git.simulate(sourceSha, targetSha, edge.operation, signal); }
                    catch (error) {
                        checkCancelled(signal);
                        evidence.unavailable = error instanceof Error ? error.message : 'Local simulation unavailable.';
                        evidence.warnings!.push(evidence.unavailable);
                    }
                } else if (evidence.ancestor !== true) {
                    evidence.unavailable = 'A trusted local clone with the exact Azure commits is required for simulation. Open the matching repository or fetch manually.';
                }
            }
            edge.analysis = analyzeEvidence(edge, evidence);
            const upstream = graph.edges.filter(e => e.target === edge.source && e.analysis?.status !== 'SYNCED');
            if (upstream.length) { edge.analysis.warnings.push('Upstream integration is pending. Revalidate this relationship after upstream completion, even if its current heads are integrated.'); }
            progress({ completed: ++completed, total: graph.edges.length, edge: edge.analysis });
        }
        const latest = await this.remote.refs(signal); checkCancelled(signal);
        const finalHeads = new Map(latest.map(r => [r.name, r.sha]));
        const raced = graph.nodes.filter(n => heads.get(n.branch) !== finalHeads.get(n.branch)).map(n => n.id);
        const racedEdges = affectedEdges(graph, raced);
        for (const edge of graph.edges) {
            if (racedEdges.has(edge.id) && edge.analysis) {
                edge.analysis = { ...edge.analysis, status: 'DRIFTED', verified: false, reasons: ['Remote heads changed during analysis. Refresh to validate the new state.'] };
                progress({ completed, total: graph.edges.length, edge: edge.analysis });
            }
        }
        for (const key of this.comparisons.keys()) { if (!usedKeys.has(key)) { this.comparisons.delete(key); } }
        graph.snapshot = { validatedAt: raced.length ? null : new Date().toISOString(),
            branchHeads: Object.fromEntries(graph.nodes.filter(n => heads.has(n.branch)).map(n => [n.branch, heads.get(n.branch)!])) };
        return graph;
    }
}

/** Cancels obsolete runs and prevents late results/progress from replacing a newer generation. */
export class ValidationCoordinator {
    private generation = 0;
    private abort?: AbortController;
    cancel(): void { this.generation++; this.abort?.abort(); this.abort = undefined; }
    async run(service: GraphValidationService, graph: BranchGraph, progress: (update: ValidationProgress) => void): Promise<BranchGraph | undefined> {
        this.cancel(); const generation = this.generation; const abort = createAbortController(); this.abort = abort;
        try {
            const result = await service.validate(graph, abort.signal, update => { if (generation === this.generation) { progress(update); } });
            return generation === this.generation ? result : undefined;
        } catch (error) {
            if (generation !== this.generation || abort.signal.aborted || error instanceof OperationCancelled) { return undefined; }
            throw error;
        } finally { if (generation === this.generation) { this.abort = undefined; } }
    }
}
