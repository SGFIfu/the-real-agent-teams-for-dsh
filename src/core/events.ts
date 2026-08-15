/**
 * Typed Agent Teams event names. The harness glue re-emits these through
 * Cordis `ctx.emit`, so other plugins can subscribe with full typing.
 * @module dsh-agent-teams/core
 */
export const TEAM_CREATED = 'agent-teams/team-created';
export const TEAM_COMPLETED = 'agent-teams/team-completed';
export const TEAM_FAILED = 'agent-teams/team-failed';

export const MEMBER_JOINED = 'agent-teams/member-joined';
export const MEMBER_LEFT = 'agent-teams/member-left';
export const MEMBER_STATUS = 'agent-teams/member-status';

export const TASK_CREATED = 'agent-teams/task-created';
export const TASK_CLAIMED = 'agent-teams/task-claimed';
export const TASK_COMPLETED = 'agent-teams/task-completed';
export const TASK_FAILED = 'agent-teams/task-failed';
export const TASK_RELEASED = 'agent-teams/task-released';
export const TASK_BLOCKED = 'agent-teams/task-blocked';

export const MESSAGE_SENT = 'agent-teams/message-sent';
export const MESSAGE_DELIVERY_FAILED = 'agent-teams/message-delivery-failed';

export const PLAN_SUBMITTED = 'agent-teams/plan-submitted';
export const PLAN_APPROVED = 'agent-teams/plan-approved';
export const PLAN_REJECTED = 'agent-teams/plan-rejected';

export const FILE_CLAIMED = 'agent-teams/file-claimed';
export const FILE_RELEASED = 'agent-teams/file-released';
export const FILE_CONFLICT = 'agent-teams/file-conflict';

export const FINDING_ADDED = 'agent-teams/finding-added';
export const FINDING_RESOLVED = 'agent-teams/finding-resolved';

/** All event names, for listener discovery. */
export const ALL_EVENTS = [
  TEAM_CREATED,
  TEAM_COMPLETED,
  TEAM_FAILED,
  MEMBER_JOINED,
  MEMBER_LEFT,
  MEMBER_STATUS,
  TASK_CREATED,
  TASK_CLAIMED,
  TASK_COMPLETED,
  TASK_FAILED,
  TASK_RELEASED,
  TASK_BLOCKED,
  MESSAGE_SENT,
  MESSAGE_DELIVERY_FAILED,
  PLAN_SUBMITTED,
  PLAN_APPROVED,
  PLAN_REJECTED,
  FILE_CLAIMED,
  FILE_RELEASED,
  FILE_CONFLICT,
  FINDING_ADDED,
  FINDING_RESOLVED,
] as const;
