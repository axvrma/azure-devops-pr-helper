import * as assert from 'assert';
import * as vscode from 'vscode';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
export async function run(): Promise<void> {
    const extension = vscode.extensions.getExtension('axvrma.azure-devops-pr-helper');
    assert.ok(extension, 'Extension is discoverable');
    await extension!.activate(); assert.ok(extension!.isActive);
    const commands = await vscode.commands.getCommands(true);
    for (const name of ['extension.raisePR', 'extension.openPRCreator', 'extension.openBranchFlow', 'extension.openSettings', 'extension.generateAITitle', 'extension.copyPrUrl', 'extension.clearPAT']) {
        assert.ok(commands.includes(name), `Registered command: ${name}`);
    }
    await vscode.commands.executeCommand('extension.openBranchFlow');
    const folder = await fs.mkdtemp(join(tmpdir(), 'branchflow-electron-fixture-'));
    const uri = vscode.Uri.file(join(folder, 'empty.branchflow.json'));
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify({ schemaVersion: 1, graphId: 'smoke', name: 'Smoke Test', repository: null, nodes: [], edges: [], snapshot: { validatedAt: null, branchHeads: {} }, ui: { viewport: { x: 0, y: 0, zoom: 1 }, snapToGrid: true } })));
    await vscode.commands.executeCommand('vscode.openWith', uri, 'azureDevopsPr.branchFlow');
    // No credentials or Azure resources are used. GUI behavior is also covered in the webview suite.
    console.log(`Branch Flow native extension smoke passed on VS Code ${vscode.version}, Node ${process.versions.node}`);
}
