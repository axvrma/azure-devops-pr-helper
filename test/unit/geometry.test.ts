import { expect, it } from 'vitest';
import { nextBranchPosition } from '../../webview/src/geometry';
import type { BranchNode } from '../../src/branchFlow/domain/model';
it('adds thirty branches without stacking them or changing existing positions', () => {
    const nodes: BranchNode[] = [];
    for (let i = 0; i < 30; i++) { const position = nextBranchPosition(nodes, { x: 400, y: 400 }); expect(nodes.every(n => Math.abs(n.position.x - position.x) >= 270 || Math.abs(n.position.y - position.y) >= 140)).toBe(true); nodes.push({ id: String(i), branch: `release/${i}`, position }); }
    expect(new Set(nodes.map(n => JSON.stringify(n.position))).size).toBe(30);
});
