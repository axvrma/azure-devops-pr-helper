# Local verification record

Date: 2026-10-26. Reference environment: macOS arm64, Node 22.23.2, Git 2.50.1. The original Node 18 shell was left unchanged; commands used an isolated Node 22 runner.

| Check | Observed result |
| --- | --- |
| Clean `npm ci` from committed lockfile | Passed; dependency installation completed |
| Strict host/webview TypeScript | Passed against pinned VS Code 1.60.0 types |
| ESLint | Passed |
| Vitest | 93 tests passed in 14 files |
| Actual Git fixtures | Clean/conflicted merge and rebase; clean merge with conflicting rebase; dirty checkout preservation; unavailable/unrelated/partial histories; output cap and cancellation passed |
| Native host/file/PR tests | Schema and origin boundaries, backup recovery baseline, stale saves, concurrent writers, failure cleanup, exact duplicate prevention, partial PR success and asynchronous form prefill passed |
| Production browser suite | 13 Playwright Chromium tests passed with no browser errors or CSP violations; actual bundled assets used |
| VS Code 1.60.2 / Node 14.16.0 native smoke | Activation, all existing/new commands, untitled graph and saved custom editor opening passed |
| VS Code 1.143.1 / Node 24.21.0 current-stable native smoke | Activation, commands and custom editor opening passed |
| `npm audit` including build/test dependencies | Zero findings |
| Domain performance fixture | 1,000 nodes / 3,990 edges: validation, traversal, layout and serialization test passed in ~35 ms total against a 300 ms budget |
| Production webview | ~530 kB raw / ~165 kB gzip JavaScript, ~36 kB CSS |
| Local VSIX | 1.1.3 packaged successfully; approximately 0.55 MB compressed |
| Package inspection | Bundled host, CSS/JS, manifest, icons, docs, MIT license and third-party notices present; source, node_modules, tests, stale compiled config, credentials and temporary fixtures excluded |

The prepared GitHub Actions workflow has not been pushed or run remotely.

The native smoke is an activation/contribution/custom-editor lifecycle check, not a full rendered-UI certification. Playwright checks use a fixture-only bridge and actual production browser bundle; HTTP behavior is mocked separately. Azure authentication, real API response behavior, policy permissions, remote branch races, actual PR/work-item creation, optional provider generation, all supported operating systems and VS Code themes remain manual release checks in release-verification.md. No Marketplace readiness claim overrides those checks.

Known non-failing build warning: React Flow's `use client` directive is not meaningful in a browser IIFE. No React Server Components runtime exists in this extension. Early test failures were fixed and rerun; only the passing final checks are summarized above.

No remote PRs, branches, pushes, merges, deployment, Marketplace changes or publishing were performed. The pre-existing modified `.DS_Store` and existing 1.0.3 VSIX were left alone.

Follow-up UX regressions cover collapsible sections and safe recent-file labels, inherited PR context without a second picker, first-Save filename routing, persistent operation errors, render recovery, keyboard Actions menu, wheel pan/zoom and adding twenty branches while selection and progressive validation updates occur. The initial simple twenty-addition reproduction did not crash; hardening removes overlapping placement, avoids redundant selection/viewport updates, keeps one ready-message subscription and contains render failures. That initial test did not reproduce the user-observed disappearance. The 1.1.3 investigation below adds a failing-then-passing measurement/minimap regression that identifies a concrete cause.

The UI consistency update adds shared local workbench CSS and SVG line icons. Browser tests render the actual sidebar/PR/Settings HTML through a fixture-only VS Code adapter; dark/light/high-contrast controls, two-line recent rows, disabled empty-history clearing and narrow panels are checked. Shared styles are bundled into Branch Flow and loaded from the restricted `media/ui` resource root by the legacy webviews. The screenshot supplied by the user is a visual reference only.

## Disappearing canvas investigation (1.1.3)

The domain graph remained populated while its controlled React Flow projection discarded all `dimensions` change events. The installed React Flow 12.12 renderer rebuilds internal nodes from supplied user nodes; omitted `measured` fields clear width/height and handle geometry. This can hide nodes after a later validation/projection update and leaves the minimap empty. The original tests counted DOM nodes, which did not establish that those nodes were drawn.

Before the fix, the new browser test expected three minimap nodes and received zero. After preserving positive dimension changes in an ephemeral measurement map and projecting them back into controlled nodes, the minimap and visible-node checks pass through repeated progress messages and Fit View. A second fixture checks 24 nodes and 24 edges during six automatic state refreshes over 61 seconds of simulated browser time, resize and Fit View. Measurements are retained across same-graph snapshots, cleared for a new graph and never persisted to graph JSON.

The shared graph router reserves distinct branch ports, vertical columns and occupied horizontal segments. Unit tests reject shared collinear runs while permitting point crossings and cover a 100-node/197-edge DAG. A browser test also checks the actual rounded SVG paths for overlaps before and after keyboard movement through a fork/convergence graph. Fit View uses both node and route bounds and reports success only after applying the viewport.

Primary references: installed `@xyflow/system` `adoptUserNodes` and `@xyflow/react` node/minimap renderers, plus the [Node measured geometry documentation](https://reactflow.dev/api-reference/types/node) and [controlled change handling reference](https://reactflow.dev/api-reference/utils/apply-node-changes). Live Azure response behavior remains outside the fixture tests.
