# Changelog

All notable changes to the "Azure DevOps PR Helper" extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
