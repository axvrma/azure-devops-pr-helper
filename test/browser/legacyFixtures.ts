import * as vscode from 'vscode';
import { createPanel, Uri, window as fixtureWindow } from './vscodeFixture';
import { SidebarProvider } from '../../src/webviews/sidebarProvider';
import { PRCreatorPanel } from '../../src/webviews/prCreatorPanel';
import { SettingsPanel } from '../../src/webviews/settingsPanel';
import type { ExtensionServices } from '../../src/types';
const services = { context: { extensionUri: Uri.file(process.cwd()) }, analytics: { track: () => undefined } } as unknown as ExtensionServices;
const sidebar = { ...createPanel(), visible: true, onDidChangeVisibility: () => ({ dispose: () => undefined }) };
new SidebarProvider(services).resolveWebviewView(sidebar as unknown as vscode.WebviewView, {} as vscode.WebviewViewResolveContext, {} as vscode.CancellationToken);
let lastPanel: vscode.WebviewPanel;
// The fixture window factory is shared by the bundled provider modules.
fixtureWindow.createWebviewPanel = () => { lastPanel = createPanel(); return lastPanel; };
PRCreatorPanel.createOrShow(services);
const pr = lastPanel!.webview.html;
SettingsPanel.createOrShow(services);
export const pages = { sidebar: sidebar.webview.html, pr, settings: lastPanel!.webview.html };
