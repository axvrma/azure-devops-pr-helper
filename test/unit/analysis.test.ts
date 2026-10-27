import { expect, it, vi } from 'vitest';
import { AnalysisRemote, GraphValidationService, ValidationCoordinator } from '../../src/branchFlow/application/analysis';
import { analyzeEvidence } from '../../src/branchFlow/domain/status';
import { A, B, C, graph } from './fixtures';
const refs = [{ name: 'release/2.1', sha: A }, { name: 'release/2.2', sha: B }, { name: 'release/2.3', sha: C }];
function remote(): AnalysisRemote {
    return { refs: vi.fn().mockResolvedValue(refs), activePrs: vi.fn().mockResolvedValue(new Map()), compare: vi.fn().mockResolvedValue({ ancestor: false, outstandingCommits: 2 }) };
}
it('fetches refs twice, active PRs once, emits progressive results in dependency order and caches immutable comparisons', async () => {
    const api = remote(); const service = new GraphValidationService(api); const progress = vi.fn();
    const result = await service.validate(graph(), new AbortController().signal, progress);
    expect(api.refs).toHaveBeenCalledTimes(2); expect(api.activePrs).toHaveBeenCalledTimes(1);
    expect(result.edges.map(e => e.analysis?.status)).toEqual(['ACTION_REQUIRED', 'ACTION_REQUIRED']);
    expect(progress.mock.calls.filter(([p]) => p.edge?.status === 'ACTION_REQUIRED').map(([p]) => p.edge.edgeId)).toEqual(['ab', 'bc']);
    expect(result.edges[1].analysis?.warnings.join(' ')).toContain('Upstream');
    await service.validate(result, new AbortController().signal, () => undefined);
    expect(api.compare).toHaveBeenCalledTimes(2); expect(api.activePrs).toHaveBeenCalledTimes(2);
});
it('marks actual and transitive drift when remote heads race validation', async () => {
    const api = remote(); api.refs = vi.fn().mockResolvedValueOnce(refs).mockResolvedValueOnce([{ ...refs[0], sha: B }, ...refs.slice(1)]);
    api.compare = vi.fn().mockResolvedValue({ ancestor: true });
    const result = await new GraphValidationService(api).validate(graph(), new AbortController().signal, () => undefined);
    expect(result.edges.every(e => e.analysis?.status === 'DRIFTED' && !e.analysis.verified)).toBe(true);
    expect(result.snapshot.validatedAt).toBeNull(); expect(result.snapshot.branchHeads['release/2.2']).toBe(B);
});
it('clears cached green when either ref disappears', async () => {
    const value = graph(); value.edges[0].analysis = analyzeEvidence(value.edges[0], { sourceSha: A, targetSha: B, ancestor: true });
    value.snapshot.branchHeads = Object.fromEntries(refs.map(r => [r.name, r.sha]));
    const api = remote(); api.refs = vi.fn().mockResolvedValue(refs.slice(1));
    const result = await new GraphValidationService(api).validate(value, new AbortController().signal, () => undefined);
    expect(result.edges[0].analysis?.status).toBe('UNKNOWN');
});
it('does not misreport a compare or PR failure as a Git conflict', async () => {
    const api = remote(); api.compare = vi.fn().mockRejectedValue(new Error('Offline')); api.activePrs = vi.fn().mockRejectedValue(new Error('Forbidden'));
    const result = await new GraphValidationService(api).validate(graph(), new AbortController().signal, () => undefined);
    expect(result.edges.every(e => e.analysis?.status === 'ERROR')).toBe(true);
});
it('cancels an obsolete run and discards late progress and responses even when a transport ignores cancellation', async () => {
    const api = remote(); let resolve!: (value: typeof refs) => void;
    api.refs = vi.fn().mockImplementationOnce(() => new Promise(r => { resolve = r; })).mockResolvedValue(refs);
    const coordinator = new ValidationCoordinator(); const firstProgress = vi.fn();
    const service = new GraphValidationService(api);
    const first = coordinator.run(service, graph(), firstProgress);
    const second = await coordinator.run(service, graph(), () => undefined);
    resolve(refs);
    expect(await first).toBeUndefined(); expect(firstProgress).not.toHaveBeenCalled(); expect(second).toBeDefined();
});
it('returns UNKNOWN for rebase without exact local simulation and preserves actual simulated conflicts', async () => {
    const value = graph(); value.edges[0].operation = 'rebase';
    const api = remote();
    const result = await new GraphValidationService(api).validate(value, new AbortController().signal, () => undefined);
    expect(result.edges[0].analysis?.status).toBe('UNKNOWN');
    const simulated = await new GraphValidationService(api, { simulate: vi.fn().mockResolvedValue({ clean: false, conflictFiles: ['file.txt'], failedCommit: A }) }).validate(value, new AbortController().signal, () => undefined);
    expect(simulated.edges[0].analysis?.status).toBe('CONFLICT'); expect(simulated.edges[0].analysis?.failedCommit).toBe(A);
});
