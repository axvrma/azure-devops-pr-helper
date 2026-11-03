# Azure DevOps PR Helper

Create Azure DevOps pull requests and plan branch integration visually inside VS Code. **Branch Flow Manager works without AI, a backend, or a paid service.** Optional Anthropic, Gemini and OpenAI assistance remains available in the existing PR Creator.

## Branch Flow Manager

Run **Azure DevOps: Open Branch Flow**, or use **New graph** in the sidebar’s collapsible **Branch Flow** section. That section also lists recently opened graphs; **PR Helper** has its own collapsible section. New graphs reuse the PR Creator’s selected project and repository. Change the context at any time using the repository control in the graph toolbar. If no selection is available, choose an HTTPS organization, project and repository using the native picker. Configure your PAT in **Azure DevOps: Open Settings** first.

1. Search remote branches and drag them onto the canvas, or use each branch's **+** button.
2. Connect source A to target B to plan propagation **A → B**. Choose Merge / PR, Rebase target onto source, or unverified Cherry-pick. Forks, convergences and disconnected components are supported; cycles and cross-repository connections are rejected.
3. Use **Analyze All** or select a relationship and **Revalidate**. Inspect exact commit SHAs, evidence, outstanding source commits, matching active PRs, policy evaluations and conflict details. The overview suggests dependency order and downstream revalidation.
4. For a merge relationship, **Create PR…** opens the existing editable PR Creator with repository and branches prefilled. An existing active PR opens instead. Only explicit submission creates a remote PR; Branch Flow never merges, pushes or performs remote rebases.
5. Save locally as `.branchflow.json`. Saved graphs automatically revalidate on open and when revealed. Refresh manually or opt into polling. Native VS Code dirty-close warnings and backups protect unsaved work; external edits produce a protected-save warning with Reload and Save As recovery.

The toolbar’s **Actions** menu contains New, Save, Save As, Open, Recent, Import/Export JSON, Refresh, Analyze All, Auto Layout, Fit View, Undo and Redo. Connection mode, snap, repository and Settings share the same compact toolbar. First Save opens the native filename dialog; Save As always lets you choose a new name. The canvas supports multiple selection, node/edge deletion, context menus, keyboard movement, zoom/pan, snap-to-grid and a minimap. Scroll pans vertically, Shift+scroll pans horizontally, and Ctrl/Cmd+scroll or pinch zooms. New branches are placed without overlap. Action toasts confirm results; the inspector’s **Errors** section retains operation, time and details after notifications disappear. A renderer recovery panel preserves access to the editor and save actions if the canvas fails. Use **Connect branches with keyboard** in the inspector for an alternative to dragging connection handles. Delete/Backspace removes the selection; Ctrl/Cmd+Z and redo shortcuts restore graph edits. Branch search is debounced and displays 100 results per page. VS Code light/dark/high-contrast colors and text status labels are supported.

| Status | Meaning |
| --- | --- |
| SYNCED · green | Current source ancestry is positively verified in the current target |
| ACTION REQUIRED · yellow | Integration remains; the explanation states whether a merge/rebase was actually simulated |
| CONFLICT · red | Actual local simulation or exact-head Azure PR merge conflict evidence exists |
| PR ACTIVE · blue | Matching active PR; policies and completion may still block it |
| DRIFTED · orange | Saved evidence is stale because heads or dependencies changed |
| ANALYZING | Validation is in progress; Cancel stops obsolete work |
| UNKNOWN | Inconclusive evidence, missing refs or unavailable simulation |
| ERROR | An operation failed; this is not a Git conflict |

A completed or squash-merged PR does not automatically prove current source ancestry. Cherry-pick is explicitly unverified in V1. Rebase A → B means replay B-only commits onto A in a temporary repository. A clean merge is not proof of a clean rebase. Local simulation requires a matching trusted, complete clone with the exact Azure objects already present; fetch manually when necessary. The extension leaves your checkout, index, branches and dirty files alone. Without a suitable clone, cloud merge planning still works and exact rebase simulation remains UNKNOWN. See [operation semantics and file format](docs/branch-flow/semantics-and-format.md).

## PR Creator and optional AI

Run **Azure DevOps: Create Pull Request** or **Raise PR**. Select a repository and editable source/target branches, enter a title/description manually, and optionally link comma-separated work-item IDs. **AI** can suggest content using local Git commits and diff context when you configure a provider/key. Manual PR creation and all Branch Flow operations work without AI. PR history retains ten locally stored entries; the last PR URL can be copied from the command palette.

Set up provider, model, token limit and temperature in Settings. AI generation intentionally sends the chosen commit/diff context to that provider. No AI service is called by Branch Flow analysis. Provider model availability and live Azure permissions depend on your account.

## Configuration and requirements

- VS Code **1.60.0+**; Git is needed for workspace hints and optional local analysis. Git 2.38+ is recommended for simulation.
- Azure DevOps HTTPS organization URL, project and PAT. HTTPS on-premises organization/collection URLs are accepted; REST version must match the server. HTTP URLs and embedded URL credentials are refused.
- Code Read permission for analysis; Code Read/Write for explicit PR creation. Work Items Read/Write is needed only for work-item linking.
- Optional provider API key for Anthropic, Google Gemini or OpenAI.

| VS Code setting | Default / purpose |
| --- | --- |
| `azureDevopsPr.orgHost` | Organization URL configured in Settings |
| `azureDevopsPr.project` | Project configured in Settings |
| `azureDevopsPr.apiVersion` | `7.1` |
| `azureDevopsPr.branchFlow.localAnalysis` | `true`; disabled in untrusted workspaces regardless of setting |
| `azureDevopsPr.branchFlow.pollIntervalSeconds` | `0`, disabled; positive intervals have a 30-second minimum |
| `azureDevopsPr.useAI` | `true`; existing optional AI behavior |
| `azureDevopsPr.generateDescription` | `true`; optional AI description |
| `azureDevopsPr.autoAcceptAI` | `false`; existing behavior setting retained |
| `azureDevopsPr.aiProvider` / `aiModel` | Provider and model; blank model uses provider default |
| `azureDevopsPr.aiMaxTokens` / `aiTemperature` | `1024` / `0.3` |
| `azureDevopsPr.enableTelemetry` | `true`; also respects VS Code's telemetry switch |

If a graph names another organization, credentials are withheld until you explicitly select/authorize that context. A deleted/renamed branch should be replaced in the graph. A shallow/partial clone, missing objects or simulation failure cannot produce a clean rebase claim. See the in-panel recovery explanation and [verification guide](docs/branch-flow/release-verification.md).

## Security and privacy

PATs and provider keys stay in VS Code SecretStorage and the extension host. Webviews receive presence flags, never stored secrets. Branch Flow uses bundled local scripts/styles with a nonce CSP and no network connections. All filesystem, authenticated HTTP and Git operations run in the host. Graph imports and messages have runtime schemas and limits; Git uses argument arrays. API logs and errors exclude credentials and raw response bodies.

Branch Flow adds no telemetry events. Existing PostHog usage events are limited by an allowlist to aggregate counts, booleans, provider/source categories and fixed failure categories. Branch/repository/organization names, SHAs, graph/source/diff contents, credentials and unrestricted errors are dropped. A pseudonymous VS Code machine ID is used to count installations. Disable usage analytics in extension Settings or disable VS Code telemetry. Saved graphs, backups, history and Recent paths are local user data and can contain private metadata; protect them accordingly. [Security review](docs/branch-flow/security-review.md).

## Development and release

Build/test tooling requires Node **22.12+**; extension users do not need to install Node. Run `npm ci`, `npm run verify`, `npm run test:browser` (after `npx playwright install chromium`), and `npm run test:extension`. Package locally with `npm run vscode:package`; this does not publish. The production host/browser bundles exclude development dependencies. [Release checks, budgets and manual Azure validation](docs/branch-flow/release-verification.md) · [existing-system audit](docs/architecture/existing-system.md) · [implementation checklist](docs/branch-flow/implementation-checklist.md).

MIT · Built by Abhishek Verma. Bundled libraries retain their licenses in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
