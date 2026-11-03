import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, ReactFlowProvider, Background, Controls, ControlButton, MiniMap, Handle, Position, MarkerType, BaseEdge, EdgeLabelRenderer,
    getViewportForBounds, useReactFlow, useUpdateNodeInternals, type Node, type NodeProps, type EdgeProps, type Edge, type Connection, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../../media/ui/workbench.css';
import './style.css';
import { BranchGraph, BranchRef, EdgeAnalysis, emptyGraph, IntegrationOperation, operationLabel, statuses } from '../../src/branchFlow/domain/model';
import { executionPlan, layoutGraph, validateGraph } from '../../src/branchFlow/domain/graph';
import type { ViewMessage } from '../../src/branchFlow/protocol';
import { action, bridge } from './bridge';
import { History, remember, undo, redo } from './history';
import { ActionMenu, MenuAction } from './ActionMenu';
import { ErrorInspector, useNotifications } from './notifications';
import { CanvasBoundary } from './CanvasBoundary';
import { nextBranchPosition } from './geometry';
import { routeGraph, type EdgeRoute, type NodeSize, type Port } from './routing';

const colors: Record<string, string> = { SYNCED: '#238636', ACTION_REQUIRED: '#b58b00', CONFLICT: '#d73a49', PR_ACTIVE: '#388bfd', DRIFTED: '#db7700', ANALYZING: '#8b949e', UNKNOWN: '#8b949e', ERROR: '#b25369' };
const label = (value: string): string => value.replace(/_/g, ' ');
const id = (): string => Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('');
const Badge = ({ status }: { status: string }): React.JSX.Element => <span className={`badge status-${status}`}>{label(status)}</span>;
type FlowNode = Node<{ branch: string; sha?: string; current: boolean; missing: boolean; status: string; inputs: Port[]; outputs: Port[]; minHeight: number }, 'branch'>;
const BranchCard = memo(({ id, data, selected }: NodeProps<FlowNode>): React.JSX.Element => {
    const updateInternals = useUpdateNodeInternals();
    const ports = [...data.inputs, ...data.outputs].map(p => `${p.id}:${p.y}`).join('|');
    useLayoutEffect(() => { updateInternals(id); }, [id, ports, updateInternals]);
    return <article className={`branch-card ${selected ? 'selected' : ''}`} style={{ minHeight: data.minHeight }}>
        <Handle type="target" position={Position.Left} aria-label={`Propagate into ${data.branch}`} />
        {data.inputs.map(port => <Handle key={port.id} id={port.id} type="target" position={Position.Left} className="edge-port" style={{ top: port.y }} isConnectable={false} />)}
        <div className="eyebrow">BRANCH {data.current ? ' · CURRENT' : ''}</div><strong>{data.branch}</strong>
        <div className="node-meta">{data.missing ? 'Missing remote ref' : data.sha?.slice(0, 10) ?? 'Awaiting remote refs'}</div>
        <Badge status={data.status} /><Handle type="source" position={Position.Right} aria-label={`Propagate from ${data.branch}`} />
        {data.outputs.map(port => <Handle key={port.id} id={port.id} type="source" position={Position.Right} className="edge-port" style={{ top: port.y }} isConnectable={false} />)}
    </article>;
});
const StatusEdge = memo((props: EdgeProps): React.JSX.Element | null => {
    const route = props.data?.route as EdgeRoute | undefined;
    if (!route) { return null; }
    const state = String(props.data?.status ?? 'UNKNOWN');
    return <><BaseEdge id={props.id} path={route.path} markerEnd={props.markerEnd} style={{ stroke: colors[state], strokeWidth: props.selected ? 3 : 2 }} />
        <EdgeLabelRenderer><div className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${route.label.x}px,${route.label.y}px)` }}>
            <span>{String(props.data?.operation ?? '')}</span> · <span>{label(state)}</span>
        </div></EdgeLabelRenderer></>;
});
const nodeTypes = { branch: BranchCard }; const edgeTypes = { status: StatusEdge };

export function App(): React.JSX.Element {
    const flow = useReactFlow<FlowNode>();
    const [history, setHistory] = useState<History>({ past: [], present: emptyGraph('pending'), future: [] });
    const graph = history.present;
    const graphRef = useRef(graph); graphRef.current = graph;
    const historyRef = useRef(history); historyRef.current = history;
    // Controlled React Flow nodes must retain their measured geometry between status/host updates.
    // This is runtime-only state; it never enters a graph file or undo snapshot.
    const [dimensions, setDimensions] = useState<Map<string, NodeSize>>(() => new Map());
    const [refs, setRefs] = useState<BranchRef[]>([]); const [refsLoaded, setRefsLoaded] = useState(false);
    const [selection, setSelection] = useState<{ nodes: string[]; edges: string[] }>({ nodes: [], edges: [] });
    const [busy, setBusy] = useState(false); const [busyLabel, setBusyLabel] = useState('');
    const [progress, setProgress] = useState({ completed: 0, total: 0 });
    const { errors, notify, report, clearErrors, toasts } = useNotifications();
    const canvas = useRef<HTMLElement>(null);
    const flowRef = useRef(flow); flowRef.current = flow;
    const [meta, setMeta] = useState({ dirty: false, external: false, file: '', currentBranch: '' });
    const [query, setQuery] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(0);
    const [operation, setOperation] = useState<IntegrationOperation>('merge-pr');
    const [connectFrom, setConnectFrom] = useState(''); const [connectTo, setConnectTo] = useState('');
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [details, setDetails] = useState<{ edgeId: string; policyStatuses: string[]; changedFiles: string[] } | null>(null);
    const dragStart = useRef<BranchGraph | undefined>(undefined);
    const nameStart = useRef<BranchGraph | undefined>(undefined);
    const update = useCallback((next: BranchGraph, rememberEdit = true, post = true): void => {
        try {
            const parsed = validateGraph(next);
            const previous = historyRef.current;
            const value = rememberEdit ? remember(previous, parsed) : { ...previous, present: parsed };
            historyRef.current = value; graphRef.current = parsed; setHistory(value); setMeta(m => ({ ...m, dirty: true }));
            if (post) { bridge.postMessage({ type: 'edit', graph: parsed }); }
        } catch (e) { report(e instanceof Error ? e.message : 'Invalid graph edit.', 'Edit graph'); }
    }, [report]);
    const sync = useCallback((next: BranchGraph): void => {
        const previous = historyRef.current;
        const value = next.graphId !== previous.present.graphId ? { past: [], present: next, future: [] } : { ...previous, present: next };
        historyRef.current = value; graphRef.current = next; setHistory(value);
    }, []);
    useEffect(() => {
        const receive = (event: MessageEvent<ViewMessage>): void => {
            const message = event.data;
            switch (message.type) {
                case 'state': {
                    const first = graphRef.current.graphId === 'pending' || message.graph.graphId !== graphRef.current.graphId;
                    try { validateGraph(message.graph); } catch (error) { report(error instanceof Error ? error.message : 'Invalid graph state.', 'Restore graph'); break; }
                    sync(message.graph); setMeta({ dirty: message.dirty, external: message.external, file: message.file ?? '', currentBranch: message.currentBranch ?? '' });
                    if (first) { setDimensions(new Map()); setSelection({ nodes: [], edges: [] }); requestAnimationFrame(() => { void flowRef.current.setViewport(message.graph.ui.viewport); }); }
                    break;
                }
                case 'meta': setMeta(m => ({ ...m, dirty: message.dirty, external: message.external })); break;
                case 'refs': setRefs(message.refs); setRefsLoaded(true); break;
                case 'busy':
                    setBusy(message.value); setBusyLabel(message.label);
                    if (!message.value) {
                        const next = graphRef.current;
                        sync({ ...next, edges: next.edges.map(e => ({ ...e, analysis: e.analysis?.status === 'ANALYZING' ? { ...e.analysis, status: 'UNKNOWN', verified: false, reasons: ['Analysis did not finish. Revalidate.'] } : e.analysis })) });
                    } break;
                case 'progress': {
                    setProgress({ completed: message.completed, total: message.total });
                    if (message.edge?.status === 'ERROR') { report(message.edge.reasons.join(' '), 'Relationship validation', `${message.edge.validationMethod} · source ${message.edge.sourceSha ?? 'missing'} · target ${message.edge.targetSha ?? 'missing'}`); }
                    if (message.edge) { const next = graphRef.current; sync({ ...next, edges: next.edges.map(e => e.id === message.edge!.edgeId ? { ...e, analysis: message.edge } : e) }); }
                    break;
                }
                case 'error': report(message.message, message.operation ?? 'Extension action'); break;
                case 'notice': notify(message.message); break;
                case 'prDetails': setDetails(message); notify('PR policies and changes loaded.'); break;
            }
        };
        window.addEventListener('message', receive); bridge.postMessage({ type: 'ready' });
        return () => window.removeEventListener('message', receive);
    }, [notify, report, sync]);
    useEffect(() => {
        const error = (event: ErrorEvent): void => report(event.message || 'Unexpected webview failure.', 'Webview runtime');
        const rejected = (event: PromiseRejectionEvent): void => report(event.reason instanceof Error ? event.reason.message : 'A webview operation did not complete.', 'Webview operation');
        window.addEventListener('error', error); window.addEventListener('unhandledrejection', rejected);
        return () => { window.removeEventListener('error', error); window.removeEventListener('unhandledrejection', rejected); };
    }, [report]);
    useEffect(() => { const timer = setTimeout(() => { setSearch(query.toLocaleLowerCase()); setPage(0); }, 200); return () => clearTimeout(timer); }, [query]);
    useEffect(() => {
        const element = canvas.current;
        const wheel = (event: WheelEvent): void => {
            if (!event.shiftKey || event.ctrlKey || event.metaKey) { return; }
            event.preventDefault(); event.stopPropagation();
            const current = flowRef.current.getViewport(); const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? element?.clientHeight ?? 800 : 1;
            const viewport = { ...current, x: Math.max(-1e6, Math.min(1e6, current.x - (event.deltaX || event.deltaY) * unit)),
                y: Math.max(-1e6, Math.min(1e6, current.y - (event.deltaX ? event.deltaY : 0) * unit)) };
            void flowRef.current.setViewport(viewport);
            update({ ...graphRef.current, ui: { ...graphRef.current.ui, viewport } }, false);
        };
        element?.addEventListener('wheel', wheel, { capture: true, passive: false });
        return () => element?.removeEventListener('wheel', wheel, { capture: true });
    }, [update]);

    const undoEdit = useCallback((forward = false): void => {
        const next = forward ? redo(historyRef.current) : undo(historyRef.current);
        if (next === historyRef.current) { return; }
        historyRef.current = next; graphRef.current = next.present; setHistory(next); bridge.postMessage({ type: 'edit', graph: next.present });
        notify(forward ? 'Graph edit redone.' : 'Graph edit undone.');
    }, [notify]);
    const removeSelected = useCallback((): void => {
        if (!selection.nodes.length && !selection.edges.length) { return; }
        const current = graphRef.current;
        update({ ...current, nodes: current.nodes.filter(n => !selection.nodes.includes(n.id)),
            edges: current.edges.filter(e => !selection.edges.includes(e.id) && !selection.nodes.includes(e.source) && !selection.nodes.includes(e.target)) });
        setSelection({ nodes: [], edges: [] }); setContextMenu(null); notify('Selection deleted.');
    }, [selection, update, notify]);
    useEffect(() => {
        const keyboard = (event: KeyboardEvent): void => {
            if ((event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable="true"]')) { return; }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); undoEdit(event.shiftKey); }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); undoEdit(true); }
            if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelected(); }
            if (event.key === 'Escape') { setContextMenu(null); }
        };
        window.addEventListener('keydown', keyboard); return () => window.removeEventListener('keydown', keyboard);
    }, [removeSelected, undoEdit]);
    const heads = useMemo(() => new Map(refs.map(r => [r.name, r.sha])), [refs]);
    const selectedNode = graph.nodes.find(n => n.id === selection.nodes[0]);
    const selectedEdge = graph.edges.find(e => e.id === selection.edges[0]);
    const names = useMemo(() => new Map(graph.nodes.map(n => [n.id, n.branch])), [graph.nodes]);
    const nodeSet = useMemo(() => new Set(graph.nodes.map(n => n.branch)), [graph.nodes]);
    const edgeStructure = graph.edges.map(edge => JSON.stringify([edge.id, edge.source, edge.target])).join('|');
    const routingEdges = useMemo(() => graph.edges.map(({ id, source, target, operation }) => ({ id, source, target, operation })), [edgeStructure]);
    const routing = useMemo(() => routeGraph(graph.nodes, routingEdges, dimensions), [graph.nodes, routingEdges, dimensions]);
    const routingRef = useRef(routing); routingRef.current = routing;
    const graphNodes = useMemo<FlowNode[]>(() => {
        const relationships = new Map(graph.nodes.map(n => [n.id, [] as typeof graph.edges]));
        for (const edge of graph.edges) { relationships.get(edge.source)?.push(edge); relationships.get(edge.target)?.push(edge); }
        return graph.nodes.map(n => {
        const related = relationships.get(n.id) ?? [];
        const states = related.map(e => e.analysis?.status ?? 'UNKNOWN');
        const state = ['CONFLICT', 'ERROR', 'ANALYZING', 'DRIFTED', 'ACTION_REQUIRED', 'PR_ACTIVE', 'UNKNOWN', 'SYNCED'].find(s => states.includes(s as EdgeAnalysis['status'])) ?? 'UNKNOWN';
        const ports = routing.nodes.get(n.id)!;
        return { id: n.id, type: 'branch', position: n.position, measured: dimensions.get(n.id), selected: selection.nodes.includes(n.id),
            ariaLabel: `${n.branch}, ${label(state)}`, data: { inputs: ports.inputs, outputs: ports.outputs, minHeight: Math.max(112, (Math.max(ports.inputs.length, ports.outputs.length) + 1) * 12 + 40), branch: n.branch, sha: heads.get(n.branch), current: n.branch === meta.currentBranch,
                missing: refsLoaded && !heads.has(n.branch), status: state } };
    }); }, [graph.nodes, graph.edges, selection.nodes, heads, meta.currentBranch, refsLoaded, routing.nodes, dimensions]);
    const graphEdges = useMemo<Edge[]>(() => graph.edges.map(e => ({ id: e.id, source: e.source, target: e.target, sourceHandle: routing.edges.get(e.id)?.sourceHandle, targetHandle: routing.edges.get(e.id)?.targetHandle, type: 'status', selected: selection.edges.includes(e.id),
        markerEnd: { type: MarkerType.ArrowClosed, color: colors[e.analysis?.status ?? 'UNKNOWN'] },
        ariaLabel: `${names.get(e.source)} to ${names.get(e.target)}, ${e.operation}, ${label(e.analysis?.status ?? 'UNKNOWN')}`,
        data: { status: e.analysis?.status ?? 'UNKNOWN', operation: e.operation, route: routing.edges.get(e.id) } })), [graph.edges, selection.edges, names, routing.edges]);
    const branchMatches = useMemo(() => refs.filter(r => r.name.toLocaleLowerCase().includes(search)), [refs, search]);
    const connect = useCallback((connection: Connection): void => {
        if (!connection.source || !connection.target) { return; }
        const next = { ...graphRef.current, edges: [...graphRef.current.edges, { id: id(), source: connection.source, target: connection.target, operation }] };
        try { validateGraph(next); update(next); notify('Branch relationship connected.'); } catch (error) { report(error instanceof Error ? error.message : 'Invalid connection.', 'Connect branches'); }
    }, [operation, update, notify, report]);
    const validConnection = useCallback((connection: Connection | Edge): boolean => {
        if (!connection.source || !connection.target) { return false; }
        try { validateGraph({ ...graphRef.current, edges: [...graphRef.current.edges, { id: 'candidate', source: connection.source, target: connection.target, operation }] }); return true; } catch { return false; }
    }, [operation]);
    const addBranch = (branch: string, position?: { x: number; y: number }): void => {
        const current = graphRef.current;
        if (!current.repository || current.nodes.some(n => n.branch === branch) || !heads.has(branch)) { return; }
        const bounds = canvas.current?.getBoundingClientRect();
        const center = flow.screenToFlowPosition({ x: bounds ? bounds.left + bounds.width / 2 : window.innerWidth / 2, y: bounds ? bounds.top + bounds.height / 2 : window.innerHeight / 2 });
        const location = position ?? nextBranchPosition(current.nodes, center);
        const next = { ...current, nodes: [...current.nodes, { id: id(), branch, position: location }] };
        try { validateGraph(next); } catch (error) { report(error instanceof Error ? error.message : 'Could not add branch.', 'Add branch'); return; }
        update(next); notify(`Added ${branch}.`);
        if (!position) { void flow.setCenter(location.x + 125, location.y + 60, { zoom: flow.getZoom() }); }
    };
    const nodeChanges = (changes: NodeChange<FlowNode>[]): void => {
        const measured = changes.filter(change => change.type === 'dimensions' && change.dimensions && change.dimensions.width > 0 && change.dimensions.height > 0);
        if (measured.length) { setDimensions(previous => {
            let next = previous;
            for (const change of measured) {
                if (change.type !== 'dimensions' || !change.dimensions) { continue; }
                const before = previous.get(change.id);
                if (before?.width === change.dimensions.width && before.height === change.dimensions.height) { continue; }
                if (next === previous) { next = new Map(previous); }
                next.set(change.id, change.dimensions);
            }
            return next;
        }); }
        const positions = new Map(changes.flatMap(c => c.type === 'position' && c.position ? [[c.id, c.position] as const] : []));
        const selects = changes.filter(c => c.type === 'select');
        if (selects.length) { setSelection(s => {
            const nodes = [...new Set([...s.nodes.filter(n => !selects.some(c => c.id === n && !c.selected)), ...selects.filter(c => c.selected).map(c => c.id)])];
            const edges = selects.some(c => c.selected) ? [] : s.edges;
            return nodes.join() === s.nodes.join() && edges === s.edges ? s : { nodes, edges };
        }); }
        const moved = graphRef.current.nodes.some(n => { const p = positions.get(n.id); return p && (p.x !== n.position.x || p.y !== n.position.y); });
        if (moved) { update({ ...graphRef.current, nodes: graphRef.current.nodes.map(n => ({ ...n, position: positions.get(n.id) ?? n.position })) }, false, !dragStart.current); }
    };
    const count = useMemo(() => Object.fromEntries(statuses.map(s => [s, graph.edges.filter(e => (e.analysis?.status ?? 'UNKNOWN') === s).length])), [graph.edges]);
    const edgeAction = (name: 'analyze' | 'createPr' | 'openPr' | 'details'): void => {
        if (selectedEdge) { bridge.postMessage({ type: 'edgeAction', action: name, edgeId: selectedEdge.id }); }
    };
    const plan = useMemo(() => executionPlan(graph), [graph]);
    const fitCanvas = useCallback(async (announce = true): Promise<void> => {
        const bounds = canvas.current?.getBoundingClientRect(); const routes = routingRef.current;
        if (!routes.nodes.size) { if (announce) { notify('Add branches before fitting the canvas.'); } return; }
        if (!bounds?.width || !bounds.height || !flowRef.current.viewportInitialized) { if (announce) { notify('The canvas is still initializing. Try Fit View again shortly.'); } return; }
        let left = Infinity; let right = -Infinity; let top = Infinity; let bottom = -Infinity;
        const include = (x: number, y: number): void => { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); };
        for (const node of routes.nodes.values()) { include(node.position.x, node.position.y); include(node.position.x + node.width, node.position.y + node.height); }
        for (const route of routes.edges.values()) { route.points.forEach(p => include(p.x, p.y)); include(route.label.x - 70, route.label.y - 12); include(route.label.x + 70, route.label.y + 12); }
        const viewport = getViewportForBounds({ x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }, bounds.width, bounds.height, 0.1, 1.5, 0.15);
        try {
            const moved = await flowRef.current.setViewport(viewport);
            if (moved) { update({ ...graphRef.current, ui: { ...graphRef.current.ui, viewport } }, false); if (announce) { notify('Canvas fitted to branches and connections.'); } }
            else if (announce) { notify('The canvas is still initializing. Try Fit View again shortly.'); }
        } catch (error) { report(error instanceof Error ? error.message : 'Could not fit the canvas.', 'Fit View'); }
    }, [notify, report, update]);
    const menuActions: MenuAction[] = [
        ...(['new', 'save', 'saveAs', 'open', 'recent', 'import', 'export'] as const).map((name, index) => ({ group: 'File', label: ['New', 'Save', 'Save As', 'Open', 'Recent', 'Import', 'Export'][index], run: () => action(name) })),
        { group: 'Validate', label: 'Refresh', disabled: !graph.repository || busy, run: () => action('refresh') },
        { group: 'Validate', label: 'Analyze All', disabled: !graph.repository || busy, run: () => action('analyze') },
        { group: 'Canvas', label: 'Auto Layout', run: () => { update(layoutGraph(graphRef.current)); notify('Graph arranged.'); requestAnimationFrame(() => { void fitCanvas(false); }); } },
        { group: 'Canvas', label: 'Fit View', run: () => { void fitCanvas(); } },
        { group: 'Edit', label: 'Undo', disabled: !history.past.length, run: () => undoEdit() },
        { group: 'Edit', label: 'Redo', disabled: !history.future.length, run: () => undoEdit(true) },
    ];
    return <main className="app" onClick={() => contextMenu && setContextMenu(null)}>
        <nav className="toolbar" aria-label="Graph toolbar">
            <ActionMenu actions={menuActions} />
            <input aria-label="Graph name" className="graph-name" value={graph.name} maxLength={200}
                onFocus={() => { nameStart.current = graphRef.current; }} onChange={e => update({ ...graphRef.current, name: e.target.value || 'Untitled Branch Flow' }, false)}
                onBlur={() => { if (nameStart.current && nameStart.current.name !== graphRef.current.name) { const next = { ...historyRef.current, past: [...historyRef.current.past, nameStart.current].slice(-50), future: [] }; historyRef.current = next; setHistory(next); notify('Graph renamed.'); } nameStart.current = undefined; }} />
            <span aria-label={meta.dirty ? 'Unsaved changes' : 'Saved'} className="dirty">{meta.dirty ? '●' : '✓'}</span>
            <label className="connection-mode">New connection <select aria-label="New connection" value={operation} onChange={e => { setOperation(e.target.value as IntegrationOperation); notify('New connection operation changed.'); }}><option value="merge-pr">Merge / PR</option><option value="rebase">Rebase target onto source</option><option value="cherry-pick">Cherry-pick (unverified)</option></select></label>
            <label className="snap-option"><input type="checkbox" checked={graph.ui.snapToGrid} onChange={e => { update({ ...graphRef.current, ui: { ...graphRef.current.ui, snapToGrid: e.target.checked } }); notify(e.target.checked ? 'Snap to grid enabled.' : 'Snap to grid disabled.'); }} />Snap to grid</label>
            <button className="context" onClick={() => action('context')} title={graph.repository?.organizationUrl}>{graph.repository ? `${graph.repository.project} / ${graph.repository.repositoryName ?? graph.repository.repositoryId}` : 'Choose repository…'}</button>
            <button onClick={() => { action('settings'); notify('Opening connection settings…'); }} title="Connection and credential settings">Settings</button>
            {busy && <button onClick={() => action('cancel')}>Cancel</button>}
        </nav>
        {meta.external && <div className="banner warning" role="alert">File changed externally. Save is protected. <button onClick={() => action('reloadExternal')}>Reload file</button><button onClick={() => action('saveAs')}>Save As</button><button onClick={() => action('keepLocal')}>Keep local</button></div>}
        <div className="workspace"><aside className="branch-browser" aria-label="Remote branches"><div className="section-heading"><h2>Remote branches</h2><span>{refs.length}</span></div>
            <input aria-label="Search remote branches" placeholder="Filter branches…" value={query} onChange={e => setQuery(e.target.value)} />
            <p className="muted">Drag a branch onto the canvas or press + to add it.</p>
            {!graph.repository && <div className="empty"><strong>Start with a repository</strong><p>Choose your Azure organization, project and repository.</p><button onClick={() => action('context')}>Choose repository</button></div>}
            {busy && !refsLoaded && <p role="status">Loading remote branches…</p>}
            {graph.repository && refsLoaded && !branchMatches.length && <p role="status">{refs.length ? 'No branches match this filter.' : 'No remote branches found. Check repository access and refresh.'}</p>}
            {graph.repository && !refsLoaded && !busy && <p>Remote branches are unavailable. Check connection settings and refresh.</p>}
            <ul className="branch-list">{branchMatches.slice(page * 100, (page + 1) * 100).map(ref => <li key={ref.name} draggable={!nodeSet.has(ref.name)} onDragStart={e => { e.dataTransfer.setData('application/branchflow-branch', ref.name); e.dataTransfer.effectAllowed = 'copy'; }}>
                <div className="branch-info"><strong title={ref.name}>{ref.name}</strong><small>{ref.sha.slice(0, 8)}{ref.name === meta.currentBranch ? ' · current branch' : ''}</small></div>
                <button aria-label={`Add ${ref.name}`} title="Add branch" disabled={nodeSet.has(ref.name)} onClick={() => addBranch(ref.name)}>{nodeSet.has(ref.name) ? '✓' : '+'}</button>
            </li>)}</ul>
            {branchMatches.length > 100 && <div className="pagination"><button disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {Math.ceil(branchMatches.length / 100)}</span><button disabled={(page + 1) * 100 >= branchMatches.length} onClick={() => setPage(p => p + 1)}>Next</button></div>}
            <div className="legend"><h3>Status key</h3>{statuses.filter(s => s !== 'ANALYZING').map(s => <div key={s}><span className="legend-dot" style={{ background: colors[s] }} /><span>{label(s)}</span></div>)}</div>
        </aside>
        <section className="canvas" ref={canvas} aria-label="Branch dependency graph" onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); addBranch(e.dataTransfer.getData('application/branchflow-branch'), flow.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}>
            <CanvasBoundary onError={report}>
            <ReactFlow<FlowNode> nodes={graphNodes} edges={graphEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={nodeChanges}
                onEdgesChange={changes => { const selected = changes.filter(c => c.type === 'select'); if (selected.length) { setSelection(s => { const edges = [...new Set([...s.edges.filter(e => !selected.some(c => c.id === e && !c.selected)), ...selected.filter(c => c.selected).map(c => c.id)])]; const nodes = selected.some(c => c.selected) ? [] : s.nodes; return edges.join() === s.edges.join() && nodes === s.nodes ? s : { nodes, edges }; }); } }}
                onConnect={connect} isValidConnection={validConnection} snapToGrid={graph.ui.snapToGrid} snapGrid={[20, 20]} minZoom={0.1} maxZoom={4} deleteKeyCode={null}
                multiSelectionKeyCode={['Meta', 'Control']} selectionOnDrag panOnDrag={[1, 2]} panOnScroll zoomOnScroll={false} zoomActivationKeyCode={['Control', 'Meta']} defaultViewport={graph.ui.viewport}
                onNodeDragStart={() => { dragStart.current = graphRef.current; }} onNodeDragStop={() => {
                    const before = dragStart.current; dragStart.current = undefined;
                    if (before) { const next = { ...historyRef.current, past: [...historyRef.current.past, before].slice(-50), future: [] }; historyRef.current = next; setHistory(next); bridge.postMessage({ type: 'edit', graph: graphRef.current }); notify('Branch positions updated.'); }
                }}
                onNodeContextMenu={(e, node) => { e.preventDefault(); setSelection({ nodes: [node.id], edges: [] }); setContextMenu({ x: e.clientX, y: e.clientY }); }}
                onEdgeContextMenu={(e, edge) => { e.preventDefault(); setSelection({ nodes: [], edges: [edge.id] }); setContextMenu({ x: e.clientX, y: e.clientY }); }}
                onPaneClick={() => { setSelection({ nodes: [], edges: [] }); setContextMenu(null); }}
                onMoveEnd={(_, viewport) => { const previous = graphRef.current.ui.viewport; if (graphRef.current.graphId !== 'pending' && (previous.x !== viewport.x || previous.y !== viewport.y || previous.zoom !== viewport.zoom)) { update({ ...graphRef.current, ui: { ...graphRef.current.ui, viewport } }, false); } }}
                onlyRenderVisibleElements={graph.nodes.length > 200}>
                <Background gap={20} size={1} /><Controls showFitView={false}><ControlButton onClick={() => { void fitCanvas(); }} title="Fit View" aria-label="Fit View"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" /></svg></ControlButton></Controls><MiniMap pannable zoomable nodeColor={n => colors[String(n.data.status)] ?? colors.UNKNOWN} />
            </ReactFlow>
            </CanvasBoundary>
            <span className="canvas-hint">Scroll to pan · Shift+scroll horizontally · Ctrl/Cmd+scroll to zoom</span>
            {!graph.nodes.length && <div className="canvas-empty"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true"><circle cx="6" cy="5" r="2" /><circle cx="6" cy="19" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 7v10m0-4h5a7 7 0 0 0 7-5" /></svg><h1>Map your branch flow</h1><p>Add branches, then connect a source to its target.</p><p>Analyze each relationship before planning integration.</p></div>}
        </section>
        <aside className="inspector" aria-label="Selection inspector"><ErrorInspector errors={errors} clear={clearErrors} /><div className="section-heading"><h2>{selectedEdge ? 'Relationship' : selectedNode ? 'Branch details' : 'Release overview'}</h2></div>
            {selectedNode && <><h3 className="break">{selectedNode.branch}</h3><dl><dt>Repository</dt><dd>{graph.repository?.repositoryName ?? graph.repository?.repositoryId}</dd><dt>Remote SHA</dt><dd className="sha">{heads.get(selectedNode.branch) ?? 'Missing or not loaded'}</dd>
                <dt>Current known status</dt><dd><Badge status={graphNodes.find(n => n.id === selectedNode.id)?.data.status ?? 'UNKNOWN'} /></dd>
                <dt>Last validation</dt><dd>{graph.edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id).map(e => e.analysis?.checkedAt).filter(Boolean).sort().reverse()[0] ?? 'Never'}</dd>
                <dt>Incoming dependencies</dt><dd>{graph.edges.filter(e => e.target === selectedNode.id).map(e => names.get(e.source)).join(', ') || 'None'}</dd><dt>Outgoing dependencies</dt><dd>{graph.edges.filter(e => e.source === selectedNode.id).map(e => names.get(e.target)).join(', ') || 'None'}</dd></dl></>}
            {selectedEdge && <><h3 className="break">{names.get(selectedEdge.source)} → {names.get(selectedEdge.target)}</h3>
                <label>Integration operation<select value={selectedEdge.operation} onChange={e => { update({ ...graphRef.current, edges: graphRef.current.edges.map(edge => edge.id === selectedEdge.id ? { ...edge, operation: e.target.value as IntegrationOperation, analysis: undefined } : edge) }); notify('Relationship operation updated.'); }}>
                    <option value="merge-pr">Merge / PR</option><option value="rebase">Rebase target onto source</option><option value="cherry-pick">Cherry-pick (unverified)</option></select></label>
                <p>{operationLabel(selectedEdge.operation, names.get(selectedEdge.source)!, names.get(selectedEdge.target)!)}</p>
                <Badge status={selectedEdge.analysis?.status ?? 'UNKNOWN'} />
                {selectedEdge.analysis && <AnalysisDetails analysis={selectedEdge.analysis} />}
                <div className="actions"><button disabled={busy} onClick={() => edgeAction('analyze')}>Revalidate</button>
                    {selectedEdge.analysis?.existingPr && <button onClick={() => edgeAction('openPr')}>Open PR #{selectedEdge.analysis.existingPr.id}</button>}
                    {selectedEdge.operation === 'merge-pr' && selectedEdge.analysis?.status !== 'SYNCED' && !selectedEdge.analysis?.existingPr && <button className="primary" onClick={() => edgeAction('createPr')}>Create PR…</button>}
                    {selectedEdge.analysis?.existingPr && <button onClick={() => edgeAction('details')}>Load policies & changes</button>}
                </div>
                {details?.edgeId === selectedEdge.id && <><h3>PR policies</h3><p>{details.policyStatuses.join(', ') || 'No evaluations returned; review policy configuration in Azure.'}</p><details><summary>{details.changedFiles.length} changed paths (not conflict proof)</summary><ul>{details.changedFiles.map((p, i) => <li key={i} className="break">{p}</li>)}</ul></details></>}
            </>}
            {(selection.nodes.length > 0 || selection.edges.length > 0) && <button className="danger" onClick={removeSelected}>Delete selection</button>}
            <details className="accessible-connect"><summary>Connect branches with keyboard</summary><label>Source<select aria-label="Connection source" value={connectFrom} onChange={e => setConnectFrom(e.target.value)}><option value="">Select source</option>{graph.nodes.map(n => <option key={n.id} value={n.id}>{n.branch}</option>)}</select></label>
                <label>Target<select aria-label="Connection target" value={connectTo} onChange={e => setConnectTo(e.target.value)}><option value="">Select target</option>{graph.nodes.map(n => <option key={n.id} value={n.id}>{n.branch}</option>)}</select></label><p>Uses the operation selected in the toolbar.</p>
                <button disabled={!connectFrom || !connectTo} onClick={() => connect({ source: connectFrom, target: connectTo, sourceHandle: null, targetHandle: null })}>Connect</button></details>
            <div className="readiness"><h3>Release readiness</h3><strong>{count.SYNCED} / {graph.edges.length} relationships integrated</strong><p>{count.CONFLICT ? 'Resolve conflicts before integration.' : plan.length ? 'Review outstanding relationships and upstream dependencies.' : graph.edges.length ? 'Current source histories are integrated at the checked heads.' : 'Add relationships to build an integration plan.'}</p>
                <ol className="plan">{plan.map(step => <li key={step.edgeId}><button onClick={() => setSelection({ nodes: [], edges: [step.edgeId] })}>{step.text}</button></li>)}</ol>
                <p className="muted">Plan only. Remote integration always requires your explicit action. Branches can change after analysis.</p>
            </div>
        </aside></div>
        <footer className="statusbar" aria-live="polite"><span>{graph.nodes.length} nodes · {graph.edges.length} edges</span><span>{count.SYNCED} synced · {count.ACTION_REQUIRED + count.PR_ACTIVE + count.DRIFTED} need action · {count.CONFLICT} conflicts · {count.UNKNOWN + count.ERROR} unknown/errors</span>
            <span>{busy ? `${busyLabel} ${progress.completed}/${progress.total}` : meta.file || 'Unsaved local graph'}</span></footer>
        {toasts}
        {contextMenu && <div className="context-menu" role="menu" style={{ left: Math.min(contextMenu.x, window.innerWidth - 180), top: Math.min(contextMenu.y, window.innerHeight - 110) }}>
            <button role="menuitem" onClick={removeSelected}>Delete selection</button>{selectedEdge && <button role="menuitem" onClick={() => { edgeAction('analyze'); setContextMenu(null); }}>Revalidate relationship</button>}</div>}
    </main>;
}
function AnalysisDetails({ analysis }: { analysis: EdgeAnalysis }): React.JSX.Element {
    return <><ul className="reasons">{analysis.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>{analysis.warnings.length > 0 && <ul className="warnings">{analysis.warnings.map((r, i) => <li key={i}>{r}</li>)}</ul>}
        <dl><dt>Validation method</dt><dd>{analysis.validationMethod}</dd><dt>Evidence verified</dt><dd>{analysis.verified ? 'Yes — see method and explanation' : 'No integration proof'}</dd>
            <dt>Source SHA checked</dt><dd className="sha">{analysis.sourceSha ?? 'Unavailable'}</dd><dt>Target SHA checked</dt><dd className="sha">{analysis.targetSha ?? 'Unavailable'}</dd>
            <dt>Outstanding source commits</dt><dd>{analysis.outstandingCommits ?? 'Unknown'}</dd><dt>Last validated</dt><dd>{new Date(analysis.checkedAt).toLocaleString()}</dd>
            {analysis.existingPr && <><dt>Matching PR</dt><dd>#{analysis.existingPr.id} · {analysis.existingPr.title} · {analysis.existingPr.status} · merge: {analysis.existingPr.mergeStatus ?? 'unknown'}</dd></>}
            {analysis.failedCommit && <><dt>Failed replay commit</dt><dd className="sha">{analysis.failedCommit}</dd></>}</dl>
        {!!analysis.conflictFiles?.length && <details open><summary>Conflicting files</summary><ul>{analysis.conflictFiles.map(p => <li key={p} className="break">{p}</li>)}</ul></details>}</>;
}
const root = document.getElementById('root');
if (root) { createRoot(root).render(<ReactFlowProvider><App /></ReactFlowProvider>); }
