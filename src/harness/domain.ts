/**
 * The durable `agent_teams` storage domain: identity, version, and the zod
 * record schemas validated at the durable boundary by the harness.
 * @module dsh-agent-teams/harness
 */
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import {
  domainSchema,
} from '../core/schemas.ts';

export const agentTeamsDomain = defineDomain({
  name: 'agent_teams',
  version: 1,
  tables: {
    teams: domainTable(domainSchema.teams),
    members: domainTable(domainSchema.members),
    tasks: domainTable(domainSchema.tasks),
    messages: domainTable(domainSchema.messages),
    plans: domainTable(domainSchema.plans),
    file_claims: domainTable(domainSchema.file_claims),
    findings: domainTable(domainSchema.findings),
    workspaces: domainTable(domainSchema.workspaces),
    git_workspaces: domainTable(domainSchema.git_workspaces),
    commits: domainTable(domainSchema.commits),
    review_requests: domainTable(domainSchema.review_requests),
    review_results: domainTable(domainSchema.review_results),
    runtime_events: domainTable(domainSchema.runtime_events),
  },
});
