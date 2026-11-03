import * as vscode from 'vscode';

const paths = {
    pullRequest: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m7-12h2a3 3 0 0 1 3 3v9m-5-12 3-3m-3 3 3 3"/><circle cx="18" cy="19" r="2"/>',
    branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10m0-4h5a7 7 0 0 0 7-5"/>',
    file: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 13h8m-8 4h5"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2M3 7v12h16l3-8H6l-3 8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5m10-4a8 8 0 0 0-13-2l-2 2m16 8-2 2a8 8 0 0 1-13-2"/>',
    settings: '<path d="m9 3-.6 2.2-2 .9-2-.6L2.8 9l1.5 1.6v2.8L2.8 15l1.6 3.5 2-.6 2 .9L9 21h6l.6-2.2 2-.9 2 .6 1.6-3.5-1.5-1.6v-2.8L21.2 9l-1.6-3.5-2 .6-2-.9L15 3z"/><circle cx="12" cy="12" r="3"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="1"/><path d="M16 8V3H3v13h5"/>',
    external: '<path d="M14 3h7v7m0-7L10 14m0-9H4v15h15v-6"/>',
    archive: '<path d="M4 8v12h16V8M3 3h18v5H3zm6 9h6"/>',
    spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4z"/>',
    shield: '<path d="m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6z"/><path d="m8 12 3 3 5-6"/>',
} as const;
export function uiIcon(name: keyof typeof paths): string {
    return `<svg class="ui-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
export function uiResourceRoot(context: vscode.ExtensionContext): vscode.Uri { return vscode.Uri.joinPath(context.extensionUri, 'media', 'ui'); }
export function uiStylesUri(webview: vscode.Webview, context: vscode.ExtensionContext): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(uiResourceRoot(context), 'workbench.css'));
}
