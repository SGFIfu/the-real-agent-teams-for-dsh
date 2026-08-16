import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTeamsService } from "./service.js";
import { MemoryStore } from "./store.js";
describe('durable message delivery', () => {
    it('queues a pending-session delivery and retries it after the child is ready', async () => {
        let ready = false;
        let attempts = 0;
        const runtime = {
            startContinuable: async () => ({ childId: 'child', messageId: 'message' }),
            followup: async () => {
                attempts += 1;
                if (!ready)
                    throw new Error('session pending');
            },
            reportFrom: async () => { },
            interrupt: () => { },
            listChildrenOf: async () => [],
        };
        const service = new AgentTeamsService({ store: new MemoryStore(), runtime });
        const team = await service.createTeam({ name: 'messages', goal: 'deliver reliably', leadSessionId: 'lead', workspaceId: 'ws' });
        await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: 'lead' });
        const queued = await service.sendMessage({ teamId: team.id, fromSessionId: 'lead', toSessionId: 'backend', body: 'wake up' });
        assert.equal(queued.deliveryState, 'queued');
        assert.equal(queued.deliveryTargets?.backend?.state, 'queued');
        ready = true;
        const delivered = (await service.retryPendingMessages(team.id, 'backend'))[0];
        assert.equal(delivered?.deliveryState, 'delivered');
        assert.equal(delivered?.deliveryTargets?.backend?.state, 'delivered');
        assert.equal(delivered?.deliveryTargets?.backend?.attempts, 2);
        assert.equal(attempts, 2);
    });
});
