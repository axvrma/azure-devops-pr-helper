import { execFileSync } from 'child_process';
import * as vscode from 'vscode';
import { validBranch } from '../branchFlow/domain/model';

/**
 * Get the root path of the current workspace
 */
export function getWorkspaceRoot(resource?: vscode.Uri): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return undefined;
    }

    const activeResource = resource ?? vscode.window.activeTextEditor?.document.uri;
    if (activeResource) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(activeResource);
        if (workspaceFolder) {
            return workspaceFolder.uri.fsPath;
        }
    }

    return workspaceFolders[0].uri.fsPath;
}

export function getWorkspaceFolderName(resource?: vscode.Uri): string | undefined {
    const root = getWorkspaceRoot(resource);
    if (!root) {
        return undefined;
    }

    return vscode.workspace.workspaceFolders?.find(folder => folder.uri.fsPath === root)?.name;
}

function git(args: string[], cwd: string): string {
    return execFileSync('git', args, {
        encoding: 'utf8',
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 3000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
    }).trim();
}

/**
 * Get the current Git branch name
 */
export function getCurrentBranch(): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        return undefined;
    }
    
    try {
        const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
        return branch && branch !== 'HEAD' ? branch : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Get the current repository name from Git remote
 */
export function getCurrentRepoName(): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        return undefined;
    }
    
    try {
        const url = git(['config', '--get', 'remote.origin.url'], cwd);
        
        // Support formats like:
        // - git@ssh.dev.azure.com:v3/org/project/repo
        // - https://dev.azure.com/org/project/_git/repo
        // - https://org.visualstudio.com/project/_git/repo
        const cleanUrl = url.replace(/(^.*[:/])|(\.git$)/g, '');
        const parts = cleanUrl.split('/');
        return parts[parts.length - 1] || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Check if the current workspace is a Git repository
 */
export function isGitRepository(): boolean {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        return false;
    }
    
    try {
        git(['rev-parse', '--is-inside-work-tree'], cwd);
        return true;
    } catch {
        return false;
    }
}

/**
 * Get the Git remote URL
 */
export function getRemoteUrl(): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        return undefined;
    }
    
    try {
        return git(['config', '--get', 'remote.origin.url'], cwd) || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Validate a branch name format
 */
export function isValidBranchName(branchName: string): boolean {
    return validBranch(branchName);
}

/**
 * Get the git diff for staged and unstaged changes
 * Returns a summary of changes suitable for AI context
 */
export function getGitDiff(targetBranch?: string): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd || (targetBranch !== undefined && !validBranch(targetBranch))) { return undefined; }
    try {
        let diff = '';
        
        // If target branch provided, get diff against it
        if (targetBranch) {
            try {
                diff = git(['diff', `${targetBranch}...HEAD`, '--stat'], cwd);
                
                // Also get the actual diff (limited)
                const fullDiff = git(['diff', `${targetBranch}...HEAD`], cwd);
                
                // Limit diff size to avoid token limits
                if (fullDiff.length > 0) {
                    diff += '\n\n--- Diff Preview ---\n';
                    diff += fullDiff.slice(0, 3000);
                    if (fullDiff.length > 3000) {
                        diff += '\n... (diff truncated)';
                    }
                }
            } catch {
                // Fall back to current changes
            }
        }
        
        // If no target branch diff, get staged + unstaged changes
        if (!diff) {
            // Get staged changes
            const staged = git(['diff', '--cached', '--stat'], cwd);
            
            // Get unstaged changes
            const unstaged = git(['diff', '--stat'], cwd);
            
            if (staged) {
                diff += 'Staged changes:\n' + staged + '\n\n';
            }
            if (unstaged) {
                diff += 'Unstaged changes:\n' + unstaged;
            }
            
            // Get actual diff content (limited)
            if (staged || unstaged) {
                const fullDiff = git(['diff', 'HEAD'], cwd);
                
                if (fullDiff.length > 0) {
                    diff += '\n\n--- Diff Preview ---\n';
                    diff += fullDiff.slice(0, 3000);
                    if (fullDiff.length > 3000) {
                        diff += '\n... (diff truncated)';
                    }
                }
            }
        }
        
        return diff || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Get commit messages between current branch and target
 */
export function getCommitMessages(targetBranch?: string): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        return undefined;
    }
    
    try {
        const target = targetBranch || 'main';
        if (!validBranch(target)) { return undefined; }
        const messages = git(['log', `${target}..HEAD`, '--oneline', '--no-decorate'], cwd);
        
        return messages || undefined;
    } catch {
        return undefined;
    }
}
