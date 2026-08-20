/**
 * Member status state machine - enforces valid transitions to prevent race conditions
 * @module dsh-agent-teams/core
 */

import type { MemberStatus } from './types.ts';

/**
 * Defines all valid status transitions for a team member.
 * This prevents race conditions from multiple concurrent writers.
 */
export const VALID_STATUS_TRANSITIONS: Record<MemberStatus, MemberStatus[]> = {
  // Starting state can transition to idle or fail immediately
  starting: ['idle', 'failed', 'stopped'],

  // Idle members can start working, reviewing, be stopped, or fail
  idle: ['working', 'reviewing', 'stopped', 'failed'],

  // Working members can finish (idle), get blocked, start reviewing, or terminate
  working: ['idle', 'blocked', 'reviewing', 'stopped', 'failed'],

  // Blocked members can resume work, give up (idle), or terminate
  blocked: ['working', 'idle', 'stopped', 'failed'],

  // Reviewing members can finish (idle), get blocked, keep working, or terminate
  reviewing: ['idle', 'working', 'blocked', 'stopped', 'failed'],

  // Terminal states - no transitions allowed
  stopped: [],
  failed: [],
};

/**
 * Validates whether a status transition is allowed.
 * @param from - Current status
 * @param to - Desired status
 * @returns true if transition is valid, false otherwise
 */
export function isValidTransition(from: MemberStatus, to: MemberStatus): boolean {
  // Allow no-op transitions (same status)
  if (from === to) return true;

  // Check if transition is in the allowed list
  const allowedTransitions = VALID_STATUS_TRANSITIONS[from];
  return allowedTransitions.includes(to);
}

/**
 * Validates a status transition and returns the result.
 * @param from - Current status
 * @param to - Desired status
 * @returns Object with valid flag and optional error message
 */
export function validateTransition(from: MemberStatus, to: MemberStatus): {
  valid: boolean;
  error?: string;
} {
  if (from === to) {
    return { valid: true };
  }

  const allowed = VALID_STATUS_TRANSITIONS[from];

  if (allowed.length === 0) {
    return {
      valid: false,
      error: `Cannot transition from terminal state '${from}'`,
    };
  }

  if (!allowed.includes(to)) {
    return {
      valid: false,
      error: `Invalid transition from '${from}' to '${to}'. Allowed: ${allowed.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Applies transition rules to determine the effective status.
 * This handles edge cases like native lifecycle events that may conflict with task state.
 *
 * @param currentStatus - Member's current status
 * @param desiredStatus - Status being requested
 * @param hasActiveTask - Whether member currently owns a task
 * @returns The effective status after applying rules
 */
export function resolveEffectiveStatus(
  currentStatus: MemberStatus,
  desiredStatus: MemberStatus,
  hasActiveTask: boolean,
): MemberStatus {
  // If transition is invalid, keep current status
  if (!isValidTransition(currentStatus, desiredStatus)) {
    console.warn(
      `[state-machine] Rejected invalid transition: ${currentStatus} -> ${desiredStatus}`,
    );
    return currentStatus;
  }

  // Special rule: Don't allow idle if member has active task
  // (Prevents race between task claim and native 'idle' event)
  if (desiredStatus === 'idle' && hasActiveTask && (currentStatus === 'working' || currentStatus === 'blocked' || currentStatus === 'reviewing')) {
    console.warn(
      `[state-machine] Rejected idle transition while task is active (current: ${currentStatus})`,
    );
    return currentStatus;
  }

  // Allow transition
  return desiredStatus;
}
