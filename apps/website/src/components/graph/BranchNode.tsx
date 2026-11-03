import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { GitBranch, Check, CircleDot } from "lucide-react";
import { statuses, type Status } from "../../data/demoGraph";
export type BranchData = {
  name: string;
  kind: string;
  sha: string;
  status: Status;
  related: boolean;
  dimmed: boolean;
  analyzing: boolean;
};
export type BranchFlowNode = Node<BranchData, "branch">;
export function BranchNode({ data, selected }: NodeProps<BranchFlowNode>) {
  const status = statuses[data.status];
  return (
    <div
      className={`branch-node ${selected ? "is-selected" : ""} ${data.related ? "is-related" : ""} ${data.dimmed ? "is-dimmed" : ""}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="node-meta">
        <span>{data.kind}</span>
        <span className="node-dots">···</span>
      </div>
      <div className="node-name">
        <GitBranch size={15} />
        <strong>{data.name}</strong>
      </div>
      <div className="node-footer">
        <code>{data.sha}</code>
        <span
          style={{ color: data.analyzing ? "#bba5ff" : status.color }}
          className="node-status"
        >
          {data.status === "synced" && !data.analyzing ? (
            <Check size={11} />
          ) : (
            <CircleDot size={10} />
          )}{" "}
          {data.analyzing ? "Analyzing" : status.label}
        </span>
      </div>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}
