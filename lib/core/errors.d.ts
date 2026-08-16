/**
 * Typed error model. Every failure path returns one of these codes — never a
 * bare `Error('something went wrong')`.
 * @module dsh-agent-teams/core
 */
export type TeamErrorCode = 'TEAM_NOT_FOUND' | 'TEAM_NOT_ACTIVE' | 'MEMBER_NOT_FOUND' | 'TASK_NOT_FOUND' | 'TASK_ALREADY_CLAIMED' | 'TASK_REOPEN_NOT_ALLOWED' | 'TASK_NOT_OWNED_BY_CALLER' | 'TASK_DEPENDENCIES_UNRESOLVED' | 'DEPENDENCY_CYCLE' | 'DEPENDENCY_SELF_REFERENCE' | 'UNAUTHORIZED_TEAM_ACCESS' | 'FILE_CLAIM_CONFLICT' | 'FILE_CLAIM_NOT_FOUND' | 'PLAN_REQUIRED' | 'PLAN_NOT_APPROVED' | 'PLAN_NOT_FOUND' | 'TEAM_NOT_COMPLETABLE' | 'SUBAGENT_UNAVAILABLE' | 'SUBAGENT_CAPABILITY_UNSUPPORTED' | 'STORAGE_UNAVAILABLE' | 'MESSAGE_NOT_FOUND' | 'INVALID_INPUT' | 'WEB_CALLER_UNAUTHORIZED' | 'WEB_CALLER_FORBIDDEN' | 'WEB_ORIGIN_FORBIDDEN' | 'CROSS_TEAM_TARGET' | 'SESSION_NOT_IN_TEAM' | 'UNSAFE_RESOURCE_ID' | 'MEMBER_ALREADY_IN_TEAM' | 'REVIEW_FINDINGS_OPEN';
export interface TeamErrorPayload {
    code: TeamErrorCode;
    message: string;
    details?: Record<string, unknown>;
}
export declare class TeamError extends Error {
    readonly code: TeamErrorCode;
    readonly details?: Record<string, unknown>;
    constructor(code: TeamErrorCode, message: string, details?: Record<string, unknown>);
    toJSON(): TeamErrorPayload;
}
export declare function teamError(code: TeamErrorCode, message: string, details?: Record<string, unknown>): TeamError;
/** True when the unknown value is one of our typed errors. */
export declare function isTeamError(value: unknown): value is TeamError;
