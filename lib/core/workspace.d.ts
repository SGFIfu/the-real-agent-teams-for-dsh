/**
 * Workspace and file-lease coordination primitives.
 *
 * This module deliberately sits below the service and the Harness adapter. It
 * owns the durable workspace/file-claim invariants, but it does not know how a
 * session is spawned, how HTTP requests are authenticated, or how Git is
 * executed. The adapter layer supplies those capabilities through narrow
 * interfaces.
 */
import type { TeamStore } from './store.ts';
import type { FileClaim, FileClaimKind, SessionId, TeamWorkspace, TaskId, TeamId, TeamMemberId, WorkspaceId } from './types.ts';
import { TeamError } from './errors.ts';
export type WorkspaceErrorCode = 'TEAM_NOT_FOUND' | 'MEMBER_NOT_FOUND' | 'TASK_NOT_FOUND' | 'UNAUTHORIZED_TEAM_ACCESS' | 'WORKSPACE_NOT_FOUND' | 'WORKSPACE_OWNERSHIP_CONFLICT' | 'WORKSPACE_PATH_ESCAPE' | 'FILE_CLAIM_CONFLICT' | 'FILE_CLAIM_NOT_FOUND' | 'INVALID_INPUT';
/** A typed error that shares the Service/tool error serialization contract. */
export declare class WorkspaceError extends TeamError {
    constructor(code: WorkspaceErrorCode, message: string, details?: Record<string, unknown>);
}
export interface WorkspaceActor {
    teamId: TeamId | string;
    sessionId: SessionId;
    memberId?: TeamMemberId | string;
}
export interface WorkspaceManagerOptions {
    store: TeamStore;
    /** Roots approved by the host. If omitted, the repository root is the root. */
    allowedRoots?: string[];
    /** Time after which a heartbeat is considered stale. */
    leaseTimeoutMs?: number;
    now?: () => number;
}
export interface CreateWorkspaceInput {
    teamId: TeamId | string;
    memberId?: TeamMemberId | string;
    taskId?: TaskId | string;
    sessionId: SessionId;
    repositoryRoot: string;
    branch: string;
    worktreePath: string;
    leaseId?: string;
}
export interface WorkspaceClaimPattern {
    pattern: string;
    kind?: FileClaimKind;
}
export interface ClaimWorkspaceFilesInput {
    teamId: TeamId | string;
    workspaceId?: WorkspaceId | string;
    actor: WorkspaceActor;
    patterns: Array<string | WorkspaceClaimPattern>;
    purpose: string;
}
export interface HandoffFileInput {
    teamId: TeamId | string;
    claimId: string;
    fromSessionId: SessionId;
    toSessionId: SessionId;
    toMemberId?: TeamMemberId | string;
    purpose?: string;
}
/** Normalize an absolute host path without consulting the filesystem. */
export declare function normalizeHostPath(value: string, field?: string): string;
declare function isWithinRoot(root: string, candidate: string): boolean;
declare function normalizePattern(value: string): {
    pattern: string;
    kind: FileClaimKind;
};
declare function patternsConflict(a: {
    pattern: string;
    kind: FileClaimKind;
}, b: {
    pattern: string;
    kind: FileClaimKind;
}): boolean;
export declare class WorkspaceManager {
    private readonly options;
    private readonly allowedRoots?;
    private readonly leaseTimeoutMs;
    private readonly mutexes;
    constructor(options: WorkspaceManagerOptions);
    private mutex;
    private assertTeam;
    private assertActor;
    private normalizeAllowedRoots;
    private assertAllowedPath;
    private assertWorkspaceActor;
    private workspace;
    create(input: CreateWorkspaceInput): Promise<TeamWorkspace>;
    get(workspaceId: string, actor: WorkspaceActor): Promise<TeamWorkspace>;
    list(teamId: TeamId | string, actor: WorkspaceActor): Promise<TeamWorkspace[]>;
    setStatus(workspaceId: string, actor: WorkspaceActor, status: TeamWorkspace['status']): Promise<TeamWorkspace>;
    heartbeat(workspaceId: string, actor: WorkspaceActor): Promise<TeamWorkspace>;
    releaseWorkspace(workspaceId: string, actor: WorkspaceActor): Promise<TeamWorkspace>;
    handoffWorkspace(workspaceId: string, actor: WorkspaceActor, target: {
        sessionId: SessionId;
        memberId: TeamMemberId | string;
    }): Promise<TeamWorkspace>;
    recoverStale(teamId?: TeamId | string): Promise<TeamWorkspace[]>;
    claimFiles(input: ClaimWorkspaceFilesInput): Promise<FileClaim[]>;
    releaseFiles(teamId: TeamId | string, claimIds: string[], actor: WorkspaceActor): Promise<FileClaim[]>;
    handoffFile(input: HandoffFileInput): Promise<FileClaim>;
}
export declare const workspaceInternals: {
    normalizePattern: typeof normalizePattern;
    patternsConflict: typeof patternsConflict;
    isWithinRoot: typeof isWithinRoot;
};
export {};
