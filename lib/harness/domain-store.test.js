import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DomainStore } from "./domain-store.js";
import { createRuntimeEventLog } from "../core/runtime-events.js";
import { MemoryDomain } from '@deepseek-ai/dsh-storage-domain';
const TEAM_A = 'team-a';
describe('DomainStore atomic runtime event append', () => {
    it('provides atomic append with cross-process safety', async () => {
        // Create a domain with in-memory backend
        const domain = MemoryDomain.open({
            domain: 'agent_teams',
            tables: {
                teams: {},
                members: {},
                tasks: {},
                messages: {},
                plans: {},
                file_claims: {},
                findings: {},
                workspaces: {},
                git_workspaces: {},
                commits: {},
                review_requests: {},
                review_results: {},
                runtime_events: {},
            },
        });
        const store = new DomainStore(domain);
        const log = createRuntimeEventLog(store);
        // DomainStore should report atomic capabilities
        assert.equal(log.capabilities.atomicAppend, true);
        assert.equal(log.capabilities.crossProcessSafe, true);
        assert.equal(log.capabilities.limitation, undefined);
        // Concurrent appends should produce unique, sequential sequences
        const events = await Promise.all(Array.from({ length: 20 }, (_, index) => log.append({ teamId: TEAM_A, name: 'concurrent_event', dedupeKey: `event-${index}` })));
        // All sequences should be unique
        const sequences = events.map((e) => e.sequence);
        assert.equal(new Set(sequences).size, 20);
        // Sequences should be contiguous 1..20
        assert.deepEqual(sequences.sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
    });
    it('counter records do not appear in event listings', async () => {
        const domain = MemoryDomain.open({
            domain: 'agent_teams',
            tables: {
                teams: {},
                members: {},
                tasks: {},
                messages: {},
                plans: {},
                file_claims: {},
                findings: {},
                workspaces: {},
                git_workspaces: {},
                commits: {},
                review_requests: {},
                review_results: {},
                runtime_events: {},
            },
        });
        const store = new DomainStore(domain);
        const log = createRuntimeEventLog(store);
        await log.append({ teamId: TEAM_A, name: 'event_one' });
        await log.append({ teamId: TEAM_A, name: 'event_two' });
        // Read should only return actual events, not counter records
        const page = await log.read(TEAM_A, { visibility: 'all' });
        assert.equal(page.events.length, 2);
        assert.deepEqual(page.events.map((e) => e.name), ['event_one', 'event_two']);
        // Verify no counter IDs appear
        assert.ok(page.events.every((e) => !e.id.startsWith('__runtime_events_counter__:')));
    });
});
