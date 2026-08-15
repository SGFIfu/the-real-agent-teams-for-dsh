/**
 * File claim tests: exact, directory, and glob conflicts; release rules.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, S } from "./testing.js";
describe('file claims', () => {
    it('claims and releases files', async () => {
        const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        const claims = await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server/auth.ts'], purpose: 'auth work' });
        assert.equal(claims.length, 1);
        assert.equal(claims[0].kind, 'file');
        const listed = await service.listFileClaims(teamId, S.lead);
        assert.equal(listed.length, 1);
        await service.releaseFiles([claims[0].id], S.backend);
        assert.equal((await service.listFileClaims(teamId, S.lead)).length, 0);
    });
    it('same-owner overlapping claims are allowed', async () => {
        const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
        await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server/auth.ts'], purpose: 'a' });
        const claims = await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server/'], purpose: 'b' });
        assert.equal(claims.length, 1);
    });
    it('exact path conflict between owners is rejected', async () => {
        const { service, teamId } = await makeFixture([
            { name: 'b', role: 'b', sessionId: S.backend },
            { name: 'f', role: 'f', sessionId: S.frontend },
        ]);
        await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server/auth.ts'], purpose: 'backend' });
        await assert.rejects(() => service.claimFiles({ teamId, ownerSessionId: S.frontend, patterns: ['src/server/auth.ts'], purpose: 'frontend' }), (error) => {
            assert.equal(error.code, 'FILE_CLAIM_CONFLICT');
            return true;
        });
    });
    it('directory vs contained file conflicts', async () => {
        const { service, teamId } = await makeFixture([
            { name: 'b', role: 'b', sessionId: S.backend },
            { name: 'f', role: 'f', sessionId: S.frontend },
        ]);
        await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server'], purpose: 'whole dir' });
        await assert.rejects(() => service.claimFiles({ teamId, ownerSessionId: S.frontend, patterns: ['src/server/auth.ts'], purpose: 'one file' }), (error) => {
            assert.equal(error.code, 'FILE_CLAIM_CONFLICT');
            return true;
        });
    });
    it('glob vs contained path conflicts; disjoint globs do not', async () => {
        const { service, teamId } = await makeFixture([
            { name: 'b', role: 'b', sessionId: S.backend },
            { name: 'f', role: 'f', sessionId: S.frontend },
        ]);
        await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server/**'], purpose: 'server glob' });
        await assert.rejects(() => service.claimFiles({ teamId, ownerSessionId: S.frontend, patterns: ['src/server/auth.ts'], purpose: 'auth' }), (error) => {
            assert.equal(error.code, 'FILE_CLAIM_CONFLICT');
            return true;
        });
        const ok = await service.claimFiles({ teamId, ownerSessionId: S.frontend, patterns: ['src/client/**'], purpose: 'client glob' });
        assert.equal(ok.length, 1);
    });
    it('atomic batch: no partial claims when one pattern conflicts', async () => {
        const { service, teamId } = await makeFixture([
            { name: 'b', role: 'b', sessionId: S.backend },
            { name: 'f', role: 'f', sessionId: S.frontend },
        ]);
        await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server/auth.ts'], purpose: 'backend' });
        await assert.rejects(() => service.claimFiles({ teamId, ownerSessionId: S.frontend, patterns: ['src/client/app.ts', 'src/server/auth.ts'], purpose: 'mixed' }), (error) => {
            assert.equal(error.code, 'FILE_CLAIM_CONFLICT');
            return true;
        });
        const listed = await service.listFileClaims(teamId, S.lead);
        assert.equal(listed.length, 1, 'the non-conflicting pattern was not partially claimed');
    });
    it('non-owner cannot release; lead can', async () => {
        const { service, teamId } = await makeFixture([
            { name: 'b', role: 'b', sessionId: S.backend },
            { name: 'f', role: 'f', sessionId: S.frontend },
        ]);
        const claims = await service.claimFiles({ teamId, ownerSessionId: S.backend, patterns: ['src/server/auth.ts'], purpose: 'backend' });
        await assert.rejects(() => service.releaseFiles([claims[0].id], S.frontend), (error) => {
            assert.equal(error.code, 'UNAUTHORIZED_TEAM_ACCESS');
            return true;
        });
        await service.releaseFiles([claims[0].id], S.lead);
        assert.equal((await service.listFileClaims(teamId, S.lead)).length, 0);
    });
});
