import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BranchRef, RepositoryContext, safeOrganizationUrl, shaSchema } from '../domain/model';
import { checkCancelled, OperationCancelled, Semaphore } from './async';

export interface GitResult { code: number; stdout: string; stderr: string }
export class GitFailure extends Error {
    constructor(message = 'Local Git analysis failed. Check Git availability and complete local history.') { super(message); this.name = 'GitFailure'; }
}
export interface GitSimulation { clean: boolean; conflictFiles: string[]; failedCommit?: string }
const simulations = new Semaphore(2);

export function gitEnvironment(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    for (const key of Object.keys(env)) { if (key.startsWith('GIT_')) { delete env[key]; } }
    return { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0',
        GIT_AUTHOR_NAME: 'Branch Flow Simulation', GIT_AUTHOR_EMAIL: 'simulation@localhost',
        GIT_COMMITTER_NAME: 'Branch Flow Simulation', GIT_COMMITTER_EMAIL: 'simulation@localhost',
        GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', LC_ALL: 'C' };
}

export async function runGit(cwd: string, args: readonly string[], signal?: AbortSignal, timeoutMs = 30000, maxBytes = 2 * 1024 * 1024): Promise<GitResult> {
    checkCancelled(signal);
    return new Promise((resolve, reject) => {
        const child = spawn('git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'credential.helper=', ...args], {
            cwd, env: gitEnvironment(), shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
        });
        let stdout = ''; let stderr = ''; let bytes = 0; let failure: Error | undefined; let killTimer: ReturnType<typeof setTimeout> | undefined;
        const kill = (force: boolean): void => {
            try {
                if (child.pid && process.platform !== 'win32') { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM'); }
                else if (child.pid) { spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill()); }
            } catch { /* Process already exited. */ }
        };
        const stop = (error: Error): void => { if (failure) { return; } failure = error; kill(false); killTimer = setTimeout(() => kill(true), 1000); };
        const abort = (): void => stop(new OperationCancelled());
        const timer = setTimeout(() => stop(new GitFailure('Local Git analysis timed out. Try a smaller relationship or complete local history.')), timeoutMs);
        const collect = (chunk: Buffer, stream: 'stdout' | 'stderr'): void => {
            bytes += chunk.length;
            if (bytes > maxBytes) { stop(new GitFailure('Local Git output exceeded the analysis limit.')); return; }
            if (stream === 'stdout') { stdout += chunk.toString('utf8'); } else { stderr += chunk.toString('utf8'); }
        };
        child.stdout.on('data', chunk => collect(chunk as Buffer, 'stdout'));
        child.stderr.on('data', chunk => collect(chunk as Buffer, 'stderr'));
        signal?.addEventListener('abort', abort, { once: true });
        child.on('error', () => { failure = new GitFailure('Git could not start. Install Git and reload VS Code.'); });
        child.on('close', code => {
            clearTimeout(timer); if (killTimer) { clearTimeout(killTimer); } signal?.removeEventListener('abort', abort);
            if (failure) { reject(failure); } else { resolve({ code: code ?? -1, stdout, stderr }); }
        });
        if (signal?.aborted) { abort(); }
    });
}

export function parseAzureRemote(raw: string): { organizationUrl: string; project: string; repository: string } | undefined {
    try {
        const ssh = /^(?:git@ssh\.dev\.azure\.com:v3\/|ssh:\/\/git@ssh\.dev\.azure\.com\/v3\/)([^/]+)\/([^/]+)\/([^/]+)$/.exec(raw);
        if (ssh) { return { organizationUrl: `https://dev.azure.com/${encodeURIComponent(decodeURIComponent(ssh[1]))}`, project: decodeURIComponent(ssh[2]), repository: decodeURIComponent(ssh[3]).replace(/\.git$/, '') }; }
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol)) { return; }
        // Credentials from configured remotes are deliberately discarded, never forwarded.
        const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        const index = parts.indexOf('_git');
        if (index < 1 || !parts[index + 1] || parts.length !== index + 2) { return; }
        const prefix = parts.slice(0, index - 1).map(encodeURIComponent).join('/');
        return { organizationUrl: safeOrganizationUrl(`${url.protocol}//${url.host}${prefix ? '/' + prefix : ''}`),
            project: parts[index - 1], repository: parts[index + 1].replace(/\.git$/, '') };
    } catch { return; }
}

export class LocalGitAdapter {
    constructor(private readonly cwd: string) {}
    async matches(context: RepositoryContext, signal?: AbortSignal): Promise<boolean> {
        const remote = await runGit(this.cwd, ['config', '--get-regexp', '^remote[.].*[.]url$'], signal);
        if (remote.code !== 0) { return false; }
        return remote.stdout.split('\n').some(line => {
            const value = line.replace(/^\S+\s+/, '').trim(); const parsed = parseAzureRemote(value);
            return parsed?.organizationUrl.toLowerCase() === context.organizationUrl.toLowerCase() &&
                parsed.project.toLowerCase() === context.project.toLowerCase() &&
                [context.repositoryId.toLowerCase(), context.repositoryName?.toLowerCase()].includes(parsed.repository.toLowerCase());
        });
    }
    async currentBranch(signal?: AbortSignal): Promise<string | undefined> {
        const result = await runGit(this.cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], signal);
        return result.code === 0 ? result.stdout.trim() : undefined;
    }
    async available(source: string, target: string, signal?: AbortSignal): Promise<void> {
        shaSchema.parse(source); shaSchema.parse(target);
        const shallow = await runGit(this.cwd, ['rev-parse', '--is-shallow-repository'], signal);
        const partial = await runGit(this.cwd, ['config', '--get-regexp', '^(extensions[.]partialclone|remote[.].*[.]promisor)$'], signal);
        if (shallow.code !== 0 || shallow.stdout.trim() !== 'false' || partial.code !== 1) { throw new GitFailure('Local simulation needs complete, non-shallow, non-partial Git history. Fetch or clone manually, then refresh.'); }
        for (const sha of [source, target]) {
            const result = await runGit(this.cwd, ['cat-file', '-e', `${sha}^{commit}`], signal);
            if (result.code !== 0) { throw new GitFailure('The exact Azure commits are not available locally. Fetch manually, then refresh; Branch Flow never fetches automatically.'); }
        }
    }
    async isAncestor(source: string, target: string, signal?: AbortSignal): Promise<boolean> {
        await this.available(source, target, signal);
        const result = await runGit(this.cwd, ['merge-base', '--is-ancestor', source, target], signal);
        if (result.code !== 0 && result.code !== 1) { throw new GitFailure(); }
        return result.code === 0;
    }
    async simulate(source: string, target: string, operation: 'merge-pr' | 'rebase', signal?: AbortSignal): Promise<GitSimulation> {
        return simulations.run(async () => {
            await this.available(source, target, signal);
            const base = await runGit(this.cwd, ['merge-base', source, target], signal);
            if (base.code !== 0) { throw new GitFailure('The branches have unrelated or incomplete histories. Exact simulation is unavailable.'); }
            const common = await runGit(this.cwd, ['rev-parse', '--git-common-dir'], signal);
            if (common.code !== 0) { throw new GitFailure(); }
            const objects = path.resolve(this.cwd, common.stdout.trim(), 'objects');
            if (/[\r\n]/.test(objects)) { throw new GitFailure('Local object path cannot be safely used for simulation.'); }
            const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'branchflow-'));
            const run = (args: string[], activeSignal = signal): Promise<GitResult> => runGit(temporary,
                ['-c', `core.hooksPath=${path.join(temporary, 'disabled-hooks')}`, '-c', 'commit.gpgSign=false',
                    '-c', 'protocol.allow=never', '-c', 'rerere.enabled=false', ...args], activeSignal);
            try {
                const init = await run(['init', '--template=', '.']); if (init.code !== 0) { throw new GitFailure(); }
                await fs.writeFile(path.join(temporary, '.git', 'objects', 'info', 'alternates'), objects + '\n', { mode: 0o600 });
                const checkout = await run(['checkout', '--detach', target]); if (checkout.code !== 0) { throw new GitFailure(); }
                // Only immutable SHAs reach Git; no imported branch names or shell strings.
                const result = operation === 'rebase'
                    ? await run(['rebase', '--no-verify', '--no-autostash', '--no-autosquash', '--no-fork-point', '--no-update-refs', '--no-rebase-merges', source])
                    : await run(['merge', '--no-commit', '--no-ff', '--no-verify', source]);
                if (result.code === 0) { return { clean: true, conflictFiles: [] }; }
                const unmerged = await run(['diff', '--name-only', '--diff-filter=U', '-z']);
                const files = [...new Set(unmerged.stdout.split('\0').filter(Boolean))];
                if (unmerged.code !== 0 || !files.length) { throw new GitFailure('Simulation failed without conflict evidence. No clean/conflicted result can be asserted.'); }
                const failed = operation === 'rebase' ? await run(['rev-parse', '--verify', 'REBASE_HEAD']) : undefined;
                return { clean: false, conflictFiles: files.slice(0, 10000), failedCommit: failed?.code === 0 && shaSchema.safeParse(failed.stdout.trim()).success ? failed.stdout.trim() : undefined };
            } finally {
                // Entire repository is disposable; cleanup cannot be cancelled with the analysis.
                await fs.rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
            }
        }, signal);
    }
}

export function refsToHeads(refs: BranchRef[]): Record<string, string> { return Object.fromEntries(refs.map(r => [r.name, r.sha])); }
