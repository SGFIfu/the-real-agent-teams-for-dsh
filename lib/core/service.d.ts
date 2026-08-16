/**
 * The Agent Teams coordination service: ALL business logic lives here.
 * Tools are a thin model-facing shell over this class; the harness plugin row
 * owns one instance per process.
 * @module dsh-agent-teams/core
 */
import type { TeamStore } from './store.ts';
import type { AgentTeam, FileClaim, ReviewFinding, ReviewSeverity, SessionId, TeamMember, TeamMessage, TeamMessageType, TeamPlan, TeamSnapshot, TeamTask, TaskPriority } from './types.ts';
import type { TeamEventSink, TeamRuntimeAdapter } from './types.ts';
import type { ReviewDomain } from './review.ts';
import type { RuntimeEventLog } from './runtime-events.ts';
import type { CreateFindingInput, CreateReviewRequestInput, ReviewSubmission } from './review.ts';
import type { CreateWorkspaceInput, WorkspaceManager } from './workspace.ts';
export interface ServiceDeps {
    store: TeamStore;
    /** Optional harness runtime adapter; absent in no-model tests/simulation. */
    runtime?: TeamRuntimeAdapter;
    /** Optional event sink (the harness ctx.emit bridge). */
    sink?: TeamEventSink;
    /** Default subagent provider for spawned teammates. */
    defaultProvider?: string;
    /** Cap on simultaneously registered members per team. */
    maxActiveMembers?: number;
    /** Optional v2 review/QA domain; absent in legacy/no-model fixtures. */
    review?: ReviewDomain;
    /** Optional durable audit projection; live sink remains the UI notification path. */
    runtimeEvents?: RuntimeEventLog;
    /** Optional workspace/lease authority used by the production Harness instance. */
    workspace?: WorkspaceManager;
}
export declare class AgentTeamsService {
    readonly store: TeamStore;
    readonly runtime?: TeamRuntimeAdapter;
    readonly sink?: TeamEventSink;
    readonly defaultProvider: string;
    readonly maxActiveMembers: number;
    readonly review?: ReviewDomain;
    readonly runtimeEvents?: RuntimeEventLog;
    readonly workspace?: WorkspaceManager;
    private readyFlag;
    /** Serializes multi-record invariants within one plugin process. */
    private readonly teamMutationQueues;
    /** Coalesces duplicate wake-ups while a worker is being nudged. */
    private readonly wakeKeys;
    constructor(deps: ServiceDeps);
    /** Resolve a team or fail with the typed error. */
    private team;
    private emit;
    private appendRuntimeEvent;
    private assertActor;
    private assertActive;
    private requireLead;
    private withTeamMutation;
    ready(): Promise<void>;
    private requireWorkspaceManager;
    private workspaceActor;
    createWorkspace(input: Omit<CreateWorkspaceInput, 'sessionId'>, actor: SessionId): Promise<Awaited<ReturnType<WorkspaceManager['create']>>>;
    listWorkspaces(teamId: string, actor: SessionId): Promise<Awaited<ReturnType<WorkspaceManager['list']>>>;
    getWorkspace(workspaceId: string, teamId: string, actor: SessionId): Promise<Awaited<ReturnType<WorkspaceManager['get']>>>;
    heartbeatWorkspace(workspaceId: string, teamId: string, actor: SessionId): Promise<Awaited<ReturnType<WorkspaceManager['heartbeat']>>>;
    releaseWorkspace(workspaceId: string, teamId: string, actor: SessionId): Promise<Awaited<ReturnType<WorkspaceManager['releaseWorkspace']>>>;
    handoffWorkspace(workspaceId: string, teamId: string, actor: SessionId, target: {
        sessionId: SessionId;
        memberId: string;
    }): Promise<Awaited<ReturnType<WorkspaceManager['handoffWorkspace']>>>;
    createTeam(input: {
        name: string;
        goal: string;
        leadSessionId: SessionId;
        workspaceId: string;
    }): Promise<AgentTeam>;
    getTeam(teamId: string): Promise<AgentTeam>;
    getTeamForActor(teamId: string, actor: SessionId): Promise<AgentTeam>;
    listTeams(actorSessionId?: SessionId): Promise<AgentTeam[]>;
    pauseTeam(teamId: string, actor: SessionId): Promise<AgentTeam>;
    resumeTeam(teamId: string, actor: SessionId): Promise<AgentTeam>;
    failTeam(teamId: string, actor: SessionId): Promise<AgentTeam>;
    private setTeamStatus;
    /**
     * Completion guard: the lead may only complete a team when every gate
     * holds. Violations produce `TEAM_NOT_COMPLETABLE` with the reasons.
     */
    completeTeam(teamId: string, actor: SessionId): Promise<AgentTeam>;
    registerMember(input: {
        teamId: string;
        sessionId: SessionId;
        name: string;
        role: string;
        provider?: string;
        modelProvider?: string;
        model?: string;
        capabilities?: string[];
        actor: SessionId;
    }): Promise<TeamMember>;
    /** Bind the real Harness child identity after native spawn succeeds. */
    bindMemberSession(memberId: string, childSessionId: SessionId, actor: SessionId): Promise<TeamMember>;
    markMemberSpawnFailed(memberId: string, actor: SessionId): Promise<TeamMember>;
    getMember(memberId: string): Promise<TeamMember>;
    memberBySession(teamId: string, sessionId: SessionId): Promise<TeamMember | undefined>;
    listMembers(teamId: string, actor: SessionId): Promise<TeamMember[]>;
    updateMember(memberId: string, actor: SessionId, patch: Partial<Pick<TeamMember, 'status' | 'currentTaskId' | 'provider' | 'model' | 'capabilities'>>): Promise<TeamMember>;
    touchMember(teamId: string, sessionId: SessionId): Promise<void>;
    /** Sync the member's current-task metadata after a claim/finish. */
    private syncMemberTask;
    /** Native lifecycle bridge update; authorization is supplied by the host event source. */
    updateMemberFromRuntime(memberId: string, patch: Partial<Pick<TeamMember, 'status' | 'currentTaskId'>>): Promise<TeamMember>;
    auditCapability(input: {
        teamId: string;
        sessionId: SessionId;
        capability: string;
        allowed: boolean;
        command?: string;
        workspace?: string;
    }): Promise<void>;
    removeMember(memberId: string, actor: SessionId): Promise<void>;
    assignTask(taskId: string, memberId: string, actor: SessionId): Promise<TeamTask>;
    createTask(input: {
        teamId: string;
        title: string;
        description: string;
        priority?: TaskPriority;
        dependencies?: string[];
        requiresPlan?: boolean;
        required?: boolean;
        assignedMemberId?: string;
        assignedRole?: string;
        requiredCapabilities?: string[];
        workspaceId?: string;
        actor: SessionId;
    }): Promise<TeamTask>;
    createTasks(batch: Array<Omit<Parameters<AgentTeamsService['createTask']>[0], 'actor' | 'teamId'> & {
        teamId?: string;
    }>, actor: SessionId, teamId?: string): Promise<TeamTask[]>;
    private requireTask;
    getTask(taskId: string, actor: SessionId): Promise<TeamTask>;
    listTasks(teamId: string, actor: SessionId): Promise<TeamTask[]>;
    private tasksOf;
    /** True when every dependency of the task is completed. */
    private dependenciesSatisfied;
    private memberCanClaim;
    private requireCapability;
    private refreshReadyTasks;
    private wakeEligibleWorkers;
    /** Cycle detection over the task graph of one team (DFS with colors). */
    addDependency(teamId: string, taskId: string, dependencyId: string, actor: SessionId): Promise<TeamTask>;
    claimTask(taskId: string, actor: SessionId): Promise<TeamTask>;
    /**
     * Atomic self-scheduling claim: scan candidates, atomically claim the
     * first one that is still free. Under concurrent callers, losers simply
     * advance to the next candidate — exactly one owner per task.
     */
    claimNextTask(teamId: string, actor: SessionId): Promise<{
        claimed: false;
        reason: string;
    } | {
        claimed: true;
        task: TeamTask;
    }>;
    completeTask(taskId: string, actor: SessionId, result?: string): Promise<TeamTask>;
    /** Complete a worker task and immediately self-schedule the next task. */
    completeTaskAndSchedule(taskId: string, actor: SessionId, result?: string): Promise<{
        completed: TeamTask;
        next: {
            claimed: false;
            reason: string;
        } | {
            claimed: true;
            task: TeamTask;
        };
    }>;
    failTask(taskId: string, actor: SessionId, result?: string): Promise<TeamTask>;
    private finishTask;
    /** Owner or lead releases a task back to pending (or out of a blocked state). */
    releaseTask(taskId: string, actor: SessionId, reason?: string): Promise<TeamTask>;
    reassignTask(taskId: string, actor: SessionId, toSessionId: SessionId): Promise<TeamTask>;
    setTaskBlocked(taskId: string, actor: SessionId, reason?: string): Promise<TeamTask>;
    private deliverMessageTarget;
    private aggregateDelivery;
    private tryMessageDelivery;
    sendMessage(input: {
        teamId: string;
        fromSessionId: SessionId;
        toSessionId?: SessionId;
        type?: TeamMessageType;
        body: string;
    }): Promise<TeamMessage>;
    retryPendingMessages(teamId: string, targetSessionId?: SessionId): Promise<TeamMessage[]>;
    private leadHandleFor;
    private memberHandleFor;
    broadcastMessage(input: {
        teamId: string;
        fromSessionId: SessionId;
        type?: TeamMessageType;
        body: string;
    }): Promise<TeamMessage>;
    getInbox(teamId: string, sessionId: SessionId): Promise<TeamMessage[]>;
    listMessages(teamId: string, actor: SessionId, limit?: number): Promise<TeamMessage[]>;
    submitPlan(input: {
        teamId: string;
        taskId: string;
        authorSessionId: SessionId;
        body: string;
    }): Promise<TeamPlan>;
    approvePlan(planId: string, actor: SessionId, feedback?: string): Promise<TeamPlan>;
    rejectPlan(planId: string, actor: SessionId, feedback: string): Promise<TeamPlan>;
    private requirePlan;
    listPlans(teamId: string, actor: SessionId): Promise<TeamPlan[]>;
    private requireReviewDomain;
    createReviewRequest(input: Omit<CreateReviewRequestInput, 'requestedBy'> & {
        requestedBy?: never;
    }, actor: SessionId): Promise<import('./types.ts').ReviewRequest>;
    startReview(requestId: string, actor: SessionId): Promise<import('./types.ts').ReviewRequest>;
    submitReviewResult(input: Omit<Parameters<ReviewDomain['submitResult']>[0], 'reviewerSessionId'>, actor: SessionId): Promise<ReviewSubmission>;
    createReviewFinding(input: Omit<CreateFindingInput, 'authorSessionId'>, actor: SessionId): Promise<ReviewFinding>;
    resolveReviewFinding(findingId: string, resolutionEvidence: string, actor: SessionId): Promise<ReviewFinding>;
    evaluateReviewGate(input: {
        teamId: string;
        taskId: string;
        workspaceId: string;
    }, actor: SessionId): Promise<import('./review.ts').ReviewGate>;
    private normalizePattern;
    /**
     * File ownership is the coordination boundary immediately before an agent
     * edits a worktree. A requiresPlan task may inspect and submit a plan, but
     * it must not acquire implementation files until a Lead approval exists.
     */
    private assertImplementationReady;
    /** Conservative overlap test: same exact pattern, or one is a prefix scope of the other. */
    private patternsConflict;
    claimFiles(input: {
        teamId: string;
        ownerSessionId: SessionId;
        workspaceId?: string;
        patterns: string[];
        purpose: string;
    }): Promise<FileClaim[]>;
    releaseFiles(claimIds: string[], actor: SessionId): Promise<void>;
    listFileClaims(teamId: string, actor: SessionId): Promise<FileClaim[]>;
    handoffFile(input: {
        teamId: string;
        claimId: string;
        toSessionId: SessionId;
        toMemberId?: string;
        purpose?: string;
    }, actor: SessionId): Promise<FileClaim>;
    addFinding(input: {
        teamId: string;
        authorSessionId: SessionId;
        taskId?: string;
        severity: ReviewSeverity;
        summary: string;
        detail: string;
        title?: string;
        description?: string;
        evidence?: string;
        responsibleSessionId?: SessionId;
    }): Promise<ReviewFinding>;
    resolveFinding(findingId: string, actor: SessionId): Promise<ReviewFinding>;
    acceptFinding(findingId: string, actor: SessionId): Promise<ReviewFinding>;
    private finishFinding;
    private requireFinding;
    private requireFindingTeam;
    listFindings(teamId: string, actor: SessionId): Promise<ReviewFinding[]>;
    getSnapshot(teamId: string, actor: SessionId): Promise<TeamSnapshot>;
    /**
     * Read-only snapshot WITHOUT actor authorization: reserved for the
     * loopback-bound web panel route (`/agent-teams/...`). Never call from
     * model-facing tools — they use {@link getSnapshot} with real identity.
     */
    publicSnapshot(teamId: string): Promise<TeamSnapshot>;
}
