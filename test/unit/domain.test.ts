import { describe, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { affectedEdges, executionPlan, layoutGraph, parseGraph, serializeGraph, topologicalOrder, validateGraph } from '../../src/branchFlow/domain/graph';
import { emptyGraph, safeOrganizationUrl, validBranch } from '../../src/branchFlow/domain/model';
import { analyzeEvidence } from '../../src/branchFlow/domain/status';
import { parseHostMessage } from '../../src/branchFlow/protocol';
import { A, B, graph, repository } from './fixtures';

it.each(['release/2.1.0', "feature/O'Hare", 'feature/日本語', 'fix/#42', 'team/$name', 'feature/a(b)'])('allows valid branch %s', name => expect(validBranch(name)).toBe(true));
it.each(['', '-option', 'a..b', 'a//b', 'a/.hidden', 'a.lock/b', 'branch.', 'a@{b', 'a b', 'a\nb', 'a\\b', 'a\u007f', '@', 'branch/'])('rejects invalid ref %s', name => expect(validBranch(name)).toBe(false));
it.each(['http://example.test', 'https://u:p@example.test', 'https://host/path?token=x', 'javascript:alert(1)', 'https://host/#x'])('rejects unsafe credential destination %s', value => expect(() => safeOrganizationUrl(value)).toThrow());

describe('DAG integrity', () => {
    it('rejects self loops, duplicate nodes, branch pairs, orphan and cyclic edges', () => {
        const values = [
            { ...graph(), nodes: [...graph().nodes, graph().nodes[0]] },
            { ...graph(), edges: [{ id: 'bad', source: 'a', target: 'a', operation: 'merge-pr' }] },
            { ...graph(), edges: [...graph().edges, { id: 'dup', source: 'a', target: 'b', operation: 'rebase' }] },
            { ...graph(), edges: [...graph().edges, { id: 'bad', source: 'missing', target: 'a', operation: 'merge-pr' }] },
            { ...graph(), edges: [...graph().edges, { id: 'ca', source: 'c', target: 'a', operation: 'merge-pr' }] },
        ];
        values.forEach(value => expect(() => validateGraph(value)).toThrow());
    });
    it('handles converging, branching and disconnected components deterministically', () => {
        const value = graph();
        value.nodes.push({ id: 'd', branch: 'release/fork', position: { x: 1, y: 1 } }, { id: 'z', branch: 'disconnected', position: { x: 2, y: 2 } });
        value.edges.push({ id: 'ad', source: 'a', target: 'd', operation: 'rebase' }, { id: 'dc', source: 'd', target: 'c', operation: 'merge-pr' });
        expect(topologicalOrder(value)).toEqual(['a', 'b', 'd', 'c', 'z']);
        expect([...affectedEdges(value, ['a'])].sort()).toEqual(['ab', 'ad', 'bc', 'dc']);
        expect([...affectedEdges(value, ['b'])].sort()).toEqual(['ab', 'bc']);
        expect(affectedEdges(value, ['z']).size).toBe(0);
        const positioned = layoutGraph(value);
        expect(positioned.nodes.find(n => n.id === 'c')!.position.x).toBeGreaterThan(positioned.nodes.find(n => n.id === 'd')!.position.x);
        expect(new Set(positioned.nodes.map(n => JSON.stringify(n.position))).size).toBe(value.nodes.length);
        expect(executionPlan(value).map(p => p.edgeId)).toEqual(['ab', 'ad', 'bc', 'dc']);
    });
    it('marks direct and transitive validations stale without claiming downstream heads changed', () => {
        const value = graph(); const before = JSON.stringify(value.snapshot);
        expect([...affectedEdges(value, ['a'])]).toEqual(['ab', 'bc']);
        expect(JSON.stringify(value.snapshot)).toBe(before);
    });
});

describe('schema trust boundary', () => {
    it('roundtrips deterministic JSON with stable IDs and positions', () => {
        const value = graph(); const serialized = serializeGraph(value);
        expect(serializeGraph(parseGraph(serialized))).toBe(serialized);
        expect(parseGraph(serialized).nodes).toEqual(value.nodes);
    });
    it('rejects unsupported versions, arbitrary properties, credentials and oversized imports', () => {
        expect(() => parseGraph('{')).toThrow('valid JSON');
        expect(() => parseGraph(JSON.stringify({ ...graph(), schemaVersion: 99 }))).toThrow('version');
        expect(() => parseGraph(JSON.stringify({ ...graph(), token: 'secret' }))).toThrow('Invalid');
        expect(() => parseGraph(' '.repeat(5 * 1024 * 1024 + 1))).toThrow('limit');
        expect(() => validateGraph({ ...graph(), repository: { ...repository, organizationUrl: 'https://user:token@dev.azure.com/example' } })).toThrow();
        expect(() => validateGraph({ ...graph(), nodes: graph().nodes.map(n => ({ ...n, repositoryId: 'other' })) })).toThrow();
        expect(() => validateGraph({ ...emptyGraph('x'), nodes: graph().nodes })).toThrow();
    });
    it('accepts only typed messages, rejects arbitrary commands, code and malformed edits', () => {
        expect(parseHostMessage({ type: 'action', action: 'refresh' }).type).toBe('action');
        for (const value of [null, { command: 'exec' }, { type: 'edgeAction', action: 'merge', edgeId: 'a' }, { type: 'edit', graph: { schemaVersion: 1 } }, { type: 'action', action: 'save', file: '/etc/passwd' }]) {
            expect(() => parseHostMessage(value)).toThrow();
        }
    });
});

describe('evidence engine', () => {
    const edge = graph().edges[0];
    const evidence = { sourceSha: A, targetSha: B };
    it('requires positive ancestry evidence for green', () => {
        expect(analyzeEvidence(edge, evidence).status).toBe('UNKNOWN');
        const result = analyzeEvidence(edge, { ...evidence, ancestor: true });
        expect(result.status).toBe('SYNCED'); expect(result.verified).toBe(true);
    });
    it('does not equate an action, completed PR or empty conflict list with synchronization', () => {
        expect(analyzeEvidence(edge, { ...evidence, ancestor: false }).warnings).toContain('Merge conflicts have not been checked.');
        expect(analyzeEvidence(edge, { ...evidence, pr: { id: 1, title: 'done', status: 'completed' }, simulation: { clean: true, conflictFiles: [] } }).status).toBe('UNKNOWN');
    });
    it('uses active PR conflicts only at both exact heads', () => {
        const pr = { id: 1, title: 'p', status: 'active' as const, mergeStatus: 'conflicts', sourceSha: A, targetSha: B };
        expect(analyzeEvidence(edge, { ...evidence, ancestor: false, pr }).status).toBe('CONFLICT');
        expect(analyzeEvidence(edge, { ...evidence, ancestor: false, pr: { ...pr, targetSha: A } }).status).toBe('PR_ACTIVE');
    });
    it('does not use merge predictions to validate a rebase or mark an unsimulated rebase clean', () => {
        const rebase = { ...edge, operation: 'rebase' as const };
        const pr = { id: 1, title: 'p', status: 'active' as const, mergeStatus: 'succeeded', sourceSha: A, targetSha: B };
        expect(analyzeEvidence(rebase, { ...evidence, ancestor: false, pr }).status).toBe('UNKNOWN');
        expect(analyzeEvidence(rebase, { ...evidence, ancestor: false, simulation: { clean: true, conflictFiles: [] } }).status).toBe('ACTION_REQUIRED');
        expect(analyzeEvidence(rebase, { ...evidence, ancestor: false, simulation: { clean: false, conflictFiles: ['a'] } }).status).toBe('CONFLICT');
    });
    it('keeps cherry-pick unverified even with equal heads or patch-equivalence assumptions', () => {
        const result = analyzeEvidence({ ...edge, operation: 'cherry-pick' }, { ...evidence, ancestor: true });
        expect(result.status).toBe('UNKNOWN'); expect(result.verified).toBe(false);
    });
    it('distinguishes deleted refs and failures from conflicts', () => {
        expect(analyzeEvidence(edge, { sourceSha: null, targetSha: B }).status).toBe('UNKNOWN');
        expect(analyzeEvidence(edge, { ...evidence, error: 'API failed' }).status).toBe('ERROR');
    });
});

it('validates, traverses and lays out a 1000-node / 3990-edge DAG within the 300ms domain budget', () => {
    const value = emptyGraph('large'); value.repository = repository;
    value.nodes = Array.from({ length: 1000 }, (_, i) => ({ id: `n${i}`, branch: `release/${i}`, position: { x: 0, y: 0 } }));
    for (let i = 0; i < 1000; i++) { for (let j = 1; j <= 4 && i + j < 1000; j++) { value.edges.push({ id: `e${i}-${j}`, source: `n${i}`, target: `n${i + j}`, operation: 'merge-pr' }); } }
    const start = performance.now();
    validateGraph(value); layoutGraph(value); affectedEdges(value, ['n0']); serializeGraph(value);
    const elapsed = performance.now() - start;
    console.info(`1000-node DAG domain operations: ${elapsed.toFixed(1)} ms`);
    expect(elapsed).toBeLessThan(300);
});

it('includes currently synced downstream edges in the plan when upstream integration is pending', () => {
    const value = graph();
    value.edges[0].analysis = analyzeEvidence(value.edges[0], { sourceSha: A, targetSha: B, ancestor: false });
    value.edges[1].analysis = analyzeEvidence(value.edges[1], { sourceSha: A, targetSha: B, ancestor: true });
    expect(executionPlan(value)).toHaveLength(2); expect(executionPlan(value)[1].text).toContain('After upstream integration');
});

it('does not persist transient ANALYZING state', () => {
    const value = graph(); value.edges[0].analysis = { ...analyzeEvidence(value.edges[0], { sourceSha: A, targetSha: B }), status: 'ANALYZING' };
    expect(parseGraph(serializeGraph(value)).edges[0].analysis).toBeUndefined();
});
