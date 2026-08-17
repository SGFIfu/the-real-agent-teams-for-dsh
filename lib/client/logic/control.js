/**
 * Event → UI adapter (pure, DOM-free, unit-testable).
 *
 * Pipeline: Agent Teams events / snapshot diffs → normalized UI events →
 * bounded activity buffer → animation hints. The React layer renders these;
 * nothing here touches DOM or React.
 * @module dsh-agent-teams/client/logic
 */
/** Status → icon + label + css suffix. Never color-only. */
export function statusMeta(status) {
    switch (status) {
        case 'working':
            return { icon: '●', label: 'WORKING', css: 'st-working' };
        case 'thinking':
        case 'starting':
            return { icon: '◎', label: 'THINKING', css: 'st-thinking' };
        case 'blocked':
            return { icon: '⚠', label: 'BLOCKED', css: 'st-blocked' };
        case 'reviewing':
            return { icon: '◐', label: 'REVIEWING', css: 'st-reviewing' };
        case 'idle':
            return { icon: '○', label: 'IDLE', css: 'st-idle' };
        case 'waiting':
            return { icon: '◌', label: 'WAITING', css: 'st-waiting' };
        case 'completed':
            return { icon: '✓', label: 'DONE', css: 'st-completed' };
        case 'failed':
            return { icon: '!', label: 'FAILED', css: 'st-failed' };
        case 'stopped':
            return { icon: '■', label: 'STOPPED', css: 'st-idle' };
        default:
            return { icon: '○', label: status.toUpperCase(), css: 'st-idle' };
    }
}
export function taskStatusMeta(status) {
    switch (status) {
        case 'pending':
            return { icon: '○', label: 'AVAILABLE', css: 'st-waiting' };
        case 'in_progress':
            return { icon: '●', label: 'IN PROGRESS', css: 'st-working' };
        case 'blocked':
            return { icon: '⚠', label: 'BLOCKED', css: 'st-blocked' };
        case 'completed':
            return { icon: '✓', label: 'COMPLETED', css: 'st-completed' };
        case 'failed':
            return { icon: '!', label: 'FAILED', css: 'st-failed' };
        default:
            return { icon: '○', label: status.toUpperCase(), css: 'st-idle' };
    }
}
/** Role → default avatar icon; unknown roles fall back to Bot. */
export function roleAvatar(role) {
    const map = {
        lead: '👑',
        architect: '🧠',
        backend: '🖥',
        frontend: '🖼',
        tester: '🧪',
        reviewer: '🔍',
        researcher: '🔎',
        devops: '⚙',
        debugger: '🐞',
        'security-reviewer': '🛡',
        'database-specialist': '🗄',
    };
    return map[role.toLowerCase()] ?? '🤖';
}
/** Layered (topological) rows for the task DAG. */
export function layeredGraph(tasks) {
    const rows = [];
    const placed = new Set();
    let remaining = [...tasks];
    let guard = 0;
    while (remaining.length > 0 && guard < 1000) {
        guard += 1;
        const row = remaining.filter((t) => t.dependencies.every((d) => placed.has(d)));
        if (row.length === 0) {
            // Cycle safety: flush the rest into one row rather than looping.
            rows.push(remaining);
            break;
        }
        rows.push(row);
        for (const t of row)
            placed.add(t.id);
        remaining = remaining.filter((t) => !placed.has(t.id));
    }
    return rows;
}
/** Diff two snapshots into ordered UI events (older first). */
export function diffSnapshots(prev, next, nowTs) {
    const events = [];
    if (prev === undefined) {
        // First observation: seed from current state without animations.
        for (const m of next.members) {
            events.push({ id: `m-${m.id}-init`, kind: 'member-joined', ts: nowTs, teamId: next.teamId, sessionId: m.sessionId, title: `${m.name} joined (${m.role})` });
        }
        for (const t of next.tasks) {
            if (t.status === 'completed')
                events.push({ id: `t-${t.id}-init`, kind: 'task-completed', ts: nowTs, teamId: next.teamId, taskId: t.id, title: `Task ${t.title} completed` });
        }
        return events;
    }
    const prevTasks = new Map(prev.tasks.map((t) => [t.id, t]));
    const prevMembers = new Map(prev.members.map((m) => [m.sessionId, m]));
    const prevMessages = new Set(prev.messages.map((m) => m.id));
    const prevPlans = new Map(prev.plans.map((p) => [p.id, p]));
    const prevClaims = new Set(prev.fileClaims.map((c) => c.id));
    const prevFindings = new Map(prev.findings.map((f) => [f.id, f]));
    for (const task of next.tasks) {
        const before = prevTasks.get(task.id);
        if (before === undefined) {
            events.push({ id: `t-${task.id}-created`, kind: 'task-created', ts: nowTs, teamId: next.teamId, taskId: task.id, title: `Task created: ${task.title}` });
        }
        else if (before.status !== task.status) {
            const kind = task.status === 'completed' ? 'task-completed' : task.status === 'failed' ? 'task-failed' : task.status === 'blocked' ? 'task-blocked' : task.status === 'pending' ? 'task-released' : 'task-claimed';
            events.push({ id: `t-${task.id}-${task.status}`, kind, ts: nowTs, teamId: next.teamId, taskId: task.id, sessionId: task.ownerSessionId, title: `Task ${task.title} ${task.status.replace('_', ' ')}` });
        }
    }
    for (const member of next.members) {
        const before = prevMembers.get(member.sessionId);
        if (before === undefined) {
            events.push({ id: `m-${member.id}-joined`, kind: 'member-joined', ts: nowTs, teamId: next.teamId, sessionId: member.sessionId, title: `${member.name} joined (${member.role})` });
        }
        else if (before.status !== member.status) {
            events.push({ id: `m-${member.id}-status-${member.status}`, kind: 'member-status', ts: nowTs, teamId: next.teamId, sessionId: member.sessionId, title: `${member.name} is now ${member.status}` });
        }
    }
    for (const message of next.messages) {
        if (!prevMessages.has(message.id)) {
            events.push({
                id: `msg-${message.id}`,
                kind: 'message',
                ts: nowTs,
                teamId: next.teamId,
                sessionId: message.fromSessionId,
                targetSessionId: message.toSessionId,
                preview: message.body.slice(0, 80),
                title: 'Message',
            });
        }
    }
    for (const plan of next.plans) {
        const before = prevPlans.get(plan.id);
        if (before !== undefined && before.status !== plan.status) {
            const kind = plan.status === 'approved' ? 'plan-approved' : plan.status === 'rejected' ? 'plan-rejected' : 'plan-submitted';
            events.push({ id: `p-${plan.id}-${plan.status}`, kind, ts: nowTs, teamId: next.teamId, sessionId: plan.authorSessionId, taskId: plan.taskId, title: `Plan ${plan.status} for task ${plan.taskId}` });
        }
        else if (before === undefined) {
            events.push({ id: `p-${plan.id}-submitted`, kind: 'plan-submitted', ts: nowTs, teamId: next.teamId, sessionId: plan.authorSessionId, taskId: plan.taskId, title: `Plan submitted for task ${plan.taskId}` });
        }
    }
    for (const claim of next.fileClaims) {
        if (!prevClaims.has(claim.id)) {
            events.push({ id: `c-${claim.id}`, kind: 'file-claimed', ts: nowTs, teamId: next.teamId, sessionId: claim.ownerSessionId, preview: claim.pattern, title: `File claimed: ${claim.pattern}` });
        }
    }
    for (const finding of next.findings) {
        const before = prevFindings.get(finding.id);
        if (before === undefined) {
            events.push({ id: `f-${finding.id}`, kind: 'finding', ts: nowTs, teamId: next.teamId, sessionId: finding.authorSessionId, taskId: finding.taskId, severity: finding.severity, preview: finding.summary, title: `Finding (${finding.severity}): ${finding.summary}` });
        }
    }
    if (prev.teamStatus !== next.teamStatus && next.teamStatus === 'completed') {
        events.push({ id: 'team-completed', kind: 'team-completed', ts: nowTs, teamId: next.teamId, title: 'Team completed' });
    }
    return events;
}
/**
 * Map one SSE frame (`{"type": "agent-teams/…", …payload}`) into a UI event.
 * Ids intentionally match `diffSnapshots` so pushBuffer dedupes against the
 * polling diff; unknown frames return undefined. No animation is invented
 * here — every returned event is backed by a real emitted payload.
 */
export function rawEventToUiEvent(frame, nowTs) {
    if (frame === null || typeof frame !== 'object' || typeof frame.type !== 'string')
        return undefined;
    const teamId = typeof frame.teamId === 'string'
        ? frame.teamId
        : typeof frame.team?.id === 'string'
            ? frame.team.id
            : typeof frame.member?.teamId === 'string'
                ? frame.member.teamId
                : typeof frame.task?.teamId === 'string'
                    ? frame.task.teamId
                    : typeof frame.message?.teamId === 'string'
                        ? frame.message.teamId
                        : typeof frame.plan?.teamId === 'string'
                            ? frame.plan.teamId
                            : typeof frame.claim?.teamId === 'string'
                                ? frame.claim.teamId
                                : typeof frame.finding?.teamId === 'string' ? frame.finding.teamId : '';
    const p = frame;
    switch (frame.type) {
        case 'agent-teams/member-joined': {
            const m = p.member;
            if (m === undefined || typeof m !== 'object')
                return undefined;
            return { id: `m-${m.id}-joined`, kind: 'member-joined', ts: nowTs, teamId: teamId || m.teamId, sessionId: m.sessionId, title: `${m.name} joined (${m.role})` };
        }
        case 'agent-teams/member-left': {
            const m = p.member;
            if (m === undefined || typeof m !== 'object')
                return undefined;
            return { id: `m-${m.id}-left`, kind: 'member-left', ts: nowTs, teamId: teamId || m.teamId, sessionId: m.sessionId, title: `${m.name} left the team` };
        }
        case 'agent-teams/member-status': {
            const m = p.member;
            if (m === undefined || typeof m !== 'object')
                return undefined;
            return { id: `m-${m.id}-status-${m.status}`, kind: 'member-status', ts: nowTs, teamId: teamId || m.teamId, sessionId: m.sessionId, title: `${m.name} is now ${m.status}` };
        }
        case 'agent-teams/task-created': {
            const t = p.task;
            if (t === undefined || typeof t !== 'object')
                return undefined;
            return { id: `t-${t.id}-created`, kind: 'task-created', ts: nowTs, teamId: teamId || t.teamId, taskId: t.id, title: `Task created: ${t.title}` };
        }
        case 'agent-teams/task-claimed': {
            const t = p.task;
            if (t === undefined || typeof t !== 'object')
                return undefined;
            return { id: `t-${t.id}-${t.status}`, kind: 'task-claimed', ts: nowTs, teamId: teamId || t.teamId, taskId: t.id, sessionId: p.ownerSessionId, title: `Task ${t.title} claimed` };
        }
        case 'agent-teams/task-completed': {
            const t = p.task;
            if (t === undefined || typeof t !== 'object')
                return undefined;
            return { id: `t-${t.id}-completed`, kind: 'task-completed', ts: nowTs, teamId: teamId || t.teamId, taskId: t.id, sessionId: t.ownerSessionId, title: `Task ${t.title} completed` };
        }
        case 'agent-teams/task-failed': {
            const t = p.task;
            if (t === undefined || typeof t !== 'object')
                return undefined;
            return { id: `t-${t.id}-failed`, kind: 'task-failed', ts: nowTs, teamId: teamId || t.teamId, taskId: t.id, sessionId: t.ownerSessionId, title: `Task ${t.title} failed` };
        }
        case 'agent-teams/task-released': {
            const t = p.task;
            if (t === undefined || typeof t !== 'object')
                return undefined;
            return { id: `t-${t.id}-${t.status}`, kind: 'task-released', ts: nowTs, teamId: teamId || t.teamId, taskId: t.id, title: `Task ${t.title} released` };
        }
        case 'agent-teams/task-blocked': {
            const t = p.task;
            if (t === undefined || typeof t !== 'object')
                return undefined;
            return { id: `t-${t.id}-blocked`, kind: 'task-blocked', ts: nowTs, teamId: teamId || t.teamId, taskId: t.id, sessionId: t.ownerSessionId, preview: typeof p.reason === 'string' ? p.reason : undefined, title: `Task ${t.title} blocked` };
        }
        case 'agent-teams/message-sent': {
            const m = p.message;
            if (m === undefined || typeof m !== 'object')
                return undefined;
            if (m.deliveryState === 'failed')
                return { id: `msg-${m.id}-failed`, kind: 'message', ts: nowTs, teamId: teamId || m.teamId, sessionId: m.fromSessionId, targetSessionId: m.toSessionId, preview: `⚠ delivery failed: ${String(m.deliveryError ?? '')}`, title: 'Message delivery failed' };
            return { id: `msg-${m.id}`, kind: 'message', ts: nowTs, teamId: teamId || m.teamId, sessionId: m.fromSessionId, targetSessionId: m.toSessionId, preview: String(m.body ?? '').slice(0, 80), title: 'Message' };
        }
        case 'agent-teams/message-delivery-failed': {
            const m = p.message;
            if (m === undefined || typeof m !== 'object')
                return undefined;
            return { id: `msg-${m.id}-failed`, kind: 'message', ts: nowTs, teamId: teamId || m.teamId, sessionId: m.fromSessionId, targetSessionId: m.toSessionId, preview: `⚠ delivery failed: ${String(p.error ?? '')}`, title: 'Message delivery failed' };
        }
        case 'agent-teams/plan-submitted': {
            const pl = p.plan;
            if (pl === undefined || typeof pl !== 'object')
                return undefined;
            return { id: `p-${pl.id}-submitted`, kind: 'plan-submitted', ts: nowTs, teamId: teamId || pl.teamId, sessionId: pl.authorSessionId, taskId: pl.taskId, title: `Plan submitted for task ${pl.taskId}` };
        }
        case 'agent-teams/plan-approved': {
            const pl = p.plan;
            if (pl === undefined || typeof pl !== 'object')
                return undefined;
            return { id: `p-${pl.id}-approved`, kind: 'plan-approved', ts: nowTs, teamId: teamId || pl.teamId, sessionId: pl.authorSessionId, taskId: pl.taskId, title: `Plan approved for task ${pl.taskId}` };
        }
        case 'agent-teams/plan-rejected': {
            const pl = p.plan;
            if (pl === undefined || typeof pl !== 'object')
                return undefined;
            return { id: `p-${pl.id}-rejected`, kind: 'plan-rejected', ts: nowTs, teamId: teamId || pl.teamId, sessionId: pl.authorSessionId, taskId: pl.taskId, title: `Plan rejected for task ${pl.taskId}` };
        }
        case 'agent-teams/file-claimed': {
            const c = p.claim;
            if (c === undefined || typeof c !== 'object')
                return undefined;
            return { id: `c-${c.id}`, kind: 'file-claimed', ts: nowTs, teamId: teamId || c.teamId, sessionId: c.ownerSessionId, preview: c.pattern, title: `File claimed: ${c.pattern}` };
        }
        case 'agent-teams/file-released': {
            const c = p.claim;
            if (c === undefined || typeof c !== 'object')
                return undefined;
            return { id: `c-${c.id}-released`, kind: 'file-released', ts: nowTs, teamId: teamId || c.teamId, sessionId: c.ownerSessionId, preview: c.pattern, title: `File released: ${c.pattern}` };
        }
        case 'agent-teams/file-conflict':
            return { id: `fconflict-${p.conflictingClaim}-${p.attemptedBy}`, kind: 'file-conflict', ts: nowTs, teamId, sessionId: p.attemptedBy, preview: p.pattern, title: `File conflict: ${p.pattern} already claimed` };
        case 'agent-teams/finding-added': {
            const f = p.finding;
            if (f === undefined || typeof f !== 'object')
                return undefined;
            return { id: `f-${f.id}`, kind: 'finding', ts: nowTs, teamId: teamId || f.teamId, sessionId: f.authorSessionId, taskId: f.taskId, severity: f.severity, preview: f.summary, title: `Finding (${f.severity}): ${f.summary}` };
        }
        case 'agent-teams/finding-resolved': {
            const f = p.finding;
            if (f === undefined || typeof f !== 'object')
                return undefined;
            return { id: `f-${f.id}-resolved`, kind: 'finding', ts: nowTs, teamId: teamId || f.teamId, sessionId: f.authorSessionId, taskId: f.taskId, severity: f.severity, preview: f.summary, title: `Finding resolved: ${f.summary}` };
        }
        case 'agent-teams/team-completed':
            return { id: 'team-completed', kind: 'team-completed', ts: nowTs, teamId, title: 'Team completed' };
        default:
            return undefined;
    }
}
export function pushBuffer(buffer, events, cap = 300) {
    const merged = [...events.map((e) => ({ ...e, title: e.title ?? '' })), ...buffer];
    merged.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
    const seen = new Set();
    const out = [];
    for (const item of merged) {
        if (seen.has(item.id))
            continue;
        seen.add(item.id);
        out.push(item);
        if (out.length >= cap)
            break;
    }
    return out;
}
export function filterActivity(activity, filter) {
    if (filter === 'ALL')
        return activity;
    const kindSet = {
        TASKS: ['task-created', 'task-claimed', 'task-completed', 'task-failed', 'task-blocked', 'task-released'],
        MESSAGES: ['message'],
        AGENTS: ['member-joined', 'member-left', 'member-status'],
        FILES: ['file-claimed', 'file-released', 'file-conflict'],
        REVIEWS: ['finding', 'plan-submitted', 'plan-approved', 'plan-rejected'],
    };
    return activity.filter((a) => kindSet[filter].includes(a.kind));
}
/** Count members by semantic status for the header status map. */
export function statusCounts(members) {
    const counts = {};
    for (const member of members)
        counts[member.status] = (counts[member.status] ?? 0) + 1;
    return counts;
}
/** Resolve an explicitly requested team; never silently chooses the first team. */
export function resolveSelectedTeamId(teams, requested) {
    if (requested === null || requested === undefined)
        return null;
    return teams.some((team) => team.id === requested) ? requested : null;
}
/** Read the explicit Team route from a browser hash without falling back. */
export function teamIdFromHash(hash) {
    if (!hash.startsWith('#agent-team='))
        return null;
    try {
        const value = decodeURIComponent(hash.slice('#agent-team='.length));
        return value.length > 0 ? value : null;
    }
    catch {
        return null;
    }
}
/** Normalize the raw snapshot payload into the UI model. */
export function normalizeSnapshot(raw) {
    return {
        teamId: raw.team.id,
        teamName: raw.team.name,
        teamGoal: typeof raw.team.goal === 'string' ? raw.team.goal : undefined,
        teamCreatedAt: typeof raw.team.createdAt === 'number' ? raw.team.createdAt : undefined,
        leadSessionId: raw.team.leadSessionId,
        teamStatus: raw.team.status,
        members: (raw.members ?? []).map((m) => ({ id: m.id, sessionId: m.sessionId, name: m.name, role: m.role, status: m.status, currentTaskId: m.currentTaskId })),
        tasks: (raw.tasks ?? []).map((t) => ({ id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority, ownerSessionId: t.ownerSessionId, dependencies: t.dependencies ?? [], result: t.result })),
        plans: (raw.plans ?? []).map((p) => ({ id: p.id, taskId: p.taskId, authorSessionId: p.authorSessionId, status: p.status })),
        findings: (raw.findings ?? []).map((f) => ({ id: f.id, severity: f.severity, summary: f.summary, state: f.state, authorSessionId: f.authorSessionId, taskId: f.taskId })),
        messages: (raw.messages ?? []).map((m) => ({ id: m.id, fromSessionId: m.fromSessionId, toSessionId: m.toSessionId, type: m.type, body: m.body, createdAt: m.createdAt, deliveryState: m.deliveryState, deliveryError: m.deliveryError })),
        fileClaims: (raw.fileClaims ?? []).map((c) => ({ id: c.id, ownerSessionId: c.ownerSessionId, pattern: c.pattern, kind: c.kind })),
        progress: raw.progress ?? { requiredTotal: 0, requiredDone: 0, ratio: 0, blocked: [], awaitingPlanApproval: [] },
    };
}
/** True when reduced motion is requested by the OS (guard for particle animation). */
export function prefersReducedMotion() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
}
