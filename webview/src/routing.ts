import type { BranchEdge, BranchNode } from '../../src/branchFlow/domain/model';

export interface Point { x: number; y: number }
export interface NodeSize { width: number; height: number }
export interface Port { id: string; edgeId: string; y: number }
export interface RoutedNode extends BranchNode, NodeSize { inputs: Port[]; outputs: Port[] }
export interface EdgeRoute { points: Point[]; path: string; label: Point; sourceHandle: string; targetHandle: string }
export interface Routing { nodes: Map<string, RoutedNode>; edges: Map<string, EdgeRoute> }
interface Segment { from: Point; to: Point; edgeId: string }
const EPSILON = 0.000001;
const CLEARANCE = 16;
const TRACK = 24;
const key = (n: number): number => Math.round(n * 1000) / 1000;

export function collinearOverlap(a: readonly [Point, Point], b: readonly [Point, Point]): boolean {
    const horizontal = Math.abs(a[0].y - a[1].y) < EPSILON && Math.abs(b[0].y - b[1].y) < EPSILON && Math.abs(a[0].y - b[0].y) < EPSILON;
    const vertical = Math.abs(a[0].x - a[1].x) < EPSILON && Math.abs(b[0].x - b[1].x) < EPSILON && Math.abs(a[0].x - b[0].x) < EPSILON;
    if (!horizontal && !vertical) { return false; }
    const axis = horizontal ? 'x' : 'y';
    return Math.min(Math.max(a[0][axis], a[1][axis]), Math.max(b[0][axis], b[1][axis])) -
        Math.max(Math.min(a[0][axis], a[1][axis]), Math.min(b[0][axis], b[1][axis])) > EPSILON;
}
class Segments {
    private horizontal = new Map<number, Segment[]>();
    private vertical = new Map<number, Segment[]>();
    private bucket(a: Point, b: Point): { index: Map<number, Segment[]>; coordinate: number } {
        return Math.abs(a.y - b.y) < EPSILON ? { index: this.horizontal, coordinate: key(a.y) } : { index: this.vertical, coordinate: key(a.x) };
    }
    overlaps(a: Point, b: Point, except: string): boolean {
        const { index, coordinate } = this.bucket(a, b);
        return (index.get(coordinate) ?? []).some(s => s.edgeId !== except && collinearOverlap([a, b], [s.from, s.to]));
    }
    add(a: Point, b: Point, edgeId: string): void {
        if (Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON) { return; }
        const { index, coordinate } = this.bucket(a, b); const list = index.get(coordinate) ?? [];
        list.push({ from: a, to: b, edgeId }); index.set(coordinate, list);
    }
}
function compact(points: Point[]): Point[] {
    return points.filter((point, index) => !index || Math.abs(point.x - points[index - 1].x) > EPSILON || Math.abs(point.y - points[index - 1].y) > EPSILON);
}
export function roundedPath(points: Point[], radius = 6): string {
    if (points.length < 2) { return ''; }
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const previous = points[i - 1]; const corner = points[i]; const next = points[i + 1];
        const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
        const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
        const r = Math.min(radius, incoming / 2, outgoing / 2);
        const before = { x: corner.x + (previous.x - corner.x) * r / incoming, y: corner.y + (previous.y - corner.y) * r / incoming };
        const after = { x: corner.x + (next.x - corner.x) * r / outgoing, y: corner.y + (next.y - corner.y) * r / outgoing };
        path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
    }
    const last = points[points.length - 1]; return `${path} L ${last.x} ${last.y}`;
}

/** Route the whole graph together. Ports, vertical channels and occupied horizontal intervals are reserved before drawing. */
export function routeGraph(nodes: BranchNode[], edges: BranchEdge[], measured: ReadonlyMap<string, NodeSize>): Routing {
    const routedNodes = new Map<string, RoutedNode>(); const routedEdges = new Map<string, EdgeRoute>();
    const sorted = [...edges].sort((a, b) => a.id.localeCompare(b.id));
    const incoming = new Map(nodes.map(n => [n.id, [] as BranchEdge[]])); const outgoing = new Map(nodes.map(n => [n.id, [] as BranchEdge[]]));
    for (const edge of sorted) { incoming.get(edge.target)?.push(edge); outgoing.get(edge.source)?.push(edge); }
    for (const node of nodes) {
        const degree = Math.max(incoming.get(node.id)!.length, outgoing.get(node.id)!.length);
        routedNodes.set(node.id, { ...node, width: measured.get(node.id)?.width ?? 250,
            height: Math.max(112, measured.get(node.id)?.height ?? 112, (degree + 1) * 12 + 40), inputs: [], outputs: [] });
    }
    const columns = new Set<number>(); const occupied = new Segments(); const reserved = new Segments();
    const ports = new Map<string, { point: Point; column: number; handle: string }>();
    const column = (start: number, direction: number): number => {
        let value = key(start);
        while (columns.has(value)) { value = key(value + direction * 10); }
        columns.add(value); return value;
    };
    // Reserve complete escape stubs for every port so later long routes cannot cover them.
    for (const node of [...routedNodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
        for (const side of ['inputs', 'outputs'] as const) {
            const attached = side === 'inputs' ? incoming.get(node.id)! : outgoing.get(node.id)!;
            const direction = side === 'inputs' ? -1 : 1; const x = node.position.x + (direction === 1 ? node.width : 0);
            attached.forEach((edge, index) => {
                const escape = column(x + direction * CLEARANCE, direction);
                const base = node.position.y + 20 + (node.height - 40) * (index + 1) / (attached.length + 1);
                let y = key(base); let attempt = 0;
                while (reserved.overlaps({ x, y }, { x: escape, y }, edge.id)) {
                    attempt++; y = key(node.position.y + 10 + (base - node.position.y - 10 + attempt * 0.01) % (node.height - 20));
                }
                const point = { x, y }; const handle = `${side === 'inputs' ? 'in' : 'out'}-${edge.id}`;
                node[side].push({ id: handle, edgeId: edge.id, y: y - node.position.y });
                ports.set(`${edge.id}:${side}`, { point, column: escape, handle });
                reserved.add(point, { x: escape, y }, edge.id);
            });
        }
    }
    const nodeValues = [...routedNodes.values()]; const top = Math.min(0, ...nodeValues.map(n => n.position.y)); const bottom = Math.max(0, ...nodeValues.map(n => n.position.y + n.height));
    for (const edge of sorted) {
        const source = ports.get(`${edge.id}:outputs`); const target = ports.get(`${edge.id}:inputs`);
        if (!source || !target) { continue; }
        const s = source.point; const t = target.point;
        const sourceNode = routedNodes.get(edge.source)!; const targetNode = routedNodes.get(edge.target)!;
        const candidates = [
            (s.y + t.y) / 2, sourceNode.position.y - TRACK, sourceNode.position.y + sourceNode.height + TRACK,
            targetNode.position.y - TRACK, targetNode.position.y + targetNode.height + TRACK,
        ];
        let points: Point[] | undefined; let label: Point | undefined;
        for (let attempt = 0; !points; attempt++) {
            // Outside tracks guarantee termination even for dense, backward and converging relationships.
            const y = key(attempt < candidates.length ? candidates[attempt] : attempt % 2 ? top - TRACK * (attempt - candidates.length + 1) : bottom + TRACK * (attempt - candidates.length + 1));
            const candidate = compact([s, { x: source.column, y: s.y }, { x: source.column, y }, { x: target.column, y }, { x: target.column, y: t.y }, t]);
            const overlaps = candidate.slice(1).some((p, index) => occupied.overlaps(candidate[index], p, edge.id) || reserved.overlaps(candidate[index], p, edge.id));
            // Prefer label tracks outside node bodies. Vertical crossings are deliberately permitted.
            const throughNode = nodeValues.some(n => y > n.position.y - 12 && y < n.position.y + n.height + 12 &&
                Math.min(source.column, target.column) < n.position.x + n.width && Math.max(source.column, target.column) > n.position.x);
            if (!overlaps && !throughNode) { points = candidate; label = { x: (source.column + target.column) / 2, y }; }
        }
        points.slice(1).forEach((p, index) => occupied.add(points![index], p, edge.id));
        routedEdges.set(edge.id, { points, path: roundedPath(points), label: label!, sourceHandle: source.handle, targetHandle: target.handle });
    }
    return { nodes: routedNodes, edges: routedEdges };
}
