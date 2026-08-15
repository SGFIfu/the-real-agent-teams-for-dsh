/**
 * Dependency DAG tests: blocking, release, and cycle rejection.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, S } from "./testing.js";
describe('task dependencies', () => {
    it('A → B: B cannot be claimed before A completes', async () => {
        const { service, teamId } = await makeFixture([{ name: 'w', role: 'w', sessionId: S.backend }]);
        const a = await service.createTask({ teamId, title: 'A', description: 'first', actor: S.lead });
        const b = await service.createTask({ teamId, title: 'B', description: 'second', dependencies: [a.id], actor: S.lead });
        await assert.rejects(() => service.claimTask(b.id, S.backend), (error) => {
            assert.equal(error.code, 'TASK_DEPENDENCIES_UNRESOLVED');
            return true;
        });
        await service.claimTask(a.id, S.backend);
        await service.completeTask(a.id, S.backend, 'A done');
        const claimed = await service.claimTask(b.id, S.backend);
        assert.equal(claimed.id, b.id);
    });
    it('rejects the cycle A → B → C → A', async () => {
        const { service, teamId } = await makeFixture([]);
        const a = await service.createTask({ teamId, title: 'A', description: 'a', actor: S.lead });
        const b = await service.createTask({ teamId, title: 'B', description: 'b', actor: S.lead });
        const c = await service.createTask({ teamId, title: 'C', description: 'c', actor: S.lead });
        await service.addDependency(teamId, a.id, b.id, S.lead);
        await service.addDependency(teamId, b.id, c.id, S.lead);
        await assert.rejects(() => service.addDependency(teamId, c.id, a.id, S.lead), (error) => {
            assert.equal(error.code, 'DEPENDENCY_CYCLE');
            return true;
        });
    });
    it('rejects the 2-cycle A → B, B → A', async () => {
        const { service, teamId } = await makeFixture([]);
        const a = await service.createTask({ teamId, title: 'A', description: 'a', actor: S.lead });
        const b = await service.createTask({ teamId, title: 'B', description: 'b', actor: S.lead });
        await service.addDependency(teamId, a.id, b.id, S.lead);
        await assert.rejects(() => service.addDependency(teamId, b.id, a.id, S.lead), (error) => {
            assert.equal(error.code, 'DEPENDENCY_CYCLE');
            return true;
        });
    });
    it('rejects self-dependency', async () => {
        const { service, teamId } = await makeFixture([]);
        const a = await service.createTask({ teamId, title: 'A', description: 'a', actor: S.lead });
        await assert.rejects(() => service.addDependency(teamId, a.id, a.id, S.lead), (error) => {
            assert.equal(error.code, 'DEPENDENCY_SELF_REFERENCE');
            return true;
        });
    });
    it('diamond DAG: integration task waits for both branches', async () => {
        const { service, teamId } = await makeFixture([
            { name: 'b', role: 'b', sessionId: S.backend },
            { name: 'f', role: 'f', sessionId: S.frontend },
        ]);
        const arch = await service.createTask({ teamId, title: 'arch', description: 'design', actor: S.lead });
        const backend = await service.createTask({ teamId, title: 'backend', description: 'api', dependencies: [arch.id], actor: S.lead });
        const frontend = await service.createTask({ teamId, title: 'frontend', description: 'ui', dependencies: [arch.id], actor: S.lead });
        const integration = await service.createTask({ teamId, title: 'integration', description: 'join', dependencies: [backend.id, frontend.id], actor: S.lead });
        await service.claimTask(arch.id, S.backend);
        await service.completeTask(arch.id, S.backend, 'ok');
        await service.claimTask(backend.id, S.backend);
        await service.claimTask(frontend.id, S.frontend);
        await assert.rejects(() => service.claimTask(integration.id, S.backend), (error) => {
            assert.equal(error.code, 'TASK_DEPENDENCIES_UNRESOLVED');
            return true;
        });
        await service.completeTask(backend.id, S.backend, 'ok');
        await assert.rejects(() => service.claimTask(integration.id, S.frontend), (error) => {
            assert.equal(error.code, 'TASK_DEPENDENCIES_UNRESOLVED');
            return true;
        });
        await service.completeTask(frontend.id, S.frontend, 'ok');
        const claimed = await service.claimTask(integration.id, S.backend);
        assert.equal(claimed.id, integration.id);
    });
    it('cross-team dependency is rejected', async () => {
        const { service, teamId } = await makeFixture([]);
        const other = await service.createTeam({ name: 'other', goal: 'other', leadSessionId: S.lead, workspaceId: 'w2' });
        const a = await service.createTask({ teamId, title: 'A', description: 'a', actor: S.lead });
        const b = await service.createTask({ teamId: other.id, title: 'B', description: 'b', actor: S.lead });
        await assert.rejects(() => service.addDependency(teamId, a.id, b.id, S.lead), (error) => {
            assert.equal(error.code, 'INVALID_INPUT');
            return true;
        });
    });
});
