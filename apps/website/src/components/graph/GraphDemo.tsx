import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Background,
  BackgroundVariant,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type NodeChange,
  type EdgeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ChevronDown,
  GitBranch,
  GitCompareArrows,
  Maximize,
  Minus,
  Plus,
  RotateCcw,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  branches,
  branchName,
  branchStatus,
  relationships,
  scenarios,
  statuses,
  type Scenario,
  type Relationship,
} from "../../data/demoGraph";
import { BranchNode, type BranchFlowNode } from "./BranchNode";
const nodeTypes = { branch: BranchNode };
const subscribe = (cb: () => void) => {
  const q = window.matchMedia("(max-width: 767px)");
  q.addEventListener("change", cb);
  return () => q.removeEventListener("change", cb);
};
const isMobile = () => window.matchMedia("(max-width: 767px)").matches;
export default function GraphDemo() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}
function GraphCanvas() {
  const [scenario, setScenario] = useState<Scenario>("healthy");
  const [selected, setSelected] = useState<{
    kind: "edge" | "node";
    id: string;
  }>({ kind: "edge", id: "r22-r23" });
  const [positions, setPositions] = useState(() =>
    branches.map((b) => ({ id: b.id, position: { x: b.x, y: b.y } })),
  );
  const [analyzing, setAnalyzing] = useState(false);
  const [announcement, setAnnouncement] = useState(
    "Healthy Flow sample loaded.",
  );
  const instance = useRef<ReactFlowInstance<BranchFlowNode> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobile = useSyncExternalStore(subscribe, isMobile, () => false);
  const reduced = useReducedMotion();
  const duration = reduced ? 0 : 250;
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const relations = useMemo(() => relationships(scenario), [scenario]);
  const relation =
    relations.find((e) => e.id === selected.id) ||
    relations.find((e) => e.target === selected.id) ||
    relations[0];
  const branch = branches.find((b) => b.id === selected.id);
  const relevant = useMemo(
    () =>
      selected.kind === "node"
        ? relations
            .filter((e) => e.source === selected.id || e.target === selected.id)
            .map((e) => e.id)
        : [selected.id],
    [relations, selected],
  );
  const nodes: BranchFlowNode[] = branches.map((b) => ({
    id: b.id,
    type: "branch",
    position: positions.find((p) => p.id === b.id)!.position,
    selected: selected.kind === "node" && b.id === selected.id,
    ariaLabel: `${b.name}, ${statuses[branchStatus(b.id, relations)].label}. Press Enter to inspect.`,
    data: {
      name: b.name,
      kind: b.kind,
      sha: scenario === "drift" && b.id === "r21" ? "7f02a6d" : b.sha,
      status: branchStatus(b.id, relations),
      related: relevant.some((id) =>
        relations.some(
          (e) => e.id === id && (e.source === b.id || e.target === b.id),
        ),
      ),
      dimmed: false,
      analyzing,
    },
  }));
  const edges = relations.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    selected: selected.kind === "edge" && selected.id === e.id,
    animated: analyzing && !reduced,
    label: relevant.includes(e.id)
      ? statuses[e.status].label.toUpperCase()
      : "",
    ariaLabel: `${branchName(e.source)} to ${branchName(e.target)}: ${statuses[e.status].label}. Press Enter to inspect.`,
    style: {
      stroke: relevant.includes(e.id) ? statuses[e.status].color : "#55516c",
      strokeWidth: relevant.includes(e.id) ? 2 : 1.3,
      opacity: relevant.includes(e.id) ? 1 : 0.65,
    },
    labelStyle: {
      fill: statuses[e.status].color,
      fontSize: 9,
      fontFamily: "Geist Mono, monospace",
    },
    labelBgStyle: { fill: "#111119" },
    labelBgPadding: [8, 5] as [number, number],
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: relevant.includes(e.id) ? statuses[e.status].color : "#55516c",
      width: 16,
      height: 16,
    },
  }));
  function chooseScenario(next: Scenario) {
    if (timer.current) clearTimeout(timer.current);
    setAnalyzing(false);
    setScenario(next);
    setSelected({
      kind: "edge",
      id: next === "conflict" ? "r23-checkout" : "r22-r23",
    });
    setAnnouncement(
      `${scenarios.find((s) => s.id === next)!.label} sample loaded.`,
    );
  }
  function analyze() {
    setAnalyzing(true);
    setAnnouncement(
      "Running illustrative analysis. No repository is contacted.",
    );
    timer.current = setTimeout(
      () => {
        setAnalyzing(false);
        setAnnouncement(
          "Sample analysis complete. Results are illustrative and do not refresh real evidence.",
        );
      },
      reduced ? 150 : 1400,
    );
  }
  function reset() {
    chooseScenario("healthy");
    setPositions(
      branches.map((b) => ({ id: b.id, position: { x: b.x, y: b.y } })),
    );
    requestAnimationFrame(() => {
      void instance.current?.fitView({ padding: 0.13, duration });
    });
  }
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const choice = changes.find((c) => c.type === "select" && c.selected);
    if (choice && choice.type === "select")
      setSelected((current) =>
        current.kind === "edge" && current.id === choice.id
          ? current
          : { kind: "edge", id: choice.id },
      );
  }, []);
  const onNodesChange = useCallback((changes: NodeChange<BranchFlowNode>[]) => {
    const choice = changes.find((c) => c.type === "select" && c.selected);
    if (choice && choice.type === "select")
      setSelected((current) =>
        current.kind === "node" && current.id === choice.id
          ? current
          : { kind: "node", id: choice.id },
      );
    if (!changes.some((c) => c.type === "position" && c.position)) return;
    setPositions((current) => {
      const temporary: BranchFlowNode[] = current.map((p) => ({
        ...p,
        type: "branch",
        data: {} as BranchFlowNode["data"],
      }));
      return applyNodeChanges(
        changes.filter((c) => c.type === "position"),
        temporary,
      ).map((n) => ({ id: n.id, position: n.position }));
    });
  }, []);
  return (
    <div
      className="demo-window"

      aria-label="Interactive sample branch workflow"
    >
      <div className="demo-titlebar">
        <div className="window-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <span>
          <GitBranch size={13} /> release-train.branchflow.json
        </span>
        <span className="demo-sample">
          <span className="pulse-dot" /> INTERACTIVE DEMO · SAMPLE REPOSITORY
        </span>
      </div>
      <div className="demo-toolbar">
        <div
          className="scenario-switch"
          role="group"
          aria-label="Workflow scenario"
        >
          {scenarios.map((s) => (
            <button
              key={s.id}
              aria-pressed={s.id === scenario}
              onClick={() => chooseScenario(s.id)}
            >
              <span className={`scenario-dot ${s.id}`} />
              {s.label}
            </button>
          ))}
        </div>
        <button
          className="analyze-button"
          disabled={analyzing}
          onClick={analyze}
        >
          <ScanLine size={14} className={analyzing ? "analyzing-icon" : ""} />
          {analyzing ? "Analyzing…" : "Run sample analysis"}
        </button>
      </div>
      <div className="demo-workspace">
        <div className="canvas-area">
          <div className="canvas-label">
            <span className="repo-symbol">P</span>
            <span>
              acme / commerce-platform <ChevronDown size={11} />
            </span>
            <span className="sample-tag">SAMPLE</span>
          </div>
          {mobile ? (
            <div className="mobile-branches" aria-label="Sample branches">
              {branches.map((b) => (
                <button
                  className={
                    selected.kind === "node" && selected.id === b.id
                      ? "selected"
                      : ""
                  }
                  key={b.id}
                  onClick={() => setSelected({ kind: "node", id: b.id })}
                >
                  <GitBranch size={15} />
                  <span>
                    {b.name}
                    <small>
                      {b.kind} · {b.sha}
                    </small>
                  </span>
                  <span
                    className="list-status"
                    style={{
                      color: statuses[branchStatus(b.id, relations)].color,
                    }}
                  >
                    {statuses[branchStatus(b.id, relations)].label}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <ReactFlow<BranchFlowNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onInit={(flow) => {
                instance.current = flow;
              }}
              onNodesChange={onNodesChange}
              onNodeClick={(_, node) => {
                setSelected({ kind: "node", id: node.id });
                setAnnouncement(`${node.data.name} selected.`);
              }}
              onEdgeClick={(_, edge) => {
                setSelected({ kind: "edge", id: edge.id });
                setAnnouncement(`Relationship ${edge.id} selected.`);
              }}
              onEdgesChange={onEdgesChange}
              fitView
              fitViewOptions={{ padding: 0.13 }}
              minZoom={0.35}
              maxZoom={1.6}
              nodesConnectable={false}
              deleteKeyCode={null}
              panOnScroll={false}
              zoomOnScroll={false}
              preventScrolling={false}
              ariaLabelConfig={{
                "node.a11yDescription.default":
                  "Press Enter to inspect. Use arrow keys to move this sample branch.",
                "edge.a11yDescription.default":
                  "Press Enter to inspect this sample relationship.",
              }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="#2e2b3f"
              />
            </ReactFlow>
          )}
          {!mobile && (
            <div
              className="graph-controls"
              role="group"
              aria-label="Graph controls"
            >
              <button
                aria-label="Zoom in"
                onClick={() => {
                  void instance.current?.zoomIn({ duration });
                }}
              >
                <Plus size={15} />
              </button>
              <button
                aria-label="Zoom out"
                onClick={() => {
                  void instance.current?.zoomOut({ duration });
                }}
              >
                <Minus size={15} />
              </button>
              <span />
              <button
                aria-label="Fit graph to viewport"
                onClick={() => {
                  void instance.current?.fitView({ padding: 0.13, duration });
                }}
              >
                <Maximize size={14} />
              </button>
              <button aria-label="Reset graph" onClick={reset}>
                <RotateCcw size={14} />
              </button>
            </div>
          )}
          <div className="canvas-help">
            {mobile
              ? "Tap a branch to inspect its relationships"
              : "Drag to arrange · Scroll to explore the page · Pinch to zoom"}
          </div>
        </div>
        <aside
          className="inspector"
          tabIndex={0}
          aria-label="Branch and relationship inspector"
        >
          <h2 className="inspector-heading">
            <GitCompareArrows size={14} />
            <span>{branch ? "BRANCH DETAILS" : "BRANCH ANALYSIS"}</span>
            <span className="inspector-live">SAMPLE</span>
          </h2>
          {branch ? (
            <>
              <h3 className="inspector-branch">{branch.name}</h3>
              <p className="inspector-copy">
                {branch.kind.toLowerCase()} branch ·{" "}
                <code>
                  {scenario === "drift" && branch.id === "r21"
                    ? "7f02a6d"
                    : branch.sha}
                </code>
              </p>
              <div className="inspector-label">CONNECTED RELATIONSHIPS</div>
              <div className="relationship-list">
                {relations
                  .filter(
                    (e) => e.source === branch.id || e.target === branch.id,
                  )
                  .map((e) => (
                    <button
                      key={e.id}
                      onClick={() => setSelected({ kind: "edge", id: e.id })}
                    >
                      <span>
                        {branchName(e.source)} <ArrowRight size={11} />{" "}
                        {branchName(e.target)}
                      </span>
                      <small style={{ color: statuses[e.status].color }}>
                        {statuses[e.status].label}
                      </small>
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <RelationshipDetails relation={relation} analyzing={analyzing} />
          )}
          <div className="inspector-note">
            <ShieldCheck size={15} />
            <span>
              Illustrative evidence only.
              <br />
              No live repository. No Git operations.
            </span>
          </div>
        </aside>
      </div>
      <div className="demo-statusbar">
        <span>
          <span className="pulse-dot" />
          {analyzing
            ? "Running sample analysis…"
            : "6 branches · 6 relationships"}
        </span>
        <span>
          LOCAL DEMO <span className="statusbar-divider">/</span> NO API CALLS
        </span>
      </div>
      <details className="graph-summary">
        <summary>
          View accessible relationship summary <ChevronDown size={14} />
        </summary>
        <p>{scenarios.find((s) => s.id === scenario)!.description}</p>
        <ul>
          {relations.map((e) => (
            <li key={e.id}>
              <button onClick={() => setSelected({ kind: "edge", id: e.id })}>
                {branchName(e.source)} → {branchName(e.target)}
                <span style={{ color: statuses[e.status].color }}>
                  {statuses[e.status].label}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </details>
      <span className="sr-only" aria-live="polite" role="status">
        {announcement}
      </span>
      {mobile && (
        <button className="mobile-reset" onClick={reset}>
          <RotateCcw size={13} /> Reset sample
        </button>
      )}
    </div>
  );
}
function RelationshipDetails({
  relation: e,
  analyzing,
}: {
  relation: Relationship;
  analyzing: boolean;
}) {
  return (
    <>
      <div className="inspector-route">
        <div>
          <span className="route-dot" />
          <code>{branchName(e.source)}</code>
          <span>SOURCE</span>
        </div>
        <ArrowDown size={13} />
        <div>
          <span className="route-dot target" />
          <code>{branchName(e.target)}</code>
          <span>TARGET</span>
        </div>
      </div>
      <div className="inspector-label">INTEGRATION STATUS</div>
      <div
        className="integration-status"
        style={{ color: analyzing ? "#c4b5fd" : statuses[e.status].color }}
      >
        {e.status === "synced" ? (
          <Check size={15} />
        ) : (
          <span className="status-circle" />
        )}
        {analyzing
          ? "ANALYZING SAMPLE"
          : statuses[e.status].label.toUpperCase()}
      </div>
      <dl className="analysis-facts">
        <div>
          <dt>Outstanding commits</dt>
          <dd>{e.status === "drifted" ? "Stale" : e.commits}</dd>
        </div>
        <div>
          <dt>Active pull request</dt>
          <dd>
            {e.pr ? "#142" : e.status === "drifted" ? "Revalidate" : "None"}
          </dd>
        </div>
        <div>
          <dt>Operation</dt>
          <dd>Merge / PR</dd>
        </div>
      </dl>
      {e.pr && (
        <p className="sample-pr">
          {e.pr} <span>Sample PR</span>
        </p>
      )}
      <div className="evidence-box">
        <span className="inspector-label">
          {e.status === "conflict"
            ? "SIMULATED CONFLICT EVIDENCE"
            : "SAMPLE EVIDENCE"}
        </span>
        <p>{e.evidence}</p>
        {e.conflictPath && (
          <code className="conflict-path">{e.conflictPath}</code>
        )}
      </div>
      {e.commits > 0 && (
        <details className="sample-commits">
          <summary>
            Illustrative commits{" "}
            {e.status === "drifted" ? "(stale sample)" : `(${e.commits})`}
          </summary>
          <ul>
            {[
              { sha: "8ae2c19", title: "Handle payment retry" },
              { sha: "4b7e0d2", title: "Validate checkout input" },
              { sha: "71cf9a3", title: "Add release notes" },
              { sha: "2ed5b04", title: "Update integration coverage" },
            ]
              .slice(0, e.commits)
              .map((c) => (
                <li key={c.sha}>
                  <code>{c.sha}</code>
                  <span>{c.title}</span>
                </li>
              ))}
          </ul>
        </details>
      )}
      <div className="next-step">
        <span className="inspector-label">RECOMMENDED NEXT STEP</span>
        <p>{e.next}</p>
      </div>
    </>
  );
}
