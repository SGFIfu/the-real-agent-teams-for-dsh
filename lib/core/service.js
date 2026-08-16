import { teamError } from "./errors.js";
import { newId } from "./ids.js";
import * as events from "./events.js";
import { capabilityAudit, classifyToolCapability, hasCapabilities, normalizeCapabilities } from "./capabilities.js";
const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 };
function now() {
    return Date.now();
}
export class AgentTeamsService {
    store;
    runtime;
    sink;
    defaultProvider;
    maxActiveMembers;
    review;
    runtimeEvents;
    workspace;
    readyFlag = false;
    /** Serializes multi-record invariants within one plugin process. */
    teamMutationQueues = new Map();
    /** Coalesces duplicate wake-ups while a worker is being nudged. */
    wakeKeys = new Set();
    /** Bounded liveness retries for a wake that did not result in a claim. */
    wakeAttempts = new Map();
    wakeRetryTimers = new Map();
    static MAX_WAKE_ATTEMPTS = 3;
    static WAKE_RETRY_DELAY_MS = 1500;
    constructor(deps) {
        this.store = deps.store;
        this.runtime = deps.runtime;
        this.sink = deps.sink;
        this.defaultProvider = deps.defaultProvider ?? 'spawn';
        this.maxActiveMembers = deps.maxActiveMembers ?? 5;
        this.review = deps.review;
        this.runtimeEvents = deps.runtimeEvents;
        this.workspace = deps.workspace;
    }
    /** Resolve a team or fail with the typed error. */
    async team(teamId) {
        const value = await this.store.get('teams', teamId);
        if (value === undefined)
            throw teamError('TEAM_NOT_FOUND', `team ${teamId} not found`, { teamId });
        return value;
    }
    emit(name, payload) {
        try {
            this.sink?.emit(name, payload);
        }
        catch {
            // Observers must never break the coordination path.
        }
        this.appendRuntimeEvent(name, payload);
    }
    appendRuntimeEvent(name, payload) {
        const value = payload !== null && typeof payload === 'object' ? payload : {};
        const nestedTeam = value.team !== null && typeof value.team === 'object' ? value.team : undefined;
        const nestedEntity = ['task', 'member', 'message', 'plan', 'claim', 'finding']
            .map((key) => value[key])
            .find((entry) => entry !== null && typeof entry === 'object');
        const teamId = typeof value.teamId === 'string'
            ? value.teamId
            : typeof nestedTeam?.id === 'string'
                ? nestedTeam.id
                : typeof nestedEntity?.teamId === 'string' ? nestedEntity.teamId : undefined;
        if (this.runtimeEvents === undefined || teamId === undefined)
            return;
        const eventId = typeof value.id === 'string' ? value.id : typeof nestedEntity?.id === 'string' ? nestedEntity.id : undefined;
        void this.runtimeEvents.append({
            teamId: teamId,
            name,
            visibility: 'public',
            dedupeKey: eventId === undefined ? undefined : `${name}:${eventId}`,
            payload: value,
        }).catch(() => undefined);
    }
    async assertActor(teamId, sessionId) {
        const value = await this.team(teamId);
        if (value.leadSessionId === sessionId)
            return { team: value };
        const members = await this.store.list('members', (m) => m.teamId === teamId);
        const member = members.find((m) => m.sessionId === sessionId);
        if (member === undefined) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', `session ${sessionId} is not a member of team ${teamId}`, { teamId, sessionId });
        }
        return { team: value, member };
    }
    async assertActive(team) {
        if (team.status !== 'active') {
            throw teamError('TEAM_NOT_ACTIVE', `team ${team.id} is ${team.status}`, { teamId: team.id, status: team.status });
        }
    }
    async requireLead(teamId, actor) {
        const { team } = await this.assertActor(teamId, actor);
        if (team.leadSessionId !== actor) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the team lead may perform this operation', { teamId, actor });
        }
        return team;
    }
    async withTeamMutation(teamId, operation) {
        const previous = this.teamMutationQueues.get(teamId) ?? Promise.resolve();
        let release;
        const current = new Promise((resolve) => { release = resolve; });
        const queued = previous.then(() => current);
        this.teamMutationQueues.set(teamId, queued);
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
            if (this.teamMutationQueues.get(teamId) === queued)
                this.teamMutationQueues.delete(teamId);
        }
    }
    async ready() {
        await this.store.ready();
        this.readyFlag = true;
        // Recovery is snapshot-first: after a plugin reload, a persisted READY
        // task may have no new event to trigger scheduling. Reconcile it against
        // the current worker catalog and issue bounded native wake-ups.
        if (this.runtime !== undefined) {
            const teams = await this.store.list('teams', (team) => team.status === 'active');
            for (const team of teams)
                await this.notifyReadyWorkers(team.id);
        }
    }
    requireWorkspaceManager() {
        if (this.workspace === undefined)
            throw teamError('STORAGE_UNAVAILABLE', 'workspace coordination is not mounted');
        return this.workspace;
    }
    workspaceActor(teamId, sessionId) {
        return { teamId, sessionId };
    }
    async createWorkspace(input, actor) {
        const manager = this.requireWorkspaceManager();
        const team = await this.team(input.teamId);
        await this.assertActor(team.id, actor);
        await this.assertActive(team);
        return manager.create({ ...input, sessionId: actor });
    }
    async listWorkspaces(teamId, actor) {
        const manager = this.requireWorkspaceManager();
        return manager.list(teamId, this.workspaceActor(teamId, actor));
    }
    async getWorkspace(workspaceId, teamId, actor) {
        const manager = this.requireWorkspaceManager();
        return manager.get(workspaceId, this.workspaceActor(teamId, actor));
    }
    async heartbeatWorkspace(workspaceId, teamId, actor) {
        const manager = this.requireWorkspaceManager();
        return manager.heartbeat(workspaceId, this.workspaceActor(teamId, actor));
    }
    async releaseWorkspace(workspaceId, teamId, actor) {
        const manager = this.requireWorkspaceManager();
        return manager.releaseWorkspace(workspaceId, this.workspaceActor(teamId, actor));
    }
    async handoffWorkspace(workspaceId, teamId, actor, target) {
        const manager = this.requireWorkspaceManager();
        return manager.handoffWorkspace(workspaceId, this.workspaceActor(teamId, actor), target);
    }
    // ── teams ──────────────────────────────────────────────────────────────────
    async createTeam(input) {
        const id = newId('team');
        const timestamp = now();
        const team = {
            id,
            name: input.name,
            goal: input.goal,
            leadSessionId: input.leadSessionId,
            workspaceId: input.workspaceId,
            status: 'active',
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        await this.store.put('teams', id, team);
        this.emit(events.TEAM_CREATED, { team });
        return team;
    }
    async getTeam(teamId) {
        return this.team(teamId);
    }
    async getTeamForActor(teamId, actor) {
        const { team } = await this.assertActor(teamId, actor);
        return team;
    }
    async listTeams(actorSessionId) {
        const teams = await this.store.list('teams');
        return actorSessionId === undefined
            ? teams
            : teams.filter((t) => t.leadSessionId === actorSessionId);
    }
    async pauseTeam(teamId, actor) {
        await this.requireLead(teamId, actor);
        return this.setTeamStatus(teamId, 'paused');
    }
    async resumeTeam(teamId, actor) {
        await this.requireLead(teamId, actor);
        return this.setTeamStatus(teamId, 'active');
    }
    async failTeam(teamId, actor) {
        await this.requireLead(teamId, actor);
        return this.setTeamStatus(teamId, 'failed');
    }
    async setTeamStatus(teamId, status) {
        const result = await this.store.update('teams', teamId, (current) => {
            if (current.status === status)
                return null;
            return { ...current, status, updatedAt: now() };
        });
        const team = result.value;
        return team;
    }
    /**
     * Completion guard: the lead may only complete a team when every gate
     * holds. Violations produce `TEAM_NOT_COMPLETABLE` with the reasons.
     */
    async completeTeam(teamId, actor) {
        await this.requireLead(teamId, actor);
        return this.withTeamMutation(teamId, async () => {
            const reasons = [];
            const tasks = await this.store.list('tasks', (t) => t.teamId === teamId);
            const findings = await this.store.list('findings', (f) => f.teamId === teamId);
            const plans = await this.store.list('plans', (p) => p.teamId === teamId);
            const workspaces = await this.store.list('workspaces', (workspace) => workspace.teamId === teamId);
            const required = tasks.filter((t) => t.required && t.status !== 'cancelled');
            const incomplete = required.filter((t) => t.status !== 'completed');
            if (incomplete.length > 0)
                reasons.push(`required tasks incomplete: ${incomplete.map((t) => t.id).join(', ')}`);
            const failed = required.filter((t) => t.status === 'failed');
            if (failed.length > 0)
                reasons.push(`required tasks failed: ${failed.map((t) => t.id).join(', ')}`);
            const active = required.filter((t) => t.status === 'in_progress');
            if (active.length > 0)
                reasons.push(`required tasks still in progress: ${active.map((t) => t.id).join(', ')}`);
            const blocked = required.filter((t) => t.status === 'blocked');
            if (blocked.length > 0)
                reasons.push(`required tasks blocked: ${blocked.map((t) => t.id).join(', ')}`);
            const pending = required.filter((t) => t.status === 'pending');
            if (pending.length > 0)
                reasons.push(`required tasks pending: ${pending.map((t) => t.id).join(', ')}`);
            const criticalBlocked = tasks.filter((t) => t.status === 'blocked' && t.priority === 'critical');
            if (criticalBlocked.length > 0)
                reasons.push(`critical tasks blocked: ${criticalBlocked.map((t) => t.id).join(', ')}`);
            const unplanned = tasks.filter((t) => t.requiresPlan && t.status !== 'cancelled' && !plans.some((p) => p.taskId === t.id && p.status === 'approved'));
            if (unplanned.length > 0)
                reasons.push(`tasks requiring an approved plan: ${unplanned.map((t) => t.id).join(', ')}`);
            const openCritical = findings.filter((f) => f.state === 'open' && (f.severity === 'critical' || f.severity === 'high'));
            if (openCritical.length > 0)
                reasons.push(`open critical/high review findings: ${openCritical.map((f) => f.id).join(', ')}`);
            for (const workspace of workspaces) {
                if (workspace.taskId === undefined || !required.some((task) => task.id === workspace.taskId))
                    continue;
                if (!['clean', 'merged'].includes(workspace.status)) {
                    reasons.push(`workspace ${workspace.id} is ${workspace.status}`);
                }
                if (this.review !== undefined) {
                    const gate = await this.review.evaluateCompletionGate({
                        teamId,
                        taskId: workspace.taskId,
                        workspaceId: workspace.id,
                        actorSessionId: actor,
                    });
                    if (!gate.approved)
                        reasons.push(`review/QA gate for ${workspace.taskId}: ${gate.reasons.join('; ')}`);
                }
            }
            if (reasons.length > 0)
                throw teamError('TEAM_NOT_COMPLETABLE', 'team completion guard rejected', { teamId, reasons });
            const completed = await this.setTeamStatus(teamId, 'completed');
            this.emit(events.TEAM_COMPLETED, { team: completed });
            return completed;
        });
    }
    // ── members ────────────────────────────────────────────────────────────────
    async registerMember(input) {
        const team = await this.requireLead(input.teamId, input.actor);
        await this.assertActive(team);
        const existing = await this.store.list('members', (m) => m.teamId === input.teamId);
        if (existing.some((m) => m.sessionId === input.sessionId)) {
            throw teamError('MEMBER_ALREADY_IN_TEAM', `session ${input.sessionId} already a member`, {
                teamId: input.teamId,
                sessionId: input.sessionId,
            });
        }
        const activeMembers = existing.filter((member) => member.status !== 'stopped' && member.status !== 'failed');
        if (activeMembers.length >= this.maxActiveMembers) {
            throw teamError('INVALID_INPUT', `team ${input.teamId} is at its member cap (${this.maxActiveMembers})`, {
                teamId: input.teamId,
            });
        }
        const id = newId('member');
        const timestamp = now();
        const member = {
            id,
            teamId: input.teamId,
            sessionId: input.sessionId,
            name: input.name,
            role: input.role,
            status: 'starting',
            lifecycleState: 'starting',
            provider: input.provider,
            modelProvider: input.modelProvider,
            model: input.model,
            capabilities: normalizeCapabilities(input.capabilities, input.role),
            joinedAt: timestamp,
            lastActiveAt: timestamp,
        };
        await this.store.put('members', id, member);
        this.emit(events.MEMBER_JOINED, { member });
        return member;
    }
    /** Bind the real Harness child identity after native spawn succeeds. */
    async bindMemberSession(memberId, childSessionId, actor) {
        const member = await this.getMember(memberId);
        await this.requireLead(member.teamId, actor);
        if (childSessionId.length === 0 || childSessionId.startsWith('__pending_')) {
            throw teamError('INVALID_INPUT', 'member binding requires a real Harness session id', { memberId });
        }
        const existing = await this.memberBySession(member.teamId, childSessionId);
        if (existing !== undefined && existing.id !== member.id) {
            throw teamError('MEMBER_ALREADY_IN_TEAM', `session ${childSessionId} already belongs to this team`, { teamId: member.teamId, sessionId: childSessionId });
        }
        const result = await this.store.update('members', member.id, (current) => ({
            ...current,
            sessionId: childSessionId,
            status: 'idle',
            lifecycleState: 'waiting_for_task',
            lastActiveAt: now(),
        }));
        const bound = result.value;
        this.emit(events.MEMBER_STATUS, { member: bound, previousSessionId: member.sessionId, binding: 'native-child' });
        await this.notifyReadyWorkers(bound.teamId);
        return bound;
    }
    async markMemberSpawnFailed(memberId, actor) {
        const member = await this.getMember(memberId);
        await this.requireLead(member.teamId, actor);
        const result = await this.store.update('members', memberId, (current) => ({ ...current, status: 'failed', lifecycleState: 'failed', lastActiveAt: now() }));
        const failed = result.value;
        this.emit(events.MEMBER_STATUS, { member: failed, spawn: 'failed' });
        return failed;
    }
    async getMember(memberId) {
        const member = await this.store.get('members', memberId);
        if (member === undefined)
            throw teamError('MEMBER_NOT_FOUND', `member ${memberId} not found`, { memberId });
        return member;
    }
    async memberBySession(teamId, sessionId) {
        const members = await this.store.list('members', (m) => m.teamId === teamId && m.sessionId === sessionId);
        return members[0];
    }
    async listMembers(teamId, actor) {
        await this.assertActor(teamId, actor);
        return this.store.list('members', (m) => m.teamId === teamId);
    }
    async updateMember(memberId, actor, patch) {
        const current = await this.getMember(memberId);
        await this.assertActor(current.teamId, actor);
        const result = await this.store.update('members', memberId, (m) => ({
            ...m,
            ...patch,
            lifecycleState: patch.status === 'stopped' ? 'stopped' : patch.status === 'failed' ? 'failed' : m.lifecycleState,
            lastActiveAt: now(),
        }));
        const updated = result.value;
        if (patch.status !== undefined && patch.status !== current.status) {
            this.emit(events.MEMBER_STATUS, { member: updated });
        }
        return updated;
    }
    async touchMember(teamId, sessionId) {
        const member = await this.memberBySession(teamId, sessionId);
        if (member === undefined)
            return;
        await this.store.update('members', member.id, (m) => ({ ...m, lastActiveAt: now() }));
    }
    /** Sync the member's current-task metadata after a claim/finish. */
    async syncMemberTask(teamId, sessionId, taskId, status) {
        const member = await this.memberBySession(teamId, sessionId);
        if (member === undefined)
            return;
        const result = await this.store.update('members', member.id, (m) => ({
            ...m,
            currentTaskId: taskId,
            status: status ?? (taskId === undefined ? 'idle' : 'working'),
            lifecycleState: taskId === undefined ? 'waiting_for_task' : status === 'blocked' ? 'blocked' : 'working',
            lastActiveAt: now(),
        }));
        const updated = result.value;
        if (updated.status !== member.status || updated.currentTaskId !== member.currentTaskId) {
            this.emit(events.MEMBER_STATUS, { member: updated });
        }
    }
    /** Native lifecycle bridge update; authorization is supplied by the host event source. */
    async updateMemberFromRuntime(memberId, patch) {
        const current = await this.getMember(memberId);
        const effectivePatch = patch.status === 'idle' && current.currentTaskId !== undefined && (current.status === 'working' || current.status === 'blocked')
            ? { ...patch, status: current.status }
            : patch;
        const terminalRuntimeState = effectivePatch.status === 'failed' || effectivePatch.status === 'stopped';
        const result = await this.store.update('members', memberId, (m) => ({
            ...m,
            ...effectivePatch,
            ...(terminalRuntimeState ? { currentTaskId: undefined } : {}),
            lifecycleState: effectivePatch.status === 'failed' ? 'failed' : effectivePatch.status === 'stopped' ? 'stopped' : effectivePatch.status === 'working' ? 'working' : effectivePatch.status === 'idle' ? 'waiting_for_task' : m.lifecycleState,
            lastActiveAt: now(),
        }));
        const updated = result.value;
        if (updated.status !== current.status || updated.currentTaskId !== current.currentTaskId)
            this.emit(events.MEMBER_STATUS, { member: updated });
        if (effectivePatch.status === 'failed' || effectivePatch.status === 'stopped') {
            const owned = await this.store.list('tasks', (task) => task.teamId === current.teamId && task.ownerSessionId === current.sessionId && (task.status === 'in_progress' || task.status === 'blocked'));
            for (const task of owned) {
                const released = await this.store.update('tasks', task.id, (value) => ({
                    ...value,
                    status: 'pending',
                    availability: 'ready',
                    ownerSessionId: undefined,
                    startedAt: undefined,
                    result: (value.result ?? '') + '\n[released: member runtime ' + effectivePatch.status + ']'
                }));
                this.emit(events.TASK_RELEASED, { task: released.value, reason: 'member runtime ' + effectivePatch.status });
            }
            await this.notifyReadyWorkers(current.teamId);
        }
        else if (effectivePatch.status === 'idle') {
            await this.retryReadyWorkers(current.teamId, current.sessionId);
        }
        return updated;
    }
    async auditCapability(input) {
        const member = await this.memberBySession(input.teamId, input.sessionId);
        if (member === undefined)
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'capability actor is not a team member', { teamId: input.teamId, sessionId: input.sessionId });
        this.emit(events.CAPABILITY_DECISION, capabilityAudit({
            teamId: input.teamId,
            memberId: member.id,
            sessionId: input.sessionId,
            capability: input.capability,
            allowed: input.allowed,
            command: input.command,
            workspace: input.workspace,
        }));
    }
    /**
     * Enforce the bounded capability policy at the host tool boundary.
     *
     * Team coordination tools keep their own typed authorization rules. This
     * guard covers the host's repository/process tools when a real teammate is
     * the caller, so a model cannot turn a descriptive capability record into an
     * unrestricted shell or an unowned file write.
     */
    async authorizeToolCapability(input) {
        const members = await this.store.list('members', (member) => member.sessionId === input.sessionId);
        if (members.length === 0)
            return { allowed: true };
        if (members.length !== 1) {
            return { allowed: false, reason: 'session is registered in multiple teams' };
        }
        const member = members[0];
        const action = classifyToolCapability(input.toolName, input.arguments);
        if (action === undefined)
            return { allowed: true };
        let allowed = (member.capabilities ?? []).includes(action.capability);
        let reason = allowed ? undefined : `member lacks capability ${action.capability}`;
        if (allowed && action.protectedGitAction !== undefined) {
            allowed = false;
            reason = `protected action denied: ${action.protectedGitAction}`;
        }
        if (allowed && action.capability === 'repo.write.owned') {
            const path = action.path;
            if (path === undefined || path.trim() === '') {
                allowed = false;
                reason = 'a concrete file path is required for an owned write';
            }
            else {
                const normalized = this.normalizePattern(path);
                const claims = await this.store.list('file_claims', (claim) => claim.teamId === member.teamId);
                const ownsPath = claims.some((claim) => claim.ownerSessionId === member.sessionId && this.patternsConflict(claim, normalized));
                if (!ownsPath) {
                    allowed = false;
                    reason = `file is not covered by a claim owned by ${member.sessionId}`;
                }
            }
        }
        this.emit(events.CAPABILITY_DECISION, capabilityAudit({
            teamId: member.teamId,
            memberId: member.id,
            sessionId: member.sessionId,
            capability: action.capability,
            allowed,
            command: action.command ?? input.toolName,
            workspace: action.workspace ?? action.path,
        }));
        return {
            allowed,
            capability: action.capability,
            command: action.command,
            path: action.path,
            workspace: action.workspace,
            reason,
        };
    }
    async removeMember(memberId, actor) {
        const current = await this.getMember(memberId);
        const { team } = await this.assertActor(current.teamId, actor);
        if (team.leadSessionId !== actor && current.sessionId !== actor) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the lead or the member itself may remove a member', { memberId, actor });
        }
        // Release every in-flight task owned by this session (authoritative scan —
        // metadata like currentTaskId may drift and is never trusted for release).
        const tasks = await this.store.list('tasks', (t) => t.teamId === current.teamId && t.ownerSessionId === current.sessionId);
        for (const task of tasks) {
            if (task.status === 'in_progress' || task.status === 'blocked') {
                await this.releaseTask(task.id, current.sessionId, 'member removed');
            }
        }
        await this.store.remove('members', memberId);
        this.emit(events.MEMBER_LEFT, { member: current });
    }
    async assignTask(taskId, memberId, actor) {
        const task = await this.requireTask(taskId);
        const team = await this.requireLead(task.teamId, actor);
        await this.assertActive(team);
        const member = await this.getMember(memberId);
        if (member.teamId !== task.teamId)
            throw teamError('MEMBER_NOT_FOUND', `member ${memberId} is not in team ${task.teamId}`, { memberId, teamId: task.teamId });
        if (task.status !== 'pending' || task.ownerSessionId !== undefined)
            throw teamError('TASK_ALREADY_CLAIMED', `task ${taskId} is not assignable`, { taskId, status: task.status, owner: task.ownerSessionId });
        const result = await this.store.update('tasks', taskId, (current) => ({ ...current, assignedMemberId: member.id, assignedRole: current.assignedRole ?? member.role }));
        const assigned = result.value;
        this.emit(events.TASK_READY, { task: assigned, assignment: 'explicit', memberId: member.id });
        await this.notifyReadyWorkers(assigned.teamId);
        return assigned;
    }
    // ── tasks ──────────────────────────────────────────────────────────────────
    async createTask(input) {
        const { team } = await this.assertActor(input.teamId, input.actor);
        await this.assertActive(team);
        const id = newId('task');
        const dependencies = (input.dependencies ?? []);
        for (const dep of dependencies) {
            const dependency = await this.requireTask(dep);
            if (dependency.teamId !== input.teamId) {
                throw teamError('INVALID_INPUT', 'task dependencies must belong to the same team', { teamId: input.teamId, dependencyId: dep });
            }
        }
        if (input.assignedMemberId !== undefined) {
            const assigned = await this.getMember(input.assignedMemberId);
            if (assigned.teamId !== input.teamId)
                throw teamError('MEMBER_NOT_FOUND', 'assigned member is not in this team', { memberId: input.assignedMemberId, teamId: input.teamId });
        }
        const task = {
            id,
            teamId: input.teamId,
            title: input.title,
            description: input.description,
            status: 'pending',
            availability: dependencies.length === 0 ? 'ready' : 'locked',
            priority: input.priority ?? 'normal',
            dependencies,
            requiresPlan: input.requiresPlan ?? false,
            required: input.required ?? true,
            assignedMemberId: input.assignedMemberId,
            assignedRole: input.assignedRole,
            requiredCapabilities: input.requiredCapabilities,
            workspaceId: input.workspaceId,
            createdAt: now(),
        };
        await this.store.put('tasks', id, task);
        this.emit(events.TASK_CREATED, { task });
        await this.notifyReadyWorkers(task.teamId);
        return task;
    }
    async createTasks(batch, actor, teamId) {
        const created = [];
        for (const item of batch) {
            created.push(await this.createTask({ ...item, teamId: (teamId ?? item.teamId), actor }));
        }
        return created;
    }
    async requireTask(taskId) {
        const task = await this.store.get('tasks', taskId);
        if (task === undefined)
            throw teamError('TASK_NOT_FOUND', `task ${taskId} not found`, { taskId });
        return task;
    }
    async getTask(taskId, actor) {
        const task = await this.requireTask(taskId);
        await this.assertActor(task.teamId, actor);
        return task;
    }
    async listTasks(teamId, actor) {
        await this.assertActor(teamId, actor);
        return this.store.list('tasks', (t) => t.teamId === teamId);
    }
    tasksOf(teamId, tasks) {
        const map = new Map();
        for (const task of tasks)
            if (task.teamId === teamId)
                map.set(task.id, task);
        return map;
    }
    /** True when every dependency of the task is completed. */
    dependenciesSatisfied(task, all, visiting) {
        for (const dep of task.dependencies) {
            const depTask = all.get(dep);
            if (depTask === undefined)
                return false;
            if (depTask.status !== 'completed')
                return false;
        }
        return true;
    }
    async memberCanClaim(teamId, actor, task) {
        const team = await this.team(teamId);
        if (team.leadSessionId === actor) {
            if (task.assignedMemberId !== undefined || task.assignedRole !== undefined || (task.requiredCapabilities?.length ?? 0) > 0) {
                return { allowed: false, reason: 'task is assigned to a teammate or requires teammate capabilities' };
            }
            return { allowed: true };
        }
        const member = await this.memberBySession(teamId, actor);
        if (member === undefined)
            return { allowed: false, reason: 'caller is not a teammate' };
        if (member.status === 'stopped' || member.status === 'failed')
            return { allowed: false, reason: `member is ${member.status}` };
        if (member.currentTaskId !== undefined)
            return { allowed: false, reason: 'member already owns an active task' };
        if (task.assignedMemberId !== undefined && task.assignedMemberId !== member.id)
            return { allowed: false, reason: 'task is assigned to another member' };
        if (task.assignedRole !== undefined && task.assignedRole.toLowerCase() !== member.role.toLowerCase())
            return { allowed: false, reason: 'task is assigned to another role' };
        if (!hasCapabilities(member, task.requiredCapabilities))
            return { allowed: false, reason: 'member lacks required capabilities' };
        return { allowed: true };
    }
    async requireCapability(teamId, actor, capability, context) {
        const team = await this.team(teamId);
        if (team.leadSessionId === actor)
            return;
        const member = await this.memberBySession(teamId, actor);
        const allowed = member !== undefined && (member.capabilities ?? []).includes(capability);
        if (member !== undefined)
            this.emit(events.CAPABILITY_DECISION, capabilityAudit({ teamId, memberId: member.id, sessionId: actor, capability, allowed, command: context?.command, workspace: context?.workspace }));
        if (!allowed)
            throw teamError('CAPABILITY_DENIED', 'member lacks capability ' + capability, { teamId, actor, capability });
    }
    async refreshReadyTasks(teamId) {
        const all = this.tasksOf(teamId, await this.store.list('tasks'));
        const ready = [];
        for (const task of all.values()) {
            if (task.status !== 'pending' || task.ownerSessionId !== undefined)
                continue;
            const nextAvailability = this.dependenciesSatisfied(task, all) ? 'ready' : 'locked';
            if (task.availability === nextAvailability) {
                if (nextAvailability === 'ready')
                    ready.push(task);
                continue;
            }
            const result = await this.store.update('tasks', task.id, (current) => current.status === 'pending' && current.ownerSessionId === undefined
                ? { ...current, availability: nextAvailability }
                : current);
            const updated = result.value;
            if (nextAvailability === 'ready') {
                ready.push(updated);
                this.emit(events.TASK_READY, { task: updated });
            }
        }
        return ready;
    }
    wakeKey(taskId, sessionId) {
        return `${taskId}:${sessionId}`;
    }
    clearWakeRetry(key) {
        this.wakeKeys.delete(key);
        this.wakeAttempts.delete(key);
        const timer = this.wakeRetryTimers.get(key);
        if (timer !== undefined) {
            clearTimeout(timer);
            this.wakeRetryTimers.delete(key);
        }
    }
    scheduleWakeRetry(teamId, taskId, sessionId) {
        const key = this.wakeKey(taskId, sessionId);
        if (this.wakeRetryTimers.has(key) || (this.wakeAttempts.get(key) ?? 0) >= AgentTeamsService.MAX_WAKE_ATTEMPTS)
            return;
        const timer = setTimeout(() => {
            this.wakeRetryTimers.delete(key);
            void (async () => {
                const member = await this.memberBySession(teamId, sessionId);
                // A running worker may be taking time to read the authoritative board.
                // Retry only after it is demonstrably idle, avoiding duplicate prompts.
                if (member === undefined || member.currentTaskId !== undefined || member.status !== 'idle')
                    return;
                const ready = await this.refreshReadyTasks(teamId);
                await this.wakeEligibleWorkers(teamId, ready, sessionId);
                if (this.wakeKeys.has(key))
                    this.scheduleWakeRetry(teamId, taskId, sessionId);
            })().catch(() => undefined);
        }, AgentTeamsService.WAKE_RETRY_DELAY_MS);
        timer.unref?.();
        this.wakeRetryTimers.set(key, timer);
    }
    async notifyReadyWorkers(teamId) {
        const ready = await this.refreshReadyTasks(teamId);
        await this.wakeEligibleWorkers(teamId, ready);
    }
    /** Re-check authoritative state when a native worker becomes idle. */
    async retryReadyWorkers(teamId, sessionId) {
        const member = await this.memberBySession(teamId, sessionId);
        if (member === undefined || member.currentTaskId !== undefined || member.status !== 'idle')
            return;
        const ready = await this.refreshReadyTasks(teamId);
        await this.wakeEligibleWorkers(teamId, ready, sessionId);
    }
    async wakeEligibleWorkers(teamId, readyTasks, retrySessionId) {
        if (this.runtime === undefined || readyTasks.length === 0)
            return;
        const team = await this.team(teamId);
        const members = await this.store.list('members', (member) => member.teamId === teamId && member.status !== 'failed' && member.status !== 'stopped' && member.currentTaskId === undefined);
        for (const task of readyTasks) {
            const targets = members.filter((member) => (task.assignedMemberId === undefined || task.assignedMemberId === member.id) &&
                (task.assignedRole === undefined || task.assignedRole.toLowerCase() === member.role.toLowerCase()) &&
                hasCapabilities(member, task.requiredCapabilities));
            for (const member of targets) {
                const key = this.wakeKey(task.id, member.sessionId);
                const retrying = retrySessionId === member.sessionId;
                if (this.wakeKeys.has(key) && !retrying)
                    continue;
                const attempts = this.wakeAttempts.get(key) ?? 0;
                if (retrying && attempts >= AgentTeamsService.MAX_WAKE_ATTEMPTS)
                    continue;
                this.wakeKeys.add(key);
                this.wakeAttempts.set(key, attempts + 1);
                const text = `Authoritative team update: task ${task.id} (${task.title}) is READY. Sync team_snapshot, check your inbox, then claimNextTask if eligible. Do not claim tasks assigned to another member or role.`;
                this.emit(events.WORKER_WAKEUP_REQUESTED, { teamId, taskId: task.id, sessionId: member.sessionId });
                try {
                    if (this.runtime.wakeWorker !== undefined) {
                        await this.runtime.wakeWorker(this.leadHandleFor(team), member.sessionId, text, team.leadSessionId);
                    }
                    else {
                        await this.runtime.followup(this.leadHandleFor(team), member.sessionId, text, team.leadSessionId);
                    }
                    this.scheduleWakeRetry(teamId, task.id, member.sessionId);
                }
                catch (error) {
                    this.clearWakeRetry(key);
                    this.emit(events.WORKER_WAKEUP_FAILED, { teamId, taskId: task.id, sessionId: member.sessionId, error: String(error) });
                }
            }
        }
    }
    /** Cycle detection over the task graph of one team (DFS with colors). */
    async addDependency(teamId, taskId, dependencyId, actor) {
        await this.assertActor(teamId, actor);
        if (taskId === dependencyId) {
            throw teamError('DEPENDENCY_SELF_REFERENCE', `task ${taskId} cannot depend on itself`, { taskId });
        }
        const task = await this.requireTask(taskId);
        const dep = await this.requireTask(dependencyId);
        if (task.teamId !== teamId || dep.teamId !== teamId) {
            throw teamError('INVALID_INPUT', 'both tasks must belong to the same team', { teamId, taskId, dependencyId });
        }
        if (task.dependencies.includes(dependencyId))
            return task;
        const all = this.tasksOf(teamId, await this.store.list('tasks'));
        // Walk: does dependencyId (transitively) depend on taskId?
        const stack = [dependencyId];
        const seen = new Set();
        while (stack.length > 0) {
            const current = stack.pop();
            if (current === taskId) {
                throw teamError('DEPENDENCY_CYCLE', `adding ${taskId} → ${dependencyId} would create a cycle`, { taskId, dependencyId });
            }
            if (seen.has(current))
                continue;
            seen.add(current);
            const node = all.get(current);
            if (node !== undefined)
                for (const next of node.dependencies)
                    stack.push(next);
        }
        const result = await this.store.update('tasks', taskId, (current) => ({
            ...current,
            dependencies: [...current.dependencies, dependencyId],
            availability: 'locked',
        }));
        return result.value;
    }
    async claimTask(taskId, actor) {
        const task = await this.requireTask(taskId);
        const { team } = await this.assertActor(task.teamId, actor);
        await this.assertActive(team);
        const all = this.tasksOf(task.teamId, await this.store.list('tasks'));
        if (task.status === 'pending' && !this.dependenciesSatisfied(task, all)) {
            throw teamError('TASK_DEPENDENCIES_UNRESOLVED', `task ${taskId} has unresolved dependencies`, {
                taskId,
                dependencies: task.dependencies.filter((d) => all.get(d)?.status !== 'completed'),
            });
        }
        if (task.status === 'pending') {
            const eligibility = await this.memberCanClaim(task.teamId, actor, task);
            if (!eligibility.allowed) {
                throw teamError('TASK_NOT_ELIGIBLE', `session ${actor} is not eligible for task ${taskId}: ${eligibility.reason ?? 'eligibility policy rejected'}`, { taskId, actor, reason: eligibility.reason });
            }
        }
        const result = await this.store.update('tasks', taskId, (current) => {
            if (current.status !== 'pending')
                return null;
            if (!this.dependenciesSatisfied(current, all))
                return null;
            return { ...current, status: 'in_progress', availability: 'ready', ownerSessionId: actor, startedAt: now() };
        });
        if (result.found && result.value.ownerSessionId === actor && result.value.status === 'in_progress') {
            const claimed = result.value;
            this.clearWakeRetry(this.wakeKey(claimed.id, actor));
            await this.syncMemberTask(claimed.teamId, actor, claimed.id);
            this.emit(events.TASK_CLAIMED, { task: claimed, ownerSessionId: actor });
            return claimed;
        }
        // Distinguish the typed failure.
        const fresh = await this.requireTask(taskId);
        if (fresh.status !== 'pending' || fresh.ownerSessionId !== undefined) {
            throw teamError('TASK_ALREADY_CLAIMED', `task ${taskId} already claimed`, { taskId, owner: fresh.ownerSessionId });
        }
        if (!this.dependenciesSatisfied(fresh, all)) {
            throw teamError('TASK_DEPENDENCIES_UNRESOLVED', `task ${taskId} has unresolved dependencies`, {
                taskId,
                dependencies: fresh.dependencies.filter((d) => all.get(d)?.status !== 'completed'),
            });
        }
        throw teamError('TASK_ALREADY_CLAIMED', `task ${taskId} could not be claimed`, { taskId });
    }
    /**
     * Atomic self-scheduling claim: scan candidates, atomically claim the
     * first one that is still free. Under concurrent callers, losers simply
     * advance to the next candidate — exactly one owner per task.
     */
    async claimNextTask(teamId, actor) {
        const { team } = await this.assertActor(teamId, actor);
        await this.assertActive(team);
        const actorMember = team.leadSessionId === actor ? undefined : await this.memberBySession(teamId, actor);
        if (actorMember?.status === 'stopped' || actorMember?.status === 'failed') {
            throw teamError('TASK_NOT_ELIGIBLE', `member ${actor} is ${actorMember.status}`, { teamId, actor });
        }
        const all = this.tasksOf(teamId, await this.store.list('tasks'));
        const candidates = [...all.values()]
            .filter((t) => t.status === 'pending')
            .filter((t) => t.ownerSessionId === undefined)
            .filter((t) => this.dependenciesSatisfied(t, all))
            .filter((t) => t.availability !== 'locked')
            .filter((t) => actorMember?.currentTaskId === undefined || (t.assignedMemberId === undefined && t.assignedRole === undefined && (t.requiredCapabilities?.length ?? 0) === 0))
            .filter((t) => t.assignedMemberId === undefined || actorMember?.id === t.assignedMemberId)
            .filter((t) => t.assignedRole === undefined || actorMember?.role.toLowerCase() === t.assignedRole.toLowerCase())
            .filter((t) => actorMember === undefined || hasCapabilities(actorMember, t.requiredCapabilities))
            .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.createdAt - b.createdAt);
        for (const candidate of candidates) {
            const result = await this.store.update('tasks', candidate.id, (current) => {
                if (current.status !== 'pending' || current.ownerSessionId !== undefined)
                    return null;
                if (!this.dependenciesSatisfied(current, all))
                    return null;
                return { ...current, status: 'in_progress', availability: 'ready', ownerSessionId: actor, startedAt: now() };
            });
            const value = result.value;
            if (value !== undefined && value.ownerSessionId === actor && value.status === 'in_progress') {
                this.clearWakeRetry(this.wakeKey(value.id, actor));
                await this.syncMemberTask(teamId, actor, value.id);
                this.emit(events.TASK_CLAIMED, { task: value, ownerSessionId: actor });
                return { claimed: true, task: value };
            }
            // Another taker won this one; continue scanning.
        }
        const blockedByDeps = [...all.values()].some((t) => t.status === 'pending' && t.ownerSessionId === undefined && !this.dependenciesSatisfied(t, all));
        const assignedElsewhere = [...all.values()].some((t) => t.status === 'pending' && t.ownerSessionId === undefined && this.dependenciesSatisfied(t, all) && ((t.assignedMemberId !== undefined && t.assignedMemberId !== actorMember?.id) ||
            (t.assignedRole !== undefined && t.assignedRole.toLowerCase() !== actorMember?.role.toLowerCase())));
        return {
            claimed: false,
            reason: blockedByDeps ? 'no claimable task: remaining candidates have unresolved dependencies' : assignedElsewhere ? 'no eligible task: remaining ready tasks are assigned to another member or role' : 'no claimable task',
        };
    }
    async completeTask(taskId, actor, result) {
        return this.finishTask(taskId, actor, 'completed', result);
    }
    /** Complete a worker task and immediately self-schedule the next task. */
    async completeTaskAndSchedule(taskId, actor, result) {
        const completed = await this.completeTask(taskId, actor, result);
        const task = await this.requireTask(taskId);
        if (task.teamId === undefined || (await this.memberBySession(task.teamId, actor)) === undefined) {
            return { completed, next: { claimed: false, reason: 'lead completion does not self-schedule' } };
        }
        return { completed, next: await this.claimNextTask(task.teamId, actor) };
    }
    async failTask(taskId, actor, result) {
        return this.finishTask(taskId, actor, 'failed', result);
    }
    async finishTask(taskId, actor, status, result) {
        const task = await this.requireTask(taskId);
        await this.assertActor(task.teamId, actor);
        if (status === 'completed' && task.requiresPlan) {
            const plans = await this.store.list('plans', (p) => p.teamId === task.teamId && p.taskId === task.id);
            if (!plans.some((plan) => plan.status === 'approved')) {
                throw teamError('PLAN_NOT_APPROVED', `task ${task.id} requires an approved plan before completion`, {
                    taskId,
                    requiresPlan: true,
                    approvedPlan: false,
                });
            }
        }
        const outcome = await this.store.update('tasks', taskId, (current) => {
            if (current.status !== 'in_progress' || current.ownerSessionId !== actor)
                return null;
            return {
                ...current,
                status,
                result: result ?? current.result,
                completedAt: status === 'completed' ? now() : current.completedAt,
                ownerSessionId: current.ownerSessionId,
            };
        });
        const value = outcome.value;
        if (value.status !== status) {
            throw teamError('TASK_NOT_OWNED_BY_CALLER', `session ${actor} cannot ${status} task ${taskId}`, { taskId, actor, current: task.status });
        }
        await this.syncMemberTask(task.teamId, actor, undefined);
        this.emit(status === 'completed' ? events.TASK_COMPLETED : events.TASK_FAILED, { task: value });
        const ready = await this.refreshReadyTasks(task.teamId);
        await this.wakeEligibleWorkers(task.teamId, ready);
        return value;
    }
    /** Owner or lead releases a task back to pending (or out of a blocked state). */
    async releaseTask(taskId, actor, reason) {
        const task = await this.requireTask(taskId);
        const { team } = await this.assertActor(task.teamId, actor);
        const isLead = team.leadSessionId === actor;
        const result = await this.store.update('tasks', taskId, (current) => {
            const owned = current.ownerSessionId === actor;
            const inFlight = current.status === 'in_progress' || current.status === 'blocked';
            if ((!owned && !isLead) || !inFlight)
                return null;
            return {
                ...current,
                status: 'pending',
                availability: 'ready',
                ownerSessionId: undefined,
                startedAt: undefined,
                result: reason !== undefined ? `${current.result ?? ''}\n[released: ${reason}]`.trim() : current.result,
            };
        });
        const value = result.value;
        if (value.status !== 'pending') {
            throw teamError('TASK_NOT_OWNED_BY_CALLER', `session ${actor} cannot release task ${taskId}`, { taskId, actor });
        }
        if (task.ownerSessionId !== undefined)
            await this.syncMemberTask(task.teamId, task.ownerSessionId, undefined);
        this.emit(events.TASK_RELEASED, { task: value, reason });
        const ready = await this.refreshReadyTasks(task.teamId);
        await this.wakeEligibleWorkers(task.teamId, ready);
        return value;
    }
    async reassignTask(taskId, actor, toSessionId) {
        const task = await this.requireTask(taskId);
        const { team } = await this.assertActor(task.teamId, actor);
        if (team.leadSessionId !== actor) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the lead may reassign tasks', { taskId, actor });
        }
        if (task.status === 'completed') {
            throw teamError('TASK_REOPEN_NOT_ALLOWED', `completed task ${taskId} cannot be reopened; create a follow-up task`, { taskId });
        }
        const target = await this.memberBySession(task.teamId, toSessionId);
        if (target === undefined) {
            throw teamError('MEMBER_NOT_FOUND', `reassign target ${toSessionId} is not a member`, { toSessionId });
        }
        const eligibility = await this.memberCanClaim(task.teamId, toSessionId, task);
        if (!eligibility.allowed) {
            throw teamError('TASK_NOT_ELIGIBLE', `session ${toSessionId} is not eligible for task ${taskId}: ${eligibility.reason ?? 'eligibility policy rejected'}`, { taskId, toSessionId, reason: eligibility.reason });
        }
        const all = this.tasksOf(task.teamId, await this.store.list('tasks'));
        if (!this.dependenciesSatisfied(task, all)) {
            throw teamError('TASK_DEPENDENCIES_UNRESOLVED', `task ${taskId} has unresolved dependencies`, { taskId, dependencies: task.dependencies.filter((d) => all.get(d)?.status !== 'completed') });
        }
        const previousOwner = task.ownerSessionId;
        const result = await this.store.update('tasks', taskId, (current) => ({
            ...current,
            ownerSessionId: toSessionId,
            status: 'in_progress',
            startedAt: current.startedAt ?? now(),
        }));
        const reassigned = result.value;
        if (previousOwner !== undefined && previousOwner !== toSessionId)
            await this.syncMemberTask(task.teamId, previousOwner, undefined, 'idle');
        await this.syncMemberTask(task.teamId, toSessionId, reassigned.id, 'working');
        return reassigned;
    }
    async setTaskBlocked(taskId, actor, reason) {
        const task = await this.requireTask(taskId);
        await this.assertActor(task.teamId, actor);
        const result = await this.store.update('tasks', taskId, (current) => {
            if (current.status !== 'in_progress' || current.ownerSessionId !== actor)
                return null;
            return { ...current, status: 'blocked', result: reason !== undefined ? `blocked: ${reason}` : current.result };
        });
        const value = result.value;
        if (value.status !== 'blocked') {
            throw teamError('TASK_NOT_OWNED_BY_CALLER', `session ${actor} cannot block task ${taskId}`, { taskId, actor });
        }
        await this.syncMemberTask(task.teamId, actor, value.id, 'blocked');
        this.emit(events.TASK_BLOCKED, { task: value, reason });
        return value;
    }
    // ── messages ───────────────────────────────────────────────────────────────
    async deliverMessageTarget(message, team, target, senderMember) {
        if (this.runtime === undefined)
            throw new Error('native subagent runtime is not mounted');
        if (target === team.leadSessionId && senderMember !== undefined) {
            await this.runtime.reportFrom(this.memberHandleFor(senderMember.sessionId), message.body);
            return 'native-report';
        }
        if (target !== team.leadSessionId) {
            await this.runtime.followup(this.leadHandleFor(team), target, message.body, message.fromSessionId);
            return 'native-followup';
        }
        return 'durable-inbox';
    }
    aggregateDelivery(message, errors) {
        const targets = Object.values(message.deliveryTargets ?? {});
        const delivered = targets.length === 0 || targets.every((target) => target.state === 'delivered' || target.state === 'acknowledged');
        const queued = targets.some((target) => target.state === 'queued' || target.state === 'pending' || target.state === 'delivering');
        const failed = targets.length > 0 && targets.every((target) => target.state === 'failed');
        return {
            ...message,
            deliveryState: delivered ? 'delivered' : queued ? 'queued' : failed ? 'failed' : 'pending',
            ...(delivered ? { deliveredAt: message.deliveredAt ?? now(), deliveryError: undefined } : {}),
            ...(errors.length > 0 ? { deliveryError: errors.join('; ') } : {}),
        };
    }
    async tryMessageDelivery(messageId, team, retry = false) {
        const current = await this.store.get('messages', messageId);
        if (current === undefined)
            throw teamError('MESSAGE_NOT_FOUND', 'message not found', { messageId });
        const targets = current.deliveryTargets ?? {};
        const senderMember = await this.memberBySession(team.id, current.fromSessionId);
        const errors = [];
        let transport = current.deliveryTransport;
        for (const target of Object.keys(targets)) {
            const state = targets[target];
            if (state === undefined || state.state === 'delivered' || state.state === 'acknowledged')
                continue;
            const attempts = state.attempts + 1;
            if (attempts > 5) {
                targets[target] = { ...state, state: 'failed', attempts, error: state.error ?? 'delivery retry limit exceeded' };
                errors.push(target + ': delivery retry limit exceeded');
                continue;
            }
            targets[target] = { ...state, state: 'delivering', attempts };
            try {
                transport = await this.deliverMessageTarget(current, team, target, senderMember);
                targets[target] = { state: 'delivered', attempts, deliveredAt: now() };
                this.emit(events.MESSAGE_DELIVERED, { teamId: team.id, messageId, targetSessionId: target, attempt: attempts, retry });
            }
            catch (error) {
                const messageError = String(error);
                targets[target] = { state: 'queued', attempts, error: messageError };
                errors.push(target + ': ' + messageError);
                this.emit(events.MESSAGE_QUEUED, { teamId: team.id, messageId, targetSessionId: target, attempt: attempts, error: messageError });
            }
        }
        const attemptValues = Object.values(targets).map((value) => value.attempts);
        const updated = this.aggregateDelivery({
            ...current,
            deliveryTargets: targets,
            deliveryAttempt: Math.max(current.deliveryAttempt ?? 0, ...attemptValues),
            deliveryTransport: transport,
        }, errors);
        const result = await this.store.update('messages', messageId, () => updated);
        const finalMessage = result.value;
        if (finalMessage.deliveryState === 'failed')
            this.emit(events.MESSAGE_DELIVERY_FAILED, { message: finalMessage, error: finalMessage.deliveryError });
        return finalMessage;
    }
    async sendMessage(input) {
        const { team } = await this.assertActor(input.teamId, input.fromSessionId);
        await this.assertActive(team);
        const senderIsLead = team.leadSessionId === input.fromSessionId;
        const senderMember = senderIsLead ? undefined : await this.memberBySession(input.teamId, input.fromSessionId);
        if (input.toSessionId !== undefined) {
            const target = await this.memberBySession(input.teamId, input.toSessionId);
            if (target === undefined && team.leadSessionId !== input.toSessionId) {
                throw teamError('MEMBER_NOT_FOUND', `message target ${input.toSessionId} is not in team ${input.teamId}`, { toSessionId: input.toSessionId });
            }
        }
        const targets = input.toSessionId === undefined
            ? (await this.store.list('members', (m) => m.teamId === input.teamId)).map((m) => m.sessionId)
            : [input.toSessionId];
        const deliveryTargets = {};
        for (const target of targets)
            deliveryTargets[target] = { state: 'pending', attempts: 0 };
        const id = newId('msg');
        const message = {
            id,
            teamId: input.teamId,
            fromSessionId: input.fromSessionId,
            toSessionId: input.toSessionId,
            type: input.type ?? 'message',
            body: input.body,
            createdAt: now(),
            deliveryState: 'pending',
            deliveryTargets,
        };
        await this.store.put('messages', id, message);
        const deliveryErrors = this.runtime === undefined ? ['native subagent runtime is not mounted'] : [];
        let transport = 'durable-inbox';
        if (this.runtime !== undefined) {
            for (const target of targets) {
                try {
                    if (target === team.leadSessionId && senderMember !== undefined) {
                        await this.runtime.reportFrom(this.memberHandleFor(senderMember.sessionId), input.body);
                        transport = 'native-report';
                        deliveryTargets[target] = { state: 'delivered', attempts: 1, deliveredAt: now() };
                    }
                    else if (target !== team.leadSessionId) {
                        // Native Harness authorizes followup by the direct parent. The
                        // coordinator relays through that authority while retaining the
                        // true sender in the source metadata; no Lead model turn copies
                        // or rewrites the message.
                        await this.runtime.followup(this.leadHandleFor(team), target, input.body, input.fromSessionId);
                        transport = 'native-followup';
                        deliveryTargets[target] = { state: 'delivered', attempts: 1, deliveredAt: now() };
                    }
                }
                catch (error) {
                    const messageError = `${target}: ${String(error)}`;
                    deliveryErrors.push(messageError);
                    deliveryTargets[target] = { state: 'queued', attempts: 1, error: messageError };
                }
            }
        }
        const delivered = deliveryErrors.length === 0;
        const finalMessage = (await this.store.update('messages', id, (current) => ({
            ...current,
            deliveryState: delivered ? 'delivered' : this.runtime === undefined ? 'failed' : 'queued',
            deliveryTransport: transport,
            ...(delivered ? { deliveredAt: now() } : { deliveryError: deliveryErrors.join('; ') }),
        }))).value;
        this.emit(events.MESSAGE_SENT, { message: finalMessage });
        if (!delivered) {
            if (this.runtime === undefined)
                this.emit(events.MESSAGE_DELIVERY_FAILED, { message: finalMessage, error: deliveryErrors.join('; ') });
            else
                this.emit(events.MESSAGE_QUEUED, { message: finalMessage, error: deliveryErrors.join('; ') });
        }
        return finalMessage;
    }
    async retryPendingMessages(teamId, targetSessionId) {
        if (this.runtime === undefined)
            return [];
        const team = await this.team(teamId);
        const pending = await this.store.list('messages', (message) => message.teamId === teamId && (message.deliveryState === 'queued' || message.deliveryState === 'pending'));
        const retried = [];
        for (const message of pending) {
            if (targetSessionId !== undefined && message.toSessionId !== undefined && message.toSessionId !== targetSessionId)
                continue;
            retried.push(await this.tryMessageDelivery(message.id, team, true));
        }
        return retried;
    }
    leadHandleFor(team) {
        // The harness adapter resolves the live parent agent from the session id.
        return { __teamLeadSessionId: team.leadSessionId };
    }
    memberHandleFor(sessionId) {
        return { __teamMemberSessionId: sessionId };
    }
    async broadcastMessage(input) {
        return this.sendMessage({ ...input, toSessionId: undefined });
    }
    async getInbox(teamId, sessionId) {
        await this.assertActor(teamId, sessionId);
        const messages = await this.store.list('messages', (m) => m.teamId === teamId);
        return messages
            .filter((m) => m.toSessionId === undefined || m.toSessionId === sessionId)
            .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    }
    async listMessages(teamId, actor, limit = 100) {
        await this.assertActor(teamId, actor);
        const messages = await this.store.list('messages', (m) => m.teamId === teamId);
        return messages.sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)).slice(0, limit);
    }
    // ── plans ──────────────────────────────────────────────────────────────────
    async submitPlan(input) {
        await this.assertActor(input.teamId, input.authorSessionId);
        const task = await this.requireTask(input.taskId);
        if (task.teamId !== input.teamId)
            throw teamError('INVALID_INPUT', 'task is not in this team', { taskId: input.taskId, teamId: input.teamId });
        if (!task.requiresPlan) {
            throw teamError('PLAN_REQUIRED', `task ${input.taskId} does not require a plan`, { taskId: input.taskId });
        }
        const id = newId('plan');
        const plan = {
            id,
            teamId: input.teamId,
            taskId: input.taskId,
            authorSessionId: input.authorSessionId,
            body: input.body,
            status: 'submitted',
            createdAt: now(),
        };
        await this.store.put('plans', id, plan);
        // In-flight work on the task halts until a decision.
        await this.store.update('tasks', input.taskId, (current) => current.status === 'in_progress' ? { ...current, status: 'blocked' } : current);
        if (task.status === 'in_progress' && task.ownerSessionId !== undefined) {
            await this.syncMemberTask(input.teamId, task.ownerSessionId, task.id, 'blocked');
        }
        this.emit(events.PLAN_SUBMITTED, { plan });
        return plan;
    }
    async approvePlan(planId, actor, feedback) {
        const plan = await this.requirePlan(planId);
        const { team } = await this.assertActor(plan.teamId, actor);
        if (team.leadSessionId !== actor) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the lead may approve plans', { planId, actor });
        }
        if (plan.status === 'approved')
            return plan;
        if (plan.status !== 'submitted') {
            throw teamError('INVALID_INPUT', `plan ${planId} is ${plan.status} and cannot be approved`, { planId, status: plan.status });
        }
        const result = await this.store.update('plans', planId, (current) => current.status === 'submitted'
            ? { ...current, status: 'approved', feedback, reviewedAt: now() }
            : current);
        const approved = result.value;
        if (approved.status !== 'approved') {
            throw teamError('INVALID_INPUT', `plan ${planId} changed before approval`, { planId, status: approved.status });
        }
        // The task becomes claimable again. Clear the member's stale blocked state
        // as well; otherwise the UI can report a working task after approval.
        const taskBefore = await this.requireTask(plan.taskId);
        await this.store.update('tasks', plan.taskId, (current) => current.status === 'blocked' ? { ...current, status: 'pending', ownerSessionId: undefined, startedAt: undefined } : current);
        if (taskBefore.status === 'blocked' && taskBefore.ownerSessionId !== undefined) {
            await this.syncMemberTask(plan.teamId, taskBefore.ownerSessionId, undefined, 'idle');
        }
        this.emit(events.PLAN_APPROVED, { plan: approved });
        const ready = await this.refreshReadyTasks(plan.teamId);
        await this.wakeEligibleWorkers(plan.teamId, ready);
        return approved;
    }
    async rejectPlan(planId, actor, feedback) {
        const plan = await this.requirePlan(planId);
        const { team } = await this.assertActor(plan.teamId, actor);
        if (team.leadSessionId !== actor) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the lead may reject plans', { planId, actor });
        }
        if (plan.status !== 'submitted') {
            throw teamError('INVALID_INPUT', `plan ${planId} is ${plan.status} and cannot be rejected`, { planId, status: plan.status });
        }
        const result = await this.store.update('plans', planId, (current) => current.status === 'submitted'
            ? { ...current, status: 'rejected', feedback, reviewedAt: now() }
            : current);
        const rejected = result.value;
        if (rejected.status !== 'rejected') {
            throw teamError('INVALID_INPUT', `plan ${planId} changed before rejection`, { planId, status: rejected.status });
        }
        const taskBefore = await this.requireTask(plan.taskId);
        await this.store.update('tasks', plan.taskId, (current) => current.status === 'blocked' ? { ...current, status: 'pending', ownerSessionId: undefined, startedAt: undefined } : current);
        if (taskBefore.status === 'blocked' && taskBefore.ownerSessionId !== undefined) {
            await this.syncMemberTask(plan.teamId, taskBefore.ownerSessionId, undefined, 'idle');
        }
        this.emit(events.PLAN_REJECTED, { plan: rejected });
        const ready = await this.refreshReadyTasks(plan.teamId);
        await this.wakeEligibleWorkers(plan.teamId, ready);
        return rejected;
    }
    async requirePlan(planId) {
        const plan = await this.store.get('plans', planId);
        if (plan === undefined)
            throw teamError('PLAN_NOT_FOUND', `plan ${planId} not found`, { planId });
        return plan;
    }
    async listPlans(teamId, actor) {
        await this.assertActor(teamId, actor);
        return this.store.list('plans', (p) => p.teamId === teamId);
    }
    requireReviewDomain() {
        if (this.review === undefined)
            throw teamError('INVALID_INPUT', 'review domain is not mounted in this process');
        return this.review;
    }
    async createReviewRequest(input, actor) {
        await this.assertActor(input.teamId, actor);
        return this.requireReviewDomain().createRequest({ ...input, requestedBy: actor });
    }
    async startReview(requestId, actor) {
        return this.requireReviewDomain().startReview(requestId, actor);
    }
    async submitReviewResult(input, actor) {
        return this.requireReviewDomain().submitResult({ ...input, reviewerSessionId: actor });
    }
    async createReviewFinding(input, actor) {
        return this.requireReviewDomain().createFinding({ ...input, authorSessionId: actor });
    }
    async resolveReviewFinding(findingId, resolutionEvidence, actor) {
        return this.requireReviewDomain().resolveFinding(findingId, actor, resolutionEvidence);
    }
    async evaluateReviewGate(input, actor) {
        return this.requireReviewDomain().evaluateCompletionGate({ ...input, actorSessionId: actor });
    }
    // ── file claims ────────────────────────────────────────────────────────────
    normalizePattern(pattern) {
        const trimmed = pattern.replaceAll('\\', '/').replace(/\/+$/, '');
        if (trimmed.includes('*') || trimmed.includes('?') || trimmed.includes('['))
            return { pattern: trimmed, kind: 'glob' };
        if (pattern.endsWith('/') || pattern.endsWith('\\'))
            return { pattern: trimmed, kind: 'directory' };
        return { pattern: trimmed, kind: 'file' };
    }
    /**
     * File ownership is the coordination boundary immediately before an agent
     * edits a worktree. A requiresPlan task may inspect and submit a plan, but
     * it must not acquire implementation files until a Lead approval exists.
     */
    async assertImplementationReady(teamId, actor) {
        const owned = await this.store.list('tasks', (task) => task.teamId === teamId && task.ownerSessionId === actor && task.status === 'in_progress' && task.requiresPlan);
        for (const task of owned) {
            const plans = await this.store.list('plans', (plan) => plan.teamId === teamId && plan.taskId === task.id);
            if (!plans.some((plan) => plan.status === 'approved')) {
                throw teamError('PLAN_NOT_APPROVED', `task ${task.id} requires an approved plan before implementation`, {
                    taskId: task.id,
                    requiresPlan: true,
                    approvedPlan: false,
                });
            }
        }
    }
    /** Conservative overlap test: same exact pattern, or one is a prefix scope of the other. */
    patternsConflict(a, b) {
        const pa = a.pattern;
        const pb = b.pattern;
        if (pa === pb)
            return true;
        const globPrefix = (pattern) => {
            const star = pattern.search(/[*?[]/);
            return star < 0 ? pattern : pattern.slice(0, star);
        };
        const contains = (outer, inner) => {
            const base = outer.replace(/\/+$/, '');
            if (base === '')
                return true;
            return inner === base || inner.startsWith(`${base}/`);
        };
        const ga = globPrefix(pa) ?? pa;
        const gb = globPrefix(pb) ?? pb;
        if (a.kind === 'glob' || b.kind === 'glob') {
            return contains(ga, gb) || contains(gb, ga);
        }
        return contains(pa, pb) || contains(pb, pa);
    }
    async claimFiles(input) {
        const { team } = await this.assertActor(input.teamId, input.ownerSessionId);
        await this.assertActive(team);
        await this.requireCapability(input.teamId, input.ownerSessionId, 'repo.write.owned', { command: 'team_file_claim', workspace: input.workspaceId });
        await this.assertImplementationReady(input.teamId, input.ownerSessionId);
        if (this.workspace !== undefined) {
            try {
                const claims = await this.workspace.claimFiles({
                    teamId: input.teamId,
                    workspaceId: input.workspaceId,
                    actor: this.workspaceActor(input.teamId, input.ownerSessionId),
                    patterns: input.patterns,
                    purpose: input.purpose,
                });
                for (const claim of claims)
                    this.emit(events.FILE_CLAIMED, { claim });
                return claims;
            }
            catch (error) {
                if (error !== null && typeof error === 'object' && 'code' in error && error.code === 'FILE_CLAIM_CONFLICT') {
                    const details = error.details ?? {};
                    this.emit(events.FILE_CONFLICT, {
                        teamId: input.teamId,
                        pattern: String(details.pattern ?? input.patterns[0] ?? ''),
                        attemptedBy: input.ownerSessionId,
                        ownerSessionId: String(details.ownerSessionId ?? ''),
                        conflictingClaim: String(details.conflictingClaim ?? ''),
                    });
                }
                throw error;
            }
        }
        return this.withTeamMutation(input.teamId, async () => {
            const owner = await this.memberBySession(input.teamId, input.ownerSessionId);
            const normalized = input.patterns.map((p) => this.normalizePattern(p));
            const existing = await this.store.list('file_claims', (c) => c.teamId === input.teamId);
            for (const target of normalized) {
                const conflict = existing.find((c) => c.ownerSessionId !== input.ownerSessionId && this.patternsConflict(c, target));
                if (conflict !== undefined) {
                    this.emit(events.FILE_CONFLICT, { teamId: input.teamId, pattern: target.pattern, attemptedBy: input.ownerSessionId, ownerSessionId: conflict.ownerSessionId, conflictingClaim: conflict.id });
                    throw teamError('FILE_CLAIM_CONFLICT', `claim ${target.pattern} conflicts with ${conflict.pattern} owned by ${conflict.ownerSessionId}`, {
                        teamId: input.teamId,
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
                    teamId: input.teamId,
                    ownerSessionId: input.ownerSessionId,
                    ownerMemberId: owner?.id,
                    pattern: target.pattern,
                    kind: target.kind,
                    purpose: input.purpose,
                    createdAt: now(),
                };
                await this.store.put('file_claims', claim.id, claim);
                this.emit(events.FILE_CLAIMED, { claim });
                created.push(claim);
            }
            return created;
        });
    }
    async releaseFiles(claimIds, actor) {
        if (this.workspace !== undefined) {
            const claims = await this.store.list('file_claims', (claim) => claimIds.includes(claim.id));
            const teamIds = [...new Set(claims.map((claim) => claim.teamId))];
            if (teamIds.length > 1)
                throw teamError('INVALID_INPUT', 'file claims must belong to one team per release operation', { claimIds, teamIds });
            if (teamIds.length === 1) {
                const released = await this.workspace.releaseFiles(teamIds[0], claimIds, { teamId: teamIds[0], sessionId: actor });
                for (const claim of released)
                    this.emit(events.FILE_RELEASED, { claim });
                return;
            }
        }
        for (const claimId of claimIds) {
            const claim = await this.store.get('file_claims', claimId);
            if (claim === undefined)
                throw teamError('FILE_CLAIM_NOT_FOUND', `claim ${claimId} not found`, { claimId });
            const { team } = await this.assertActor(claim.teamId, actor);
            if (team.leadSessionId !== actor && claim.ownerSessionId !== actor) {
                throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the lead or claim owner may release a file claim', { claimId, actor });
            }
            await this.store.remove('file_claims', claimId);
            this.emit(events.FILE_RELEASED, { claim });
        }
    }
    async listFileClaims(teamId, actor) {
        await this.assertActor(teamId, actor);
        return this.store.list('file_claims', (c) => c.teamId === teamId);
    }
    async handoffFile(input, actor) {
        const manager = this.requireWorkspaceManager();
        const claim = await this.store.get('file_claims', input.claimId);
        if (claim === undefined || claim.teamId !== input.teamId) {
            throw teamError('FILE_CLAIM_NOT_FOUND', `file claim ${input.claimId} not found`, { claimId: input.claimId, teamId: input.teamId });
        }
        const updated = await manager.handoffFile({
            teamId: input.teamId,
            claimId: input.claimId,
            fromSessionId: actor,
            toSessionId: input.toSessionId,
            toMemberId: input.toMemberId,
            purpose: input.purpose,
        });
        this.emit(events.FILE_RELEASED, { claim: { ...updated, handoff: true } });
        return updated;
    }
    // ── review findings ────────────────────────────────────────────────────────
    async addFinding(input) {
        await this.assertActor(input.teamId, input.authorSessionId);
        let responsibleMemberId;
        if (input.responsibleSessionId !== undefined) {
            const responsible = await this.memberBySession(input.teamId, input.responsibleSessionId);
            if (responsible === undefined)
                throw teamError('MEMBER_NOT_FOUND', `responsible session ${input.responsibleSessionId} is not in team`, { teamId: input.teamId });
            responsibleMemberId = responsible.id;
        }
        else if (input.taskId !== undefined) {
            const task = await this.requireTask(input.taskId);
            if (task.teamId !== input.teamId) {
                throw teamError('INVALID_INPUT', 'finding task is not in this team', { taskId: input.taskId, teamId: input.teamId });
            }
            if (task.ownerSessionId !== undefined)
                responsibleMemberId = (await this.memberBySession(input.teamId, task.ownerSessionId))?.id;
        }
        const finding = {
            id: newId('finding'),
            teamId: input.teamId,
            authorSessionId: input.authorSessionId,
            taskId: input.taskId,
            severity: input.severity,
            summary: input.summary,
            detail: input.detail,
            title: input.title ?? input.summary,
            description: input.description ?? input.detail,
            evidence: input.evidence,
            responsibleMemberId,
            state: 'open',
            createdAt: now(),
        };
        await this.store.put('findings', finding.id, finding);
        this.emit(events.FINDING_ADDED, { finding });
        return finding;
    }
    async resolveFinding(findingId, actor) {
        return this.finishFinding(findingId, actor, 'resolved');
    }
    async acceptFinding(findingId, actor) {
        const { team } = await this.requireFindingTeam(findingId, actor);
        if (team.leadSessionId !== actor) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the lead may accept a finding', { findingId, actor });
        }
        return this.finishFinding(findingId, actor, 'accepted');
    }
    async finishFinding(findingId, actor, state) {
        const finding = await this.requireFinding(findingId);
        await this.assertActor(finding.teamId, actor);
        if (state === 'resolved' && finding.responsibleMemberId !== undefined) {
            const responsible = await this.getMember(finding.responsibleMemberId);
            const team = await this.team(finding.teamId);
            if (actor !== responsible.sessionId && actor !== team.leadSessionId) {
                throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the responsible member or lead may resolve this finding', { findingId, actor });
            }
        }
        const result = await this.store.update('findings', findingId, (current) => current.state === 'open' ? { ...current, state, resolvedAt: now() } : current);
        const resolved = result.value;
        this.emit(events.FINDING_RESOLVED, { finding: resolved });
        return resolved;
    }
    async requireFinding(findingId) {
        const finding = await this.store.get('findings', findingId);
        if (finding === undefined)
            throw teamError('INVALID_INPUT', `finding ${findingId} not found`, { findingId });
        return finding;
    }
    async requireFindingTeam(findingId, actor) {
        const finding = await this.requireFinding(findingId);
        return this.assertActor(finding.teamId, actor);
    }
    async listFindings(teamId, actor) {
        await this.assertActor(teamId, actor);
        return this.store.list('findings', (f) => f.teamId === teamId);
    }
    // ── snapshot ───────────────────────────────────────────────────────────────
    async getSnapshot(teamId, actor) {
        const { team } = await this.assertActor(teamId, actor);
        const [members, tasks, messages, plans, fileClaims, findings] = await Promise.all([
            this.store.list('members', (m) => m.teamId === teamId),
            this.store.list('tasks', (t) => t.teamId === teamId),
            this.store.list('messages', (m) => m.teamId === teamId),
            this.store.list('plans', (p) => p.teamId === teamId),
            this.store.list('file_claims', (c) => c.teamId === teamId),
            this.store.list('findings', (f) => f.teamId === teamId),
        ]);
        const required = tasks.filter((t) => t.required && t.status !== 'cancelled');
        const requiredDone = required.filter((t) => t.status === 'completed').length;
        const byStatus = {
            pending: 0,
            in_progress: 0,
            blocked: 0,
            completed: 0,
            failed: 0,
            cancelled: 0,
        };
        for (const task of tasks)
            byStatus[task.status] += 1;
        const progress = {
            requiredTotal: required.length,
            requiredDone,
            ratio: required.length === 0 ? 1 : requiredDone / required.length,
            byStatus,
            blocked: tasks.filter((t) => t.status === 'blocked').map((t) => t.id),
            awaitingPlanApproval: plans.filter((p) => p.status === 'submitted').map((p) => p.id),
        };
        return { team, members, tasks, messages, plans, fileClaims, findings, progress };
    }
    /**
     * Read-only snapshot WITHOUT actor authorization: reserved for the
     * loopback-bound web panel route (`/agent-teams/...`). Never call from
     * model-facing tools — they use {@link getSnapshot} with real identity.
     */
    async publicSnapshot(teamId) {
        return this.getSnapshot(teamId, (await this.team(teamId)).leadSessionId);
    }
}
