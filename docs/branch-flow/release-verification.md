# Release verification and packaging

Branch Flow is source-complete for its documented V1 scope. Live Azure integration and release approval belong to the user. This session made no push, deployment, merge, remote PR, branch update or Marketplace change.

## Developer prerequisites

Use Node 22.12+ (tested with 22.23.2), npm and Git. The local shell originally had Node 18, so verification used an isolated Node 22 npm runner. Consumers keep VS Code >=1.60; the host bundle targets Node 14 and browser bundle Chromium 91. @types/vscode is pinned to 1.60.0. AbortController has a bundled fallback for Node 14.16. New build/test tools do not run inside the extension host.

```sh
npm ci
npm run verify
npx playwright install chromium
npm run test:browser
npm run test:extension
npm audit
npm run package:inspect
npm run vscode:package
```

`verify` runs strict host/webview typing, ESLint, unit/host/real-Git/React tests, host and webview production builds and license collection. The browser suite uses the actual production bundle under the production CSP with a fixture-only host bridge; it covers canvas render, add, undo, redo, inspection, cycle rejection and absence of CSP violations/browser errors. Native extension smoke tests download VS Code to an ignored directory and use an isolated user profile with telemetry disabled. They verify activation, old/new command registration, untitled Branch Flow and saved-file custom editor opening. Set `VSCODE_TEST_VERSION=stable` to repeat against current VS Code. On Linux CI use xvfb-run; the test launcher clears inherited ELECTRON_RUN_AS_NODE. Native smoke does not prove every rendered feature on every OS/theme.

VSIX packaging is local only. The bundled runtime and assets are included; source/test tooling and node_modules are excluded. THIRD_PARTY_NOTICES.md is generated from the production dependency tree. The existing 1.0.3 VSIX is left untouched. The new manifest is 1.1.3; choose any release metadata changes before the user packages/publishes. Inspect a newly packaged VSIX for `out/extension.js`, `media/branch-flow/app.js`, `app.css`, notices, license, README and manifest. No credentials, temp Git fixtures or local graphs should be packaged.

## Local verification record

The accompanying verification record contains the final commands and observed results from this workspace. Do not infer live Azure success from mocks. Initial failures (Electron test environment inheritance, browser library-mode environment substitution and the Zod CSP eval probe) were corrected and their checks rerun. The Vite React Flow `use client` warning concerns a React Server Components directive; this extension uses a browser-only IIFE and no server component runtime. The directive is retained as a build warning rather than weakening the CSP or adding a server.

## Required user-owned Azure verification before publishing

Use a disposable Azure repository with Code Read for analysis and Code Read/Write only for explicit PR creation; Work Items Read/Write is needed only for linking. No credentials were available for these checks in this session.

1. Configure HTTPS organization, project and PAT. Check cloud dev.azure.com, legacy visualstudio.com and your HTTPS Azure DevOps Server URL/API version if supported by your deployment. Verify 401, 403, deleted repo and missing-branch recovery.
2. Choose repository; browse/search/paginate branches, drag/add nodes and connect a fork/convergence DAG. Try Unicode and slash refs. Verify exact source/target pairing, active PR status, Azure merge conflict evidence and policy/changes loading at current heads.
3. Without a clone, merge ancestry and active PR discovery should work; rebase must remain UNKNOWN unless ancestry already proves integration. In a matching trusted complete clone with exact objects, test clean/conflicted merge and rebase, dirty user checkout preservation, detached HEAD, shallow/partial clone and cancellation. Manually fetch out of band and refresh.
4. Create PR from an edge: confirm editable repository/source/target prefill; manually edit fields; optional AI remains available; explicit submit creates once, links work items and records history. Click again and confirm matching active PR opens instead of duplication. This is a user-owned remote action.
5. Advance/force-push source and target branches using your own tools. Refresh/open/reveal/poll and confirm direct and downstream staleness, progressive updates, final-head race detection and updated execution plan. Never read a clean simulation as permission to auto-merge/rebase.
6. Save, Save As, close dirty editor, cancel close, discard, reload VS Code with unsaved backup, import/export and Recent. Open two windows, modify the file externally and confirm Save refuses stale overwrites while Reload/Save As preserve work. Verify disk-full/permission-denied handling on your filesystem.
7. Check full keyboard operation, multi-select, node/edge context menus, inspector scrolling, minimap, pan/zoom, long labels and native dark/light/high-contrast themes in VS Code 1.60 and current VS Code on supported Windows/macOS/Linux platforms.
8. Disable extension telemetry and VS Code telemetry separately. Inspect diagnostics/network behavior. Branch Flow never emits graph content/identifiers; legacy AI may send chosen diff context only when invoked.

## Measurable budgets

Hard limits: 5 MiB JSON; 1,000 nodes; 4,000 edges; 100 branch rows per UI page; 200 Azure ref/PR pages and 100,000 discovered items; 10 MiB API response; four concurrent Azure requests; two concurrent local simulations; 15-second request timeout; at most two transient read retries with capped backoff/Retry-After; 30 seconds and 2 MiB per Git command; 50 undo snapshots.

Regression targets: domain validation, layout, traversal and serialization of the 1,000-node / 3,990-edge fixture together <300 ms on the reference development machine; standalone browser bundle <650 kB raw and <200 kB gzip; initial fixture canvas/inspector usable within 2 seconds after assets load; branch filter debounce 200 ms; refresh debounce 500 ms; optional polling minimum 30 seconds and disabled by default. Large-graph pan/drag target is 30 fps at 200 visible nodes, with viewport culling above 200. Frame-rate behavior is a target requiring hardware/VS Code profiling, not an asserted measurement from unit tests. Azure wall time depends on repository/history size and service latency; cancellation remains available.

## Primary compatibility and API references

- [VS Code 1.60 release](https://code.visualstudio.com/updates/v1_60) and installed 1.60.0 API type definitions.
- [React Flow quick start](https://reactflow.dev/learn), [Vite requirements](https://vite.dev/guide/), [Vitest requirements](https://vitest.dev/guide/), [Zod requirements](https://zod.dev/), [Playwright local server testing](https://playwright.dev/docs/test-webserver). Exact versions, peer ranges, engines and licenses were checked against npm metadata before installation; the lockfile is authoritative.
- [Azure refs list](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/refs/list?view=azure-devops-rest-7.1), [commit comparisons](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/diffs/get?view=azure-devops-rest-7.1), [PR list](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-requests/get-pull-requests?view=azure-devops-rest-7.1), [iteration changes](https://learn.microsoft.com/en-us/rest/api/azure/devops/git/pull-request-iteration-changes/get?view=azure-devops-rest-7.1), [policy evaluations (documented preview)](https://learn.microsoft.com/en-us/rest/api/azure/devops/policy/evaluations/list?view=azure-devops-rest-7.1).
- [Git rebase semantics](https://git-scm.com/docs/git-rebase/2.50.0), [MSAL advisory](https://github.com/AzureAD/microsoft-authentication-library-for-js/security/advisories/GHSA-xcx6-jx8p-x3h5).
