/**
 * Member status state machine - enforces valid transitions to prevent race conditions
 * @module dsh-agent-teams/core
 */
import type { MemberStatus } from './types.ts';
/**
 * Defines all valid status transitions for a team member.
 * This prevents race conditions from multiple concurrent writers.
 */
export declare const VALID_STATUS_TRANSITIONS: Record<MemberStatus, MemberStatus[]>;
/**
 * Validates whether a status transition is allowed.
 * @param from - Current status
 * @param to - Desired status
 * @returns true if transition is valid, false otherwise
 */
export declare function isValidTransition(from: MemberStatus, to: MemberStatus): boolean;
/**
 * Validates a status transition and returns the result.
 * @param from - Current status
 * @param to - Desired status
 * @returns Object with valid flag and optional error message
 */
export declare function validateTransition(from: MemberStatus, to: MemberStatus): {
    valid: boolean;
    error?: string;
};
/**
 * Applies transition rules to determine the effective status.
 * This handles edge cases like native lifecycle events that may conflict with task state.
 *
 * @param currentStatus - Member's current status
 * @param desiredStatus - Status being requested
 * @param hasActiveTask - Whether member currently owns a task
 * @returns The effective status after applying rules
 */
export declare function resolveEffectiveStatus(currentStatus: MemberStatus, desiredStatus: MemberStatus, hasActiveTask: boolean): MemberStatus;
