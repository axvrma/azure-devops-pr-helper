# Changelog

All notable changes to the "Azure DevOps PR Helper" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.3] - 2026-10-26

### Fixed
- Retain React Flow's measured node widths/heights in runtime state across analysis, refresh, selection and viewport updates. Ignoring dimension changes left model counts intact while node/minimap render geometry disappeared.
- Fit View now includes routed connections/labels, checks viewport readiness and confirms completion before showing its success toast.
- Route all relationships together using separate input/output ports, reserved escape stubs, distinct vertical channels and collision-checked horizontal tracks. Paths may intersect but cannot share collinear runs; node movement re-routes connections without changing saved branch positions.
- Added a regression that fails before the measurement fix, a 24-node/24-edge refresh/idle/resize case, actual SVG path checks during node movement, and unit coverage for fan-out, convergence, backward links, coincident nodes and crossings.

## [1.1.2] - 2026-10-26

### Changed
- Unified sidebar, PR Creator, Settings and graph controls with a shared native-theme style foundation and restrained line icons.
- Refined the sidebar into compact section headers, clear context rows, explicit credential-presence labels and quieter empty states.
- Replaced unthemed Branch Flow buttons and recent-file tiles with consistent controls and two-line file rows; added counts, disabled empty-history clearing and narrow-panel layouts.
- Made the sidebar's primary PR action a keyboard-accessible button. Added dark/light/high-contrast and narrow-panel browser checks using the actual extension HTML.

## [1.1.1] - 2026-10-26

### Changed
- Replaced the standalone sidebar Branch Flow button with independent collapsible PR Helper and Branch Flow sections, including a live list of recently opened graph files.
- Reuse the PR Creator’s selected repository/project when starting a graph, with an unambiguous workspace fallback and editable context.
- Consolidated the canvas header into one toolbar with an Actions menu, new-connection mode, snap, repository and Settings; removed the branding row.

### Fixed
- First Save now prompts for a filename; new untitled graphs no longer imply an absolute destination.
- Added result toasts and a persistent inspector error history, including native save failures and canvas-renderer recovery.
- Enabled vertical wheel panning, Shift+scroll horizontal panning and Ctrl/Cmd+scroll zoom.
- Prevented new branches stacking at one point, suppressed unchanged selection/position updates, and stabilized the webview state/message lifecycle while adding nodes.
- Added regressions for 20 additions with selection/validation updates, gestures, menus, filename routing, sidebar files, inherited context and render recovery.

## [1.1.0] - 2026-10-26

### Added
- Branch Flow Manager: React Flow DAG canvas, remote branch browsing, explicit integration operations, accessible status labels, inspector, execution plan, layout, selection and undo/redo.
- Exact-head Azure ancestry/PR analysis, drift detection, progressive validation, cancellation, optional polling, and isolated local merge/rebase simulation without fetching or changing user branches.
- Versioned `.branchflow.json` custom editor with native saving, import/export, recent files, hot-exit backup, external-change detection and concurrent-save protection.
- Shared PR application service, editable Branch Flow prefill, exact active-pair duplicate prevention, work-item linking and preserved PR history.
- Unit, actual-Git, file, native-provider, PR form, React and production-browser CSP tests; VS Code minimum-version smoke runner; release/security/architecture documentation and third-party notices.

### Changed
- Bundle host/webview for Node 14 / Chromium 91 while keeping VS Code 1.60 minimum. Build/test tools require Node 22.12+.
- Harden Azure URL encoding, response validation, pagination, timeouts, read retries, cancellation and errors. Writes are never retried.
- Require credential-free HTTPS Azure endpoints; restrict webview resource roots and external links; use cryptographic nonces.
- Drop private/unrestricted analytics fields centrally and redact raw API error bodies. Branch Flow adds no telemetry.
- Remove unused browser PostHog dependency and replace deprecated test tooling. Package only bundled runtime assets.

## [1.0.0] - 2026-03-29

### Changed
- Bumped to stable v1.0.0 release
- Full production-ready build with AI-powered PR creation and secure credential storage

## [0.2.0] - 2026-03-27

### Added
- **Analytics Integration**: PostHog analytics to track anonymous usage data
- **Privacy Settings**: New telemetry toggle in settings to opt-out of analytics
- **Privacy Documentation**: Comprehensive documentation of what data is collected

### Changed
- Updated README with analytics and privacy information

## [0.1.0] - 2025-06-27

### Added
- **PR Creation**: Create Pull Requests directly from VS Code
- **AI-Powered Suggestions**: Claude AI generates PR titles and descriptions
- **Work Item Linking**: Link PRs to Azure DevOps work items
- **Secure Storage**: PAT and API keys stored using VS Code SecretStorage
- **Auto-Detection**: Automatically detects current branch and repository
- **Settings Panel**: Comprehensive settings UI for all configuration
- **Sidebar View**: Quick access sidebar for PR operations
- **PR History**: Track recently created PRs with quick actions

### Features
- Support for multiple Claude models (Sonnet, Opus, Haiku)
- Configurable AI parameters (temperature, max tokens)
- Test connection buttons for Azure DevOps and Claude
- Copy PR URL to clipboard
- Open PR in browser directly from extension
