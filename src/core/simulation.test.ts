/**
 * No-model team simulation: lead + 5 workers + reviewer over a 20-task DAG.
 * Exercises dependency scheduling, concurrent self-claiming, messaging, plan
 * approval/rejection, file-claim conflicts, member removal mid-flight, review
 * findings, the completion guard, and team completion — no LLM calls.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AgentTeamsService } from './service.ts';
import { MemoryStore } from './store.ts';
import { TeamError, isTeamError } from './errors.ts';
import type { TeamEventSink, TeamTask } from './types.ts';
import { S } from './testing.ts';

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('no-model team simulation', () => {
  it('runs a full 20-task development team to completion with all invariants', async () => {
    const events: Array<{ name: string; payload: unknown }> = [];
    const sink: TeamEventSink = { emit: (name, payload) => events.push({ name, payload }) };
    const service = new AgentTeamsService({ store: new MemoryStore(), sink, maxActiveMembers: 10 });
    const team = await service.createTeam({ name: 'feature-team', goal: 'ship authentication end to end', leadSessionId: S.lead, workspaceId: 'ws' });

    // ── board: 20 tasks, diamond DAG ─────────────────────────────────────────
    const t = await service.createTasks(
      [
        { teamId: team.id, title: 'architecture', description: 'auth design', priority: 'critical', requiresPlan: true },
        ...[1, 2, 3, 4].map((n) => ({ teamId: team.id, title: `backend-${n}`, description: `backend slice ${n}` })),
        ...[1, 2, 3, 4].map((n) => ({ teamId: team.id, title: `frontend-${n}`, description: `frontend slice ${n}` })),
        { teamId: team.id, title: 'integration', description: 'wire it together' },
        ...[1, 2, 3].map((n) => ({ teamId: team.id, title: `test-${n}`, description: `test suite ${n}` })),
        ...[1, 2, 3, 4].map((n) => ({ teamId: team.id, title: `polish-${n}`, description: `polish ${n}` })),
        { teamId: team.id, title: 'docs', description: 'documentation' },
        { teamId: team.id, title: 'perf-review', description: 'performance pass' },
        { teamId: team.id, title: 'final-review', description: 'release review', priority: 'critical', requiresPlan: true },
      ],
      S.lead,
    );
    const [arch, ...backend] = t.slice(0, 5);
    const frontend = t.slice(5, 9);
    const [integration, ...tests] = t.slice(9, 13);
    const polish = t.slice(13, 17);
    const [docs, perf, finalReview] = t.slice(17);

    await service.addDependency(team.id, backend[0].id, arch.id, S.lead);
    for (const task of backend.slice(1)) await service.addDependency(team.id, task.id, arch.id, S.lead);
    for (const task of frontend) await service.addDependency(team.id, task.id, arch.id, S.lead);
    for (const task of [...backend, ...frontend]) await service.addDependency(team.id, integration.id, task.id, S.lead);
    for (const task of tests) await service.addDependency(team.id, task.id, integration.id, S.lead);
    for (let i = 0; i < polish.length; i += 1) await service.addDependency(team.id, polish[i].id, tests[i % tests.length].id, S.lead);
    for (const task of [docs, perf]) await service.addDependency(team.id, task.id, integration.id, S.lead);
    for (const task of [...polish, docs, perf]) await service.addDependency(team.id, finalReview.id, task.id, S.lead);

    // ── members ──────────────────────────────────────────────────────────────
    const roles: Array<{ sessionId: string; name: string; role: string }> = [
      { sessionId: S.architect, name: 'architect', role: 'architect' },
      { sessionId: S.backend, name: 'backend', role: 'backend' },
      { sessionId: S.frontend, name: 'frontend', role: 'frontend' },
      { sessionId: S.tester, name: 'tester', role: 'tester' },
      { sessionId: S.reviewer, name: 'reviewer', role: 'reviewer' },
      { sessionId: S.debugger, name: 'debugger', role: 'debugger' },
    ];
    for (const role of roles) await service.registerMember({ teamId: team.id, sessionId: role.sessionId, name: role.name, role: role.role, actor: S.lead });

    const allDone = (snapshotTasks: TeamTask[]): boolean => snapshotTasks.every((x) => x.status === 'completed');

    const worker = (
      sessionId: string,
      role: string,
      work: (task: TeamTask) => Promise<string>,
      lane?: { inLane: (task: TeamTask) => boolean; laneDone: (tasks: TeamTask[]) => boolean },
    ): Promise<void> =>
      (async () => {
        for (let round = 0; round < 600; round += 1) {
          try {
            const tasks = await service.listTasks(team.id, sessionId);
            if (allDone(tasks)) return;
            if (lane !== undefined && lane.laneDone(tasks)) return;
            const outcome = await service.claimNextTask(team.id, sessionId);
            if (!outcome.claimed) {
              await tick();
              continue;
            }
            if (lane !== undefined && !lane.inLane(outcome.task)) {
              await service.releaseTask(outcome.task.id, sessionId, 'not my lane');
              await tick();
              continue;
            }
            const result = await work(outcome.task);
            await service.completeTask(outcome.task.id, sessionId, result);
          } catch (error) {
            if (isTeamError(error) && error.code === 'UNAUTHORIZED_TEAM_ACCESS') return; // retired member
            throw error;
          }
        }
        throw new Error(`worker ${role} did not converge`);
      })();

    // Architect: plan approval cycle first (reject once, then approve).
    await service.claimTask(arch.id, S.architect);
    const plan1 = await service.submitPlan({ teamId: team.id, taskId: arch.id, authorSessionId: S.architect, body: 'JWT + refresh tokens' });
    await service.rejectPlan(plan1.id, S.lead, 'add token revocation');
    const plan2 = await service.submitPlan({ teamId: team.id, taskId: arch.id, authorSessionId: S.architect, body: 'JWT + refresh + revocation list' });
    await service.approvePlan(plan2.id, S.lead);
    await service.claimTask(arch.id, S.architect);
    await service.completeTask(arch.id, S.architect, 'arch approved and done');

    // File claims: backend and frontend claim disjoint areas; one conflict path.
    await service.claimFiles({ teamId: team.id, ownerSessionId: S.backend, patterns: ['src/server/**'], purpose: 'backend slices' });
    await service.claimFiles({ teamId: team.id, ownerSessionId: S.frontend, patterns: ['src/client/**'], purpose: 'frontend slices' });
    let conflictSeen = false;
    try {
      await service.claimFiles({ teamId: team.id, ownerSessionId: S.frontend, patterns: ['src/server/extra.ts'], purpose: 'sneaky' });
    } catch (error) {
      assert.equal((error as TeamError).code, 'FILE_CLAIM_CONFLICT');
      conflictSeen = true;
    }
    assert.ok(conflictSeen, 'file claim conflict path exercised');

    // ── pipeline phase: backend ∥ frontend (explicit claims, concurrent) ─────
    const backendFn = (async () => {
      for (const task of backend) {
        await service.claimTask(task.id, S.backend);
        await service.completeTask(task.id, S.backend, `${task.title} done`);
      }
    })();
    const frontendFn = (async () => {
      for (const task of frontend) {
        await service.claimTask(task.id, S.frontend);
        await service.completeTask(task.id, S.frontend, `${task.title} done`);
      }
    })();
    await Promise.all([backendFn, frontendFn]);

    // Coordination message: backend announces the contract, then wires integration.
    await service.broadcastMessage({ teamId: team.id, fromSessionId: S.backend, type: 'warning', body: 'API contract v1' });
    await service.claimTask(integration.id, S.backend);
    {
      const inbox = await service.getInbox(team.id, S.backend);
      assert.ok(inbox.some((m) => m.body === 'API contract v1'), 'backend sees the contract message');
    }
    await service.completeTask(integration.id, S.backend, 'integration green');

    // Tester lane: test suites, then polish.
    for (const task of tests) {
      await service.claimTask(task.id, S.tester);
      await service.completeTask(task.id, S.tester, `${task.title} done`);
    }
    for (const task of polish) {
      await service.claimTask(task.id, S.tester);
      await service.completeTask(task.id, S.tester, `${task.title} done`);
    }

    // ── debugger claims perf-review, then is pulled away (removal releases it) ──
    await service.claimTask(perf.id, S.debugger);
    const debuggerMember = await service.memberBySession(team.id, S.debugger);
    assert.ok(debuggerMember !== undefined);
    await service.removeMember(debuggerMember!.id, S.lead);
    const perfAfterRemoval = await service.getTask(perf.id, S.lead);
    assert.equal(perfAfterRemoval.status, 'pending', 'held task released when the member was removed');

    // Remaining workers self-schedule docs + perf-review concurrently, each
    // scoped to its own lane; out-of-lane claims are released, not executed.
    const reviewerWorker = worker(
      S.reviewer,
      'reviewer',
      async (task) => (task.title === 'docs' ? 'docs reviewed' : `${task.title} done`),
      {
        inLane: (task) => task.title === 'docs',
        laneDone: (tasks) => tasks.some((t) => t.title === 'docs' && t.status === 'completed'),
      },
    );
    const backendSecond = worker(
      S.backend,
      'backend-2',
      async (task) => `${task.title} done`,
      {
        inLane: (task) => task.title === 'perf-review',
        laneDone: (tasks) => tasks.some((t) => t.title === 'perf-review' && t.status === 'completed'),
      },
    );
    await Promise.all([reviewerWorker, backendSecond]);
    assert.equal((await service.getTask(docs.id, S.lead)).status, 'completed');
    assert.equal((await service.getTask(perf.id, S.lead)).status, 'completed');

    // ── review findings ──────────────────────────────────────────────────────
    const finding = await service.addFinding({ teamId: team.id, authorSessionId: S.reviewer, taskId: integration.id, severity: 'high', summary: 'refresh-token reuse window', detail: 'tokens stay valid 30s after rotation' });
    const finding2 = await service.addFinding({ teamId: team.id, authorSessionId: S.reviewer, taskId: integration.id, severity: 'medium', summary: 'metric naming drift', detail: 'minor' });
    await service.sendMessage({ teamId: team.id, fromSessionId: S.reviewer, toSessionId: S.lead, type: 'review', body: 'findings posted; 1 high, 1 medium' });

    // Guard: team must not complete while the high finding is open.
    await assert.rejects(() => service.completeTeam(team.id, S.lead), (error: unknown) => {
      assert.equal((error as TeamError).code, 'TEAM_NOT_COMPLETABLE');
      return true;
    });
    await service.resolveFinding(finding.id, S.backend);
    await service.acceptFinding(finding2.id, S.lead);

    // ── final review: plan reject → resubmit → approve → complete ───────────
    await service.claimTask(finalReview.id, S.reviewer);
    const planA = await service.submitPlan({ teamId: team.id, taskId: finalReview.id, authorSessionId: S.reviewer, body: 'manual QA pass' });
    await service.rejectPlan(planA.id, S.lead, 'add a load test');
    const planB = await service.submitPlan({ teamId: team.id, taskId: finalReview.id, authorSessionId: S.reviewer, body: 'manual QA + load test' });
    await service.approvePlan(planB.id, S.lead);
    await service.claimTask(finalReview.id, S.reviewer);
    await service.completeTask(finalReview.id, S.reviewer, 'release review passed');

    // ── release all file claims, then complete ──────────────────────────────
    const claims = await service.listFileClaims(team.id, S.lead);
    await service.releaseFiles(claims.map((c) => c.id), S.lead);
    assert.equal((await service.listFileClaims(team.id, S.lead)).length, 0, 'claims released');

    const completed = await service.completeTeam(team.id, S.lead);
    assert.equal(completed.status, 'completed');

    // ── invariants ───────────────────────────────────────────────────────────
    const tasks = await service.listTasks(team.id, S.lead);
    assert.equal(tasks.filter((x) => x.status === 'completed').length, 20, 'all tasks completed');
    const claimCounts = new Map<string, number>();
    for (const event of events.filter((e) => e.name === 'agent-teams/task-claimed')) {
      const payload = event.payload as { task: TeamTask };
      claimCounts.set(payload.task.id, (claimCounts.get(payload.task.id) ?? 0) + 1);
    }
    // arch / perf-review / final-review were each claimed twice (plan cycle,
    // member removal, plan cycle); every other task exactly once.
    for (const [id, count] of claimCounts) {
      const expected = id === arch.id || id === perf.id || id === finalReview.id ? 2 : 1;
      assert.equal(count, expected, `task ${id} claimed exactly ${expected} time(s)`);
    }
    assert.equal([...claimCounts.values()].reduce((a, b) => a + b, 0), 23);
    // Dependency ordering: every task started after all of its deps completed.
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        const depTask = tasks.find((x) => x.id === dep);
        assert.ok(depTask !== undefined);
        assert.ok((task.startedAt ?? 0) >= (depTask.completedAt ?? 0), `${task.title} started after ${depTask!.title} completed`);
      }
    }
    const inFlight = tasks.filter((x) => x.status === 'in_progress');
    assert.equal(inFlight.length, 0);
    const snapshot = await service.getSnapshot(team.id, S.lead);
    assert.equal(snapshot.progress.ratio, 1);
    assert.equal(snapshot.progress.blocked.length, 0);
    assert.equal(snapshot.progress.awaitingPlanApproval.length, 0);
    assert.ok(events.some((e) => e.name === 'agent-teams/team-completed'));
  });
});
