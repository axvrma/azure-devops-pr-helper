# Branch Flow implementation checklist

Each item includes implementation and verification; credentials-dependent checks are explicitly recorded in the release guide.

- [x] Audit existing architecture, security, compatibility and integration risks.
- [x] Pure schema-v1 models; import limits; invariants; deterministic DAG ordering, affected edges and planner.
- [x] Evidence-based merge/rebase/cherry-pick status engine and race-safe validation scheduler.
- [x] Existing Azure client: refs/SHAs, compare, active/completed PRs, policy/changes, paging, safe retry and cancellation.
- [x] Safe asynchronous Git runner and isolated merge/rebase simulation, cleanup, real Git fixtures.
- [x] Shared PR service, exact duplicate prevention, editable prefill, history/work items, result refresh.
- [x] React Flow canvas, accessible nodes/edges, branch browser, inspectors, plan/readiness, full toolbar.
- [x] Undo/redo, DAG connections, keyboard/context actions, layout, minimap, viewport and snap.
- [x] Native new/save/save-as/open/import/export, recent files, dirty warnings, recovery, external modification protection.
- [x] Open/visible/manual/poll refresh, progressive analysis, cancellation and obsolescence protection.
- [x] Security review, CSP, message/response validation, safe URLs, secret/telemetry boundaries.
- [x] Build, typecheck, lint, unit/integration/Git/webview checks and local package inspection.
- [x] README, changelog, format/semantics, budgets, release and manual Azure/minimum-host verification instructions.

## Verification boundaries

Implementation and local checks are complete. Live Azure/AI account checks, the cross-platform/theme release matrix and hardware frame-rate profiling remain explicitly user-owned manual verification; they are not represented by the checked implementation items. See release-verification.md and verification-results.md. CI is prepared locally and has not been run on GitHub. Cherry-pick stays deliberately unverified, and no automatic remote integrations/fetches exist.

## Follow-up sidebar and editor UX

- [x] Separate collapsible PR Helper and Branch Flow sections with live recent-opened files.
- [x] Inherit the PR Creator repository/project for new graphs; retain editable graph context.
- [x] One toolbar with Actions menu, new-connection controls, context and Settings; remove branding row.
- [x] Prompt for first-save filename using unassociated untitled resources and native Save As.
- [x] Add transient action notifications and a bounded, persistent session error inspector.
- [x] Enable vertical wheel pan, Shift+wheel horizontal pan, and modifier zoom.
- [x] Non-overlapping node placement, stable/no-op guarded state updates and recoverable renderer errors.
- [x] Host, sidebar, renderer-recovery and production-browser regressions, including 20 additions with selection/progress updates.

- [x] Shared native-theme controls and typography, SVG icons, compact sidebar file rows, and dark/light/high-contrast/narrow-panel browser verification.

- [x] Reproduce missing measured/minimap geometry, retain controlled-node dimensions across updates, and test actual drawn nodes over refresh/idle/resize cycles.
- [x] Separate connection ports and routing tracks; verify non-overlapping collinear SVG paths across fan-out/convergence and node movement.
