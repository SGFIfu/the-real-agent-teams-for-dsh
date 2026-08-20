import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TeamError } from './errors.ts';
import { makeFixture, S } from './testing.ts';

describe('service authority and multi-record guards', () => {
  it('keeps team controls and member registration lead-only', async () => {
    const { service, teamId } = await makeFixture([{ name: 'backend', role: 'backend', sessionId: S.backend }]);
    await assert.rejects(() => service.pauseTeam(teamId, S.backend), (error: unknown) => {
      assert.equal((error as TeamError).code, 'UNAUTHORIZED_TEAM_ACCESS');
      return true;
    });
    await assert.rejects(
      () => service.registerMember({ teamId, sessionId: S.frontend, name: 'frontend', role: 'frontend', actor: S.backend }),
      (error: unknown) => {
        assert.equal((error as TeamError).code, 'UNAUTHORIZED_TEAM_ACCESS');
        return true;
      },
    );
  });

  it('does not report native delivery when no runtime is mounted', async () => {
    const { service, teamId } = await makeFixture([{ name: 'backend', role: 'backend', sessionId: S.backend }]);
    const message = await service.sendMessage({ teamId, fromSessionId: S.lead, toSessionId: S.backend, body: 'hello' });
    assert.equal(message.deliveryState, 'failed');
    assert.match(message.deliveryError ?? '', /runtime/i);
    assert.equal((await service.getInbox(teamId, S.backend)).length, 1);
  });

  it('serializes competing file claims in one service process', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'backend', role: 'backend', sessionId: S.backend },
      { name: 'frontend', role: 'frontend', sessionId: S.frontend },
    ]);
    const results = await Promise.allSettled([
      service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['shared/types.ts'], purpose: 'types' }),
      service.claimFiles({ teamId, ownerSessionId: S.frontend, patterns: ['shared/types.ts'], purpose: 'types' }),
    ]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const rejected = results.find((result) => result.status === 'rejected');
    assert.ok(rejected !== undefined);
    assert.equal((rejected as PromiseRejectedResult).reason.code, 'FILE_CLAIM_CONFLICT');
  });

  it('rejects cross-team finding references and invalid plan transitions', async () => {
    const first = await makeFixture([{ name: 'backend', role: 'backend', sessionId: S.backend }]);
    const secondTeam = await first.service.createTeam({ name: 'second', goal: 'second team', leadSessionId: S.lead, workspaceId: 'ws-2' });
    const task = await first.service.createTask({ teamId: secondTeam.id, title: 'foreign', description: 'foreign task', actor: S.lead });
    await assert.rejects(
      () => first.service.addFinding({ teamId: first.teamId, authorSessionId: S.lead, taskId: task.id, severity: 'medium', summary: 'bad link', detail: 'cross-team' }),
      (error: unknown) => {
        assert.equal((error as TeamError).code, 'INVALID_INPUT');
        return true;
      },
    );
    const planTask = await first.service.createTask({ teamId: first.teamId, title: 'planned', description: 'planned task', requiresPlan: true, actor: S.lead });
    const plan = await first.service.submitPlan({ teamId: first.teamId, taskId: planTask.id, authorSessionId: S.backend, body: 'plan' });
    await first.service.rejectPlan(plan.id, S.lead, 'revise');
    await assert.rejects(() => first.service.approvePlan(plan.id, S.lead), (error: unknown) => {
      assert.equal((error as TeamError).code, 'INVALID_INPUT');
      return true;
    });
  });
});
