/**
 * Test helpers: no-model harness-free construction of the service.
 * @module dsh-agent-teams/core/testing
 */
import { AgentTeamsService } from './service.ts';
import { MemoryStore } from './store.ts';
import type { SessionId } from './types.ts';

export function makeStore(): MemoryStore {
  return new MemoryStore();
}

export function makeService(store?: MemoryStore, options?: { maxActiveMembers?: number }): AgentTeamsService {
  return new AgentTeamsService({ store: store ?? makeStore(), maxActiveMembers: options?.maxActiveMembers });
}

export const S = {
  lead: 'sess-lead' as SessionId,
  architect: 'sess-architect' as SessionId,
  backend: 'sess-backend' as SessionId,
  frontend: 'sess-frontend' as SessionId,
  tester: 'sess-tester' as SessionId,
  reviewer: 'sess-reviewer' as SessionId,
  debugger: 'sess-debugger' as SessionId,
  outsider: 'sess-outsider' as SessionId,
};

export interface Fixture {
  store: MemoryStore;
  service: AgentTeamsService;
  teamId: string;
}

export async function makeFixture(memberRoles: Array<{ name: string; role: string; sessionId: SessionId }>): Promise<Fixture> {
  const store = makeStore();
  const service = makeService(store);
  const team = await service.createTeam({ name: 'test-team', goal: 'ship the feature', leadSessionId: S.lead, workspaceId: 'ws-1' });
  for (const member of memberRoles) {
    await service.registerMember({ teamId: team.id, sessionId: member.sessionId, name: member.name, role: member.role, actor: S.lead });
  }
  return { store, service, teamId: team.id };
}

/** Dump every table into a plain object (used for restart-persistence tests). */
export async function dumpStore(store: MemoryStore): Promise<Record<string, Record<string, unknown>>> {
  const dump: Record<string, Record<string, unknown>> = {};
  for (const table of [
    'teams',
    'members',
    'tasks',
    'messages',
    'plans',
    'file_claims',
    'findings',
    'workspaces',
    'git_workspaces',
    'commits',
    'review_requests',
    'review_results',
    'runtime_events',
  ] as const) {
    const records = await store.list(table);
    dump[table] = Object.fromEntries(records.map((r) => [r.id, r]));
  }
  return dump;
}
