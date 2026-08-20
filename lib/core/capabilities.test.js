import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTeamsService } from "./service.js";
import { MemoryStore } from "./store.js";
const lead = 'capability-lead';
describe('host tool capability policy', () => {
    it('allows an owned write and denies an unclaimed path', async () => {
        const events = [];
        const service = new AgentTeamsService({
            store: new MemoryStore(),
            sink: { emit: (_name, payload) => events.push(payload) },
        });
        const team = await service.createTeam({ name: 'caps', goal: 'bounded writes', leadSessionId: lead, workspaceId: 'ws' });
        const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: lead });
        await service.claimFiles({ teamId: team.id, ownerSessionId: backend.sessionId, patterns: ['repo/server.js'], purpose: 'implementation' });
        const allowed = await service.authorizeToolCapability({ sessionId: backend.sessionId, toolName: 'write', arguments: { path: 'repo/server.js', content: 'ok' } });
        assert.equal(allowed.allowed, true);
        assert.equal(allowed.capability, 'repo.write.owned');
        const denied = await service.authorizeToolCapability({ sessionId: backend.sessionId, toolName: 'write', arguments: { path: 'repo/other.js', content: 'no' } });
        assert.equal(denied.allowed, false);
        assert.match(denied.reason ?? '', /not covered by a claim/);
        assert.ok(events.length >= 2, 'both capability decisions are auditable events');
    });
    it('lets a reviewer run approved verification but denies repository mutation', async () => {
        const service = new AgentTeamsService({ store: new MemoryStore() });
        const team = await service.createTeam({ name: 'review-caps', goal: 'review', leadSessionId: lead, workspaceId: 'ws' });
        const reviewer = await service.registerMember({ teamId: team.id, sessionId: 'reviewer', name: 'Reviewer', role: 'reviewer', actor: lead });
        const test = await service.authorizeToolCapability({ sessionId: reviewer.sessionId, toolName: 'pwsh', arguments: { command: 'npm test' } });
        assert.equal(test.allowed, true);
        assert.equal(test.capability, 'process.test');
        const write = await service.authorizeToolCapability({ sessionId: reviewer.sessionId, toolName: 'write', arguments: { path: 'repo/server.js', content: 'mutation' } });
        assert.equal(write.allowed, false);
        assert.match(write.reason ?? '', /repo\.write\.owned/);
    });
    it('rejects shell file mutation and protected git actions even for implementers', async () => {
        const service = new AgentTeamsService({ store: new MemoryStore() });
        const team = await service.createTeam({ name: 'shell-caps', goal: 'guard shell', leadSessionId: lead, workspaceId: 'ws' });
        const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend-shell', name: 'Backend', role: 'backend', actor: lead });
        const shellWrite = await service.authorizeToolCapability({ sessionId: backend.sessionId, toolName: 'pwsh', arguments: { command: 'Set-Content repo/server.js x' } });
        assert.equal(shellWrite.allowed, false);
        assert.match(shellWrite.reason ?? '', /protected action denied/);
        const merge = await service.authorizeToolCapability({ sessionId: backend.sessionId, toolName: 'pwsh', arguments: { command: 'git merge main' } });
        assert.equal(merge.allowed, false);
        assert.match(merge.reason ?? '', /protected action denied/);
        const status = await service.authorizeToolCapability({ sessionId: backend.sessionId, toolName: 'pwsh', arguments: { command: 'git status --short' } });
        assert.equal(status.allowed, true);
        assert.equal(status.capability, 'git.read');
        const arbitrary = await service.authorizeToolCapability({ sessionId: backend.sessionId, toolName: 'pwsh', arguments: { command: 'python download-and-run.py' } });
        assert.equal(arbitrary.allowed, false);
        assert.match(arbitrary.reason ?? '', /protected action denied/);
    });
});
