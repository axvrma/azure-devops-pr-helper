import { BranchEdge, BranchGraph, graphSchema, LIMITS } from './model';

export function topologicalOrder(graph: Pick<BranchGraph, 'nodes' | 'edges'>): string[] {
    const degree = new Map(graph.nodes.map(n => [n.id, 0]));
    const next = new Map(graph.nodes.map(n => [n.id, [] as string[]]));
    for (const edge of graph.edges) {
        if (!degree.has(edge.source) || !degree.has(edge.target)) { throw new Error('A connection refers to a missing branch.'); }
        degree.set(edge.target, degree.get(edge.target)! + 1);
        next.get(edge.source)!.push(edge.target);
    }
    const ready = [...degree.keys()].filter(id => degree.get(id) === 0).sort();
    const order: string[] = [];
    while (ready.length) {
        const id = ready.shift()!; order.push(id);
        for (const target of next.get(id)!.sort()) {
            degree.set(target, degree.get(target)! - 1);
            if (degree.get(target) === 0) { ready.push(target); ready.sort(); }
        }
    }
    if (order.length !== graph.nodes.length) { throw new Error('Connections must form a directed acyclic graph; cycles are unsupported.'); }
    return order;
}

export function validateGraph(value: unknown): BranchGraph {
    const parsed = graphSchema.safeParse(value);
    if (!parsed.success) {
        throw new Error('Invalid Branch Flow graph: check schemaVersion 1, required fields, refs, positions and size limits.');
    }
    const graph = parsed.data;
    if (!graph.repository && graph.nodes.length) { throw new Error('Choose one repository before adding branches.'); }
    if (new Set(graph.nodes.map(n => n.id)).size !== graph.nodes.length ||
        new Set(graph.nodes.map(n => n.branch)).size !== graph.nodes.length) { throw new Error('Duplicate branch or node ID.'); }
    if (new Set(graph.edges.map(e => e.id)).size !== graph.edges.length) { throw new Error('Duplicate connection ID.'); }
    const pairs = new Set<string>();
    for (const e of graph.edges) {
        const pair = JSON.stringify([e.source, e.target]);
        if (e.source === e.target || pairs.has(pair)) { throw new Error('Self connections and duplicate branch pairs are unsupported.'); }
        if (e.analysis && (e.analysis.edgeId !== e.id || e.analysis.operation !== e.operation)) { throw new Error('Validation evidence does not match its connection.'); }
        pairs.add(pair);
    }
    topologicalOrder(graph);
    return graph;
}

// Future versions register a migration here; unknown versions are never guessed.
export function migrateGraph(value: unknown): BranchGraph { return validateGraph(value); }

export function parseGraph(text: string): BranchGraph {
    if (new TextEncoder().encode(text).byteLength > LIMITS.bytes) { throw new Error('Graph exceeds the 5 MiB import limit.'); }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error('This file is not valid JSON.'); }
    if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1) {
        throw new Error('Unsupported Branch Flow schema version. This extension reads version 1.');
    }
    return migrateGraph(value);
}

export function serializeGraph(value: BranchGraph): string {
    const graph = validateGraph(value);
    const stable = { ...graph,
        nodes: [...graph.nodes].sort((a, b) => a.id.localeCompare(b.id)),
        edges: [...graph.edges].map(e => ({ ...e, analysis: e.analysis?.status === 'ANALYZING' ? undefined : e.analysis })).sort((a, b) => a.id.localeCompare(b.id)),
        snapshot: { ...graph.snapshot, branchHeads: Object.fromEntries(Object.entries(graph.snapshot.branchHeads).sort(([a], [b]) => a.localeCompare(b))) },
    };
    const text = JSON.stringify(stable, null, 2) + '\n';
    if (new TextEncoder().encode(text).byteLength > LIMITS.bytes) { throw new Error('Graph exceeds the 5 MiB save limit.'); }
    return text;
}

export function orderedEdges(graph: BranchGraph): BranchEdge[] {
    const order = new Map(topologicalOrder(graph).map((id, index) => [id, index]));
    return [...graph.edges].sort((a, b) => order.get(a.source)! - order.get(b.source)! || a.id.localeCompare(b.id));
}

export function affectedEdges(graph: BranchGraph, changedNodes: Iterable<string>): Set<string> {
    const affected = new Set<string>(); const queue = [...changedNodes]; const visited = new Set(queue);
    const outgoing = new Map(graph.nodes.map(n => [n.id, [] as BranchEdge[]]));
    for (const e of graph.edges) {
        outgoing.get(e.source)!.push(e);
        if (visited.has(e.target)) { affected.add(e.id); }
    }
    for (let i = 0; i < queue.length; i++) {
        for (const e of outgoing.get(queue[i]) ?? []) {
            affected.add(e.id);
            if (!visited.has(e.target)) { visited.add(e.target); queue.push(e.target); }
        }
    }
    return affected;
}

export function layoutGraph(graph: BranchGraph): BranchGraph {
    const levels = new Map<string, number>(); const rows = new Map<number, number>();
    const incoming = new Map(graph.nodes.map(n => [n.id, [] as string[]]));
    for (const e of graph.edges) { incoming.get(e.target)!.push(e.source); }
    for (const id of topologicalOrder(graph)) {
        levels.set(id, Math.max(0, ...incoming.get(id)!.map(p => levels.get(p)! + 1)));
    }
    return { ...graph, nodes: graph.nodes.map(n => {
        const level = levels.get(n.id)!; const row = rows.get(level) ?? 0; rows.set(level, row + 1);
        return { ...n, position: { x: 50 + level * 320, y: 60 + row * 150 } };
    }) };
}

export function executionPlan(graph: BranchGraph): { edgeId: string; text: string }[] {
    const names = new Map(graph.nodes.map(n => [n.id, n.branch]));
    const pending = new Set<string>(); const steps: { edgeId: string; text: string }[] = [];
    for (const edge of orderedEdges(graph)) {
        const dependencyPending = pending.has(edge.source);
        const integrated = edge.analysis?.status === 'SYNCED';
        if (!integrated || dependencyPending) {
            pending.add(edge.target);
            const source = names.get(edge.source); const target = names.get(edge.target);
            const text = integrated
                ? `After upstream integration, refresh and revalidate ${source} → ${target}; integrate only if required.`
                : `${edge.operation === 'rebase' ? `Review replay of ${target}-only commits onto ${source}` : edge.operation === 'cherry-pick' ? `Review selected commits from ${source} into ${target}` : `Integrate ${source} → ${target}`}; confirm completion, refresh heads, then revalidate downstream dependencies.`;
            steps.push({ edgeId: edge.id, text });
        }
    }
    return steps;
}
