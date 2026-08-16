import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { agentTeamsDomain } from "../harness/domain.js";
import { domainSchema, findingSchema, messageSchema } from "./schemas.js";
import { MemoryStore } from "./store.js";
const newTables = [
    'workspaces',
    'git_workspaces',
    'commits',
    'review_requests',
    'review_results',
    'runtime_events',
];
describe('shared domain contracts', () => {
    it('registers every durable table in both schema maps and the harness domain', () => {
        const expected = [
            'teams',
            'members',
            'tasks',
            'messages',
            'plans',
            'file_claims',
            'findings',
            ...newTables,
        ].sort();
        assert.deepEqual(Object.keys(domainSchema).sort(), expected);
        assert.deepEqual(Object.keys(agentTeamsDomain.tables).sort(), expected);
    });
    it('initializes all new MemoryStore tables and supports typed records', async () => {
        const store = new MemoryStore();
        for (const table of newTables)
            assert.deepEqual(await store.list(table), [], `${table} starts empty`);
        await store.put('runtime_events', 'event-1', {
            id: 'event-1',
            teamId: 'team-1',
            sequence: 1,
            name: 'workspace_ready',
            visibility: 'public',
            payloadVersion: 1,
            payload: { workspaceId: 'workspace-1' },
            createdAt: 100,
        });
        assert.equal((await store.get('runtime_events', 'event-1'))?.name, 'workspace_ready');
    });
    it('accepts a complete record for each new contract schema', () => {
        const records = {
            workspaces: {
                id: 'workspace-1',
                teamId: 'team-1',
                repositoryRoot: 'C:/repo',
                branch: 'agent/one',
                worktreePath: 'C:/worktrees/one',
                status: 'ready',
                leaseId: 'lease-1',
                createdAt: 100,
                updatedAt: 110,
                lastHeartbeatAt: 110,
            },
            git_workspaces: {
                id: 'git-workspace-1',
                workspaceId: 'workspace-1',
                repositoryRoot: 'C:/repo',
                branch: 'agent/one',
                baseRef: 'main',
                worktreePath: 'C:/worktrees/one',
                changedFiles: ['src/core/types.ts'],
                status: 'dirty',
                createdAt: 100,
                updatedAt: 110,
            },
            commits: {
                id: 'commit-1',
                teamId: 'team-1',
                workspaceId: 'workspace-1',
                memberId: 'member-1',
                hash: 'abc123',
                subject: 'expand contracts',
                files: ['src/core/types.ts'],
                createdAt: 120,
            },
            review_requests: {
                id: 'request-1',
                teamId: 'team-1',
                taskId: 'task-1',
                workspaceId: 'workspace-1',
                requestedBy: 'session-1',
                reviewerMemberId: 'member-2',
                baseRef: 'main',
                headRef: 'agent/one',
                status: 'requested',
                createdAt: 130,
                updatedAt: 130,
            },
            review_results: {
                id: 'result-1',
                requestId: 'request-1',
                reviewerMemberId: 'member-2',
                verdict: 'approved',
                evidence: ['tests passed'],
                findingIds: [],
                createdAt: 140,
            },
            runtime_events: {
                id: 'event-1',
                teamId: 'team-1',
                sequence: 1,
                name: 'workspace_ready',
                actorSessionId: 'session-1',
                visibility: 'public',
                payloadVersion: 1,
                payload: { workspaceId: 'workspace-1' },
                createdAt: 150,
            },
        };
        for (const table of newTables)
            domainSchema[table].parse(records[table]);
    });
    it('keeps legacy records valid when optional fields are absent', () => {
        assert.deepEqual(messageSchema.parse({
            id: 'message-1',
            teamId: 'team-1',
            fromSessionId: 'session-1',
            type: 'message',
            body: 'legacy',
            createdAt: 100,
        }), {
            id: 'message-1',
            teamId: 'team-1',
            fromSessionId: 'session-1',
            type: 'message',
            body: 'legacy',
            createdAt: 100,
        });
        assert.deepEqual(findingSchema.parse({
            id: 'finding-1',
            teamId: 'team-1',
            authorSessionId: 'session-1',
            severity: 'low',
            summary: 'legacy',
            detail: 'legacy detail',
            state: 'open',
            createdAt: 100,
        }).title, undefined);
    });
});
