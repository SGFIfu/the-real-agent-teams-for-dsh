import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from './store.ts';
import { WorkspaceError, WorkspaceManager, normalizeHostPath } from './workspace.ts';
import type { TeamMemberId } from './types.ts';
import { makeService, S } from './testing.ts';

async function fixture(): Promise<{ store: MemoryStore; manager: WorkspaceManager; teamId: string; backendId: TeamMemberId; frontendId: TeamMemberId }> {
  const store = new MemoryStore();
  const service = makeService(store, { maxActiveMembers: 5 });
  const team = await service.createTeam({ name: 'workspace-test', goal: 'lease work safely', leadSessionId: S.lead, workspaceId: 'root' });
  const backend = await service.registerMember({ teamId: team.id, sessionId: S.backend, name: 'Backend', role: 'backend', actor: S.lead });
  const frontend = await service.registerMember({ teamId: team.id, sessionId: S.frontend, name: 'Frontend', role: 'frontend', actor: S.lead });
  const manager = new WorkspaceManager({ store, allowedRoots: ['/tmp/dsh-workspaces'], leaseTimeoutMs: 100, now: () => clock });
  return { store, manager, teamId: team.id, backendId: backend.id, frontendId: frontend.id };
}

let clock = 1_000;

describe('workspace leases', () => {
  it('normalizes host paths and rejects escaping approved roots', async () => {
    assert.equal(normalizeHostPath('/tmp/dsh-workspaces/./repo/../repo'), '/tmp/dsh-workspaces/repo');
    assert.throws(() => normalizeHostPath('../../outside'), (error: unknown) => (error as WorkspaceError).code === 'WORKSPACE_PATH_ESCAPE');

    const { manager, teamId, backendId } = await fixture();
    await assert.rejects(
      () => manager.create({
        teamId,
        memberId: backendId,
        sessionId: S.backend,
        repositoryRoot: '/tmp/dsh-workspaces/repo',
        worktreePath: '/tmp/dsh-workspaces/../outside',
        branch: 'feature/backend',
      }),
      (error: unknown) => (error as WorkspaceError).code === 'WORKSPACE_PATH_ESCAPE',
    );
  });

  it('binds a workspace to the real member session, recovers stale leases, and supports handoff', async () => {
    const { manager, teamId, backendId, frontendId } = await fixture();
    const workspace = await manager.create({
      teamId,
      memberId: backendId,
      sessionId: S.backend,
      repositoryRoot: '/tmp/dsh-workspaces/repo',
      worktreePath: '/tmp/dsh-workspaces/worktrees/backend',
      branch: 'feature/backend',
    });
    assert.equal(workspace.memberId, backendId);
    await assert.rejects(
      () => manager.get(workspace.id, { teamId, memberId: frontendId, sessionId: S.frontend }),
      (error: unknown) => (error as WorkspaceError).code === 'WORKSPACE_OWNERSHIP_CONFLICT',
    );

    clock += 101;
    const recovered = await manager.recoverStale(teamId);
    assert.deepEqual(recovered.map((item) => item.id), [workspace.id]);
    assert.equal(recovered[0]?.status, 'recoverable');

    const handedOff = await manager.handoffWorkspace(workspace.id, { teamId, memberId: backendId, sessionId: S.backend }, {
      memberId: frontendId,
      sessionId: S.frontend,
    });
    assert.equal(handedOff.memberId, frontendId);
    assert.equal((await manager.get(workspace.id, { teamId, memberId: frontendId, sessionId: S.frontend })).memberId, frontendId);
  });

  it('serializes cross-agent file leases and supports conflict resolution by handoff', async () => {
    const { manager, teamId, backendId, frontendId } = await fixture();
    const workspace = await manager.create({
      teamId,
      memberId: backendId,
      sessionId: S.backend,
      repositoryRoot: '/tmp/dsh-workspaces/repo',
      worktreePath: '/tmp/dsh-workspaces/worktrees/backend',
      branch: 'feature/backend',
    });
    const [backendClaim] = await manager.claimFiles({
      teamId,
      workspaceId: workspace.id,
      actor: { teamId, memberId: backendId, sessionId: S.backend },
      patterns: ['shared/types.ts'],
      purpose: 'API contract',
    });
    assert.equal(backendClaim?.ownerMemberId, backendId);

    await assert.rejects(
      () => manager.claimFiles({
        teamId,
        workspaceId: workspace.id,
        actor: { teamId, memberId: frontendId, sessionId: S.frontend },
        patterns: ['shared/types.ts'],
        purpose: 'frontend types',
      }),
      (error: unknown) => (error as WorkspaceError).code === 'WORKSPACE_OWNERSHIP_CONFLICT' || (error as WorkspaceError).code === 'FILE_CLAIM_CONFLICT',
    );

    const handedOff = await manager.handoffFile({
      teamId,
      claimId: backendClaim!.id,
      fromSessionId: S.backend,
      toSessionId: S.frontend,
      toMemberId: frontendId,
      purpose: 'frontend owns shared contract after coordination',
    });
    assert.equal(handedOff.ownerSessionId, S.frontend);
    assert.equal((await manager.releaseFiles(teamId, [handedOff.id], { teamId, memberId: frontendId, sessionId: S.frontend })).length, 1);

    const [directoryClaim] = await manager.claimFiles({
      teamId,
      actor: { teamId, memberId: backendId, sessionId: S.backend },
      patterns: [{ pattern: 'src/server/', kind: 'directory' }],
      purpose: 'server ownership',
    });
    await assert.rejects(
      () => manager.claimFiles({
        teamId,
        actor: { teamId, memberId: frontendId, sessionId: S.frontend },
        patterns: ['src/server/routes.ts'],
        purpose: 'route work',
      }),
      (error: unknown) => (error as WorkspaceError).code === 'FILE_CLAIM_CONFLICT',
    );
    const [serverGlob] = await manager.claimFiles({
      teamId,
      actor: { teamId, memberId: frontendId, sessionId: S.frontend },
      patterns: ['server/**'],
      purpose: 'server glob',
    });
    const [clientGlob] = await manager.claimFiles({
      teamId,
      actor: { teamId, memberId: frontendId, sessionId: S.frontend },
      patterns: ['client/**'],
      purpose: 'client glob',
    });
    await manager.releaseFiles(teamId, [directoryClaim!.id, serverGlob!.id, clientGlob!.id], { teamId, sessionId: S.lead });

    const [first, second] = await Promise.allSettled([
      manager.claimFiles({ teamId, actor: { teamId, memberId: backendId, sessionId: S.backend }, patterns: ['server/**'], purpose: 'backend' }),
      manager.claimFiles({ teamId, actor: { teamId, memberId: frontendId, sessionId: S.frontend }, patterns: ['server/**'], purpose: 'frontend' }),
    ]);
    const successes = [first, second].filter((value) => value.status === 'fulfilled');
    assert.equal(successes.length, 1, 'exactly one concurrent owner may acquire the same glob');
  });
});
