import { execSync } from 'child_process';
import * as vscode from 'vscode';

/**
 * Get the root path of the current workspace
 */
export function getWorkspaceRoot(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    return workspaceFolders && workspaceFolders.length > 0 
        ? workspaceFolders[0].uri.fsPath 
        : undefined;
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
        const branch = execSync('git rev-parse --abbrev-ref HEAD', { 
            encoding: 'utf8', 
            cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        return branch || undefined;
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
        const url = execSync('git config --get remote.origin.url', { 
            encoding: 'utf8', 
            cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
        
        // Support formats like:
        // - git@ssh.dev.azure.com:v3/org/project/repo
        // - https://dev.azure.com/org/project/_git/repo
        // - https://org.visualstudio.com/project/_git/repo
        const cleanUrl = url.replace(/(^.*[:\/])|(\.git$)/g, '');
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
        execSync('git rev-parse --is-inside-work-tree', { 
            encoding: 'utf8', 
            cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        });
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
        return execSync('git config --get remote.origin.url', { 
            encoding: 'utf8', 
            cwd,
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim() || undefined;
    } catch {
        return undefined;
    }
}

/**
 * Validate a branch name format
 */
export function isValidBranchName(branchName: string): boolean {
    if (!branchName || branchName.trim().length === 0) {
        return false;
    }
    
    // Git branch name rules:
    // - Cannot start with '.' or end with '/'
    // - Cannot contain '..' or '//'
    // - Cannot contain control characters, spaces, ~, ^, :, ?, *, [
    const invalidPatterns = [
        /^\./,           // starts with .
        /\/$/,           // ends with /
        /\.\./,          // contains ..
        /\/\//,          // contains //
        /[\x00-\x1f]/,   // control characters
        /[ ~^:?*\[\\]/,  // special characters
        /@\{/,           // @{
        /\.lock$/,       // ends with .lock
    ];
    
    return !invalidPatterns.some(pattern => pattern.test(branchName));
}

/**
 * Get the git diff for staged and unstaged changes
 * Returns a summary of changes suitable for AI context
 */
export function getGitDiff(targetBranch?: string): string | undefined {
    const cwd = getWorkspaceRoot();
    if (!cwd) {
        return undefined;
    }
    
    try {
        let diff = '';
        
        // If target branch provided, get diff against it
        if (targetBranch) {
            try {
                diff = execSync(`git diff ${targetBranch}...HEAD --stat`, {
                    encoding: 'utf8',
                    cwd,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    maxBuffer: 1024 * 1024, // 1MB buffer
                }).trim();
                
                // Also get the actual diff (limited)
                const fullDiff = execSync(`git diff ${targetBranch}...HEAD`, {
                    encoding: 'utf8',
                    cwd,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    maxBuffer: 1024 * 1024,
                }).trim();
                
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
            const staged = execSync('git diff --cached --stat', {
                encoding: 'utf8',
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            
            // Get unstaged changes
            const unstaged = execSync('git diff --stat', {
                encoding: 'utf8',
                cwd,
                stdio: ['pipe', 'pipe', 'pipe'],
            }).trim();
            
            if (staged) {
                diff += 'Staged changes:\n' + staged + '\n\n';
            }
            if (unstaged) {
                diff += 'Unstaged changes:\n' + unstaged;
            }
            
            // Get actual diff content (limited)
            if (staged || unstaged) {
                const fullDiff = execSync('git diff HEAD', {
                    encoding: 'utf8',
                    cwd,
                    stdio: ['pipe', 'pipe', 'pipe'],
                    maxBuffer: 1024 * 1024,
                }).trim();
                
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
        const messages = execSync(`git log ${target}..HEAD --oneline --no-decorate`, {
            encoding: 'utf8',
            cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
        
        return messages || undefined;
    } catch {
        return undefined;
    }
}
