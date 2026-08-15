/**
 * Typed Agent Teams event names. The harness glue re-emits these through
 * Cordis `ctx.emit`, so other plugins can subscribe with full typing.
 * @module dsh-agent-teams/core
 */
export declare const TEAM_CREATED = "agent-teams/team-created";
export declare const TEAM_COMPLETED = "agent-teams/team-completed";
export declare const TEAM_FAILED = "agent-teams/team-failed";
export declare const MEMBER_JOINED = "agent-teams/member-joined";
export declare const MEMBER_LEFT = "agent-teams/member-left";
export declare const MEMBER_STATUS = "agent-teams/member-status";
export declare const TASK_CREATED = "agent-teams/task-created";
export declare const TASK_CLAIMED = "agent-teams/task-claimed";
export declare const TASK_COMPLETED = "agent-teams/task-completed";
export declare const TASK_FAILED = "agent-teams/task-failed";
export declare const TASK_RELEASED = "agent-teams/task-released";
export declare const TASK_BLOCKED = "agent-teams/task-blocked";
export declare const MESSAGE_SENT = "agent-teams/message-sent";
export declare const MESSAGE_DELIVERY_FAILED = "agent-teams/message-delivery-failed";
export declare const PLAN_SUBMITTED = "agent-teams/plan-submitted";
export declare const PLAN_APPROVED = "agent-teams/plan-approved";
export declare const PLAN_REJECTED = "agent-teams/plan-rejected";
export declare const FILE_CLAIMED = "agent-teams/file-claimed";
export declare const FILE_RELEASED = "agent-teams/file-released";
export declare const FILE_CONFLICT = "agent-teams/file-conflict";
export declare const FINDING_ADDED = "agent-teams/finding-added";
export declare const FINDING_RESOLVED = "agent-teams/finding-resolved";
/** All event names, for listener discovery. */
export declare const ALL_EVENTS: readonly ["agent-teams/team-created", "agent-teams/team-completed", "agent-teams/team-failed", "agent-teams/member-joined", "agent-teams/member-left", "agent-teams/member-status", "agent-teams/task-created", "agent-teams/task-claimed", "agent-teams/task-completed", "agent-teams/task-failed", "agent-teams/task-released", "agent-teams/task-blocked", "agent-teams/message-sent", "agent-teams/message-delivery-failed", "agent-teams/plan-submitted", "agent-teams/plan-approved", "agent-teams/plan-rejected", "agent-teams/file-claimed", "agent-teams/file-released", "agent-teams/file-conflict", "agent-teams/finding-added", "agent-teams/finding-resolved"];
