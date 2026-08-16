/**
 * Durable review and QA domain.
 *
 * This module deliberately owns no state of its own. Review requests,
 * results, and findings are stored through the same TeamStore used by the
 * coordination service. It is kept separate from the service so the review
 * invariant can be exercised without a Harness runtime or a model.
 */
import type { TeamStore } from './store.ts';
import type { ReviewFinding, ReviewRequest, ReviewRequestId, ReviewResult, ReviewSeverity, SessionId } from './types.ts';
export type ReviewDomainErrorCode = 'REVIEW_NOT_FOUND' | 'REVIEW_STATE_INVALID' | 'REVIEW_ACTOR_INVALID' | 'REVIEW_CONTEXT_INVALID' | 'REVIEW_FINDING_INVALID' | 'REVIEW_NOT_APPROVABLE' | 'QA_EVIDENCE_MISSING' | 'QA_EVIDENCE_INVALID';
/** Typed errors local to the bounded review domain. */
export declare class ReviewDomainError extends Error {
    readonly code: ReviewDomainErrorCode;
    readonly details?: Record<string, unknown>;
    constructor(code: ReviewDomainErrorCode, message: string, details?: Record<string, unknown>);
}
export type QaEvidenceKind = 'test' | 'manual' | 'tool' | 'artifact' | 'runtime';
export type QaEvidenceOutcome = 'passed' | 'failed' | 'observed';
/** Structured evidence recorded by a real team session and verified by the reviewer. */
export interface QaEvidenceInput {
    id: string;
    kind: QaEvidenceKind;
    outcome: QaEvidenceOutcome;
    summary: string;
    source: string;
    recordedBySessionId: SessionId;
    verifiedBySessionId: SessionId;
    verifiedAt: number;
}
export interface QaEvidence extends QaEvidenceInput {
    schemaVersion: 1;
}
export interface ReviewDomainDeps {
    store: TeamStore;
    clock?: () => number;
    idFactory?: (prefix: string) => string;
}
export interface CreateReviewRequestInput {
    teamId: string;
    taskId: string;
    workspaceId: string;
    requestedBy: SessionId;
    reviewerMemberId: string;
    baseRef: string;
    headRef: string;
}
export interface CreateFindingInput {
    teamId: string;
    taskId: string;
    workspaceId: string;
    authorSessionId: SessionId;
    responsibleMemberId: string;
    severity: ReviewSeverity;
    title: string;
    description: string;
    evidence: string;
}
export interface SubmitReviewInput {
    requestId: string;
    reviewerSessionId: SessionId;
    verdict: ReviewResult['verdict'];
    evidence: readonly QaEvidenceInput[];
    findingIds?: readonly string[];
}
export interface ReviewSubmission {
    request: ReviewRequest;
    result: ReviewResult;
    findings: ReviewFinding[];
}
export interface ReviewGate {
    approved: boolean;
    requestId?: ReviewRequestId;
    blockingFindingIds: string[];
    reasons: string[];
}
/** Parse durable ReviewResult evidence and enforce its structured shape. */
export declare function parseQaEvidence(encoded: readonly string[]): QaEvidence[];
export declare function isQaEvidenceComplete(encoded: readonly string[]): boolean;
export declare class ReviewDomain {
    readonly store: TeamStore;
    private readonly clock;
    private readonly idFactory;
    constructor(deps: ReviewDomainDeps);
    private nextTimestamp;
    private requireTeam;
    private requireTask;
    private requireWorkspace;
    private requireMember;
    private authorizeActor;
    private requireRequest;
    private assertAssignedReviewer;
    createRequest(input: CreateReviewRequestInput): Promise<ReviewRequest>;
    startReview(requestId: string, reviewerSessionId: SessionId): Promise<ReviewRequest>;
    createFinding(input: CreateFindingInput): Promise<ReviewFinding>;
    resolveFinding(findingId: string, actorSessionId: SessionId, resolutionEvidence: string): Promise<ReviewFinding>;
    private reviewFindings;
    submitResult(input: SubmitReviewInput): Promise<ReviewSubmission>;
    evaluateCompletionGate(input: {
        teamId: string;
        taskId: string;
        workspaceId: string;
        actorSessionId: SessionId;
    }): Promise<ReviewGate>;
}
