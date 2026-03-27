# Azure DevOps PR Helper

A VS Code extension to streamline creating Pull Requests on Azure DevOps with AI-powered title and description generation using Claude.

## Features

- **Create PRs directly from VS Code** - No need to switch to the browser
- **AI-Powered Suggestions** - Claude generates PR titles and descriptions based on your branch name
- **Work Item Linking** - Link PRs to Azure DevOps work items
- **Secure Credential Storage** - PAT and API keys stored using VS Code SecretStorage
- **Auto-Detection** - Automatically detects current branch and repository
- **Comprehensive Settings** - All configuration in one place

## Installation

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Compile:
   ```bash
   npm run compile
   ```
4. Press F5 to launch the Extension Development Host

## Configuration

Open the settings panel via Command Palette: `Azure DevOps: Open Settings`

### Azure DevOps Settings

| Setting | Description |
|---------|-------------|
| Organization URL | Your Azure DevOps org URL (e.g., `https://dev.azure.com/your-org`) |
| Project | Project name containing your repositories |
| PAT | Personal Access Token with Code and Work Items permissions |
| API Version | Azure DevOps REST API version (default: 7.1) |

### Claude AI Settings

| Setting | Description |
|---------|-------------|
| API Key | Your Anthropic API key from console.anthropic.com |
| Model | Claude model to use (default: claude-sonnet-4-5) |
| Max Tokens | Maximum response length (default: 1024) |
| Temperature | Creativity level 0-1 (default: 0.3) |

### AI Behavior Toggles

| Setting | Description |
|---------|-------------|
| Enable AI Suggestions | Use Claude to generate PR titles/descriptions |
| Generate Description | Also generate description (not just title) |
| Auto-Accept AI | Skip confirmation and use AI content directly |

## Commands

| Command | Description |
|---------|-------------|
| `Azure DevOps: Raise PR` | Create a new pull request |
| `Azure DevOps: Copy Last PR URL` | Copy the last created PR URL |
| `Azure DevOps: Clear Azure DevOps PAT` | Remove stored PAT |
| `Azure DevOps: Open Settings` | Open the settings panel |
| `Azure DevOps: Generate PR Title with Claude` | Generate a title using AI |

## Project Structure

```
src/
├── extension.ts          # Entry point
├── api/
│   ├── azureDevOps.ts    # Azure DevOps API client
│   └── claude.ts         # Claude API client
├── commands/
│   ├── raisePR.ts        # PR creation command
│   ├── copyUrl.ts        # Copy URL command
│   ├── clearPAT.ts       # Clear credentials command
│   ├── generateTitle.ts  # AI title generation
│   └── index.ts          # Command exports
├── webviews/
│   ├── settingsPanel.ts  # Settings webview
│   ├── sidebarProvider.ts # Sidebar webview
│   └── index.ts          # Webview exports
├── utils/
│   ├── constants.ts      # Configuration keys and defaults
│   ├── git.ts            # Git utilities
│   ├── helpers.ts        # General utilities
│   └── services.ts       # Extension services wrapper
└── types/
    └── index.ts          # TypeScript interfaces
```

## Security

- Azure DevOps PAT and Claude API key are stored securely using VS Code's SecretStorage API
- Credentials are never exposed in logs or configuration files
- CSP headers protect webviews from XSS attacks

## Requirements

- VS Code 1.60.0 or higher
- Git repository connected to Azure DevOps
- Azure DevOps PAT with:
  - Code (Read & Write)
  - Work Items (Read & Write)
- Claude API key (optional, for AI features)

## License

MIT

## Author

Built by Abhishek Verma
