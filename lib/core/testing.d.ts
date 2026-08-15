/**
 * Test helpers: no-model harness-free construction of the service.
 * @module dsh-agent-teams/core/testing
 */
import { AgentTeamsService } from './service.ts';
import { MemoryStore } from './store.ts';
import type { SessionId } from './types.ts';
export declare function makeStore(): MemoryStore;
export declare function makeService(store?: MemoryStore, options?: {
    maxActiveMembers?: number;
}): AgentTeamsService;
export declare const S: {
    lead: SessionId;
    architect: SessionId;
    backend: SessionId;
    frontend: SessionId;
    tester: SessionId;
    reviewer: SessionId;
    debugger: SessionId;
    outsider: SessionId;
};
export interface Fixture {
    store: MemoryStore;
    service: AgentTeamsService;
    teamId: string;
}
export declare function makeFixture(memberRoles: Array<{
    name: string;
    role: string;
    sessionId: SessionId;
}>): Promise<Fixture>;
/** Dump every table into a plain object (used for restart-persistence tests). */
export declare function dumpStore(store: MemoryStore): Promise<Record<string, Record<string, unknown>>>;
