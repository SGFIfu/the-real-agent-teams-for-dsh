/**
 * Task lifecycle tests: creation, listing, claiming, completion, release,
 * reassignment, blocking.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, makeService, S } from './testing.ts';
import { TeamError } from './errors.ts';

describe('task lifecycle', () => {
  it('creates and lists tasks', async () => {
    const { service, teamId } = await makeFixture([]);
    const task = await service.createTask({ teamId, title: 'setup', description: 'scaffold', actor: S.lead });
    assert.equal(task.status, 'pending');
    assert.equal(task.required, true);
    assert.equal(task.requiresPlan, false);
    const listed = await service.listTasks(teamId, S.lead);
    assert.equal(listed.length, 1);
  });

  it('claims, completes, and records results', async () => {
    const { service, teamId } = await makeFixture([{ name: 'backend', role: 'backend', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'api', description: 'endpoints', actor: S.lead });
    const claimed = await service.claimTask(task.id, S.backend);
    assert.equal(claimed.ownerSessionId, S.backend);
    assert.equal(claimed.status, 'in_progress');
    const completed = await service.completeTask(task.id, S.backend, 'done: 3 endpoints');
    assert.equal(completed.status, 'completed');
    assert.match(completed.result ?? '', /3 endpoints/);
  });

  it('completes and self-claims the next task without changing session identity', async () => {
    const { service, teamId } = await makeFixture([{ name: 'backend', role: 'backend', sessionId: S.backend }]);
    const first = await service.createTask({ teamId, title: 'task-a', description: 'first', actor: S.lead });
    const second = await service.createTask({ teamId, title: 'task-b', description: 'second', actor: S.lead });
    await service.claimTask(first.id, S.backend);
    const result = await service.completeTaskAndSchedule(first.id, S.backend, 'A done');
    assert.equal(result.completed.status, 'completed');
    assert.equal(result.next.claimed, true);
    if (result.next.claimed) assert.equal(result.next.task.id, second.id);
    const member = await service.memberBySession(teamId, S.backend);
    assert.equal(member?.sessionId, S.backend);
    assert.equal(member?.currentTaskId, second.id);
  });

  it('rejects a second claim of the same task', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'a', role: 'a', sessionId: S.backend },
      { name: 'b', role: 'b', sessionId: S.frontend },
    ]);
    const task = await service.createTask({ teamId, title: 'x', description: 'y', actor: S.lead });
    await service.claimTask(task.id, S.backend);
    await assert.rejects(() => service.claimTask(task.id, S.frontend), (error: unknown) => {
      assert.ok(error instanceof TeamError);
      assert.equal((error as TeamError).code, 'TASK_ALREADY_CLAIMED');
      return true;
    });
  });

  it('rejects completion by a non-owner', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'a', role: 'a', sessionId: S.backend },
      { name: 'b', role: 'b', sessionId: S.frontend },
    ]);
    const task = await service.createTask({ teamId, title: 'x', description: 'y', actor: S.lead });
    await service.claimTask(task.id, S.backend);
    await assert.rejects(() => service.completeTask(task.id, S.frontend, 'sneaky'), (error: unknown) => {
      assert.equal((error as TeamError).code, 'TASK_NOT_OWNED_BY_CALLER');
      return true;
    });
  });

  it('releases an owned task back to pending', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'x', description: 'y', actor: S.lead });
    await service.claimTask(task.id, S.backend);
    const released = await service.releaseTask(task.id, S.backend, 'changed my mind');
    assert.equal(released.status, 'pending');
    assert.equal(released.ownerSessionId, undefined);
  });

  it('lead can reassign an in-flight task', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'a', role: 'a', sessionId: S.backend },
      { name: 'b', role: 'b', sessionId: S.frontend },
    ]);
    const task = await service.createTask({ teamId, title: 'x', description: 'y', actor: S.lead });
    await service.claimTask(task.id, S.backend);
    const moved = await service.reassignTask(task.id, S.lead, S.frontend);
    assert.equal(moved.ownerSessionId, S.frontend);
    assert.equal(moved.status, 'in_progress');
  });

  it('does not reopen a completed dependency behind active downstream work', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'a', role: 'a', sessionId: S.backend },
      { name: 'b', role: 'b', sessionId: S.frontend },
    ]);
    const prerequisite = await service.createTask({ teamId, title: 'prerequisite', description: 'done first', actor: S.lead });
    const downstream = await service.createTask({ teamId, title: 'downstream', description: 'depends on prerequisite', dependencies: [prerequisite.id], actor: S.lead });
    await service.claimTask(prerequisite.id, S.backend);
    await service.completeTask(prerequisite.id, S.backend, 'done');
    await service.claimTask(downstream.id, S.frontend);
    await assert.rejects(() => service.reassignTask(prerequisite.id, S.lead, S.frontend), (error: unknown) => {
      assert.ok(error instanceof TeamError);
      assert.equal(error.code, 'TASK_REOPEN_NOT_ALLOWED');
      return true;
    });
  });

  it('blocks and keeps ownership until release', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'x', description: 'y', actor: S.lead });
    await service.claimTask(task.id, S.backend);
    const blocked = await service.setTaskBlocked(task.id, S.backend, 'waiting on infra');
    assert.equal(blocked.status, 'blocked');
    const released = await service.releaseTask(task.id, S.backend, 'infra ready');
    assert.equal(released.status, 'pending');
  });

  it('does not let a native idle event erase an owned task status', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    const task = await service.createTask({ teamId, title: 'runtime state', description: 'd', actor: S.lead });
    await service.claimTask(task.id, S.backend);
    const member = (await service.listMembers(teamId, S.lead)).find((item) => item.sessionId === S.backend);
    assert.ok(member);
    await service.updateMemberFromRuntime(member.id, { status: 'idle' });
    const after = (await service.listMembers(teamId, S.lead)).find((item) => item.sessionId === S.backend);
    assert.equal(after?.status, 'working');
    assert.equal(after?.currentTaskId, task.id);
  });

  it('rejects access from non-members', async () => {
    const { service, teamId } = await makeFixture([]);
    await assert.rejects(() => service.listTasks(teamId, S.outsider), (error: unknown) => {
      assert.equal((error as TeamError).code, 'UNAUTHORIZED_TEAM_ACCESS');
      return true;
    });
  });

  it('rejects a second member registration of the same session', async () => {
    const { service, teamId } = await makeFixture([{ name: 'a', role: 'a', sessionId: S.backend }]);
    await assert.rejects(
      () => service.registerMember({ teamId, sessionId: S.backend, name: 'a2', role: 'a', actor: S.lead }),
      (error: unknown) => {
        assert.equal((error as TeamError).code, 'MEMBER_ALREADY_IN_TEAM');
        return true;
      },
    );
  });

  it('enforces the member cap', async () => {
    const service = makeService(undefined, { maxActiveMembers: 2 });
    const team = await service.createTeam({ name: 't', goal: 'g', leadSessionId: S.lead, workspaceId: 'w' });
    await service.registerMember({ teamId: team.id, sessionId: S.backend, name: 'a', role: 'a', actor: S.lead });
    await service.registerMember({ teamId: team.id, sessionId: S.frontend, name: 'b', role: 'b', actor: S.lead });
    await assert.rejects(
      () => service.registerMember({ teamId: team.id, sessionId: S.tester, name: 'c', role: 'c', actor: S.lead }),
      (error: unknown) => {
        assert.equal((error as TeamError).code, 'INVALID_INPUT');
        return true;
      },
    );
  });

  it('allows staged activation after a teammate is stopped or failed', async () => {
    const service = makeService(undefined, { maxActiveMembers: 2 });
    const team = await service.createTeam({ name: 'staged', goal: 'g', leadSessionId: S.lead, workspaceId: 'w' });
    const first = await service.registerMember({ teamId: team.id, sessionId: S.backend, name: 'backend', role: 'backend', actor: S.lead });
    await service.registerMember({ teamId: team.id, sessionId: S.frontend, name: 'frontend', role: 'frontend', actor: S.lead });

    await service.updateMember(first.id, S.lead, { status: 'stopped' });
    const staged = await service.registerMember({ teamId: team.id, sessionId: S.tester, name: 'tester', role: 'tester', actor: S.lead });
    assert.equal(staged.status, 'starting');
  });

  it('pauses and resumes a team', async () => {
    const { service, teamId } = await makeFixture([]);
    const paused = await service.pauseTeam(teamId, S.lead);
    assert.equal(paused.status, 'paused');
    await assert.rejects(() => service.createTask({ teamId, title: 'x', description: 'y', actor: S.lead }), (error: unknown) => {
      assert.equal((error as TeamError).code, 'TEAM_NOT_ACTIVE');
      return true;
    });
    const resumed = await service.resumeTeam(teamId, S.lead);
    assert.equal(resumed.status, 'active');
  });
});
