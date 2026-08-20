import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTeamsService } from './service.ts';
import { MemoryStore } from './store.ts';
import type { TeamRuntimeAdapter } from './types.ts';

const lead = 'lead-timer-cleanup';

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

describe('wake retry timer cleanup', () => {
  it('cleans up timers when team is paused', async () => {
    const wakeCalls: Array<{ childId: string; text: string }> = [];
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime: runtimeWithWake(wakeCalls) });
    const team = await service.createTeam({ name: 'pause cleanup', goal: 'verify timer cleanup on pause', leadSessionId: lead, workspaceId: 'ws' });
    const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: lead });
    await service.updateMember(backend.id, lead, { status: 'idle' });

    // Create task to trigger wake retry timer
    const task = await service.createTask({ teamId: team.id, title: 'cleanup test', description: 'timer should be cleaned', assignedRole: 'backend', actor: lead });

    // Verify wake was called initially
    assert.ok(wakeCalls.some((call) => call.childId === 'backend' && call.text.includes(task.id)));

    // Pause the team - this should cleanup timers
    await service.pauseTeam(team.id, lead);

    // Access private wakeRetryTimers via reflection to verify cleanup
    const timersMap = (service as any).wakeRetryTimers as Map<string, any>;
    const wakeAttemptsMap = (service as any).wakeAttempts as Map<string, number>;
    const wakeKeysSet = (service as any).wakeKeys as Set<string>;

    // All timer-related state should be cleaned up
    assert.equal(timersMap.size, 0, 'wakeRetryTimers should be empty after pause');
    assert.equal(wakeAttemptsMap.size, 0, 'wakeAttempts should be empty after pause');
    assert.equal(wakeKeysSet.size, 0, 'wakeKeys should be empty after pause');
  });

  it('cleans up timers when team is completed', async () => {
    const wakeCalls: Array<{ childId: string; text: string }> = [];
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime: runtimeWithWake(wakeCalls) });
    const team = await service.createTeam({ name: 'complete cleanup', goal: 'verify timer cleanup on complete', leadSessionId: lead, workspaceId: 'ws' });
    const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: lead });
    await service.updateMember(backend.id, lead, { status: 'idle' });

    // Create and complete required task
    const task = await service.createTask({ teamId: team.id, title: 'required task', description: 'must complete', assignedRole: 'backend', actor: lead, required: true });
    await service.claimTask(task.id, 'backend');
    await service.completeTask(task.id, 'backend', 'done');

    // Create another idle task to trigger retry timer (not required)
    const idleTask = await service.createTask({ teamId: team.id, title: 'idle task', description: 'triggers timer', assignedRole: 'backend', actor: lead, required: false });

    // Complete the team - this should cleanup timers
    await service.completeTeam(team.id, lead);

    const timersMap = (service as any).wakeRetryTimers as Map<string, any>;
    const wakeAttemptsMap = (service as any).wakeAttempts as Map<string, number>;
    const wakeKeysSet = (service as any).wakeKeys as Set<string>;

    assert.equal(timersMap.size, 0, 'wakeRetryTimers should be empty after completion');
    assert.equal(wakeAttemptsMap.size, 0, 'wakeAttempts should be empty after completion');
    assert.equal(wakeKeysSet.size, 0, 'wakeKeys should be empty after completion');
  });

  it('cleans up timers when team fails', async () => {
    const wakeCalls: Array<{ childId: string; text: string }> = [];
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime: runtimeWithWake(wakeCalls) });
    const team = await service.createTeam({ name: 'fail cleanup', goal: 'verify timer cleanup on fail', leadSessionId: lead, workspaceId: 'ws' });
    const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: lead });
    await service.updateMember(backend.id, lead, { status: 'idle' });

    const task = await service.createTask({ teamId: team.id, title: 'fail test', description: 'timer cleanup test', assignedRole: 'backend', actor: lead });

    // Fail the team - this should cleanup timers
    await service.failTeam(team.id, lead);

    const timersMap = (service as any).wakeRetryTimers as Map<string, any>;
    const wakeAttemptsMap = (service as any).wakeAttempts as Map<string, number>;
    const wakeKeysSet = (service as any).wakeKeys as Set<string>;

    assert.equal(timersMap.size, 0, 'wakeRetryTimers should be empty after failure');
    assert.equal(wakeAttemptsMap.size, 0, 'wakeAttempts should be empty after failure');
    assert.equal(wakeKeysSet.size, 0, 'wakeKeys should be empty after failure');
  });

  it('cleans up timers when member is removed', async () => {
    const wakeCalls: Array<{ childId: string; text: string }> = [];
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime: runtimeWithWake(wakeCalls) });
    const team = await service.createTeam({ name: 'member removal', goal: 'verify timer cleanup on member removal', leadSessionId: lead, workspaceId: 'ws' });
    const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: lead });
    const frontend = await service.registerMember({ teamId: team.id, sessionId: 'frontend', name: 'Frontend', role: 'frontend', actor: lead });
    await service.updateMember(backend.id, lead, { status: 'idle' });
    await service.updateMember(frontend.id, lead, { status: 'idle' });

    const task1 = await service.createTask({ teamId: team.id, title: 'backend task', description: 'backend work', assignedRole: 'backend', actor: lead });
    const task2 = await service.createTask({ teamId: team.id, title: 'frontend task', description: 'frontend work', assignedRole: 'frontend', actor: lead });

    // Remove backend member - should cleanup only backend timers
    await service.removeMember(backend.id, lead);

    const timersMap = (service as any).wakeRetryTimers as Map<string, any>;

    // Backend timers should be cleaned up
    const backendKey = `${task1.id}:backend`;
    assert.ok(!timersMap.has(backendKey), 'backend timer should be removed');

    // Frontend timers might still exist
    const frontendKey = `${task2.id}:frontend`;
    // This is acceptable - frontend member is still active
  });

  it('prevents timer leaks across multiple pause/resume cycles', async () => {
    const wakeCalls: Array<{ childId: string; text: string }> = [];
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime: runtimeWithWake(wakeCalls) });
    const team = await service.createTeam({ name: 'cycle test', goal: 'verify no leaks across cycles', leadSessionId: lead, workspaceId: 'ws' });
    const backend = await service.registerMember({ teamId: team.id, sessionId: 'backend', name: 'Backend', role: 'backend', actor: lead });
    await service.updateMember(backend.id, lead, { status: 'idle' });

    const task = await service.createTask({ teamId: team.id, title: 'cycle task', description: 'cycle test', assignedRole: 'backend', actor: lead });

    const timersMap = (service as any).wakeRetryTimers as Map<string, any>;

    // Pause - cleanup
    await service.pauseTeam(team.id, lead);
    assert.equal(timersMap.size, 0, 'timers cleaned after first pause');

    // Resume
    await service.resumeTeam(team.id, lead);

    // Pause again
    await service.pauseTeam(team.id, lead);
    assert.equal(timersMap.size, 0, 'timers cleaned after second pause');

    // Resume again
    await service.resumeTeam(team.id, lead);

    // Final pause
    await service.pauseTeam(team.id, lead);
    assert.equal(timersMap.size, 0, 'timers cleaned after third pause');
  });
});
