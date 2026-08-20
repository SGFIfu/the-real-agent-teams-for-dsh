import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTeamsService } from './service.ts';
import { MemoryStore } from './store.ts';
import type { TeamRuntimeAdapter } from './types.ts';

describe('durable message delivery', () => {
  it('queues a pending-session delivery and retries it after the child is ready', async () => {
    let ready = false;
    let attempts = 0;
    const runtime: TeamRuntimeAdapter = {
      startContinuable: async () => ({ childId: 'child', messageId: 'message' }),
      followup: async () => {
        attempts += 1;
        if (!ready) throw new Error('session pending');
      },
      reportFrom: async () => {},
      interrupt: () => {},
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

  it('marks messages as failed when they exceed max delivery attempts', async () => {
    let attempts = 0;
    const runtime: TeamRuntimeAdapter = {
      startContinuable: async () => ({ childId: 'child', messageId: 'message' }),
      followup: async () => {
        attempts += 1;
        throw new Error('session unreachable');
      },
      reportFrom: async () => {},
      interrupt: () => {},
      listChildrenOf: async () => [],
    };
    const store = new MemoryStore();
    const service = new AgentTeamsService({ store, runtime });
    const team = await service.createTeam({ name: 'retry-limit', goal: 'test max attempts', leadSessionId: 'lead', workspaceId: 'ws' });
    await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: 'lead' });

    const message = await service.sendMessage({ teamId: team.id, fromSessionId: 'lead', toSessionId: 'backend', body: 'important' });
    assert.equal(message.deliveryState, 'queued');

    // Retry until max attempts reached (5 attempts total: 1 initial + 4 retries)
    for (let i = 0; i < 5; i++) {
      await service.retryPendingMessages(team.id, 'backend');
    }

    const messages = await store.list('messages', (m) => m.teamId === team.id);
    const failed = messages[0];
    assert.equal(failed?.deliveryState, 'failed');
    assert.equal(failed?.deliveryTargets?.backend?.state, 'failed');
    assert.ok(failed?.deliveryError?.includes('retry limit exceeded'));
    assert.equal(attempts, 5); // 1 initial + 4 retries before the 5th attempt detects the limit
  });

  it('marks expired messages as failed based on TTL', async () => {
    const runtime: TeamRuntimeAdapter = {
      startContinuable: async () => ({ childId: 'child', messageId: 'message' }),
      followup: async () => {
        throw new Error('session pending');
      },
      reportFrom: async () => {},
      interrupt: () => {},
      listChildrenOf: async () => [],
    };
    const store = new MemoryStore();
    const service = new AgentTeamsService({ store, runtime });
    const team = await service.createTeam({ name: 'ttl-test', goal: 'test message TTL', leadSessionId: 'lead', workspaceId: 'ws' });
    await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: 'lead' });

    const message = await service.sendMessage({ teamId: team.id, fromSessionId: 'lead', toSessionId: 'backend', body: 'time-sensitive' });
    assert.equal(message.deliveryState, 'queued');

    // Simulate message aging by modifying createdAt to be 16 minutes old (exceeds 15 min TTL)
    await store.update('messages', message.id, (current) => ({
      ...current,
      createdAt: Date.now() - 16 * 60 * 1000,
    }));

    const retried = (await service.retryPendingMessages(team.id, 'backend'))[0];
    assert.equal(retried?.deliveryState, 'failed');
    assert.equal(retried?.deliveryTargets?.backend?.state, 'failed');
    assert.ok(retried?.deliveryError?.includes('expired'));
  });

  it('continues retrying messages within TTL that have not exceeded max attempts', async () => {
    let attempts = 0;
    let shouldFail = true;
    const runtime: TeamRuntimeAdapter = {
      startContinuable: async () => ({ childId: 'child', messageId: 'message' }),
      followup: async () => {
        attempts += 1;
        if (shouldFail) throw new Error('temporary failure');
      },
      reportFrom: async () => {},
      interrupt: () => {},
      listChildrenOf: async () => [],
    };
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime });
    const team = await service.createTeam({ name: 'retry-success', goal: 'eventual delivery', leadSessionId: 'lead', workspaceId: 'ws' });
    await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: 'lead' });

    const message = await service.sendMessage({ teamId: team.id, fromSessionId: 'lead', toSessionId: 'backend', body: 'retry me' });
    assert.equal(message.deliveryState, 'queued');

    // Retry 3 times while still failing
    await service.retryPendingMessages(team.id, 'backend');
    await service.retryPendingMessages(team.id, 'backend');
    await service.retryPendingMessages(team.id, 'backend');

    // Now allow delivery to succeed
    shouldFail = false;
    const delivered = (await service.retryPendingMessages(team.id, 'backend'))[0];

    assert.equal(delivered?.deliveryState, 'delivered');
    assert.equal(delivered?.deliveryTargets?.backend?.state, 'delivered');
    assert.equal(delivered?.deliveryTargets?.backend?.attempts, 5); // 1 initial + 4 retries
    assert.equal(attempts, 5);
  });
});
