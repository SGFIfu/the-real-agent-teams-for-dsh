import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTeamsService } from './service.ts';
import { MemoryStore } from './store.ts';
import type { TeamRuntimeAdapter } from './types.ts';
import { TeamError } from './errors.ts';

const lead = 'lead-reliability';

function runtimeWithWake(calls: Array<{ childId: string; text: string }>): TeamRuntimeAdapter {
  return {
    startContinuable: async () => ({ childId: 'child', messageId: 'message' }),
    followup: async (_parent, childId, text) => { calls.push({ childId, text }); },
    reportFrom: async () => {},
    wakeWorker: async (_parent, childId, text) => { calls.push({ childId, text }); },
    interrupt: () => {},
    listChildrenOf: async () => [],
  };
}

describe('runtime reliability invariants', () => {
  it('refreshes dependency readiness and wakes only the assigned role', async () => {
    const wakeCalls: Array<{ childId: string; text: string }> = [];
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime: runtimeWithWake(wakeCalls) });
    const team = await service.createTeam({ name: 'reliability', goal: 'wake workers', leadSessionId: lead, workspaceId: 'ws' });
    const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: lead });
    const frontend = await service.registerMember({ teamId: team.id, sessionId: 'frontend', name: 'Frontend', role: 'frontend', actor: lead });
    const first = await service.createTask({ teamId: team.id, title: 'API', description: 'build API', assignedMemberId: backend.id, actor: lead });
    const second = await service.createTask({ teamId: team.id, title: 'UI', description: 'build UI', assignedRole: 'frontend', dependencies: [first.id], actor: lead });

    await service.claimTask(first.id, 'backend');
    await service.completeTask(first.id, 'backend', 'API ready');

    const snapshot = await service.getSnapshot(team.id, lead);
    const ready = snapshot.tasks.find((task) => task.id === second.id);
    assert.equal(ready?.availability, 'ready');
    assert.equal(ready?.status, 'pending');
    assert.ok(wakeCalls.some((call) => call.childId === frontend.sessionId && call.text.includes(second.id)));
    assert.equal((await service.claimNextTask(team.id, 'frontend')).claimed, true);
    assert.equal((await service.claimNextTask(team.id, 'backend')).claimed, false);
  });

  it('does not allow a stopped member or a member with an active task to claim another task', async () => {
    const service = new AgentTeamsService({ store: new MemoryStore() });
    const team = await service.createTeam({ name: 'eligibility', goal: 'guard claims', leadSessionId: lead, workspaceId: 'ws' });
    const member = await service.registerMember({ teamId: team.id, sessionId: 'worker', name: 'Worker', role: 'backend', actor: lead });
    const first = await service.createTask({ teamId: team.id, title: 'one', description: 'one', actor: lead });
    const second = await service.createTask({ teamId: team.id, title: 'two', description: 'two', actor: lead });
    await service.claimTask(first.id, member.sessionId);
    await assert.rejects(() => service.claimTask(second.id, member.sessionId), (error: unknown) => (error as TeamError).code === 'TASK_NOT_ELIGIBLE');
    await service.updateMember(member.id, lead, { status: 'stopped' });
    await assert.rejects(() => service.claimTask(second.id, member.sessionId), (error: unknown) => (error as TeamError).code === 'TASK_NOT_ELIGIBLE');
  });

  it('releases owned work when the native worker fails', async () => {
    const service = new AgentTeamsService({ store: new MemoryStore() });
    const team = await service.createTeam({ name: 'recovery', goal: 'recover work', leadSessionId: lead, workspaceId: 'ws' });
    const member = await service.registerMember({ teamId: team.id, sessionId: 'worker', name: 'Worker', role: 'backend', actor: lead });
    const task = await service.createTask({ teamId: team.id, title: 'recover me', description: 'recover', actor: lead });
    await service.claimTask(task.id, member.sessionId);
    await service.updateMemberFromRuntime(member.id, { status: 'failed' });
    const recovered = await service.getTask(task.id, lead);
    assert.equal(recovered.status, 'pending');
    assert.equal(recovered.ownerSessionId, undefined);
    await assert.rejects(() => service.claimTask(task.id, 'worker'), (error: unknown) => (error as TeamError).code === 'TASK_NOT_ELIGIBLE');
    const replacement = await service.registerMember({ teamId: team.id, sessionId: 'replacement', name: 'Replacement', role: 'backend', actor: lead });
    assert.equal((await service.claimTask(task.id, replacement.sessionId)).status, 'in_progress');
  });
});
