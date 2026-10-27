import { describe, expect, it } from 'vitest';
import { collinearOverlap, routeGraph, type Point, type Routing } from '../../webview/src/routing';
import type { BranchEdge, BranchNode } from '../../src/branchFlow/domain/model';

const node = (id: string, x: number, y: number): BranchNode => ({ id, branch: `release/${id}`, position: { x, y } });
const edge = (id: string, source: string, target: string): BranchEdge => ({ id, source, target, operation: 'merge-pr' });
function assertSeparateRoutes(routing: Routing): void {
    const segments: { edge: string; from: Point; to: Point }[] = [];
    for (const [id, route] of routing.edges) {
        expect(route.path).not.toMatch(/NaN|Infinity|undefined/);
        for (let i = 1; i < route.points.length; i++) {
            const from = route.points[i - 1]; const to = route.points[i];
            expect(from.x === to.x || from.y === to.y).toBe(true);
            for (const prior of segments) { if (prior.edge !== id) { expect(collinearOverlap([from, to], [prior.from, prior.to]), `overlap: ${prior.edge} / ${id}`).toBe(false); } }
            segments.push({ edge: id, from, to });
        }
    }
}
describe('shared graph router', () => {
    it('distinguishes allowed crossings and endpoint touches from overlapping runs', () => {
        expect(collinearOverlap([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 50, y: -20 }, { x: 50, y: 20 }])).toBe(false);
        expect(collinearOverlap([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 100, y: 0 }, { x: 150, y: 0 }])).toBe(false);
        expect(collinearOverlap([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 50, y: 0 }, { x: 150, y: 0 }])).toBe(true);
    });
    it('separates fan-out, fan-in, long bypasses, backwards edges and disconnected components', () => {
        const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 400, 200), node('d', 800, 0), node('e', -400, 300), node('f', 1000, 600), node('g', 1400, 600)];
        const edges = [edge('ab', 'a', 'b'), edge('ac', 'a', 'c'), edge('ad', 'a', 'd'), edge('bd', 'b', 'd'), edge('cd', 'c', 'd'), edge('de', 'd', 'e'), edge('fg', 'f', 'g')];
        const result = routeGraph(nodes, edges, new Map());
        expect(result.edges.size).toBe(edges.length); assertSeparateRoutes(result);
        expect(new Set(result.nodes.get('a')!.outputs.map(p => p.y)).size).toBe(3);
        expect(new Set(result.nodes.get('d')!.inputs.map(p => p.y)).size).toBe(3);
        expect([...result.edges.values()].every(e => e.sourceHandle.startsWith('out-') && e.targetHandle.startsWith('in-'))).toBe(true);
    });
    it('remains deterministic through analysis/status updates and input ordering changes', () => {
        const nodes = [node('a', 0, 0), node('b', 400, 0), node('c', 400, 200)]; const edges = [edge('ab', 'a', 'b'), edge('ac', 'a', 'c')];
        const first = routeGraph(nodes, edges, new Map()); const second = routeGraph([...nodes].reverse(), [...edges].reverse(), new Map());
        expect([...first.edges]).toEqual([...second.edges]);
    });
    it('handles old graphs with coincident nodes without looping or laying wires over one another', () => {
        const nodes = Array.from({ length: 24 }, (_, i) => node(`n${i}`, 0, 0));
        const edges = nodes.slice(1).map((n, i) => edge(`e${i}`, nodes[i].id, n.id));
        const result = routeGraph(nodes, edges, new Map()); expect(result.edges.size).toBe(23); assertSeparateRoutes(result);
    });
    it('uses measured node geometry and re-routes after a node moves', () => {
        const nodes = [node('a', 0, 0), node('b', 400, 0)]; const edges = [edge('ab', 'a', 'b')];
        const measurements = new Map([['a', { width: 300, height: 160 }], ['b', { width: 260, height: 140 }]]);
        const first = routeGraph(nodes, edges, measurements);
        expect(first.edges.get('ab')!.points[0].x).toBe(300);
        const moved = routeGraph([nodes[0], node('b', 400, 300)], edges, measurements);
        expect(moved.edges.get('ab')!.path).not.toBe(first.edges.get('ab')!.path); assertSeparateRoutes(moved);
    });
    it('routes a branching 100-node DAG with 197 relationships without shared segments', () => {
        const nodes = Array.from({ length: 100 }, (_, i) => node(`n${i}`, i % 10 * 360, Math.floor(i / 10) * 180));
        const edges = nodes.flatMap((n, i) => [1, 2].filter(offset => i + offset < nodes.length).map(offset => edge(`e${i}-${offset}`, n.id, nodes[i + offset].id)));
        const result = routeGraph(nodes, edges, new Map()); expect(result.edges.size).toBe(197); assertSeparateRoutes(result);
    });
});
