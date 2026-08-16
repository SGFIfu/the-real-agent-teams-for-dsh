import type { TeamMemberId, TaskId, TeamId, WorkspaceId, WorkspaceCommit } from '../core/types.ts';
export type GitWorkspaceErrorCode = 'WORKSPACE_PATH_ESCAPE' | 'WORKTREE_CREATE_FAILED' | 'WORKTREE_DIRTY' | 'BRANCH_ALREADY_EXISTS' | 'COMMIT_NOT_RECORDED' | 'INVALID_INPUT';
export declare class GitWorkspaceError extends Error {
    readonly code: GitWorkspaceErrorCode;
    readonly details?: Record<string, unknown>;
    constructor(code: GitWorkspaceErrorCode, message: string, details?: Record<string, unknown>);
    toJSON(): {
        code: GitWorkspaceErrorCode;
        message: string;
        details?: Record<string, unknown>;
    };
}
export interface GitCommandResult {
    stdout: string;
    stderr: string;
}
/** Test seam only; production always uses execFile with shell disabled. */
export type GitCommandRunner = (cwd: string, args: readonly string[]) => Promise<GitCommandResult>;
export interface GitWorkspaceAdapterOptions {
    allowedRoots: string[];
    runGit?: GitCommandRunner;
}
export interface GitWorkspaceAdapter {
    createBranch(input: {
        repositoryRoot: string;
        baseRef: string;
        branch: string;
    }): Promise<{
        head?: string;
    }>;
    addWorktree(input: {
        repositoryRoot: string;
        branch: string;
        worktreePath: string;
    }): Promise<void>;
    status(input: {
        repositoryRoot: string;
        worktreePath: string;
    }): Promise<{
        clean: boolean;
        head?: string;
        changedFiles: string[];
    }>;
    recordCommit(input: {
        repositoryRoot: string;
        worktreePath: string;
        teamId: TeamId;
        workspaceId: WorkspaceId;
        memberId: TeamMemberId;
        taskId?: TaskId;
    }): Promise<WorkspaceCommit>;
    removeWorktree(input: {
        repositoryRoot: string;
        worktreePath: string;
    }): Promise<void>;
}
export declare class NativeGitWorkspaceAdapter implements GitWorkspaceAdapter {
    private readonly roots;
    private readonly run;
    constructor(options: GitWorkspaceAdapterOptions);
    private assertLexicallyAllowed;
    private safePath;
    private existingDirectory;
    private repository;
    private worktree;
    private git;
    createBranch(input: {
        repositoryRoot: string;
        baseRef: string;
        branch: string;
    }): Promise<{
        head?: string;
    }>;
    addWorktree(input: {
        repositoryRoot: string;
        branch: string;
        worktreePath: string;
    }): Promise<void>;
    status(input: {
        repositoryRoot: string;
        worktreePath: string;
    }): Promise<{
        clean: boolean;
        head?: string;
        changedFiles: string[];
    }>;
    recordCommit(input: {
        repositoryRoot: string;
        worktreePath: string;
        teamId: TeamId;
        workspaceId: WorkspaceId;
        memberId: TeamMemberId;
        taskId?: TaskId;
    }): Promise<WorkspaceCommit>;
    removeWorktree(input: {
        repositoryRoot: string;
        worktreePath: string;
    }): Promise<void>;
}
