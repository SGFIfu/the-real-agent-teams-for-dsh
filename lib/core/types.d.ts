/**
 * Core data model for the Agent Teams runtime.
 *
 * Deliberately free of any `@deepseek-ai/*` runtime import so the core stays
 * testable with plain Node and only `zod` as a dependency. The harness glue in
 * `src/harness/` maps these types onto the real DeepSeek Harness interfaces.
 * @module dsh-agent-teams/core
 */
declare const teamIdBrand: unique symbol;
declare const memberIdBrand: unique symbol;
declare const taskIdBrand: unique symbol;
declare const messageIdBrand: unique symbol;
declare const planIdBrand: unique symbol;
declare const fileClaimIdBrand: unique symbol;
declare const workspaceIdBrand: unique symbol;
declare const gitWorkspaceIdBrand: unique symbol;
declare const commitIdBrand: unique symbol;
declare const reviewRequestIdBrand: unique symbol;
declare const reviewResultIdBrand: unique symbol;
declare const runtimeEventIdBrand: unique symbol;
export type TeamId = string & {
    readonly [teamIdBrand]: true;
};
export type TeamMemberId = string & {
    readonly [memberIdBrand]: true;
};
export type TaskId = string & {
    readonly [taskIdBrand]: true;
};
export type TeamMessageId = string & {
    readonly [messageIdBrand]: true;
};
export type PlanId = string & {
    readonly [planIdBrand]: true;
};
export type FileClaimId = string & {
    readonly [fileClaimIdBrand]: true;
};
export type WorkspaceId = string & {
    readonly [workspaceIdBrand]: true;
};
export type GitWorkspaceId = string & {
    readonly [gitWorkspaceIdBrand]: true;
};
export type CommitId = string & {
    readonly [commitIdBrand]: true;
};
export type ReviewRequestId = string & {
    readonly [reviewRequestIdBrand]: true;
};
export type ReviewResultId = string & {
    readonly [reviewResultIdBrand]: true;
};
export type RuntimeEventId = string & {
    readonly [runtimeEventIdBrand]: true;
};
/** Harness session id (opaque string; the harness owns its identity space). */
export type SessionId = string;
export type TeamStatus = 'active' | 'paused' | 'completed' | 'failed';
export interface AgentTeam {
    id: TeamId;
    name: string;
    goal: string;
    /** The session id of the harness agent that leads this team. */
    leadSessionId: SessionId;
    workspaceId: string;
    status: TeamStatus;
    createdAt: number;
    updatedAt: number;
}
export type MemberStatus = 'starting' | 'working' | 'idle' | 'blocked' | 'reviewing' | 'stopped' | 'failed';
export type MemberLifecycleState = 'starting' | 'ready' | 'waiting_for_task' | 'claiming' | 'working' | 'reporting' | 'blocked' | 'waiting_for_review' | 'stopped' | 'failed' | 'cancelled';
export type AgentCapability = 'repo.read' | 'repo.write.owned' | 'process.test' | 'process.build' | 'git.read' | 'git.commit.own-branch' | 'review.verify';
export interface TeamMember {
    id: TeamMemberId;
    teamId: TeamId;
    /** The REAL harness agent/session id. Never a fabricated second identity. */
    sessionId: SessionId;
    name: string;
    role: string;
    status: MemberStatus;
    lifecycleState?: MemberLifecycleState;
    currentTaskId?: TaskId;
    provider?: string;
    modelProvider?: string;
    model?: string;
    capabilities?: string[];
    workspaceId?: string;
    eventCursor?: number;
    joinedAt: number;
    lastActiveAt: number;
}
export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type TaskAvailability = 'locked' | 'ready';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export interface TeamTask {
    id: TaskId;
    teamId: TeamId;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    availability?: TaskAvailability;
    /** Harness session id of the owner, set atomically by claim. */
    ownerSessionId?: SessionId;
    assignedMemberId?: TeamMemberId;
    assignedRole?: string;
    requiredCapabilities?: AgentCapability[];
    workspaceId?: string;
    dependencies: TaskId[];
    requiresPlan: boolean;
    /** Required tasks count toward progress and the completion guard. */
    required: boolean;
    result?: string;
    createdAt: number;
    startedAt?: number;
    completedAt?: number;
}
export type TeamMessageType = 'message' | 'question' | 'result' | 'warning' | 'handoff' | 'review' | 'plan' | 'shutdown';
export interface TeamMessage {
    id: TeamMessageId;
    teamId: TeamId;
    fromSessionId: SessionId;
    /** Absent = broadcast to the whole team. */
    toSessionId?: SessionId;
    type: TeamMessageType;
    body: string;
    createdAt: number;
    /** Native delivery lifecycle. Legacy records may omit this field. */
    deliveryState?: 'pending' | 'queued' | 'delivering' | 'delivered' | 'acknowledged' | 'failed';
    deliveryTransport?: 'native-followup' | 'native-report' | 'durable-inbox';
    deliveryAttempt?: number;
    deliveryTargets?: Record<string, {
        state: 'pending' | 'queued' | 'delivering' | 'delivered' | 'acknowledged' | 'failed';
        attempts: number;
        deliveredAt?: number;
        error?: string;
    }>;
    deliveredAt?: number;
    deliveryError?: string;
}
export type PlanStatus = 'submitted' | 'approved' | 'rejected';
export interface TeamPlan {
    id: PlanId;
    teamId: TeamId;
    taskId: TaskId;
    authorSessionId: SessionId;
    body: string;
    status: PlanStatus;
    feedback?: string;
    createdAt: number;
    reviewedAt?: number;
}
export type FileClaimKind = 'file' | 'directory' | 'glob';
export interface FileClaim {
    id: FileClaimId;
    teamId: TeamId;
    ownerSessionId: SessionId;
    /** Durable member identity paired with ownerSessionId. Optional for legacy records. */
    ownerMemberId?: TeamMemberId;
    /** Normalized path pattern: `src/a.ts`, `src/`, `src/server/**`. */
    pattern: string;
    kind: FileClaimKind;
    purpose: string;
    createdAt: number;
}
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low';
export type FindingState = 'open' | 'resolved' | 'accepted';
export interface ReviewFinding {
    id: string;
    teamId: TeamId;
    authorSessionId: SessionId;
    taskId?: TaskId;
    severity: ReviewSeverity;
    summary: string;
    detail: string;
    /** User-facing aliases retained alongside the original summary/detail fields. */
    title?: string;
    description?: string;
    evidence?: string;
    responsibleMemberId?: TeamMemberId;
    state: FindingState;
    createdAt: number;
    resolvedAt?: number;
}
export type WorkspaceStatus = 'requested' | 'creating' | 'ready' | 'dirty' | 'clean' | 'review' | 'merged' | 'abandoned' | 'recoverable';
export interface TeamWorkspace {
    id: WorkspaceId;
    teamId: TeamId;
    memberId?: TeamMemberId;
    taskId?: TaskId;
    repositoryRoot: string;
    branch: string;
    worktreePath: string;
    status: WorkspaceStatus;
    leaseId: string;
    createdAt: number;
    updatedAt: number;
    lastHeartbeatAt: number;
}
/** Short name retained for callers that use the domain noun without Team prefix. */
export type Workspace = TeamWorkspace;
export type GitWorkspaceStatus = Exclude<WorkspaceStatus, 'requested' | 'review'>;
export interface GitWorkspace {
    id: GitWorkspaceId;
    workspaceId: WorkspaceId;
    repositoryRoot: string;
    branch: string;
    baseRef: string;
    worktreePath: string;
    head?: string;
    changedFiles: string[];
    status: GitWorkspaceStatus;
    createdAt: number;
    updatedAt: number;
}
export interface WorkspaceCommit {
    id: CommitId;
    teamId: TeamId;
    workspaceId: WorkspaceId;
    memberId: TeamMemberId;
    taskId?: TaskId;
    hash: string;
    subject: string;
    files: string[];
    createdAt: number;
}
export type ReviewRequestStatus = 'requested' | 'in_review' | 'changes_requested' | 'approved' | 'rejected';
export interface ReviewRequest {
    id: ReviewRequestId;
    teamId: TeamId;
    taskId: TaskId;
    workspaceId: WorkspaceId;
    requestedBy: SessionId;
    reviewerMemberId: TeamMemberId;
    baseRef: string;
    headRef: string;
    status: ReviewRequestStatus;
    createdAt: number;
    updatedAt: number;
}
export type ReviewVerdict = 'approved' | 'changes_requested' | 'rejected';
export interface ReviewResult {
    id: ReviewResultId;
    requestId: ReviewRequestId;
    reviewerMemberId: TeamMemberId;
    verdict: ReviewVerdict;
    evidence: string[];
    findingIds: string[];
    createdAt: number;
}
export type RuntimeEventVisibility = 'public' | 'internal';
export interface RuntimeEvent {
    id: RuntimeEventId;
    teamId: TeamId;
    sequence: number;
    name: string;
    actorSessionId?: SessionId;
    targetSessionId?: SessionId;
    visibility: RuntimeEventVisibility;
    payloadVersion: 1;
    dedupeKey?: string;
    payload: Record<string, unknown>;
    createdAt: number;
}
export interface TeamSnapshot {
    team: AgentTeam;
    members: TeamMember[];
    tasks: TeamTask[];
    messages: TeamMessage[];
    plans: TeamPlan[];
    fileClaims: FileClaim[];
    findings: ReviewFinding[];
    progress: TeamProgress;
}
export interface TeamProgress {
    requiredTotal: number;
    requiredDone: number;
    /** 0..1 */
    ratio: number;
    byStatus: Record<TaskStatus, number>;
    blocked: TaskId[];
    awaitingPlanApproval: PlanId[];
}
export interface SpawnSpec {
    provider: string;
    modelProvider?: string;
    model?: string;
    label: string;
    /** Plain text of the initial prompt (adapter converts to content blocks). */
    promptText: string;
    /** The live parent agent (the adapter resolves real identity from it). */
    parent: unknown;
    maxDepth?: number;
    toolFilter?: {
        allow?: string[];
        deny?: string[];
    };
    persona?: string;
    signal?: AbortSignal;
}
export interface SpawnResult {
    childId: SessionId;
    messageId: string;
}
/** The narrow capability surface the service needs from the harness. */
export interface TeamRuntimeAdapter {
    /** Resolve model aliases and validate a provider before durable member creation. */
    resolveAgentSpec?(input: {
        model?: string;
        modelProvider?: string;
        provider?: string;
    }): {
        requestedModel?: string;
        requestedModelProvider?: string;
        resolvedModelProvider?: string;
        resolvedModel?: string;
        requestedProvider?: string;
        resolvedProvider: string;
        alias?: string;
        availableProviders: string[];
    };
    startContinuable(spec: SpawnSpec): Promise<SpawnResult>;
    /** Deliver through the native parent authority while preserving sender attribution. */
    followup(parent: unknown, childId: SessionId, text: string, senderSessionId?: SessionId): Promise<void>;
    reportFrom(child: unknown, text: string): Promise<void>;
    /** Wake a waiting child after authoritative task state changes. */
    wakeWorker?(parent: unknown, childId: SessionId, text: string, senderSessionId?: SessionId): Promise<void>;
    interrupt(targetSessionId: SessionId, ancestor: unknown): void;
    listChildrenOf(parentSessionId: SessionId): Promise<Array<{
        sessionId: SessionId;
        label?: string;
    }>>;
}
/** Minimal observer seam so the core can publish without importing Cordis. */
export interface TeamEventSink {
    emit(name: string, payload: unknown): void;
}
export {};
