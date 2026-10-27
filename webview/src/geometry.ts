import { BranchNode } from '../../src/branchFlow/domain/model';
export function nextBranchPosition(nodes: BranchNode[], center: { x: number; y: number }): { x: number; y: number } {
    // A small spiral keeps new nodes apart without moving existing branch positions.
    for (let ring = 0; ring < 40; ring++) {
        for (let y = -ring; y <= ring; y++) { for (let x = -ring; x <= ring; x++) {
            if (Math.max(Math.abs(x), Math.abs(y)) !== ring) { continue; }
            const position = { x: Math.round((center.x - 125 + x * 300) / 20) * 20, y: Math.round((center.y - 60 + y * 160) / 20) * 20 };
            if (Math.abs(position.x) > 1e6 || Math.abs(position.y) > 1e6) { continue; }
            if (nodes.every(n => Math.abs(n.position.x - position.x) >= 270 || Math.abs(n.position.y - position.y) >= 140)) { return position; }
        } }
    }
    return { x: 0, y: 0 };
}
