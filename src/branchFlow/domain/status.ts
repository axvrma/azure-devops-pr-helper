import { BranchEdge, EdgeAnalysis, PullRequestSummary } from './model';

export interface AnalysisEvidence {
    sourceSha: string | null; targetSha: string | null;
    ancestor?: boolean; outstandingCommits?: number; pr?: PullRequestSummary;
    simulation?: { clean: boolean; conflictFiles: string[]; failedCommit?: string };
    warnings?: string[]; unavailable?: string; error?: string;
}

export function analyzeEvidence(edge: BranchEdge, evidence: AnalysisEvidence, checkedAt = new Date().toISOString()): EdgeAnalysis {
    const result: EdgeAnalysis = { edgeId: edge.id, operation: edge.operation,
        sourceSha: evidence.sourceSha, targetSha: evidence.targetSha, status: 'UNKNOWN', verified: false,
        validationMethod: 'unavailable', checkedAt, reasons: [], warnings: [...(evidence.warnings ?? [])],
        outstandingCommits: evidence.outstandingCommits, existingPr: evidence.pr };
    const status = (state: EdgeAnalysis['status'], method: string, reason: string, verified = false): EdgeAnalysis =>
        ({ ...result, status: state, validationMethod: method, reasons: [reason], verified });
    if (!evidence.sourceSha || !evidence.targetSha) { return status('UNKNOWN', 'remote-refs', 'A branch is missing or was renamed. Refresh and replace the missing node.'); }
    if (evidence.error) { return status('ERROR', 'failed', evidence.error); }
    if (edge.operation === 'cherry-pick') { return status('UNKNOWN', 'cherry-pick-unverified', 'V1 does not verify selected cherry-picked changes. Ancestry or patch IDs alone do not prove equivalent propagation.'); }
    if (evidence.ancestor === true) { return status('SYNCED', 'git-ancestry', 'The current source commit is an ancestor of the current target commit; source history is integrated.', true); }
    if (evidence.simulation) {
        const simulation = evidence.simulation;
        result.conflictFiles = simulation.conflictFiles; result.failedCommit = simulation.failedCommit;
        if (!simulation.clean) { return status('CONFLICT', `isolated-${edge.operation === 'rebase' ? 'rebase' : 'merge'}`, 'The exact operation stopped with unmerged files in an isolated local repository.', true); }
        if (edge.operation === 'rebase') { return status('ACTION_REQUIRED', 'isolated-rebase', 'Replay of target-only commits onto the source succeeded in isolation. The remote target has not been rebased.'); }
    }
    if (edge.operation === 'rebase') { return status('UNKNOWN', 'rebase-unavailable', evidence.unavailable ?? 'Exact local rebase simulation is unavailable; merge predictions cannot validate a rebase.'); }
    const pr = evidence.pr;
    const exactPrHeads = pr?.sourceSha === evidence.sourceSha && pr?.targetSha === evidence.targetSha;
    if (pr?.status === 'active' && exactPrHeads && pr.mergeStatus === 'conflicts') {
        return status('CONFLICT', 'azure-pr-merge', 'Azure reports merge conflicts for this active PR at both current heads.', true);
    }
    if (pr?.status === 'active') {
        result.warnings.push(exactPrHeads ? 'An active PR can still fail policies or completion checks.' : 'PR merge evidence is stale or unavailable for the current heads.');
        return status('PR_ACTIVE', 'azure-active-pr', 'A matching source/target pull request is active. This does not prove integration or readiness.');
    }
    if (evidence.ancestor === false) {
        if (!evidence.simulation) { result.warnings.push('Merge conflicts have not been checked.'); }
        return status('ACTION_REQUIRED', evidence.simulation ? 'isolated-merge' : 'git-ancestry',
            evidence.simulation ? 'Source history is missing from the target; a local merge simulation succeeded. Create or review a PR.' : 'Source history is missing from the target. A merge is required; conflict status is unverified.');
    }
    return status('UNKNOWN', 'inconclusive', evidence.unavailable ?? 'No conclusive ancestry or integration evidence is available.');
}
