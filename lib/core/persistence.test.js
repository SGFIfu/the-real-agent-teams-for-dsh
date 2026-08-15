/**
 * Persistence tests: schema validation, restart reconstruction, and the
 * completion guard + snapshot accounting.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { domainSchema } from "./schemas.js";
import { MemoryStore } from "./store.js";
import { dumpStore, makeFixture, makeService, S } from "./testing.js";
describe('persistence', () => {
    it('every durable record survives a zod round-trip', async () => {
        const { store, service, teamId } = await makeFixture([
            { name: 'b', role: 'b', sessionId: S.backend },
        ]);
        const task = await service.createTask({ teamId, title: 't', description: 'd', requiresPlan: true, actor: S.lead });
        await service.claimTask(task.id, S.backend);
        await service.sendMessage({ teamId, fromSessionId: S.lead, toSessionId: S.backend, body: 'hi' });
        const plan = await service.submitPlan({ teamId, taskId: task.id, authorSessionId: S.backend, body: 'plan' });
        await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/a.ts'], purpose: 'a' });
        await service.addFinding({ teamId, authorSessionId: S.backend, taskId: task.id, severity: 'high', summary: 'leak', detail: 'fd leak' });
        const dump = await dumpStore(store);
        for (const [table, records] of Object.entries(dump)) {
            const schema = domainSchema[table];
            for (const record of Object.values(records)) {
                const parsed = schema.parse(record);
                assert.deepEqual(parsed, record, `${table} record round-trips`);
            }
        }
        assert.ok(plan.id.length > 0);
    });
    it('a team reconstructed from a dumped store continues exactly where it stopped', async () => {
        const { store, service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        const a = await service.createTask({ teamId, title: 'A', description: 'root', actor: S.lead });
        const b = await service.createTask({ teamId, title: 'B', description: 'child', dependencies: [a.id], actor: S.lead });
        await service.claimTask(a.id, S.backend);
        await service.completeTask(a.id, S.backend, 'A done');
        await service.sendMessage({ teamId, fromSessionId: S.lead, toSessionId: S.backend, body: 'restart soon' });
        // "Restart": new store + service seeded from the dumped records.
        const dump = await dumpStore(store);
        const restartedStore = new MemoryStore(dump);
        const restarted = makeService(restartedStore);
        const claimed = await restarted.claimTask(b.id, S.backend);
        assert.equal(claimed.id, b.id, 'dependency state was preserved across restart');
        const inbox = await restarted.getInbox(teamId, S.backend);
        assert.equal(inbox.length, 1);
        assert.equal(inbox[0].body, 'restart soon');
        await restarted.completeTask(b.id, S.backend, 'B done');
        const completed = await restarted.completeTeam(teamId, S.lead);
        assert.equal(completed.status, 'completed');
    });
});
describe('completion guard and snapshot', () => {
    it('rejects completion with incomplete required tasks and open critical findings', async () => {
        const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        const task = await service.createTask({ teamId, title: 't', description: 'd', actor: S.lead });
        await service.addFinding({ teamId, authorSessionId: S.backend, taskId: task.id, severity: 'critical', summary: 'broken', detail: 'x' });
        await assert.rejects(() => service.completeTeam(teamId, S.lead), (error) => {
            assert.equal(error.code, 'TEAM_NOT_COMPLETABLE');
            const reasons = (error.details?.reasons).join(' ');
            assert.match(reasons, /required tasks incomplete/);
            assert.match(reasons, /open critical\/high review findings/);
            return true;
        });
    });
    it('critical blocked tasks block completion', async () => {
        const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        const task = await service.createTask({ teamId, title: 't', description: 'd', priority: 'critical', actor: S.lead });
        await service.claimTask(task.id, S.backend);
        await service.setTaskBlocked(task.id, S.backend, 'infra');
        await assert.rejects(() => service.completeTeam(teamId, S.lead), (error) => {
            assert.equal(error.code, 'TEAM_NOT_COMPLETABLE');
            assert.match(JSON.stringify(error.details ?? {}), /critical tasks blocked/);
            return true;
        });
    });
    it('optional (non-required) tasks do not block completion and progress math excludes them', async () => {
        const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        const required = await service.createTask({ teamId, title: 'r', description: 'd', actor: S.lead });
        await service.createTask({ teamId, title: 'optional', description: 'd', required: false, actor: S.lead });
        await service.claimTask(required.id, S.backend);
        await service.completeTask(required.id, S.backend, 'done');
        const snapshot = await service.getSnapshot(teamId, S.lead);
        assert.equal(snapshot.progress.requiredTotal, 1);
        assert.equal(snapshot.progress.requiredDone, 1);
        assert.equal(snapshot.progress.ratio, 1);
        const completed = await service.completeTeam(teamId, S.lead);
        assert.equal(completed.status, 'completed');
    });
    it('snapshot reports blocked tasks and plans awaiting decision', async () => {
        const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        const task = await service.createTask({ teamId, title: 'm', description: 'd', requiresPlan: true, actor: S.lead });
        await service.claimTask(task.id, S.backend);
        await service.submitPlan({ teamId, taskId: task.id, authorSessionId: S.backend, body: 'plan' });
        const snapshot = await service.getSnapshot(teamId, S.lead);
        assert.equal(snapshot.progress.blocked.length, 1);
        assert.equal(snapshot.progress.awaitingPlanApproval.length, 1);
    });
    it('lead-only completion and actor restrictions hold', async () => {
        const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        await assert.rejects(() => service.completeTeam(teamId, S.backend), (error) => {
            assert.equal(error.code, 'UNAUTHORIZED_TEAM_ACCESS');
            return true;
        });
    });
});
