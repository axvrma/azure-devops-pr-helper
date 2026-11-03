# Branch Flow semantics and file format

A directed edge A → B means propagate source A into target B. Graphs are directed acyclic graphs in one Azure repository. A branch may have several parents/children; disconnected components are supported. Duplicate nodes, branch pairs, IDs, self loops, cycles and cross-repository node data are rejected in both UI and host.

## Operations and evidence

| Operation | Exact interpretation | Evidence and limits |
| --- | --- | --- |
| merge-pr | Merge A into B through an explicitly submitted PR | Current Azure SHAs and common-commit ancestry; active exact source/target PR; exact-head Azure merge status; optional isolated local merge |
| rebase | Replay B-only commits onto A, equivalent to checking out B and running an ordinary `git rebase A` | Only simulated in a disposable repository. This is ordinary flattening rebase, without `--rebase-merges`, exec, hooks, autostash, signing, rerere or update-refs. No remote branch is updated. |
| cherry-pick | Plan selected changes from A into B | Always UNKNOWN/unverified in V1. No selected-commit editor or patch-equivalence claim is provided. |

SYNCED requires current source ancestry in target (including identical heads). A squash/cherry-pick can have equivalent content without that ancestry; it is conservatively not green. Completed PRs do not establish current-head integration. A clean simulation means the operation *could* apply at the checked commits, not that the target was changed. Yellow without a simulation explicitly says merge conflicts were not checked. PR_ACTIVE does not imply conflict freedom or passing policies. Azure's conflict status is accepted only if its last merge source and target SHAs match both current heads. No unsupported merge-simulation/conflicts API is used; file-level conflicts come from actual local Git simulation. PR changed paths are shown separately and never treated as conflicts.

ERROR is an operational failure, UNKNOWN is inconclusive/unavailable evidence, and DRIFTED is stale evidence. Colors accompany text labels and explanations. Every analysis records operation, source/target SHAs (null if deleted), method, verified flag, timestamp, reasons and warnings; optional PR summary, outstanding source-commit count, conflict paths and failed replay commit preserve the evidence.

Remote refs are loaded before and after a validation run. A changed source/target invalidates its edge; graph traversal also marks downstream dependencies stale without inventing downstream SHA changes. Validation proceeds in deterministic source topological order. Immutable commit comparisons are cached only inside that graph's validator; active PRs are batch-loaded once per run. The execution plan includes currently synced downstream edges when upstream work remains, since those relationships need revalidation after integration.

## Local analysis safety

Local Git analysis is optional and restricted to trusted workspaces whose remote matches organization, project and repository. Exact Azure commit objects must already exist. Branch Flow never fetches or changes a user's checkout, branches, index or uncommitted files. Shallow/partial clones and unrelated/incomplete histories cannot support exact simulation. Use your normal Git tools to fetch/complete history, then Refresh. Git 2.38+ is recommended for simulation flags; older Git failures are reported as unavailable evidence.

A temporary repository borrows objects through an alternates file. It has no remotes or templates, ignores inherited GIT_* environment and system/global config, disables network protocols, hooks, signing and credential helpers, and runs commands with argument arrays, 30-second command timeouts and a 2 MiB output cap. Only validated 40-character commit SHAs are used as revisions. User local Git configuration is not copied into the simulation. Disposable files are removed in finally, including after cancellation. Up to two local simulations run concurrently across panels. No actual remote rebase is implemented.

## Schema v1

Files use `.branchflow.json`. `src/branchFlow/domain/model.ts` defines the strict runtime schema; `graph.ts` is the migration entry point. Unknown versions fail with an explicit message; a future version must add an explicit migration. Unknown fields (including credentials and per-node repositories) are rejected.

```json
{
  "schemaVersion": 1,
  "graphId": "stable-unique-id",
  "name": "Release Train",
  "repository": {
    "organizationUrl": "https://dev.azure.com/example",
    "project": "Platform",
    "repositoryId": "repository-id",
    "repositoryName": "Optional display name",
    "projectId": "optional-project-id-for-policies"
  },
  "nodes": [
    { "id": "a", "branch": "release/2.1.0", "position": { "x": 50, "y": 60 } },
    { "id": "b", "branch": "release/2.2.0", "position": { "x": 370, "y": 60 } }
  ],
  "edges": [ { "id": "ab", "source": "a", "target": "b", "operation": "merge-pr" } ],
  "snapshot": { "validatedAt": null, "branchHeads": {} },
  "ui": { "viewport": { "x": 0, "y": 0, "zoom": 1 }, "snapToGrid": true }
}
```

A new graph can have `repository: null` only while it has no nodes. Edges may include an `analysis` object conforming to the schema. Saved analysis is evidence, not permanent truth: all cached statuses are marked DRIFTED when opened and automatically revalidated. Transient branch search, selection, progress, credentials and authentication never enter this format. Node IDs and positions remain stable; nodes/edges/head maps serialize in deterministic order. Limits are 5 MiB, 1,000 nodes, 4,000 edges and 50 in-memory undo snapshots.

## Save, recovery and concurrency

The native VS Code custom editor handles dirty close warnings, Save/Save As, revert and hot-exit backups. Import opens a new untitled copy; Export writes a separate JSON file without changing the editor's save target. New/Open leave other open graphs intact. Recently opened and saved paths are kept in local globalState (ten entries). Multiple files have independent validators, state and cancellation.

Saving to a local file uses an exclusive sibling `.lock` file, content SHA-256 stamps, a same-directory temporary file, fsync, a second stamp check and replace-by-rename. A stale stamp rejects the save instead of overwriting external edits/deletions. Failed writes clean up the temporary file and release their own lock. Nonlocal filesystem providers are explicitly refused for writes because replacement guarantees vary. Watchers display an external-change banner with Reload, Keep Local and Save As. Backups preserve the original file stamp, so recovering unsaved work cannot silently overwrite a file changed after the crash. Do not manually remove a surviving lock until you have checked that another writer is not active.

Sibling locks coordinate this extension across windows; there is no OS-wide compare-and-swap against arbitrary third-party writers. An uncooperative external writer can race the final stamp check and rename. Save As is the conservative resolution when another editor is actively writing. File stamps compare contents rather than timestamps. Backup/graph files can contain private branch names, PR titles and conflict paths; store them according to your repository's privacy requirements.

## Editor interactions

The sidebar has independently collapsible PR Helper and Branch Flow sections. Recent graph entries are host-owned paths selected by index; clicking an entry cannot supply an arbitrary path or command from the webview. Open and Save update the list immediately. The current PR Creator repository is remembered and reused by new graphs only when it matches the configured organization/project. Existing graph contexts stay bound to their files.

File/edit/layout/validation commands live in the keyboard-accessible Actions menu. New-connection mode, snap, repository and Settings share the toolbar. New untitled URIs are unassociated with a filesystem path, so the first native save prompts for a name and destination. Scroll pans, Shift+scroll pans horizontally and Ctrl/Cmd+scroll zooms. Local edit/result toasts are transient; the inspector retains a bounded 50-entry session error history with operation/time/details. No diagnostic history is added to graph files or telemetry. Canvas rendering has a recovery boundary; the graph model and save actions remain outside it.

Node measurements and routed port/line geometry are ephemeral presentation state. Validation does not clear those measurements, and saved graph files still contain branch positions and evidence only. Connections are routed as one graph: every relationship gets its own source/target port, reserved escape stubs, unique vertical channels and horizontal tracks checked against already reserved runs. Crossings at points are allowed; shared collinear runs are rejected. Lanes are stable across status changes and recomputed when topology, node geometry or positions change. Fit View includes connection and label bounds as well as branch cards.
