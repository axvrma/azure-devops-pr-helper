import { BranchGraph, emptyGraph } from '../../src/branchFlow/domain/model';
export const A = 'a'.repeat(40); export const B = 'b'.repeat(40); export const C = 'c'.repeat(40);
export const repository = { organizationUrl: 'https://dev.azure.com/example', project: 'Project with space', repositoryId: 'repo-id', repositoryName: 'repo', projectId: 'project-id' };
export function graph(): BranchGraph {
    return { ...emptyGraph('graph-1'), repository, name: 'Release Flow', nodes: [
        { id: 'a', branch: 'release/2.1', position: { x: 0, y: 0 } },
        { id: 'b', branch: 'release/2.2', position: { x: 300, y: 0 } },
        { id: 'c', branch: 'release/2.3', position: { x: 600, y: 0 } },
    ], edges: [{ id: 'ab', source: 'a', target: 'b', operation: 'merge-pr' }, { id: 'bc', source: 'b', target: 'c', operation: 'merge-pr' }] };
}
