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
import type { TeamMemberId, TaskId, TeamId, WorkspaceId, WorkspaceCommit } from '../core/types.ts';
import { newId } from '../core/ids.ts';
import { normalizeHostPath } from '../core/workspace.ts';

const execFile = promisify(execFileCallback);

export type GitWorkspaceErrorCode =
  | 'WORKSPACE_PATH_ESCAPE'
  | 'WORKTREE_CREATE_FAILED'
  | 'WORKTREE_DIRTY'
  | 'BRANCH_ALREADY_EXISTS'
  | 'COMMIT_NOT_RECORDED'
  | 'INVALID_INPUT';

export class GitWorkspaceError extends Error {
  readonly code: GitWorkspaceErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: GitWorkspaceErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'GitWorkspaceError';
    this.code = code;
    this.details = details;
  }

  toJSON(): { code: GitWorkspaceErrorCode; message: string; details?: Record<string, unknown> } {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

/** Test seam only; production always uses execFile with shell disabled. */
export type GitCommandRunner = (cwd: string, args: readonly string[]) => Promise<GitCommandResult>;

export interface GitWorkspaceAdapterOptions {
  allowedRoots: string[];
  runGit?: GitCommandRunner;
}

export interface GitWorkspaceAdapter {
  createBranch(input: { repositoryRoot: string; baseRef: string; branch: string }): Promise<{ head?: string }>;
  addWorktree(input: { repositoryRoot: string; branch: string; worktreePath: string }): Promise<void>;
  status(input: { repositoryRoot: string; worktreePath: string }): Promise<{ clean: boolean; head?: string; changedFiles: string[] }>;
  recordCommit(input: {
    repositoryRoot: string;
    worktreePath: string;
    teamId: TeamId;
    workspaceId: WorkspaceId;
    memberId: TeamMemberId;
    taskId?: TaskId;
  }): Promise<WorkspaceCommit>;
  removeWorktree(input: { repositoryRoot: string; worktreePath: string }): Promise<void>;
}

function fail(code: GitWorkspaceErrorCode, message: string, details?: Record<string, unknown>): never {
  throw new GitWorkspaceError(code, message, details);
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function defaultRunGit(cwd: string, args: readonly string[]): Promise<GitCommandResult> {
  const result = await execFile('git', [...args], {
    cwd,
    shell: false,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return { stdout: String(result.stdout), stderr: String(result.stderr) };
}

function validateBranch(branch: string): void {
  if (
    branch.length === 0 ||
    branch.startsWith('-') ||
    branch.startsWith('/') ||
    branch.endsWith('/') ||
    branch.endsWith('.') ||
    branch.endsWith('.lock') ||
    branch.includes('..') ||
    branch.includes('@{') ||
    /[\0\s\\]/.test(branch) ||
    !/^[A-Za-z0-9._/-]+$/.test(branch)
  ) {
    fail('INVALID_INPUT', `invalid Git branch ${branch}`, { branch });
  }
}

function validateRevision(ref: string, field: string): void {
  if (ref.length === 0 || ref.startsWith('-') || ref.includes('..') || /[\0\s\\]/.test(ref) || !/^[A-Za-z0-9._/~^:@-]+$/.test(ref)) {
    fail('INVALID_INPUT', `invalid Git ${field} ${ref}`, { [field]: ref });
  }
}

function parseLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function parseChangedFiles(value: string): string[] {
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

function isWithin(root: string, candidate: string): boolean {
  const rootResolved = resolve(root);
  const candidateResolved = resolve(candidate);
  const relation = relative(rootResolved, candidateResolved);
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

export class NativeGitWorkspaceAdapter implements GitWorkspaceAdapter {
  private readonly roots: string[];
  private readonly run: GitCommandRunner;

  constructor(options: GitWorkspaceAdapterOptions) {
    if (options.allowedRoots.length === 0) fail('INVALID_INPUT', 'at least one allowed Git root is required');
    this.roots = options.allowedRoots.map((root) => resolve(normalizeHostPath(root, 'allowed root')));
    this.run = options.runGit ?? defaultRunGit;
  }

  private assertLexicallyAllowed(candidate: string, field: string): void {
    if (!this.roots.some((root) => isWithin(root, candidate))) {
      fail('WORKSPACE_PATH_ESCAPE', `${field} is outside approved Git roots`, { field, candidate, roots: this.roots });
    }
  }

  private async safePath(raw: string, field: string, allowMissing: boolean): Promise<string> {
    const candidate = resolve(normalizeHostPath(raw, field));
    this.assertLexicallyAllowed(candidate, field);
    try {
      const actual = resolve(await realpath(candidate));
      this.assertLexicallyAllowed(actual, field);
      return actual;
    } catch (error) {
      if (!allowMissing || !(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      const parent = resolve(await realpath(dirname(candidate)));
      this.assertLexicallyAllowed(parent, `${field} parent`);
      return candidate;
    }
  }

  private async existingDirectory(raw: string, field: string): Promise<string> {
    const candidate = await this.safePath(raw, field, false);
    const details = await stat(candidate);
    if (!details.isDirectory()) fail('INVALID_INPUT', `${field} must be a directory`, { field, path: candidate });
    return candidate;
  }

  private async repository(raw: string): Promise<string> {
    return this.existingDirectory(raw, 'repositoryRoot');
  }

  private async worktree(raw: string, allowMissing: boolean): Promise<string> {
    const candidate = await this.safePath(raw, 'worktreePath', allowMissing);
    if (!allowMissing) {
      const details = await stat(candidate);
      if (!details.isDirectory()) fail('INVALID_INPUT', 'worktreePath must be a directory', { worktreePath: candidate });
    } else {
      try {
        const details = await lstat(candidate);
        if (details.isSymbolicLink()) fail('WORKSPACE_PATH_ESCAPE', 'worktreePath cannot be a symlink', { worktreePath: candidate });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
    }
    return candidate;
  }

  private async git(cwd: string, args: readonly string[]): Promise<GitCommandResult> {
    try {
      return await this.run(cwd, args);
    } catch (error) {
      throw new GitWorkspaceError('WORKTREE_CREATE_FAILED', `git ${args.join(' ')} failed`, {
        cwd,
        args: [...args],
        cause: errorText(error),
      });
    }
  }

  async createBranch(input: { repositoryRoot: string; baseRef: string; branch: string }): Promise<{ head?: string }> {
    const repositoryRoot = await this.repository(input.repositoryRoot);
    validateRevision(input.baseRef, 'baseRef');
    validateBranch(input.branch);
    try {
      await this.git(repositoryRoot, ['branch', input.branch, input.baseRef]);
    } catch (error) {
      const diagnostic = `${errorText(error)} ${error instanceof GitWorkspaceError ? JSON.stringify(error.details ?? {}) : ''}`;
      if (/already exists|not a valid branch name/i.test(diagnostic)) {
        fail('BRANCH_ALREADY_EXISTS', `branch ${input.branch} already exists or is invalid`, { branch: input.branch });
      }
      throw error;
    }
    const head = await this.git(repositoryRoot, ['rev-parse', '--verify', input.branch]);
    return { head: head.stdout.trim() || undefined };
  }

  async addWorktree(input: { repositoryRoot: string; branch: string; worktreePath: string }): Promise<void> {
    const repositoryRoot = await this.repository(input.repositoryRoot);
    const worktreePath = await this.worktree(input.worktreePath, true);
    validateBranch(input.branch);
    try {
      await this.git(repositoryRoot, ['worktree', 'add', '--', worktreePath, input.branch]);
    } catch (error) {
      fail('WORKTREE_CREATE_FAILED', `worktree ${worktreePath} could not be created`, {
        worktreePath,
        branch: input.branch,
        cause: errorText(error),
      });
    }
  }

  async status(input: { repositoryRoot: string; worktreePath: string }): Promise<{ clean: boolean; head?: string; changedFiles: string[] }> {
    await this.repository(input.repositoryRoot);
    const worktreePath = await this.worktree(input.worktreePath, false);
    const head = await this.git(worktreePath, ['rev-parse', '--verify', 'HEAD']);
    const status = await this.git(worktreePath, ['status', '--porcelain=v1', '-z']);
    const changedFiles = parseChangedFiles(status.stdout);
    return { clean: changedFiles.length === 0, head: head.stdout.trim() || undefined, changedFiles };
  }

  async recordCommit(input: {
    repositoryRoot: string;
    worktreePath: string;
    teamId: TeamId;
    workspaceId: WorkspaceId;
    memberId: TeamMemberId;
    taskId?: TaskId;
  }): Promise<WorkspaceCommit> {
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
      id: newId('commit') as WorkspaceCommit['id'],
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

  async removeWorktree(input: { repositoryRoot: string; worktreePath: string }): Promise<void> {
    const repositoryRoot = await this.repository(input.repositoryRoot);
    const worktreePath = await this.worktree(input.worktreePath, true);
    try {
      await this.git(repositoryRoot, ['worktree', 'remove', '--force', '--', worktreePath]);
    } catch (error) {
      fail('WORKTREE_CREATE_FAILED', `worktree ${worktreePath} could not be removed`, {
        worktreePath,
        cause: errorText(error),
      });
    }
  }
}
