Here's a `README.md` file tailored for your VS Code extension that raises Pull Requests on Azure DevOps and optionally links them to Work Items.

---

````markdown
# VS Code Azure DevOps PR Helper

A simple VS Code extension to streamline the process of creating Pull Requests on **Azure DevOps**. It allows you to:
- Create a PR with title and description
- Choose source and target branches
- Link work items to the PR
- Automatically copy the PR URL to clipboard

## Features

- 🔒 Securely stores your Azure DevOps Personal Access Token (PAT) using VS Code Secrets
- 🧠 Auto-detects the current Git repository and branch
- 🧭 Supports selecting repositories from your Azure DevOps organization
- 🧾 Optional linking of work items to PR
- 📋 Quick copy of last PR URL

## Requirements

- A Git repository connected to an Azure DevOps remote
- Azure DevOps PAT with `Code (read & write)` and `Work Items (read & write)` permissions
- `org-config.ts` file exporting `orgHost` and `project` fields

## Getting Started

1. Clone this repo or copy the code into your extension folder
2. Install dependencies:

```bash
npm install
````

3. Create an `org-config.ts` file at the root with the following format:

```ts
export const orgConfig = {
  orgHost: 'https://dev.azure.com/your-org',
  project: 'your-project-name'
};
```

4. Compile the extension and run in VS Code Extension Host.

## Commands

### 🔧 `Raise PR` (Command: `extension.raisePR`)

1. Prompts for Azure DevOps PAT (only once, stored securely)
2. Detects or asks for the repository
3. Prompts for source/target branches, title, and description
4. Creates the PR and optionally links to Work Items
5. Offers to copy the PR URL

### 📎 `Copy Last PR URL` (Command: `extension.copyPrUrl`)

Copies the last successfully created PR URL to your clipboard.

## Security

Your PAT is stored securely using the `vscode.SecretStorage` API and is **never exposed**.

## Sample Usage

* Open your working Git repo
* Run the `Raise PR` command from the Command Palette
* Fill in the prompts
* Your PR is created, and a notification will allow you to copy the PR link

## Troubleshooting

* Ensure your repo is connected to Azure DevOps
* Ensure PAT has the required permissions
* The extension currently assumes only one workspace folder is open

## License

MIT

## Author

Built by Abhishek Verma