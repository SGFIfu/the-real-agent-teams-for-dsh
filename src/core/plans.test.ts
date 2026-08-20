/**
 * Plan approval tests: submission gates, blocking, approval, rejection, and
 * the completion guard's plan requirement.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, S } from './testing.ts';
import { TeamError } from './errors.ts';

describe('plans', () => {
  it('submit → approve unblocks the task', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'migration', description: 'risky', requiresPlan: true, actor: S.lead });
    await service.claimTask(task.id, S.backend);
    const plan = await service.submitPlan({ teamId, taskId: task.id, authorSessionId: S.backend, body: 'phase 1 … phase 2 …' });
    assert.equal(plan.status, 'submitted');
    const blocked = await service.getTask(task.id, S.lead);
    assert.equal(blocked.status, 'blocked', 'task halts while the plan is pending');
    const blockedMember = (await service.listMembers(teamId, S.lead)).find((member) => member.sessionId === S.backend);
    assert.equal(blockedMember?.status, 'blocked');
    assert.equal(blockedMember?.currentTaskId, task.id);
    const approved = await service.approvePlan(plan.id, S.lead);
    assert.equal(approved.status, 'approved');
    const released = await service.getTask(task.id, S.lead);
    assert.equal(released.status, 'pending');
    const idleMember = (await service.listMembers(teamId, S.lead)).find((member) => member.sessionId === S.backend);
    assert.equal(idleMember?.status, 'idle');
    assert.equal(idleMember?.currentTaskId, undefined);
    const claimed = await service.claimTask(task.id, S.backend);
    assert.equal(claimed.id, task.id);
  });

  it('reject releases the task with feedback', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'migration', description: 'risky', requiresPlan: true, actor: S.lead });
    await service.claimTask(task.id, S.backend);
    const plan = await service.submitPlan({ teamId, taskId: task.id, authorSessionId: S.backend, body: 'vague' });
    const rejected = await service.rejectPlan(plan.id, S.lead, 'needs a rollback strategy');
    assert.equal(rejected.status, 'rejected');
    assert.match(rejected.feedback ?? '', /rollback/);
    const taskNow = await service.getTask(task.id, S.lead);
    assert.equal(taskNow.status, 'pending');
  });

  it('submitting a plan for a non-requiresPlan task is rejected', async () => {
    const { service, teamId } = await makeFixture([]);
    const task = await service.createTask({ teamId, title: 'plain', description: 'no plan needed', actor: S.lead });
    await assert.rejects(() => service.submitPlan({ teamId, taskId: task.id, authorSessionId: S.lead, body: 'x' }), (error: unknown) => {
      assert.equal((error as TeamError).code, 'PLAN_REQUIRED');
      return true;
    });
  });

  it('non-lead cannot approve', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'm', description: 'd', requiresPlan: true, actor: S.lead });
    await service.claimTask(task.id, S.backend);
    const plan = await service.submitPlan({ teamId, taskId: task.id, authorSessionId: S.backend, body: 'plan' });
    await assert.rejects(() => service.approvePlan(plan.id, S.backend), (error: unknown) => {
      assert.equal((error as TeamError).code, 'UNAUTHORIZED_TEAM_ACCESS');
      return true;
    });
  });

  it('completion guard requires an approved plan for requiresPlan tasks', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'm', description: 'd', requiresPlan: true, actor: S.lead });
    await service.claimTask(task.id, S.backend);
    // Work started without any plan: the guard must refuse (both incomplete
    // and unplanned apply), even while the task is still in progress.
    await assert.rejects(() => service.completeTeam(teamId, S.lead), (error: unknown) => {
      assert.equal((error as TeamError).code, 'TEAM_NOT_COMPLETABLE');
      assert.match(JSON.stringify((error as TeamError).details ?? {}), /approved plan/);
      return true;
    });
    // Recovery path: release → plan → approve → implement → complete.
    await service.releaseTask(task.id, S.backend, 'reopen for plan');
    const plan = await service.submitPlan({ teamId, taskId: task.id, authorSessionId: S.lead, body: 'proper plan' });
    await service.approvePlan(plan.id, S.lead);
    await service.claimTask(task.id, S.backend);
    await service.completeTask(task.id, S.backend, 'done with plan');
    const completed = await service.completeTeam(teamId, S.lead);
    assert.equal(completed.status, 'completed');
  });

  it('hard completion guard rejects implementation before plan approval', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'guarded', description: 'd', requiresPlan: true, actor: S.lead });
    await service.claimTask(task.id, S.backend);
    await assert.rejects(() => service.completeTask(task.id, S.backend, 'premature'), (error: unknown) => {
      assert.equal((error as TeamError).code, 'PLAN_NOT_APPROVED');
      return true;
    });
  });

  it('hard implementation guard rejects file ownership before plan approval', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'guarded files', description: 'd', requiresPlan: true, actor: S.lead });
    await service.claimTask(task.id, S.backend);
    await assert.rejects(() => service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['backend/**'], purpose: 'implementation' }), (error: unknown) => {
      assert.equal((error as TeamError).code, 'PLAN_NOT_APPROVED');
      assert.match((error as TeamError).message, /before implementation/);
      return true;
    });
  });

  it('plan approval is atomic: task and member state update together', async () => {
    const { service, teamId } = await makeFixture([{ name: 'worker', role: 'backend', sessionId: S.backend }]);
    const task = await service.createTask({
      teamId,
      title: 'atomic test',
      description: 'verify atomicity of approval',
      requiresPlan: true,
      actor: S.lead,
    });

    // Claim task and submit plan
    await service.claimTask(task.id, S.backend);
    const plan = await service.submitPlan({
      teamId,
      taskId: task.id,
      authorSessionId: S.backend,
      body: 'test plan',
    });

    // Before approval: task is blocked, member is blocked
    const blockedTask = await service.getTask(task.id, S.lead);
    const blockedMember = (await service.listMembers(teamId, S.lead)).find((m) => m.sessionId === S.backend);
    assert.equal(blockedTask.status, 'blocked');
    assert.equal(blockedTask.ownerSessionId, S.backend);
    assert.equal(blockedMember?.status, 'blocked');
    assert.equal(blockedMember?.currentTaskId, task.id);

    // Approve the plan
    await service.approvePlan(plan.id, S.lead);

    // After approval: task is released (pending, no owner), member is idle
    const releasedTask = await service.getTask(task.id, S.lead);
    const idleMember = (await service.listMembers(teamId, S.lead)).find((m) => m.sessionId === S.backend);
    assert.equal(releasedTask.status, 'pending');
    assert.equal(releasedTask.ownerSessionId, undefined, 'task owner should be cleared');
    assert.equal(idleMember?.status, 'idle', 'member should be idle');
    assert.equal(idleMember?.currentTaskId, undefined, 'member should have no current task');
  });

  it('plan rejection is atomic: task and member state update together', async () => {
    const { service, teamId } = await makeFixture([{ name: 'worker', role: 'backend', sessionId: S.backend }]);
    const task = await service.createTask({
      teamId,
      title: 'atomic reject test',
      description: 'verify atomicity of rejection',
      requiresPlan: true,
      actor: S.lead,
    });

    await service.claimTask(task.id, S.backend);
    const plan = await service.submitPlan({
      teamId,
      taskId: task.id,
      authorSessionId: S.backend,
      body: 'incomplete plan',
    });

    // Reject the plan
    await service.rejectPlan(plan.id, S.lead, 'needs more detail');

    // After rejection: task is released, member is idle
    const releasedTask = await service.getTask(task.id, S.lead);
    const idleMember = (await service.listMembers(teamId, S.lead)).find((m) => m.sessionId === S.backend);
    assert.equal(releasedTask.status, 'pending');
    assert.equal(releasedTask.ownerSessionId, undefined, 'task owner should be cleared');
    assert.equal(idleMember?.status, 'idle', 'member should be idle');
    assert.equal(idleMember?.currentTaskId, undefined, 'member should have no current task');
  });
});
