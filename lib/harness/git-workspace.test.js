import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeGitWorkspaceAdapter } from "./git-workspace.js";
async function directories() {
    const root = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-git-'));
    const repo = join(root, 'repo');
    const worktrees = join(root, 'worktrees');
    await mkdir(repo);
    await mkdir(worktrees);
    return { root, repo, worktrees };
}
describe('native Git workspace adapter', () => {
    it('uses only fixed git argv and records status/commit evidence', async () => {
        const paths = await directories();
        const worktreePath = join(paths.worktrees, 'backend');
        await mkdir(worktreePath);
        const calls = [];
        const adapter = new NativeGitWorkspaceAdapter({
            allowedRoots: [paths.root],
            runGit: async (cwd, args) => {
                calls.push({ cwd, args });
                if (args[0] === 'status')
                    return { stdout: ' M src/api.ts\0?? shared/types.ts\0', stderr: '' };
                if (args[0] === 'log')
                    return { stdout: 'add notes API\n', stderr: '' };
                if (args[0] === 'diff-tree')
                    return { stdout: 'src/api.ts\nshared/types.ts\n', stderr: '' };
                if (args[0] === 'rev-parse')
                    return { stdout: '0123456789abcdef0123456789abcdef01234567\n', stderr: '' };
                return { stdout: '', stderr: '' };
            },
        });
        const branch = await adapter.createBranch({ repositoryRoot: paths.repo, baseRef: 'HEAD', branch: 'feature/backend' });
        assert.equal(branch.head, '0123456789abcdef0123456789abcdef01234567');
        await adapter.addWorktree({ repositoryRoot: paths.repo, branch: 'feature/backend', worktreePath });
        const status = await adapter.status({ repositoryRoot: paths.repo, worktreePath });
        assert.deepEqual(status.changedFiles, ['src/api.ts', 'shared/types.ts']);
        assert.equal(status.clean, false);
        const commit = await adapter.recordCommit({
            repositoryRoot: paths.repo,
            worktreePath,
            teamId: 'team_1',
            workspaceId: 'workspace_1',
            memberId: 'member_1',
        });
        assert.equal(commit.subject, 'add notes API');
        assert.deepEqual(commit.files, ['src/api.ts', 'shared/types.ts']);
        assert.ok(calls.length >= 6);
        for (const call of calls) {
            assert.equal(call.args.some((arg) => /[;&|`$]/.test(arg)), false, `unsafe shell syntax in argv: ${call.args.join(' ')}`);
        }
        assert.deepEqual(calls[0]?.args, ['branch', 'feature/backend', 'HEAD']);
        assert.deepEqual(calls[1]?.args, ['rev-parse', '--verify', 'feature/backend']);
    });
    it('rejects branch/path traversal before invoking git', async () => {
        const paths = await directories();
        let invoked = false;
        const adapter = new NativeGitWorkspaceAdapter({
            allowedRoots: [paths.root],
            runGit: async () => {
                invoked = true;
                return { stdout: '', stderr: '' };
            },
        });
        await assert.rejects(() => adapter.createBranch({ repositoryRoot: paths.repo, baseRef: 'HEAD', branch: '../escape' }), (error) => error.code === 'INVALID_INPUT');
        await assert.rejects(() => adapter.addWorktree({ repositoryRoot: paths.repo, branch: 'feature/safe', worktreePath: join(paths.root, '..', 'escape') }), (error) => error.code === 'WORKSPACE_PATH_ESCAPE');
        assert.equal(invoked, false);
    });
    it('rejects a symlinked worktree that resolves outside the approved root', async (t) => {
        const paths = await directories();
        const outside = await mkdtemp(join(tmpdir(), 'dsh-agent-teams-outside-'));
        const link = join(paths.worktrees, 'escape');
        try {
            await symlink(outside, link, 'junction');
        }
        catch {
            t.skip('directory symlinks are unavailable in this Windows environment');
            return;
        }
        const adapter = new NativeGitWorkspaceAdapter({ allowedRoots: [paths.root], runGit: async () => ({ stdout: '', stderr: '' }) });
        await assert.rejects(() => adapter.addWorktree({ repositoryRoot: paths.repo, branch: 'feature/safe', worktreePath: link }), (error) => error.code === 'WORKSPACE_PATH_ESCAPE');
    });
});
