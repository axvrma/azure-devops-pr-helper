export type Status =
  "synced" | "action" | "conflict" | "pr" | "drifted" | "unknown";
export type Scenario = "healthy" | "conflict" | "drift";
export const statuses: Record<Status, { label: string; color: string }> = {
  synced: { label: "Synced", color: "#4adea2" },
  action: { label: "Action required", color: "#f5d46c" },
  conflict: { label: "Conflict", color: "#fb7e8c" },
  pr: { label: "PR active", color: "#7db2ff" },
  drifted: { label: "Drifted", color: "#fbad72" },
  unknown: { label: "Unknown", color: "#aaaabb" },
};
export const scenarios: { id: Scenario; label: string; description: string }[] =
  [
    {
      id: "healthy",
      label: "Healthy Flow",
      description:
        "Current source ancestry is verified across this sample release train.",
    },
    {
      id: "conflict",
      label: "Conflict Detected",
      description:
        "Simulated merge evidence identifies a conflict in the checkout integration.",
    },
    {
      id: "drift",
      label: "Release Drift",
      description:
        "Changed heads and upstream dependencies have made earlier evidence stale.",
    },
  ];
export const branches = [
  {
    id: "main",
    name: "main",
    kind: "PRODUCTION",
    sha: "a8f32c1",
    x: 30,
    y: 45,
  },
  {
    id: "r21",
    name: "release/2.1",
    kind: "RELEASE",
    sha: "c4e91b0",
    x: 300,
    y: 45,
  },
  {
    id: "hotfix",
    name: "hotfix/payment",
    kind: "HOTFIX",
    sha: "9d12e4f",
    x: 30,
    y: 255,
  },
  {
    id: "r22",
    name: "release/2.2",
    kind: "RELEASE",
    sha: "e7b06d2",
    x: 300,
    y: 255,
  },
  {
    id: "r23",
    name: "release/2.3",
    kind: "RELEASE",
    sha: "f2a84c9",
    x: 570,
    y: 255,
  },
  {
    id: "checkout",
    name: "feature/checkout",
    kind: "FEATURE",
    sha: "b6d39a1",
    x: 570,
    y: 465,
  },
];
export type Relationship = {
  id: string;
  source: string;
  target: string;
  status: Status;
  commits: number;
  evidence: string;
  next: string;
  pr?: string;
  conflictPath?: string;
};
const topology = [
  ["main-r21", "main", "r21"],
  ["r21-r22", "r21", "r22"],
  ["main-hotfix", "main", "hotfix"],
  ["hotfix-r22", "hotfix", "r22"],
  ["r22-r23", "r22", "r23"],
  ["r23-checkout", "r23", "checkout"],
];
export function relationships(scenario: Scenario): Relationship[] {
  return topology.map(([id, source, target], i) => {
    if (scenario === "healthy")
      return {
        id,
        source,
        target,
        status: "synced",
        commits: 0,
        evidence:
          "Illustrative current-head ancestry check: source is an ancestor of target.",
        next: "No pending integration. Revalidate after either branch changes.",
      };
    if (scenario === "drift")
      return {
        id,
        source,
        target,
        status: i === 0 ? "synced" : "drifted",
        commits: i === 0 ? 0 : 4,
        evidence:
          i === 0
            ? "Illustrative current-head ancestry check."
            : i === 1
              ? "Source head changed from c4e91b0 to 7f02a6d. Previous evidence is stale."
              : "An upstream dependency changed. Previous analysis requires revalidation.",
        next:
          i === 0
            ? "No pending integration."
            : "Refresh branch heads and revalidate in dependency order. No current outcome can be inferred.",
      };
    const states: Status[] = [
      "synced",
      "action",
      "unknown",
      "pr",
      "action",
      "conflict",
    ];
    return {
      id,
      source,
      target,
      status: states[i],
      commits: [0, 4, 2, 1, 4, 3][i],
      evidence: [
        "Illustrative current-head ancestry check.",
        "Merge not simulated; conflict evidence is not available.",
        "Required local objects are unavailable; evidence is inconclusive.",
        "Sample active PR found. Policies and mergeability still need review.",
        "Merge not simulated; conflict evidence is not available.",
        "Illustrative isolated merge simulation found overlapping changes at the sample commit heads.",
      ][i],
      next: [
        "No pending integration.",
        "Review changes and prepare a pull request.",
        "Fetch required objects using your Git tools, then revalidate.",
        "Review the existing pull request and its policies.",
        "Review changes and prepare a pull request.",
        "Review conflicting changes, resolve them with your Git tools, then revalidate.",
      ][i],
      ...(i === 3 ? { pr: "#142 · Payment retry handling" } : {}),
      ...(i === 5 ? { conflictPath: "src/checkout/payment.ts" } : {}),
    };
  });
}
export function branchName(id: string) {
  return branches.find((b) => b.id === id)?.name || id;
}
export function branchStatus(id: string, edges: Relationship[]): Status {
  const incoming = edges.filter((e) => e.target === id);
  const priority: Status[] = [
    "conflict",
    "drifted",
    "unknown",
    "action",
    "pr",
    "synced",
  ];
  return priority.find((s) => incoming.some((e) => e.status === s)) || "synced";
}
