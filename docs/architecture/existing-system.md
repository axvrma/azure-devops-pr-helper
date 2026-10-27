# Existing system audit and incremental architecture

Audited 2026-10-26 before implementation, against the local 1.0.3 source. The only pre-existing tracked modification was `.DS_Store`; it is left alone. The supplied brief terminates mid-sentence in section 16; no later requirements were supplied.

## Verified architecture

`src/extension.ts` constructs `ExtensionServices` (configuration, SecretStorage, globalState, analytics) and registers commands and a sidebar. Both Raise PR and Create Pull Request currently open the singleton `PRCreatorPanel`. The exported `raisePRCommand` still contains an independent quick-input workflow. Each creates PRs directly through `AzureDevOpsClient`; only the panel records ten history entries. There is no shared PR application service.

`src/api/azureDevOps.ts` uses Axios with Basic PAT authentication. Repositories, paginated branch *names*, PR creation and work-item linking are implemented. It does not yet expose ref SHAs, comparisons, PR searches or policies. Refs use continuation headers; repository/project URL encoding is inconsistent. Requests have timeouts but no cancellation/retry policy or injectable transport. API error handling logs response bodies.

`src/api/ai.ts` supports Anthropic, Gemini and OpenAI with optional SecretStorage keys, model settings, title normalization and prompt builders. `generateTitle.ts` provides the programmatic command. AI context comes from local Git diff/log helpers. This must remain optional, especially for Branch Flow.

The three webviews contain large inline HTML/CSS/nonce scripts. PR labels/history are generally escaped and repository/branch dropdowns use textContent. Messages are weakly typed and incompletely validated; external URLs are opened without origin checks. CSP restricts scripts but allows inline styles. Nonces use Math.random. Resource roots are not explicitly restricted. Settings only sends secret-presence flags, never stored secrets. Settings accepts arbitrary HTTP(S) organization hosts.

`src/utils/git.ts` uses argument arrays (no shell interpolation), but synchronous execFileSync calls have no timeout/output cap. Workspace selection uses the active editor's folder or first folder. Remote-name inference is simplistic. There is no simulation, fetch, worktree isolation, graph model or graph persistence.

Analytics uses posthog-node and machineId, checks VS Code telemetry and the extension toggle on track. Call sites currently send repository names and unrestricted error strings, contradicting README privacy claims. Browser posthog-js is declared but not imported. No new Branch Flow telemetry is needed.

## Existing behavior to preserve

PAT/key management, connection tests, all contributed commands, workspace hints, editable PR source/target/repository, manual PR writing, optional AI for all three providers, work-item linking, last URL copying, ten-entry history and privacy toggles. Preserve the public extension ID, publisher, license and minimum VS Code 1.60 engine unless evidence requires a change.

## Build and release baseline

CommonJS ES2020 strict TypeScript compiles to `out`; main is `out/extension.js`. Development dependencies use broad ranges, including @types/vscode ^1.60 (potential API drift), deprecated vscode-test, ESLint 8/TS ESLint 6. No tests or CI exist. `.vscodeignore` excludes TypeScript/maps but includes most node_modules (the existing VSIX is about 22 MB). MIT license, icon and Marketplace repository metadata exist; changelog lacks 1.0.1–1.0.3 entries. The host has Node 18.20.6 and Git 2.50.1; modern Vite/Vitest/vsce need a newer *build-time* Node.

## Risks and decisions

- Add a separate React Flow/Vite webview; do not extend inline PR HTML for the graph. Use React state with a small pure history reducer rather than introducing a second state framework.
- Add pure domain schema, DAG algorithms, evidence/status engine; application validation scheduler and shared PullRequestService; host-only Git, Azure and filesystem infrastructure. Infrastructure depends on the domain, never the reverse.
- Extend the existing Azure client with injectable HTTP, documented 7.1 endpoints, bounded reads/retries, pagination, encoding, validation, cancellation and safe errors. Never retry remote writes.
- Consolidate PR creation/history/work-item handling and duplicate checking in one service. Branch Flow only opens the editable PR Creator; explicit submission remains the sole remote creation trigger.
- Use current tool versions under Node 22.12+ for building. Bundle the host for Node 14 and the browser for Chromium 91 (VS Code 1.60 / Electron 13); pin VS Code types to 1.60. Build-tool Node requirements do not require raising the extension engine. Verify actual minimum-host execution separately.
- Persist schema-v1 JSON with bounded runtime validation, deterministic serialization, file stamps, exclusive sibling locks and replace-by-rename. Webview drafts use workspaceState for reload recovery; evidence is stale until Azure verification.
- Compare exact Azure heads. Prove merge propagation by ancestry/common commit, not completed PRs, counts of changed files or patch IDs. Rebase A → B means replay B-only commits onto A. Simulate in a temporary repository borrowing local objects; no checkout, stash, branch update, fetch, hooks or global Git configuration in the user's repository. Return UNKNOWN when exact heads/history are unavailable.
- Cancel/obsolete generations; recheck remote heads after validation and immediately before PR submission. Mark transitive dependency staleness separately from actual branch-head drift. Multiple graphs can open independently.
- Restrict URL origins and credential use to configured/explicitly selected contexts. Imported graphs cannot silently redirect the stored PAT. Validate messages and imports; enforce CSP/local roots; redact errors and allowlist telemetry properties centrally.

## Reusable pieces and coupling

Reuse ExtensionServices, SecretStorage keys, configuration, AI builders, history type, existing PR form, and Azure client. PRCreatorPanel currently owns business logic and should delegate creation incrementally. Legacy synchronous Git hints remain a targeted debt item with bounded execution; new analysis must be asynchronous. Existing forms are retained to limit regression surface. Tests must cover those seams with VS Code/HTTP mocks and actual temporary Git repositories.
