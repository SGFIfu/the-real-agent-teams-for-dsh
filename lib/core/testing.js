/**
 * Test helpers: no-model harness-free construction of the service.
 * @module dsh-agent-teams/core/testing
 */
import { AgentTeamsService } from "./service.js";
import { MemoryStore } from "./store.js";
export function makeStore() {
    return new MemoryStore();
}
export function makeService(store, options) {
    return new AgentTeamsService({ store: store ?? makeStore(), maxActiveMembers: options?.maxActiveMembers });
}
export const S = {
    lead: 'sess-lead',
    architect: 'sess-architect',
    backend: 'sess-backend',
    frontend: 'sess-frontend',
    tester: 'sess-tester',
    reviewer: 'sess-reviewer',
    debugger: 'sess-debugger',
    outsider: 'sess-outsider',
};
export async function makeFixture(memberRoles) {
    const store = makeStore();
    const service = makeService(store);
    const team = await service.createTeam({ name: 'test-team', goal: 'ship the feature', leadSessionId: S.lead, workspaceId: 'ws-1' });
    for (const member of memberRoles) {
        await service.registerMember({ teamId: team.id, sessionId: member.sessionId, name: member.name, role: member.role, actor: S.lead });
    }
    return { store, service, teamId: team.id };
}
/** Dump every table into a plain object (used for restart-persistence tests). */
export async function dumpStore(store) {
    const dump = {};
    for (const table of ['teams', 'members', 'tasks', 'messages', 'plans', 'file_claims', 'findings']) {
        const records = await store.list(table);
        dump[table] = Object.fromEntries(records.map((r) => [r.id, r]));
    }
    return dump;
}
