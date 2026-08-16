import { TeamError } from "./errors.js";
import { newId } from "./ids.js";
/** A typed error that shares the Service/tool error serialization contract. */
export class WorkspaceError extends TeamError {
    constructor(code, message, details) {
        super(code, message, details);
        this.name = 'WorkspaceError';
    }
}
function fail(code, message, details) {
    throw new WorkspaceError(code, message, details);
}
function timestamp(options) {
    return options.now?.() ?? Date.now();
}
function isDrivePath(value) {
    return /^[A-Za-z]:\//.test(value);
}
function comparablePath(value) {
    return isDrivePath(value) ? value.toLowerCase() : value;
}
/** Normalize an absolute host path without consulting the filesystem. */
export function normalizeHostPath(value, field = 'path') {
    const raw = value.trim().replaceAll('\\', '/');
    if (raw.length === 0 || raw.includes('\0'))
        fail('INVALID_INPUT', `${field} must be a non-empty path`, { field });
    const drive = /^[A-Za-z]:/.exec(raw)?.[0];
    if (drive !== undefined && !raw.startsWith(`${drive}/`)) {
        fail('WORKSPACE_PATH_ESCAPE', `${field} must be absolute`, { field, value });
    }
    if (!raw.startsWith('/') && drive === undefined) {
        fail('WORKSPACE_PATH_ESCAPE', `${field} must be absolute`, { field, value });
    }
    const prefix = drive === undefined ? '' : drive.toUpperCase();
    const body = drive === undefined ? raw : raw.slice(2);
    const parts = [];
    for (const part of body.split('/')) {
        if (part === '' || part === '.')
            continue;
        if (part === '..') {
            if (parts.length === 0)
                fail('WORKSPACE_PATH_ESCAPE', `${field} escapes its filesystem root`, { field, value });
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    if (drive !== undefined)
        return `${prefix}/${parts.join('/')}`.replace(/\/$/, '/');
    return `/${parts.join('/')}`.replace(/\/$/, '/') || '/';
}
function isWithinRoot(root, candidate) {
    const comparableRoot = comparablePath(root).replace(/\/$/, '');
    const comparableCandidate = comparablePath(candidate);
    return comparableCandidate === comparableRoot || comparableCandidate.startsWith(`${comparableRoot}/`);
}
function normalizePattern(value) {
    const raw = value.trim().replaceAll('\\', '/');
    if (raw.length === 0 || raw.includes('\0'))
        fail('INVALID_INPUT', 'file claim pattern must not be empty');
    if (raw.startsWith('/') || isDrivePath(raw) || raw.split('/').some((part) => part === '..')) {
        fail('WORKSPACE_PATH_ESCAPE', `file claim ${value} is outside the repository`, { pattern: value });
    }
    const withoutDot = raw.replace(/^\.\//, '');
    const hasGlob = /[*?\[]/.test(withoutDot);
    const directory = !hasGlob && withoutDot.endsWith('/');
    const pattern = directory ? withoutDot.replace(/\/+$/, '') : withoutDot;
    if (pattern.length === 0 || pattern === '.')
        fail('INVALID_INPUT', `invalid file claim pattern ${value}`);
    return { pattern, kind: hasGlob ? 'glob' : directory ? 'directory' : 'file' };
}
function normalizePatternInput(input) {
    const normalized = normalizePattern(typeof input === 'string' ? input : input.pattern);
    if (typeof input === 'string' || input.kind === undefined)
        return normalized;
    if (input.kind === 'file' && normalized.kind !== 'file') {
        fail('INVALID_INPUT', `file claim kind does not match ${input.pattern}`, { pattern: input.pattern, kind: input.kind });
    }
    if (input.kind === 'directory' && normalized.kind === 'glob') {
        fail('INVALID_INPUT', `directory claim cannot contain a glob ${input.pattern}`, { pattern: input.pattern, kind: input.kind });
    }
    return { pattern: normalized.pattern, kind: input.kind };
}
function literalPrefix(pattern) {
    const index = pattern.search(/[*?\[]/);
    return (index < 0 ? pattern : pattern.slice(0, index)).replace(/\/+$/, '');
}
function isWithinPattern(scope, candidate) {
    return scope === '' || candidate === scope || candidate.startsWith(`${scope}/`);
}
function globMatches(pattern, value) {
    let expression = '^';
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index];
        if (char === '*') {
            if (pattern[index + 1] === '*') {
                expression += '.*';
                index += 1;
            }
            else {
                expression += '[^/]*';
            }
        }
        else if (char === '?') {
            expression += '[^/]';
        }
        else if (char === '[') {
            const close = pattern.indexOf(']', index + 1);
            if (close > index + 1) {
                expression += pattern.slice(index, close + 1);
                index = close;
            }
            else {
                expression += '\\[';
            }
        }
        else {
            expression += char.replace(/[\\^$+?.()|{}]/g, '\\$&');
        }
    }
    return new RegExp(`${expression}$`).test(value);
}
function patternsConflict(a, b) {
    if (a.pattern === b.pattern)
        return true;
    const aPrefix = literalPrefix(a.pattern);
    const bPrefix = literalPrefix(b.pattern);
    if (a.kind === 'file' && b.kind === 'file')
        return false;
    if (a.kind === 'directory' && b.kind === 'file')
        return isWithinPattern(a.pattern, b.pattern);
    if (a.kind === 'file' && b.kind === 'directory')
        return isWithinPattern(b.pattern, a.pattern);
    if (a.kind === 'file' && b.kind === 'glob')
        return globMatches(b.pattern, a.pattern);
    if (a.kind === 'glob' && b.kind === 'file')
        return globMatches(a.pattern, b.pattern);
    if (a.kind === 'directory' || b.kind === 'directory') {
        const aDirectory = a.kind === 'directory' ? a.pattern : aPrefix;
        const bDirectory = b.kind === 'directory' ? b.pattern : bPrefix;
        return isWithinPattern(aDirectory, bDirectory) || isWithinPattern(bDirectory, aDirectory);
    }
    // Simple globs overlap when their literal scopes overlap. This is
    // intentionally conservative: denying an ambiguous lease is safer than
    // allowing two agents to edit the same possible path.
    return isWithinPattern(aPrefix, bPrefix) || isWithinPattern(bPrefix, aPrefix);
}
class SerialMutex {
    tail = Promise.resolve();
    async run(operation) {
        const previous = this.tail;
        let release;
        this.tail = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
}
export class WorkspaceManager {
    options;
    allowedRoots;
    leaseTimeoutMs;
    mutexes = new Map();
    constructor(options) {
        this.options = options;
        this.leaseTimeoutMs = options.leaseTimeoutMs ?? 5 * 60 * 1000;
        this.allowedRoots = options.allowedRoots?.map((root) => normalizeHostPath(root, 'allowed root'));
    }
    mutex(teamId) {
        let mutex = this.mutexes.get(teamId);
        if (mutex === undefined) {
            mutex = new SerialMutex();
            this.mutexes.set(teamId, mutex);
        }
        return mutex;
    }
    async assertTeam(teamId) {
        const team = await this.options.store.get('teams', teamId);
        if (team === undefined)
            fail('TEAM_NOT_FOUND', `team ${teamId} not found`, { teamId });
        return team;
    }
    async assertActor(actor) {
        const team = await this.assertTeam(String(actor.teamId));
        const member = actor.memberId === undefined
            ? (await this.options.store.list('members', (candidate) => candidate.teamId === team.id && candidate.sessionId === actor.sessionId))[0]
            : await this.options.store.get('members', String(actor.memberId));
        if (member !== undefined) {
            if (member.teamId !== team.id || member.sessionId !== actor.sessionId) {
                fail('UNAUTHORIZED_TEAM_ACCESS', 'member/session binding does not match the team actor', {
                    teamId: team.id,
                    memberId: member.id,
                    sessionId: actor.sessionId,
                });
            }
            return { team, member };
        }
        if (actor.memberId !== undefined)
            fail('MEMBER_NOT_FOUND', `member ${actor.memberId} not found`, { memberId: actor.memberId });
        if (team.leadSessionId !== actor.sessionId) {
            fail('UNAUTHORIZED_TEAM_ACCESS', `session ${actor.sessionId} is not a member of team ${team.id}`, {
                teamId: team.id,
                sessionId: actor.sessionId,
            });
        }
        return { team };
    }
    normalizeAllowedRoots(repositoryRoot) {
        return this.allowedRoots === undefined || this.allowedRoots.length === 0
            ? [repositoryRoot]
            : this.allowedRoots;
    }
    assertAllowedPath(path, field, roots) {
        if (!roots.some((root) => isWithinRoot(root, path))) {
            fail('WORKSPACE_PATH_ESCAPE', `${field} is outside the approved host roots`, { field, path, roots });
        }
    }
    async assertWorkspaceActor(workspace, actor) {
        if (String(actor.teamId) !== workspace.teamId) {
            fail('UNAUTHORIZED_TEAM_ACCESS', 'workspace does not belong to the actor team', { workspaceId: workspace.id, teamId: actor.teamId });
        }
        const access = await this.assertActor(actor);
        if (workspace.memberId !== undefined && workspace.memberId !== access.member?.id) {
            fail('WORKSPACE_OWNERSHIP_CONFLICT', 'workspace is owned by another member', {
                workspaceId: workspace.id,
                ownerMemberId: workspace.memberId,
                actorMemberId: access.member?.id,
            });
        }
        if (workspace.memberId === undefined && access.team.leadSessionId !== actor.sessionId) {
            fail('WORKSPACE_OWNERSHIP_CONFLICT', 'lead-owned workspace requires the lead session', { workspaceId: workspace.id });
        }
        return access.member;
    }
    async workspace(workspaceId) {
        const workspace = await this.options.store.get('workspaces', workspaceId);
        if (workspace === undefined)
            fail('WORKSPACE_NOT_FOUND', `workspace ${workspaceId} not found`, { workspaceId });
        return workspace;
    }
    async create(input) {
        const { team, member } = await this.assertActor({ teamId: input.teamId, memberId: input.memberId, sessionId: input.sessionId });
        const repositoryRoot = normalizeHostPath(input.repositoryRoot, 'repositoryRoot');
        const worktreePath = normalizeHostPath(input.worktreePath, 'worktreePath');
        const roots = this.normalizeAllowedRoots(repositoryRoot);
        this.assertAllowedPath(repositoryRoot, 'repositoryRoot', roots);
        this.assertAllowedPath(worktreePath, 'worktreePath', roots);
        if (repositoryRoot === worktreePath) {
            fail('WORKSPACE_PATH_ESCAPE', 'worktreePath must be different from repositoryRoot', { repositoryRoot, worktreePath });
        }
        if (input.branch.trim().length === 0 || input.branch.startsWith('-') || input.branch.includes('..') || input.branch.includes('\\') || /[\0\s]/.test(input.branch)) {
            fail('INVALID_INPUT', `invalid branch ${input.branch}`, { branch: input.branch });
        }
        if (input.taskId !== undefined) {
            const task = await this.options.store.get('tasks', String(input.taskId));
            if (task === undefined)
                fail('TASK_NOT_FOUND', `task ${input.taskId} not found`, { taskId: input.taskId });
            if (task.teamId !== team.id)
                fail('UNAUTHORIZED_TEAM_ACCESS', 'task belongs to another team', { taskId: input.taskId, teamId: team.id });
        }
        const existing = await this.options.store.list('workspaces', (candidate) => candidate.teamId === team.id && candidate.worktreePath === worktreePath && candidate.status !== 'abandoned');
        if (existing.length > 0) {
            fail('WORKSPACE_OWNERSHIP_CONFLICT', `worktree ${worktreePath} is already leased`, { workspaceId: existing[0]?.id, worktreePath });
        }
        const createdAt = timestamp(this.options);
        const workspace = {
            id: newId('workspace'),
            teamId: team.id,
            memberId: member?.id,
            taskId: input.taskId,
            repositoryRoot,
            branch: input.branch,
            worktreePath,
            status: 'requested',
            leaseId: input.leaseId ?? newId('lease'),
            createdAt,
            updatedAt: createdAt,
            lastHeartbeatAt: createdAt,
        };
        await this.options.store.put('workspaces', workspace.id, workspace);
        return workspace;
    }
    async get(workspaceId, actor) {
        const workspace = await this.workspace(workspaceId);
        await this.assertWorkspaceActor(workspace, actor);
        return workspace;
    }
    async list(teamId, actor) {
        await this.assertActor({ ...actor, teamId });
        return this.options.store.list('workspaces', (workspace) => workspace.teamId === String(teamId));
    }
    async setStatus(workspaceId, actor, status) {
        const current = await this.workspace(workspaceId);
        await this.assertWorkspaceActor(current, actor);
        const result = await this.options.store.update('workspaces', workspaceId, (workspace) => ({
            ...workspace,
            status,
            updatedAt: timestamp(this.options),
            lastHeartbeatAt: timestamp(this.options),
        }));
        return result.value;
    }
    async heartbeat(workspaceId, actor) {
        return this.setStatus(workspaceId, actor, (await this.workspace(workspaceId)).status);
    }
    async releaseWorkspace(workspaceId, actor) {
        return this.setStatus(workspaceId, actor, 'abandoned');
    }
    async handoffWorkspace(workspaceId, actor, target) {
        const current = await this.workspace(workspaceId);
        const access = await this.assertWorkspaceActor(current, actor);
        if (access === undefined && actor.sessionId !== (await this.assertTeam(current.teamId)).leadSessionId) {
            fail('WORKSPACE_OWNERSHIP_CONFLICT', 'only the current owner or lead may hand off a workspace', { workspaceId });
        }
        const targetAccess = await this.assertActor({ teamId: current.teamId, sessionId: target.sessionId, memberId: target.memberId });
        if (targetAccess.member === undefined)
            fail('MEMBER_NOT_FOUND', 'workspace handoff target must be a teammate', { memberId: target.memberId });
        const result = await this.options.store.update('workspaces', workspaceId, (workspace) => ({
            ...workspace,
            memberId: targetAccess.member?.id,
            leaseId: newId('lease'),
            updatedAt: timestamp(this.options),
            lastHeartbeatAt: timestamp(this.options),
        }));
        return result.value;
    }
    async recoverStale(teamId) {
        const now = timestamp(this.options);
        const candidates = await this.options.store.list('workspaces', (workspace) => (teamId === undefined || workspace.teamId === String(teamId)) &&
            workspace.status !== 'abandoned' &&
            workspace.status !== 'merged' &&
            now - workspace.lastHeartbeatAt > this.leaseTimeoutMs);
        const recovered = [];
        for (const candidate of candidates) {
            const result = await this.options.store.update('workspaces', candidate.id, (workspace) => workspace.status === 'abandoned' || workspace.status === 'merged'
                ? workspace
                : { ...workspace, status: 'recoverable', updatedAt: now });
            if (result.value !== undefined && result.value.status === 'recoverable') {
                recovered.push(result.value);
            }
        }
        return recovered;
    }
    async claimFiles(input) {
        const access = await this.assertActor(input.actor);
        if (String(input.teamId) !== access.team.id) {
            fail('UNAUTHORIZED_TEAM_ACCESS', 'file lease team does not match actor team', { teamId: input.teamId });
        }
        if (input.workspaceId !== undefined) {
            const workspace = await this.workspace(String(input.workspaceId));
            await this.assertWorkspaceActor(workspace, input.actor);
            if (workspace.status === 'abandoned' || workspace.status === 'merged' || workspace.status === 'recoverable') {
                fail('WORKSPACE_OWNERSHIP_CONFLICT', `workspace ${workspace.id} is not claimable in ${workspace.status} state`, { workspaceId: workspace.id, status: workspace.status });
            }
        }
        const normalized = input.patterns.map(normalizePatternInput);
        return this.mutex(access.team.id).run(async () => {
            const existing = await this.options.store.list('file_claims', (claim) => claim.teamId === access.team.id);
            for (const target of normalized) {
                const conflict = existing.find((claim) => claim.ownerSessionId !== input.actor.sessionId && patternsConflict(claim, target));
                if (conflict !== undefined) {
                    fail('FILE_CLAIM_CONFLICT', `claim ${target.pattern} conflicts with ${conflict.pattern}`, {
                        teamId: access.team.id,
                        pattern: target.pattern,
                        conflictingClaim: conflict.id,
                        ownerSessionId: conflict.ownerSessionId,
                    });
                }
            }
            const created = [];
            for (const target of normalized) {
                const claim = {
                    id: newId('claim'),
                    teamId: access.team.id,
                    ownerSessionId: input.actor.sessionId,
                    ownerMemberId: access.member?.id,
                    pattern: target.pattern,
                    kind: target.kind,
                    purpose: input.purpose,
                    createdAt: timestamp(this.options),
                };
                await this.options.store.put('file_claims', claim.id, claim);
                created.push(claim);
            }
            return created;
        });
    }
    async releaseFiles(teamId, claimIds, actor) {
        const access = await this.assertActor({ ...actor, teamId });
        return this.mutex(access.team.id).run(async () => {
            const released = [];
            for (const claimId of claimIds) {
                const claim = await this.options.store.get('file_claims', claimId);
                if (claim === undefined || claim.teamId !== access.team.id) {
                    fail('FILE_CLAIM_NOT_FOUND', `file claim ${claimId} not found`, { claimId, teamId });
                }
                if (claim.ownerSessionId !== actor.sessionId && access.team.leadSessionId !== actor.sessionId) {
                    fail('WORKSPACE_OWNERSHIP_CONFLICT', `session ${actor.sessionId} cannot release claim ${claimId}`, { claimId, ownerSessionId: claim.ownerSessionId });
                }
                await this.options.store.remove('file_claims', claimId);
                released.push(claim);
            }
            return released;
        });
    }
    async handoffFile(input) {
        const access = await this.assertActor({ teamId: input.teamId, sessionId: input.fromSessionId });
        const target = await this.assertActor({ teamId: input.teamId, sessionId: input.toSessionId, memberId: input.toMemberId });
        if (target.member === undefined)
            fail('MEMBER_NOT_FOUND', 'file lease handoff target must be a teammate', { memberId: input.toMemberId });
        return this.mutex(access.team.id).run(async () => {
            const claim = await this.options.store.get('file_claims', input.claimId);
            if (claim === undefined || claim.teamId !== access.team.id)
                fail('FILE_CLAIM_NOT_FOUND', `file claim ${input.claimId} not found`, { claimId: input.claimId });
            if (claim.ownerSessionId !== input.fromSessionId && access.team.leadSessionId !== input.fromSessionId) {
                fail('WORKSPACE_OWNERSHIP_CONFLICT', 'file lease handoff source is not the owner or lead', { claimId: input.claimId });
            }
            const result = await this.options.store.update('file_claims', input.claimId, (current) => ({
                ...current,
                ownerSessionId: input.toSessionId,
                ownerMemberId: target.member?.id,
                purpose: input.purpose ?? current.purpose,
            }));
            return result.value;
        });
    }
}
export const workspaceInternals = {
    normalizePattern,
    patternsConflict,
    isWithinRoot,
};
