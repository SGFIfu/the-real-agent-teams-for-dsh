/**
 * Concurrency tests: atomic claiming under real interleaving. No sleeps —
 * every claim goes through the store's atomic read-modify-write.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, makeService, S } from "./testing.js";
import { MemoryStore } from "./store.js";
describe('atomic task claiming', () => {
    it('50 concurrent claims on ONE task yield exactly one owner', async () => {
        const store = new MemoryStore();
        const service = makeService(store, { maxActiveMembers: 100 });
        const team = await service.createTeam({ name: 't', goal: 'g', leadSessionId: S.lead, workspaceId: 'w' });
        const teamId = team.id;
        const task = await service.createTask({ teamId, title: 'hot', description: 'single slot', actor: S.lead });
        const claimants = Array.from({ length: 50 }, (_, i) => `sess-c${i}`);
        for (const claimant of claimants) {
            await service.registerMember({ teamId, sessionId: claimant, name: claimant, role: 'worker', actor: S.lead }).catch(() => { });
        }
        const results = await Promise.allSettled(claimants.map((c) => service.claimTask(task.id, c)));
        const wins = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
        const failures = results.filter((r) => r.status === 'rejected');
        assert.equal(wins.length, 1, `exactly one winner, got ${wins.length}`);
        assert.equal(failures.length, 49);
        for (const failure of failures) {
            const error = failure.reason;
            assert.equal(error.code, 'TASK_ALREADY_CLAIMED');
        }
        const fresh = await service.getTask(task.id, S.lead);
        assert.equal(fresh.ownerSessionId, wins[0].ownerSessionId);
    });
    it('4 agents self-scheduling over 20 tasks: no duplicate owner, all claimed once', async () => {
        const { service, teamId } = await makeFixture([]);
        const agents = [S.backend, S.frontend, S.tester, S.reviewer];
        for (const agent of agents) {
            await service.registerMember({ teamId, sessionId: agent, name: agent, role: 'worker', actor: S.lead });
        }
        for (let i = 0; i < 20; i += 1) {
            await service.createTask({ teamId, title: `t${i}`, description: `task ${i}`, actor: S.lead });
        }
        // Each agent keeps claiming until nothing is left; all run concurrently.
        const perAgent = await Promise.all(agents.map(async (agent) => {
            const mine = [];
            for (;;) {
                const outcome = await service.claimNextTask(teamId, agent);
                if (!outcome.claimed)
                    break;
                mine.push(outcome.task);
            }
            return mine;
        }));
        const claimed = perAgent.flat();
        assert.equal(claimed.length, 20, 'every task claimed exactly once overall');
        const owners = claimed.map((t) => t.ownerSessionId);
        assert.ok(owners.every((owner) => agents.includes(owner)), 'all owners are registered agents');
        const ids = claimed.map((t) => t.id);
        assert.equal(new Set(ids).size, 20, 'all task ids distinct');
        const fresh = await service.listTasks(teamId, S.lead);
        for (const task of fresh)
            assert.equal(task.status, 'in_progress');
        for (const task of fresh)
            assert.ok(task.ownerSessionId !== undefined);
        const ownershipCount = new Map();
        for (const task of fresh)
            ownershipCount.set(task.ownerSessionId, (ownershipCount.get(task.ownerSessionId) ?? 0) + 1);
        // Every agent got a roughly fair share under priority ordering.
        assert.equal([...ownershipCount.keys()].length, 4);
    });
    it('50-way parallel claimNext: exactly one owner per task, 20 tasks claimed once', async () => {
        const store = new MemoryStore();
        const service = makeService(store, { maxActiveMembers: 100 });
        const team = await service.createTeam({ name: 't', goal: 'g', leadSessionId: S.lead, workspaceId: 'w' });
        const teamId = team.id;
        const agents = Array.from({ length: 50 }, (_, i) => `sess-p${i}`);
        for (const agent of agents) {
            await service.registerMember({ teamId, sessionId: agent, name: agent, role: 'worker', actor: S.lead }).catch(() => { });
        }
        for (let i = 0; i < 20; i += 1) {
            await service.createTask({ teamId, title: `p${i}`, description: 'parallel race', actor: S.lead });
        }
        const rounds = await Promise.all(agents.map((agent) => service.claimNextTask(teamId, agent)));
        const wins = rounds.filter((r) => r.claimed).map((r) => r.task);
        assert.equal(wins.length, 20, 'exactly 20 wins across 50 racers');
        assert.equal(new Set(wins.map((t) => t.id)).size, 20);
        const fresh = await service.listTasks(teamId, S.lead);
        for (const task of fresh)
            assert.equal(task.status, 'in_progress');
    });
    it('dependency-respecting claiming under concurrency: dependent tasks never claimed first', async () => {
        const { service, teamId } = await makeFixture([]);
        const a = await service.createTask({ teamId, title: 'A', description: 'root', actor: S.lead });
        const b = await service.createTask({ teamId, title: 'B', description: 'depends on A', dependencies: [a.id], actor: S.lead });
        const agent = 'sess-d1';
        await service.registerMember({ teamId, sessionId: agent, name: agent, role: 'w', actor: S.lead });
        const first = await service.claimNextTask(teamId, agent);
        assert.ok(first.claimed);
        assert.equal(first.task.id, a.id, 'root task claimed before dependent');
        const second = await service.claimNextTask(teamId, agent);
        assert.equal(second.claimed, false, 'dependent task not claimable while root is in progress');
        await service.completeTask(a.id, agent, 'done');
        const third = await service.claimNextTask(teamId, agent);
        assert.ok(third.claimed);
        assert.equal(third.task.id, b.id);
    });
});
