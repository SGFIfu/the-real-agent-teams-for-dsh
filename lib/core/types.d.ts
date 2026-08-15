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
export interface TeamMember {
    id: TeamMemberId;
    teamId: TeamId;
    /** The REAL harness agent/session id. Never a fabricated second identity. */
    sessionId: SessionId;
    name: string;
    role: string;
    status: MemberStatus;
    currentTaskId?: TaskId;
    provider?: string;
    model?: string;
    capabilities?: string[];
    joinedAt: number;
    lastActiveAt: number;
}
export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
export interface TeamTask {
    id: TaskId;
    teamId: TeamId;
    title: string;
    description: string;
    status: TaskStatus;
    priority: TaskPriority;
    /** Harness session id of the owner, set atomically by claim. */
    ownerSessionId?: SessionId;
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
    deliveryState?: 'pending' | 'delivered' | 'failed';
    deliveryTransport?: 'native-followup' | 'native-report' | 'durable-inbox';
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
    startContinuable(spec: SpawnSpec): Promise<SpawnResult>;
    /** Deliver through the native parent authority while preserving sender attribution. */
    followup(parent: unknown, childId: SessionId, text: string, senderSessionId?: SessionId): Promise<void>;
    reportFrom(child: unknown, text: string): Promise<void>;
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
