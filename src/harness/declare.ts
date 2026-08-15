/**
 * Declaration merging: the typed surface this package contributes to the
 * harness — `ctx.agentTeams` and the `agent-teams/*` event family.
 * @module dsh-agent-teams/harness
 */
import type { AgentTeamsService } from '../core/service.ts';
import type {
  AgentTeam,
  FileClaim,
  ReviewFinding,
  TeamMember,
  TeamMessage,
  TeamPlan,
  TeamTask,
} from '../core/types.ts';

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentTeams: AgentTeamsService;
  }

  interface Events {
    'agent-teams/team-created'(payload: { team: AgentTeam }): void;
    'agent-teams/team-completed'(payload: { team: AgentTeam }): void;
    'agent-teams/team-failed'(payload: { team: AgentTeam }): void;

    'agent-teams/member-joined'(payload: { member: TeamMember }): void;
    'agent-teams/member-left'(payload: { member: TeamMember }): void;
    'agent-teams/member-status'(payload: { member: TeamMember }): void;

    'agent-teams/task-created'(payload: { task: TeamTask }): void;
    'agent-teams/task-claimed'(payload: { task: TeamTask; ownerSessionId: string }): void;
    'agent-teams/task-completed'(payload: { task: TeamTask }): void;
    'agent-teams/task-failed'(payload: { task: TeamTask }): void;
    'agent-teams/task-released'(payload: { task: TeamTask; reason?: string }): void;
    'agent-teams/task-blocked'(payload: { task: TeamTask; reason?: string }): void;

    'agent-teams/message-sent'(payload: { message: TeamMessage }): void;
    'agent-teams/message-delivery-failed'(payload: { message: TeamMessage; error: string }): void;

    'agent-teams/plan-submitted'(payload: { plan: TeamPlan }): void;
    'agent-teams/plan-approved'(payload: { plan: TeamPlan }): void;
    'agent-teams/plan-rejected'(payload: { plan: TeamPlan }): void;

    'agent-teams/file-claimed'(payload: { claim: FileClaim }): void;
    'agent-teams/file-released'(payload: { claim: FileClaim }): void;
    'agent-teams/file-conflict'(payload: { teamId: string; pattern: string; attemptedBy: string; ownerSessionId: string; conflictingClaim: string }): void;

    'agent-teams/finding-added'(payload: { finding: ReviewFinding }): void;
    'agent-teams/finding-resolved'(payload: { finding: ReviewFinding }): void;
  }
}
