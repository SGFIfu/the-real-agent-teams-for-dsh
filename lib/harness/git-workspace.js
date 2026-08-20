/**
 * Host-side Git workspace adapter.
 *
 * The adapter has one executable (`git`) and a small, fixed argv surface. A
 * caller can inject a runner for deterministic tests, but cannot provide an
 * arbitrary executable or shell command. Filesystem checks happen before every
 * Git operation so a symlink cannot move a worktree outside an approved root.
 */
import { execFile as execFileCallback } from 'node:child_process';
import { lstat, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { newId } from "../core/ids.js";
import { normalizeHostPath } from "../core/workspace.js";
const execFile = promisify(execFileCallback);
export class GitWorkspaceError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'GitWorkspaceError';
        this.code = code;
        this.details = details;
    }
    toJSON() {
        return { code: this.code, message: this.message, details: this.details };
    }
}
function fail(code, message, details) {
    throw new GitWorkspaceError(code, message, details);
}
function errorText(error) {
    if (error instanceof Error)
        return error.message;
    return String(error);
}
async function defaultRunGit(cwd, args) {
    const result = await execFile('git', [...args], {
        cwd,
        shell: false,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
}
function validateBranch(branch) {
    if (branch.length === 0 ||
        branch.startsWith('-') ||
        branch.startsWith('/') ||
        branch.endsWith('/') ||
        branch.endsWith('.') ||
        branch.endsWith('.lock') ||
        branch.includes('..') ||
        branch.includes('@{') ||
        /[\0\s\\]/.test(branch) ||
        !/^[A-Za-z0-9._/-]+$/.test(branch)) {
        fail('INVALID_INPUT', `invalid Git branch ${branch}`, { branch });
    }
}
function validateRevision(ref, field) {
    if (ref.length === 0 || ref.startsWith('-') || ref.includes('..') || /[\0\s\\]/.test(ref) || !/^[A-Za-z0-9._/~^:@-]+$/.test(ref)) {
        fail('INVALID_INPUT', `invalid Git ${field} ${ref}`, { [field]: ref });
    }
}
function parseLines(value) {
    return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function parseChangedFiles(value) {
    return value
        .split('\0')
        .map((entry) => entry.replace(/\r?\n$/, ''))
        .filter((entry) => entry.trim().length > 0)
        .map((entry) => {
        const porcelainPath = /^[ MADRCU?!]{2} /.test(entry) ? entry.slice(3) : entry.trim();
        const separator = porcelainPath.lastIndexOf(' -> ');
        return separator >= 0 ? porcelainPath.slice(separator + 4) : porcelainPath;
    });
}
function isWithin(root, candidate) {
    const rootResolved = resolve(root);
    const candidateResolved = resolve(candidate);
    const relation = relative(rootResolved, candidateResolved);
    return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}
export class NativeGitWorkspaceAdapter {
    roots;
    run;
    constructor(options) {
        if (options.allowedRoots.length === 0)
            fail('INVALID_INPUT', 'at least one allowed Git root is required');
        this.roots = options.allowedRoots.map((root) => resolve(normalizeHostPath(root, 'allowed root')));
        this.run = options.runGit ?? defaultRunGit;
    }
    assertLexicallyAllowed(candidate, field) {
        if (!this.roots.some((root) => isWithin(root, candidate))) {
            fail('WORKSPACE_PATH_ESCAPE', `${field} is outside approved Git roots`, { field, candidate, roots: this.roots });
        }
    }
    async safePath(raw, field, allowMissing) {
        const candidate = resolve(normalizeHostPath(raw, field));
        this.assertLexicallyAllowed(candidate, field);
        try {
            const actual = resolve(await realpath(candidate));
            this.assertLexicallyAllowed(actual, field);
            return actual;
        }
        catch (error) {
            if (!allowMissing || !(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                throw error;
            const parent = resolve(await realpath(dirname(candidate)));
            this.assertLexicallyAllowed(parent, `${field} parent`);
            return candidate;
        }
    }
    async existingDirectory(raw, field) {
        const candidate = await this.safePath(raw, field, false);
        const details = await stat(candidate);
        if (!details.isDirectory())
            fail('INVALID_INPUT', `${field} must be a directory`, { field, path: candidate });
        return candidate;
    }
    async repository(raw) {
        return this.existingDirectory(raw, 'repositoryRoot');
    }
    async worktree(raw, allowMissing) {
        const candidate = await this.safePath(raw, 'worktreePath', allowMissing);
        if (!allowMissing) {
            const details = await stat(candidate);
            if (!details.isDirectory())
                fail('INVALID_INPUT', 'worktreePath must be a directory', { worktreePath: candidate });
        }
        else {
            try {
                const details = await lstat(candidate);
                if (details.isSymbolicLink())
                    fail('WORKSPACE_PATH_ESCAPE', 'worktreePath cannot be a symlink', { worktreePath: candidate });
            }
            catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
                    throw error;
            }
        }
        return candidate;
    }
    async git(cwd, args) {
        try {
            return await this.run(cwd, args);
        }
        catch (error) {
            throw new GitWorkspaceError('WORKTREE_CREATE_FAILED', `git ${args.join(' ')} failed`, {
                cwd,
                args: [...args],
                cause: errorText(error),
            });
        }
    }
    async createBranch(input) {
        const repositoryRoot = await this.repository(input.repositoryRoot);
        validateRevision(input.baseRef, 'baseRef');
        validateBranch(input.branch);
        try {
            await this.git(repositoryRoot, ['branch', input.branch, input.baseRef]);
        }
        catch (error) {
            const diagnostic = `${errorText(error)} ${error instanceof GitWorkspaceError ? JSON.stringify(error.details ?? {}) : ''}`;
            if (/already exists|not a valid branch name/i.test(diagnostic)) {
                fail('BRANCH_ALREADY_EXISTS', `branch ${input.branch} already exists or is invalid`, { branch: input.branch });
            }
            throw error;
        }
        const head = await this.git(repositoryRoot, ['rev-parse', '--verify', input.branch]);
        return { head: head.stdout.trim() || undefined };
    }
    async addWorktree(input) {
        const repositoryRoot = await this.repository(input.repositoryRoot);
        const worktreePath = await this.worktree(input.worktreePath, true);
        validateBranch(input.branch);
        try {
            await this.git(repositoryRoot, ['worktree', 'add', '--', worktreePath, input.branch]);
        }
        catch (error) {
            fail('WORKTREE_CREATE_FAILED', `worktree ${worktreePath} could not be created`, {
                worktreePath,
                branch: input.branch,
                cause: errorText(error),
            });
        }
    }
    async status(input) {
        await this.repository(input.repositoryRoot);
        const worktreePath = await this.worktree(input.worktreePath, false);
        const head = await this.git(worktreePath, ['rev-parse', '--verify', 'HEAD']);
        const status = await this.git(worktreePath, ['status', '--porcelain=v1', '-z']);
        const changedFiles = parseChangedFiles(status.stdout);
        return { clean: changedFiles.length === 0, head: head.stdout.trim() || undefined, changedFiles };
    }
    async recordCommit(input) {
        await this.repository(input.repositoryRoot);
        const worktreePath = await this.worktree(input.worktreePath, false);
        const [hash, subject, files] = await Promise.all([
            this.git(worktreePath, ['rev-parse', '--verify', 'HEAD']),
            this.git(worktreePath, ['log', '-1', '--format=%s']),
            this.git(worktreePath, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD', '--']),
        ]);
        const commitHash = hash.stdout.trim();
        if (!/^[0-9a-f]{7,64}$/i.test(commitHash)) {
            fail('COMMIT_NOT_RECORDED', 'Git HEAD did not resolve to a commit hash', { hash: commitHash });
        }
        return {
            id: newId('commit'),
            teamId: input.teamId,
            workspaceId: input.workspaceId,
            memberId: input.memberId,
            taskId: input.taskId,
            hash: commitHash,
            subject: subject.stdout.trim(),
            files: parseLines(files.stdout),
            createdAt: Date.now(),
        };
    }
    async removeWorktree(input) {
        const repositoryRoot = await this.repository(input.repositoryRoot);
        const worktreePath = await this.worktree(input.worktreePath, true);
        try {
            await this.git(repositoryRoot, ['worktree', 'remove', '--force', '--', worktreePath]);
        }
        catch (error) {
            fail('WORKTREE_CREATE_FAILED', `worktree ${worktreePath} could not be removed`, {
                worktreePath,
                cause: errorText(error),
            });
        }
    }
}
