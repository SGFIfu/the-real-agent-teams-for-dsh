window.__ModuleLoader__.load({
  id: "dsh-agent-teams",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var React = require("react");
/**
 * Event → UI adapter (pure, DOM-free, unit-testable).
 *
 * Pipeline: Agent Teams events / snapshot diffs → normalized UI events →
 * bounded activity buffer → animation hints. The React layer renders these;
 * nothing here touches DOM or React.
 * @module dsh-agent-teams/client/logic
 */
/** Status → icon + label + css suffix. Never color-only. */
function statusMeta(status) {
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
function taskStatusMeta(status) {
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
function roleAvatar(role) {
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
function layeredGraph(tasks) {
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
function diffSnapshots(prev, next, nowTs) {
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
function rawEventToUiEvent(frame, nowTs) {
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
function pushBuffer(buffer, events, cap = 300) {
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
function filterActivity(activity, filter) {
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
function statusCounts(members) {
    const counts = {};
    for (const member of members)
        counts[member.status] = (counts[member.status] ?? 0) + 1;
    return counts;
}
/** Resolve an explicitly requested team; never silently chooses the first team. */
function resolveSelectedTeamId(teams, requested) {
    if (requested === null || requested === undefined)
        return null;
    return teams.some((team) => team.id === requested) ? requested : null;
}
/** Read the explicit Team route from a browser hash without falling back. */
function teamIdFromHash(hash) {
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
function normalizeSnapshot(raw) {
    return {
        teamId: raw.team.id,
        teamName: raw.team.name,
        leadSessionId: raw.team.leadSessionId,
        teamStatus: raw.team.status,
        members: (raw.members ?? []).map((m) => ({ id: m.id, sessionId: m.sessionId, name: m.name, role: m.role, status: m.status, currentTaskId: m.currentTaskId })),
        tasks: (raw.tasks ?? []).map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, ownerSessionId: t.ownerSessionId, dependencies: t.dependencies ?? [], result: t.result })),
        plans: (raw.plans ?? []).map((p) => ({ id: p.id, taskId: p.taskId, authorSessionId: p.authorSessionId, status: p.status })),
        findings: (raw.findings ?? []).map((f) => ({ id: f.id, severity: f.severity, summary: f.summary, state: f.state, authorSessionId: f.authorSessionId, taskId: f.taskId })),
        messages: (raw.messages ?? []).map((m) => ({ id: m.id, fromSessionId: m.fromSessionId, toSessionId: m.toSessionId, type: m.type, body: m.body, createdAt: m.createdAt, deliveryState: m.deliveryState, deliveryError: m.deliveryError })),
        fileClaims: (raw.fileClaims ?? []).map((c) => ({ id: c.id, ownerSessionId: c.ownerSessionId, pattern: c.pattern, kind: c.kind })),
        progress: raw.progress ?? { requiredTotal: 0, requiredDone: 0, ratio: 0, blocked: [], awaitingPlanApproval: [] },
    };
}
/** True when reduced motion is requested by the OS (guard for particle animation). */
function prefersReducedMotion() {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
    return false;
}

/**
 * Privacy-safe projection of the Harness ConversationSnapshot.
 *
 * The Harness client runtime exposes typed ConversationNode/AssistantBlock
 * kinds. We intentionally project only public text/tool/result arms and never
 * pass the snapshot to the native trajectory viewer, whose product surface
 * includes reasoning details. The structural types here keep this plugin's
 * client bundle compatible with the host's injected runtime package.
 */
/** Resolve the official direct-parent address from a loaded Harness catalog. */
function subagentAddressFromCatalog(parentSessionId, childSessionId, entries) {
    if (parentSessionId === undefined || entries === undefined)
        return undefined;
    const entry = entries.find((candidate) => candidate !== null && typeof candidate === 'object' && candidate.id === childSessionId);
    if (entry === undefined || typeof entry !== 'object')
        return undefined;
    const value = entry;
    if (value.kind !== 'child')
        return undefined;
    if (value.mode !== 'continuable' && value.mode !== 'one-shot')
        return undefined;
    return { parentSessionId, childSessionId, mode: value.mode };
}
function textFromBlocks(blocks) {
    if (!Array.isArray(blocks))
        return '';
    return blocks
        .filter((block) => block !== null && typeof block === 'object')
        .filter((block) => block.kind === 'text' || block.type === 'text' || block.type === 'json')
        .map((block) => {
        if (typeof block.text === 'string')
            return block.text;
        if (typeof block.json === 'string')
            return block.json;
        if (block.json !== undefined) {
            try {
                return JSON.stringify(block.json);
            }
            catch {
                return '';
            }
        }
        return '';
    })
        .filter((text) => text.length > 0)
        .join('\n');
}
function nodeSourceForm(node) {
    const provenance = node.provenance;
    if (provenance !== null && typeof provenance === 'object' && typeof provenance.form === 'string') {
        return provenance.form;
    }
    if (typeof node.form === 'string')
        return node.form;
    const source = node.source;
    if (source !== null && typeof source === 'object' && typeof source.form === 'string') {
        return source.form;
    }
    return undefined;
}
/** Convert one official Harness ConversationSnapshot shape into public rows. */
function projectVisibleSession(input) {
    const snapshot = input !== null && typeof input === 'object' ? input : {};
    const rawNodes = Array.isArray(snapshot.nodes)
        ? snapshot.nodes
        : (snapshot.chat !== null && typeof snapshot.chat === 'object' && snapshot.chat.legacy !== undefined
            ? snapshot.chat.legacy.nodes
            : []);
    const items = [];
    for (const raw of Array.isArray(rawNodes) ? rawNodes : []) {
        if (raw === null || typeof raw !== 'object')
            continue;
        const node = raw;
        const seq = typeof node.seq === 'number' ? node.seq : items.length;
        const time = typeof node.time === 'number' ? node.time : undefined;
        const id = `${String(node.kind ?? 'event')}-${seq}`;
        if (node.kind === 'user' || node.kind === 'steering') {
            const text = textFromBlocks(node.content);
            if (text !== '')
                items.push({ id, kind: 'user', time, text });
            continue;
        }
        if (node.kind === 'assistant') {
            const blocks = Array.isArray(node.blocks) ? node.blocks : [];
            for (const block of blocks) {
                if (block === null || typeof block !== 'object')
                    continue;
                const value = block;
                if (value.kind === 'text' && typeof value.text === 'string' && value.text !== '') {
                    items.push({ id: `${id}-text-${items.length}`, kind: 'assistant', time, text: value.text });
                }
                else if (value.kind === 'tool-call' && typeof value.name === 'string') {
                    items.push({ id: `${id}-call-${items.length}`, kind: 'tool-call', time, text: `⚙ ${value.name}`, name: value.name, args: typeof value.argsRaw === 'string' ? value.argsRaw : undefined });
                }
                // `kind === reasoning` and all unknown/private blocks are deliberately dropped.
            }
            continue;
        }
        if (node.kind === 'tool-result') {
            const text = textFromBlocks(node.content);
            const call = node.call;
            const name = call !== null && typeof call === 'object' && typeof call.name === 'string'
                ? call.name
                : undefined;
            if (text !== '' || name !== undefined)
                items.push({ id, kind: 'tool-result', time, text: text || '✓ completed', name, error: node.isError === true });
            continue;
        }
        // Reports/team events are context nodes with an explicit public form. Do
        // not surface arbitrary context injections: absence of a public form is a
        // conservative privacy boundary.
        if (node.kind === 'context') {
            const form = nodeSourceForm(node);
            if (form === 'report' || form === 'team-message' || form === 'task-event' || form === 'subagent-report') {
                const text = textFromBlocks(node.content);
                if (text !== '')
                    items.push({ id, kind: 'report', time, text });
            }
        }
    }
    const partial = snapshot.partial;
    if (partial !== null && partial !== undefined && typeof partial === 'object') {
        const partialRecord = partial;
        const blocks = Array.isArray(partialRecord.blocks) ? partialRecord.blocks : [];
        for (const block of blocks) {
            if (block === null || typeof block !== 'object')
                continue;
            const value = block;
            if (value.kind === 'text' && typeof value.text === 'string' && value.text !== '')
                items.push({ id: `partial-text-${items.length}`, kind: 'assistant', text: value.text });
            if (value.kind === 'tool-call' && typeof value.name === 'string')
                items.push({ id: `partial-call-${items.length}`, kind: 'tool-call', text: `⚙ ${value.name}`, name: value.name, args: typeof value.argsRaw === 'string' ? value.argsRaw : undefined });
        }
    }
    return {
        sessionId: typeof snapshot.sessionId === 'string' ? snapshot.sessionId : '',
        running: snapshot.running === true,
        openState: typeof snapshot.openState === 'string' ? snapshot.openState : undefined,
        items,
    };
}

/**
 * dsh-agent-teams — Animated AI Team Command Center (client module).
 *
 * Renders the team as a living workspace: agent nodes with status motion,
 * event-driven message particles, a dependency task graph, a live activity
 * feed + timeline, and an Agent Inspector drawer (real sessions via the
 * Harness session viewer, team messages, tasks, file claims, send-message
 * and interrupt controls). All data is REAL — snapshots from the host
 * `/agent-teams/*` routes, push events over the SSE stream.
 *
 * Respects `prefers-reduced-motion`, keyboard navigation and the Harness
 * theme tokens. No fake activity: animations only fire for real events.
 * @module dsh-agent-teams/client
 */
/** Cordis timer when available (fiber-owned); browser fallback otherwise. */
function timerOf(ctx) {
    // `ctx.timer` is dependency-gated by Cordis and direct optional access still
    // throws when `timer` is not declared. `get()` is the supported optional
    // lookup; use the browser fallback only when the host has no timer service.
    const service = typeof ctx?.get === 'function' ? ctx.get('timer') : undefined;
    if (service !== undefined && typeof service.interval === 'function' && typeof service.timeout === 'function')
        return service;
    return {
        timeout: (cb, ms) => {
            const h = setTimeout(cb, ms);
            return () => clearTimeout(h);
        },
        interval: (cb, ms) => {
            const h = setInterval(cb, ms);
            return () => clearInterval(h);
        },
    };
}
/**
 * The web session service has had two catalog shapes across Harness builds:
 * a reactive `list.getSnapshot()` facade and a direct `listChildren()` method.
 * Keep the compatibility code here, at the client boundary, and never fall
 * back to the host trajectory viewer (`sessions.open()`), which is not a
 * privacy-safe surface for Agent Teams.
 */
async function resolvePublicSubagentAddress(sessions, parentSessionId, childSessionId) {
    if (sessions === null || typeof sessions !== 'object' || parentSessionId === undefined)
        return undefined;
    const service = sessions;
    const list = service.list;
    const directAddress = typeof service.subagentAddress === 'function'
        ? service.subagentAddress(childSessionId)
        : typeof list?.subagentAddress === 'function'
            ? list.subagentAddress(childSessionId)
            : undefined;
    if (directAddress !== undefined)
        return directAddress;
    const childListers = [];
    for (const owner of [service, service.subagents, service.subagentRuntime, list]) {
        if (owner !== undefined && typeof owner.listChildren === 'function')
            childListers.push({ owner, fn: owner.listChildren });
    }
    for (const candidate of childListers) {
        try {
            const entries = await candidate.fn.call(candidate.owner, parentSessionId);
            const address = subagentAddressFromCatalog(parentSessionId, childSessionId, Array.isArray(entries) ? entries : undefined);
            if (address !== undefined)
                return address;
        }
        catch {
            // A missing optional client catalog must not prevent the retained
            // `binding(member.sessionId)` from being used below.
        }
    }
    const refreshers = [];
    for (const owner of [service, list]) {
        if (owner === undefined)
            continue;
        for (const name of ['refreshSubagents', 'refreshChildren', 'refresh']) {
            if (typeof owner[name] === 'function')
                refreshers.push({ owner, fn: owner[name] });
        }
    }
    for (const candidate of refreshers) {
        try {
            await candidate.fn.call(candidate.owner, parentSessionId);
            const address = subagentAddressFromSnapshot(service, list, parentSessionId, childSessionId);
            if (address !== undefined)
                return address;
        }
        catch {
            // Try the next official catalog source; address resolution is best effort.
        }
    }
    return subagentAddressFromSnapshot(service, list, parentSessionId, childSessionId);
}
function subagentAddressFromSnapshot(service, list, parentSessionId, childSessionId) {
    const snapshots = [];
    for (const owner of [list, service]) {
        if (owner !== undefined && typeof owner.getSnapshot === 'function') {
            try {
                snapshots.push(owner.getSnapshot());
            }
            catch { /* optional facade */ }
        }
    }
    for (const snapshot of snapshots) {
        if (snapshot === null || typeof snapshot !== 'object')
            continue;
        const record = snapshot;
        const grouped = record.subagentsByParent?.[parentSessionId];
        const entries = Array.isArray(grouped) ? grouped : grouped !== null && typeof grouped === 'object' && Array.isArray(grouped.entries) ? grouped.entries : undefined;
        const address = subagentAddressFromCatalog(parentSessionId, childSessionId, entries);
        if (address !== undefined)
            return address;
    }
    return undefined;
}
/** Open only the explicit public child-session surface, never the host viewer. */
async function openPublicSubagent(sessions, address) {
    if (sessions === null || typeof sessions !== 'object' || address === undefined)
        return false;
    const service = sessions;
    const list = service.list;
    for (const owner of [service, list]) {
        if (owner === undefined)
            continue;
        for (const name of ['openSubagent', 'openChildSubagent']) {
            if (typeof owner[name] !== 'function')
                continue;
            try {
                await owner[name](address);
                return true;
            }
            catch {
                // Continue to the next compatible explicit public opener.
            }
        }
    }
    return false;
}
/** Resolve a retained real binding by the persisted Harness session id. */
function sessionBindingFor(sessions, sessionId) {
    if (sessions === null || typeof sessions !== 'object')
        return undefined;
    const service = sessions;
    if (typeof service.binding !== 'function')
        return undefined;
    try {
        const binding = service.binding(sessionId);
        return binding !== undefined && binding.session !== undefined ? binding : undefined;
    }
    catch {
        return undefined;
    }
}
/** A successful delivery is the only message event allowed to fly. */
function messageDeliverySucceeded(message) {
    return message?.deliveryState !== 'failed';
}
function isFailedMessageFrame(frame) {
    if (frame === null || typeof frame !== 'object')
        return false;
    const value = frame;
    if (value.type === 'agent-teams/message-delivery-failed')
        return true;
    const message = value.message;
    return value.type === 'agent-teams/message-sent' && message !== null && typeof message === 'object' && message.deliveryState === 'failed';
}
function shouldAnimateMessage(eventId, messages, frame) {
    if (isFailedMessageFrame(frame))
        return false;
    const messageId = eventId.startsWith('msg-') ? eventId.slice(4).replace(/-failed$/, '') : eventId;
    return messageDeliverySucceeded(messages.find((message) => message.id === messageId));
}
const CSS = `
.agc-overlay { position: fixed; inset: 0; z-index: 8990; pointer-events: none; }
.agc-surface { --agc-bg: #0b0d10; --agc-panel: #11151a; --agc-card: #161b22; --agc-border: #2a2f36; --agc-text: #f0f3f6; --agc-muted: #9aa0a6; --agc-input: #0b0d10; position: fixed; inset: 0; z-index: 2147483000; background: var(--agc-bg); pointer-events: auto; display: flex; flex-direction: column; color: var(--agc-text); font-size: 13px; }
/* Harness theme bootstrap owns body[data-ds-dark-theme]. Keep the panel
 * aligned with that source of truth instead of maintaining a second theme
 * preference inside the plugin. */
body:not([data-ds-dark-theme]) .agc-surface, [data-agc-theme="light"], body[data-theme="light"] .agc-surface, html[data-theme="light"] .agc-surface, [data-ds-theme="light"] .agc-surface { --agc-bg: #f6f8fa; --agc-panel: #ffffff; --agc-card: #ffffff; --agc-border: #d0d7de; --agc-text: #1f2328; --agc-muted: #57606a; --agc-input: #ffffff; }
.agc-overlay { z-index: 2147483000; }
.agc-teamlist { display: flex; flex-direction: column; gap: 10px; padding: 18px; overflow: auto; }
.agc-teamrow { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: 1px solid var(--agc-border); border-radius: 12px; padding: 12px; background: var(--agc-card); color: inherit; cursor: pointer; }
.agc-teamrow:hover, .agc-teamrow:focus-visible { border-color: #58a6ff; outline: none; }
.agc-connection { font-size: 10px; letter-spacing: .06em; color: #3fb950; }
.agc-connection.reconnecting { color: #d29922; }
.agc-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--agc-border); flex-wrap: wrap; }
.agc-title { font-size: 16px; font-weight: 700; }
.agc-goal { opacity: .7; font-size: 12px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agc-status { border-radius: 12px; padding: 2px 10px; font-size: 11px; font-weight: 700; letter-spacing: .06em; }
.agc-progress { flex: 1; min-width: 140px; height: 8px; border-radius: 4px; background: var(--agc-panel); border: 1px solid var(--agc-border); overflow: hidden; }
.agc-progressfill { height: 100%; background: #3fb950; transition: width .6s ease; }
.agc-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.agc-chip { border: 1px solid var(--agc-border); border-radius: 12px; padding: 2px 8px; font-size: 11px; cursor: pointer; background: transparent; color: inherit; }
.agc-close { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.agc-body { flex: 1; display: flex; min-height: 0; }
.agc-main { flex: 1; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; position: relative; }
.agc-side { width: 340px; border-left: 1px solid var(--agc-border); display: flex; flex-direction: column; min-height: 0; }
.agc-panel { padding: 10px 12px; border-bottom: 1px solid var(--agc-border); }
.agc-paneltitle { font-size: 11px; font-weight: 700; letter-spacing: .08em; opacity: .7; margin-bottom: 6px; }
.agc-workspace { position: relative; border: 1px solid var(--agc-border); border-radius: 12px; padding: 18px; min-height: 220px; }
.agc-agents { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: flex-start; }
.agc-leadrow { width: 100%; display: flex; justify-content: center; margin-bottom: 10px; }
.agc-node { position: relative; width: 150px; border: 1px solid var(--agc-border); border-radius: 12px; padding: 10px; cursor: pointer; background: var(--agc-card); text-align: center; outline: none; transition: border-color .25s ease, box-shadow .25s ease, opacity .25s ease; color: inherit; font: inherit; }
.agc-node:focus-visible { border-color: #58a6ff; box-shadow: 0 0 0 2px rgba(88,166,255,.4); }
.agc-node:hover { border-color: #58a6ff; }
.agc-avatar { font-size: 26px; }
.agc-name { font-weight: 700; margin-top: 2px; }
.agc-role { opacity: .65; font-size: 11px; }
.agc-statusrow { margin-top: 6px; display: flex; justify-content: center; align-items: center; gap: 4px; }
.agc-status { font-size: 10px; font-weight: 700; letter-spacing: .08em; }
.agc-task { margin-top: 4px; font-size: 11px; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agc-minibar { height: 3px; border-radius: 2px; background: #2a2f36; margin-top: 6px; overflow: hidden; }
.agc-minifill { height: 100%; background: #58a6ff; transition: width .8s ease; }
.st-working { color: #58a6ff; }
.st-thinking { color: #d29922; }
.st-blocked { color: #f85149; }
.st-reviewing { color: #bc8cff; }
.st-idle { color: #9aa0a6; }
.st-waiting { color: #9aa0a6; }
.st-completed { color: #3fb950; }
.st-failed { color: #f85149; }
.agc-pulse { animation: agcPulse 1.8s ease-in-out infinite; }
.agc-pulse-fast { animation: agcPulse 1.1s ease-in-out infinite; }
@keyframes agcPulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
.agc-msgparticle { position: fixed; width: 6px; height: 6px; border-radius: 50%; background: #58a6ff; z-index: 9050; animation: agcTravel 1.8s ease-in forwards; pointer-events: none; }
.agc-msgparticle-finding { background: #f85149; }
.agc-msgparticle-plan { background: #d29922; }
@keyframes agcTravel { from { transform: translate(0,0); opacity: 1; } to { transform: translate(var(--dx, 0), var(--dy, 0)); opacity: 0; } }
.agc-msglabel { position: fixed; font-size: 11px; border: 1px solid #2a2f36; border-radius: 8px; padding: 3px 8px; background: #000; color: #fff; z-index: 9051; animation: agcFade 1.8s ease-in forwards; pointer-events: none; max-width: 220px; }
@keyframes agcFade { 0% { opacity: 0; } 12% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
.agc-taskgraph { border: 1px solid var(--agc-border); border-radius: 12px; padding: 14px; overflow: auto; }
.agc-graphrow { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 8px 0; position: relative; }
.agc-graphconn { text-align: center; color: #9aa0a6; font-size: 12px; margin: -4px 0; }
.agc-tasknode { border: 1px solid var(--agc-border); border-radius: 8px; padding: 6px 10px; font-size: 12px; background: var(--agc-card); min-width: 130px; transition: border-color .3s ease, opacity .3s ease; }
.agc-tasknode.blocked { border-color: #f85149; }
.agc-taskowner { font-size: 10px; opacity: .7; }
.agc-depedge { display: block; text-align: center; color: #58a6ff; font-size: 12px; animation: agcFade 1.6s ease-in forwards; }
.agc-feed { flex: 1; overflow: auto; padding: 8px 10px; }
.agc-feeditem { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; border-bottom: 1px solid var(--agc-border); }
.agc-feeditem:hover { background: #111; }
body:not([data-ds-dark-theme]) .agc-feeditem:hover { background: #eef2f6; }
.agc-feedtime { opacity: .5; font-size: 10px; margin-right: 6px; }
.agc-filters { display: flex; gap: 4px; padding: 6px 10px; flex-wrap: wrap; }
.agc-filter { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 10px; font-size: 10px; padding: 2px 8px; cursor: pointer; }
.agc-filter.on { background: #1c2c45; border-color: #58a6ff; color: #dbeafe; }
.agc-banner { margin-bottom: 10px; border: 1px solid var(--agc-border); border-radius: 10px; padding: 10px 12px; }
.agc-banner.plan { border-color: #d29922; }
.agc-banner.block { border-color: #f85149; }
.agc-banner.done { border-color: #3fb950; }
.agc-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 96vw); background: var(--agc-bg); border-left: 1px solid var(--agc-border); z-index: 2147483005; display: flex; flex-direction: column; pointer-events: auto; }
.agc-drawerhead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--agc-border); }
.agc-drawerbody { flex: 1; overflow: auto; padding: 12px 14px; }
.agc-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px; }
.agc-tab { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 8px; font-size: 11px; padding: 4px 10px; cursor: pointer; }
.agc-tab.on { background: #1c2c45; border-color: #58a6ff; color: #dbeafe; }
.agc-card { border: 1px solid var(--agc-border); border-radius: 10px; padding: 10px; margin-bottom: 10px; background: var(--agc-card); }
.agc-kv { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
.agc-input { width: 100%; box-sizing: border-box; background: var(--agc-input); color: var(--agc-text); border: 1px solid var(--agc-border); border-radius: 8px; padding: 8px; font-size: 12px; }
.agc-btn { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.agc-btn.primary { background: #1c2c45; border-color: #58a6ff; }
.agc-btn.danger { border-color: #f85149; color: #f85149; }
.agc-confirm { border: 1px solid #f85149; border-radius: 8px; padding: 8px; font-size: 12px; margin-top: 8px; }
.agc-tool { border: 1px solid var(--agc-border); border-radius: 8px; padding: 4px 8px; font-size: 11px; margin: 3px 0; }
.agc-empty { opacity: .6; font-size: 12px; padding: 14px; text-align: center; }
.agc-skeleton { height: 12px; border-radius: 6px; background: #1a1a1a; animation: agcPulse 1.4s ease-in-out infinite; margin: 6px 0; }
body:not([data-ds-dark-theme]) .agc-skeleton { background: #e1e7ee; }
.agc-observe { display: flex; gap: 10px; overflow: auto; }
.agc-observecol { flex: 1; min-width: 180px; border: 1px solid var(--agc-border); border-radius: 10px; padding: 8px; font-size: 11px; }
.agc-session-feed { max-height: 42vh; overflow: auto; border: 1px solid var(--agc-border); border-radius: 10px; padding: 8px; }
.agc-session-row { padding: 8px; border-bottom: 1px solid var(--agc-border); white-space: pre-wrap; overflow-wrap: anywhere; }
.agc-session-kind { font-size: 10px; color: var(--agc-muted); letter-spacing: .06em; margin-bottom: 3px; }
.agc-follow { border: 1px solid #58a6ff; border-radius: 8px; padding: 2px 8px; font-size: 10px; color: #58a6ff; cursor: pointer; }
.agc-newmsg { position: absolute; top: -8px; right: -8px; background: #1c2c45; border: 1px solid #58a6ff; color: #58a6ff; border-radius: 10px; font-size: 10px; padding: 0 6px; }
.agc-hideflow { opacity: .45; }
@media (prefers-reduced-motion: reduce) {
  .agc-pulse, .agc-pulse-fast, .agc-msgparticle, .agc-msglabel, .agc-depedge { animation: none !important; }
  .agc-progressfill, .agc-minifill { transition: none !important; }
}
@media (max-width: 700px) {
  .agc-head { gap: 7px; padding: 8px 10px; }
  .agc-title { font-size: 14px; }
  .agc-goal { max-width: 100%; width: 100%; }
  .agc-body { flex-direction: column; overflow: auto; min-height: 0; }
  .agc-main { flex: none; min-height: 48vh; padding: 10px; }
  .agc-side { width: 100%; flex: none; height: 260px; min-height: 220px; border-left: 0; border-top: 1px solid var(--agc-border); }
  .agc-node { width: 132px; }
  .agc-workspace { overflow: auto; }
  .agc-drawer { width: 100vw; border-left: 0; }
  .agc-session-feed { max-height: 48vh; }
}
@media (max-width: 380px) {
  .agc-head { align-items: flex-start; }
  .agc-progress { order: 5; flex-basis: 100%; min-width: 0; }
  .agc-node { width: calc(50vw - 30px); min-width: 118px; }
  .agc-workspace { padding: 10px; }
  .agc-drawerhead { padding: 10px; }
  .agc-drawerbody { padding: 10px; }
}
`;
/**
 * Static client bundles do not receive the dynamic runner's `styles` closure.
 * Mirror the Harness client packages by owning a marked style tag in the
 * document head and returning a disposer for plugin unload/HMR.
 */
function installStaticCss() {
    if (typeof document === 'undefined')
        return () => { };
    const pluginCssId = 'dsh-agent-teams/command-center';
    const existing = document.querySelector(`style[data-plugin-css="${pluginCssId}"]`);
    if (existing !== null)
        return () => { };
    const tag = document.createElement('style');
    tag.dataset.plugin = 'dsh-agent-teams';
    tag.dataset.pluginCss = pluginCssId;
    tag.textContent = CSS;
    document.head.appendChild(tag);
    return () => {
        if (tag.parentNode !== null)
            tag.parentNode.removeChild(tag);
    };
}
function fmtTime(ts) {
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function AgentNode(props) {
    const { member, snapshot, onOpen, reduced } = props;
    const meta = statusMeta(member.status);
    const currentTask = snapshot.tasks.find((t) => t.id === member.currentTaskId);
    const doneBy = snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId && t.status === 'completed').length;
    const pulse = member.status === 'thinking' || member.status === 'starting' ? 'agc-pulse' : member.status === 'working' ? (reduced ? '' : 'agc-pulse-fast') : '';
    return React.createElement('button', {
        className: `agc-node ${member.status === 'idle' || member.status === 'completed' || member.status === 'stopped' ? 'agc-hideflow' : ''}`,
        onClick: () => onOpen(member.sessionId),
        tabIndex: 0,
        'aria-label': `${member.name} (${member.role}), ${meta.label}`,
        key: member.id,
    }, React.createElement('div', { className: 'agc-avatar' }, roleAvatar(member.role)), React.createElement('div', { className: 'agc-name' }, member.name), React.createElement('div', { className: 'agc-role' }, member.role), React.createElement('div', { className: 'agc-statusrow' }, React.createElement('span', { className: `agc-status ${meta.css} ${pulse}` }, `${meta.icon} ${meta.label}`)), React.createElement('div', { className: 'agc-task' }, currentTask ? currentTask.title : doneBy > 0 ? `✓ ${doneBy} done` : '—'), React.createElement('div', { className: 'agc-minibar' }, React.createElement('div', { className: 'agc-minifill', style: { width: currentTask ? '70%' : '12%' } })));
}
function MessageLayer(props) {
    const { animations } = props;
    const nodes = typeof document !== 'undefined' ? Array.from(document.querySelectorAll('[data-agc-session]')) : [];
    const pos = (sessionId) => {
        const el = nodes.find((n) => n.dataset.agcSession === sessionId);
        if (el !== undefined) {
            const r = el.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
        return { x: -100, y: -100 };
    };
    return React.createElement(React.Fragment, null, animations.map((a) => {
        const from = pos(a.fromSessionId);
        const to = pos(a.targetSessionId);
        if (a.targetSessionId === undefined || from.x < 0 || to.x < 0) {
            return React.createElement('div', { key: a.id, className: 'agc-msglabel', style: { left: '30%', top: '12%' } }, a.label);
        }
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        return React.createElement(React.Fragment, { key: a.id }, React.createElement('span', { className: `agc-msgparticle ${a.kind === 'finding' ? 'agc-msgparticle-finding' : a.kind === 'plan' ? 'agc-msgparticle-plan' : ''}`, style: { left: from.x, top: from.y, ['--dx']: `${dx}px`, ['--dy']: `${dy}px` } }), React.createElement('span', { className: 'agc-msglabel', style: { left: (from.x + to.x) / 2 - 60, top: (from.y + to.y) / 2 - 12 } }, a.label));
    }));
}
function AgentGraph(props) {
    const { snapshot, onOpen, animations, reduced } = props;
    const lead = snapshot.members.find((m) => m.role === 'lead');
    const others = snapshot.members.filter((m) => m !== lead);
    return React.createElement('div', { className: 'agc-workspace' }, React.createElement('div', { className: 'agc-agents' }, lead !== undefined &&
        React.createElement('div', { className: 'agc-leadrow', 'data-agc-session': lead.sessionId }, React.createElement(AgentNode, { member: lead, snapshot, onOpen, reduced })), others.map((member) => React.createElement('div', { 'data-agc-session': member.sessionId, key: member.id }, React.createElement(AgentNode, { member, snapshot, onOpen, reduced }))), snapshot.members.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No teammates yet. Ask the Lead to spawn the team and they will appear here.')), React.createElement(MessageLayer, { animations, members: snapshot.members }));
}
function TaskGraphPanel(props) {
    const { snapshot, depFlash } = props;
    const rows = layeredGraph(snapshot.tasks);
    const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));
    const memberOf = new Map(snapshot.members.map((m) => [m.sessionId, m.name]));
    return React.createElement('div', { className: 'agc-taskgraph' }, React.createElement('div', { className: 'agc-paneltitle' }, 'TASK GRAPH'), rows.map((row, index) => React.createElement(React.Fragment, { key: index }, index > 0 && React.createElement('div', { className: 'agc-graphconn' }, '↓'), React.createElement('div', { className: 'agc-graphrow' }, row.map((task) => {
        const meta = taskStatusMeta(task.status);
        const blockedBy = task.status === 'blocked' ? task.dependencies.filter((d) => byId.get(d)?.status !== 'completed').map((d) => byId.get(d)?.title ?? d) : [];
        const flash = depFlash.has(task.id);
        return React.createElement('div', { className: `agc-tasknode ${task.status}`, key: task.id }, React.createElement('span', { className: `agc-status ${meta.css}` }, `${meta.icon} `), task.title, task.ownerSessionId !== undefined && React.createElement('div', { className: 'agc-taskowner' }, `owner: ${memberOf.get(task.ownerSessionId) ?? task.ownerSessionId.slice(0, 8)}`), blockedBy.length > 0 && React.createElement('div', { className: 'agc-taskowner' }, `⚠ Blocked by: ${blockedBy.join(', ')}`), flash && React.createElement('span', { className: 'agc-depedge' }, '▲ dependency released'));
    })))), snapshot.tasks.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No tasks created yet.'));
}
function ActivityFeed(props) {
    const { activity, filter, onFilter, onSelect, timeline } = props;
    const filters = ['ALL', 'TASKS', 'MESSAGES', 'AGENTS', 'FILES', 'REVIEWS'];
    const items = timeline ? [...activity].reverse() : filterActivity(activity, filter);
    return React.createElement(React.Fragment, null, React.createElement('div', { className: 'agc-filters' }, filters.map((f) => React.createElement('button', { key: f, className: `agc-filter ${filter === f ? 'on' : ''}`, onClick: () => onFilter(f) }, f))), React.createElement('div', { className: 'agc-feed' }, items.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No activity yet. Team events will appear here in real time.'), items.map((item) => React.createElement('div', { className: 'agc-feeditem', key: item.id, onClick: () => onSelect(item), tabIndex: 0, role: 'button', 'aria-label': item.title }, React.createElement('span', { className: 'agc-feedtime' }, fmtTime(item.ts)), item.title))));
}
function Inspector(props) {
    const { snapshot, sessionId, bridge, onClose, activity, session } = props;
    const [tab, setTab] = React.useState('activity');
    const [follow, setFollow] = React.useState(true);
    const [draft, setDraft] = React.useState('');
    const [confirmInterrupt, setConfirmInterrupt] = React.useState(false);
    const [sent, setSent] = React.useState(null);
    const sessionFeed = React.useRef(null);
    const member = snapshot.members.find((m) => m.sessionId === sessionId);
    React.useEffect(() => {
        const handler = (event) => {
            if (event.key === 'Escape')
                onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
    React.useEffect(() => {
        const element = sessionFeed.current;
        if (follow && element !== null)
            element.scrollTop = element.scrollHeight;
    }, [follow, session?.items.length]);
    if (member === undefined)
        return null;
    const meta = statusMeta(member.status);
    const currentTask = snapshot.tasks.find((t) => t.id === member.currentTaskId);
    const myClaims = snapshot.fileClaims.filter((c) => c.ownerSessionId === member.sessionId);
    const myMessages = snapshot.messages.filter((m) => m.fromSessionId === member.sessionId || m.toSessionId === member.sessionId || m.toSessionId === undefined);
    const myActivity = activity.filter((a) => a.sessionId === member.sessionId || a.targetSessionId === member.sessionId);
    const tabs = ['activity', 'messages', 'tasks', 'files'];
    const send = async () => {
        if (draft.trim() === '')
            return;
        const result = await bridge.sendMessage(snapshot.teamId, member.sessionId, draft.trim());
        setDraft('');
        setSent(result?.message?.deliveryState === 'failed' ? 'Message delivery failed; see Activity.' : 'Message delivered to the agent session.');
    };
    const memberName = (sid) => snapshot.members.find((m) => m.sessionId === sid)?.name ?? sid.slice(0, 8);
    return React.createElement('div', { className: 'agc-drawer', role: 'dialog', 'aria-label': `${member.name} inspector` }, React.createElement('div', { className: 'agc-drawerhead' }, React.createElement('span', { className: 'agc-avatar' }, roleAvatar(member.role)), React.createElement('div', { style: { flex: 1 } }, React.createElement('div', { className: 'agc-name' }, `${member.name} (${member.role})`), React.createElement('span', { className: `agc-status ${meta.css}` }, `${meta.icon} ${meta.label}`)), follow && React.createElement('button', { className: 'agc-follow', onClick: () => setFollow(false), 'aria-label': 'Following; click to unfollow' }, '👁 FOLLOWING'), follow === false && React.createElement('button', { className: 'agc-follow', onClick: () => setFollow(true) }, 'FOLLOW'), React.createElement('button', { className: 'agc-close', onClick: onClose, 'aria-label': 'Close inspector' }, '✕')), React.createElement('div', { className: 'agc-drawerbody' }, React.createElement('div', { className: 'agc-card' }, React.createElement('div', { className: 'agc-paneltitle' }, 'CURRENT TASK'), currentTask !== undefined
        ? React.createElement(React.Fragment, null, React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, currentTask.title), React.createElement('span', { className: `agc-status ${taskStatusMeta(currentTask.status).css}` }, taskStatusMeta(currentTask.status).icon)), React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, 'Priority'), React.createElement('span', null, currentTask.priority.toUpperCase())), currentTask.dependencies.length > 0 && React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, 'Dependencies'), React.createElement('span', null, currentTask.dependencies.map((d) => { const dep = snapshot.tasks.find((t) => t.id === d); return `${dep?.status === 'completed' ? '✓' : '○'} ${dep?.title ?? d}`; }).join(', '))))
        : React.createElement('div', { className: 'agc-empty' }, 'No current task.')), myClaims.length > 0 && React.createElement('div', { className: 'agc-card' }, React.createElement('div', { className: 'agc-paneltitle' }, 'FILES CLAIMED'), myClaims.map((c) => React.createElement('div', { key: c.id, className: 'agc-tool' }, `${c.kind} ${c.pattern}`))), React.createElement('div', { className: 'agc-tabs' }, tabs.map((t) => React.createElement('button', { key: t, className: `agc-tab ${tab === t ? 'on' : ''}`, onClick: () => setTab(t) }, t.toUpperCase()))), tab === 'activity' && React.createElement(React.Fragment, null, React.createElement('div', { className: 'agc-card' }, React.createElement('div', { className: 'agc-paneltitle' }, 'LIVE SESSION · PRIVACY-SAFE VIEW'), React.createElement('div', { style: { fontSize: 11, opacity: .7 } }, session === undefined ? 'Session snapshot unavailable; reconnecting to the real Harness session.' : `${session.running ? '● LIVE' : '○ IDLE'} · ${session.items.length} public events · ${session.openState ?? 'unknown'} · reasoning hidden by typed visibility policy`)), React.createElement('div', {
        className: 'agc-session-feed',
        ref: sessionFeed,
        onScroll: (event) => {
            const element = event.currentTarget;
            if (element.scrollTop + element.clientHeight < element.scrollHeight - 24)
                setFollow(false);
        },
    }, session?.items.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No public session events yet.'), session?.items.map((item) => React.createElement('div', { key: item.id, className: 'agc-session-row' }, React.createElement('div', { className: 'agc-session-kind' }, item.kind === 'tool-call' ? `⚙ ${item.name ?? 'tool'} · call` : item.kind === 'tool-result' ? `✓ ${item.name ?? 'tool'} · result${item.error ? ' · failed' : ''}` : item.kind.toUpperCase()), item.text, item.args !== undefined && React.createElement('div', { className: 'agc-tool' }, item.args)))), !follow && React.createElement('button', { className: 'agc-follow', onClick: () => setFollow(true) }, '↓ Jump to latest'), myActivity.length > 0 && React.createElement('div', { className: 'agc-card' }, React.createElement('div', { className: 'agc-paneltitle' }, 'TEAM ACTIVITY'), myActivity.map((a) => React.createElement('div', { key: a.id, className: 'agc-feeditem' }, React.createElement('span', { className: 'agc-feedtime' }, fmtTime(a.ts)), a.title)))), tab === 'messages' && React.createElement(React.Fragment, null, myMessages.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No team messages yet. Messages between teammates will appear here.'), myMessages.map((m) => React.createElement('div', { key: m.id, className: 'agc-card' }, React.createElement('div', { style: { fontSize: 11, opacity: .7 } }, `${memberName(m.fromSessionId)} → ${m.toSessionId === undefined ? 'team' : memberName(m.toSessionId)} · ${fmtTime(m.createdAt)} · ${m.deliveryState ?? 'legacy'}`), m.body)), React.createElement('div', { className: 'agc-card' }, React.createElement('input', { className: 'agc-input', value: draft, placeholder: `Message ${member.name}...`, onChange: (event) => setDraft(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter')
            void send(); } }), React.createElement('button', { className: 'agc-btn primary', style: { marginTop: 6 }, onClick: () => void send() }, 'Send message'), sent !== null && React.createElement('div', { style: { fontSize: 11, color: '#3fb950', marginTop: 4 } }, sent))), tab === 'tasks' && React.createElement(React.Fragment, null, snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId).length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No tasks owned yet.'), snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId).map((t) => React.createElement('div', { key: t.id, className: 'agc-card' }, React.createElement('span', { className: `agc-status ${taskStatusMeta(t.status).css}` }, `${taskStatusMeta(t.status).icon} ${taskStatusMeta(t.status).label}`), ` ${t.title}`)), React.createElement('div', { className: 'agc-paneltitle' }, 'AVAILABLE'), snapshot.tasks.filter((t) => t.status === 'pending').map((t) => React.createElement('div', { key: t.id, className: 'agc-tool' }, `○ ${t.title}`))), tab === 'files' && React.createElement(React.Fragment, null, myClaims.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No file claims for this agent.'), myClaims.map((c) => React.createElement('div', { key: c.id, className: 'agc-tool' }, `${c.kind} ${c.pattern}`)), React.createElement('div', { style: { fontSize: 11, opacity: .6, marginTop: 6 } }, 'File-level read/edit activity lives in the Harness session view (Activity tab).')), React.createElement('div', { className: 'agc-card' }, React.createElement('button', { className: 'agc-btn danger', onClick: () => setConfirmInterrupt(true) }, 'Interrupt agent'), confirmInterrupt && React.createElement('div', { className: 'agc-confirm' }, `Interrupt ${member.name}? Its current operation may stop.`, React.createElement('div', { style: { marginTop: 6, display: 'flex', gap: 6 } }, React.createElement('button', { className: 'agc-btn', onClick: () => setConfirmInterrupt(false) }, 'Cancel'), React.createElement('button', { className: 'agc-btn danger', onClick: () => { void bridge.interrupt(snapshot.teamId, member.sessionId); setConfirmInterrupt(false); } }, 'Interrupt'))))));
}
function CommandCenter(props) {
    const { bridge, ctx, teamId, onClose, onBack } = props;
    const timer = timerOf(ctx);
    const [snapshot, setSnapshot] = React.useState(null);
    const [activity, setActivity] = React.useState([]);
    const [animations, setAnimations] = React.useState([]);
    const [filter, setFilter] = React.useState('ALL');
    const [timeline, setTimeline] = React.useState(false);
    const [inspector, setInspector] = React.useState(null);
    const [depFlash, setDepFlash] = React.useState(new Set());
    const [observe, setObserve] = React.useState([]);
    const [connection, setConnection] = React.useState('reconnecting');
    const [session, setSession] = React.useState(undefined);
    const [reduced, setReduced] = React.useState(() => prefersReducedMotion());
    const prevRef = React.useRef(undefined);
    const streamStateRef = React.useRef('reconnecting');
    const leadSessionId = snapshot?.leadSessionId;
    React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function')
            return;
        const media = window.matchMedia('(prefers-reduced-motion: reduce)');
        const update = () => setReduced(media.matches);
        update();
        media.addEventListener?.('change', update);
        return () => media.removeEventListener?.('change', update);
    }, []);
    React.useEffect(() => {
        let alive = true;
        let off = () => { };
        let cancelRetry = () => { };
        let retryAttempt = 0;
        const refresh = async (animate = true) => {
            try {
                const raw = await bridge.snapshot(teamId);
                if (!alive)
                    return;
                if (raw?.team?.id !== teamId)
                    throw new Error('team snapshot identity mismatch');
                const next = normalizeSnapshot(raw);
                const prev = prevRef.current;
                const events = diffSnapshots(prev, next, Date.now());
                const fresh = prev === undefined ? events : events.filter((e) => e.kind !== 'member-joined');
                setActivity((buffer) => pushBuffer(buffer, fresh, 300));
                if (animate && prev !== undefined && !reduced) {
                    const anims = fresh
                        .filter((e) => (e.kind === 'message' || e.kind === 'finding' || e.kind === 'plan-approved' || e.kind === 'plan-rejected') && e.targetSessionId !== undefined)
                        .filter((e) => e.kind !== 'message' || shouldAnimateMessage(e.id, next.messages))
                        .map((e) => ({ id: e.id, kind: e.kind, fromSessionId: e.sessionId, targetSessionId: e.targetSessionId, label: e.kind === 'message' ? (e.preview ?? 'message') : e.title ?? '', until: Date.now() + 2000 }));
                    if (anims.length > 0)
                        setAnimations(anims);
                }
                if (prev !== undefined) {
                    const flashed = new Set();
                    for (const task of next.tasks) {
                        if (task.status !== 'pending')
                            continue;
                        const prevTask = prev.tasks.find((t) => t.id === task.id);
                        if (prevTask !== undefined && prevTask.status === 'pending' && task.dependencies.some((d) => prev.tasks.find((t) => t.id === d)?.status !== 'completed' && next.tasks.find((t) => t.id === d)?.status === 'completed'))
                            flashed.add(task.id);
                    }
                    if (flashed.size > 0) {
                        setDepFlash(flashed);
                        timer.timeout(() => setDepFlash(new Set()), 1800);
                    }
                }
                prevRef.current = next;
                setSnapshot(next);
                if (streamStateRef.current === 'connected')
                    setConnection('connected');
            }
            catch {
                streamStateRef.current = 'reconnecting';
                setConnection('reconnecting');
            }
        };
        const scheduleReconnect = () => {
            cancelRetry();
            const delay = Math.min(5000, 500 * 2 ** retryAttempt);
            retryAttempt = Math.min(retryAttempt + 1, 4);
            cancelRetry = timer.timeout(() => {
                void (async () => {
                    await refresh(false);
                    if (!alive)
                        return;
                    off = bridge.subscribe(onFrame, onStreamState);
                })();
            }, delay);
        };
        const onStreamState = (state) => {
            if (!alive)
                return;
            streamStateRef.current = state;
            setConnection(state);
            if (state === 'reconnecting') {
                off();
                scheduleReconnect();
            }
            else
                retryAttempt = 0;
        };
        const onFrame = (frame) => {
            if (!alive)
                return;
            const ui = rawEventToUiEvent(frame, Date.now());
            if (ui === undefined || ui.teamId !== teamId)
                return;
            setActivity((buffer) => pushBuffer(buffer, [ui], 300));
            if (!reduced && (ui.kind === 'message' || ui.kind === 'finding' || ui.kind === 'plan-approved' || ui.kind === 'plan-rejected') && (ui.kind !== 'message' || !isFailedMessageFrame(frame))) {
                setAnimations((a) => [...a.filter((x) => x.until > Date.now()), { id: ui.id, kind: ui.kind, fromSessionId: ui.sessionId, targetSessionId: ui.targetSessionId, label: ui.kind === 'message' ? (ui.preview ?? 'message') : ui.title ?? '', until: Date.now() + 2000 }]);
            }
            void refresh(true);
        };
        void (async () => { await refresh(false); if (alive)
            off = bridge.subscribe(onFrame, onStreamState); })();
        const id = timer.interval(() => void refresh(true), 2000);
        const prune = timer.interval(() => setAnimations((a) => a.filter((x) => x.until > Date.now())), 400);
        return () => { alive = false; off(); cancelRetry(); id(); prune(); };
    }, [teamId, reduced]);
    React.useEffect(() => {
        let alive = true;
        let off = () => { };
        if (inspector === null) {
            setSession(undefined);
            return () => { alive = false; };
        }
        let sessions;
        try {
            sessions = ctx.get('sessions');
        }
        catch {
            sessions = undefined;
        }
        const hydrate = async () => {
            // A child can be durable in the host while its catalog address has not
            // been pulled into this browser scope yet. Refresh the lead's official
            // catalog before resolving the child; no native trajectory viewer is
            // opened, and the resulting snapshot still passes through our typed
            // public-event projection below.
            // A retained binding is only a scope handle. It does not mean that the
            // child history window is staged/open. Always resolve the catalog address
            // and call the official openSubagent() path before reading the snapshot;
            // otherwise a real child can remain in its cold empty projection forever.
            const address = await resolvePublicSubagentAddress(sessions, leadSessionId, inspector);
            if (!alive)
                return;
            if (address !== undefined)
                await openPublicSubagent(sessions, address);
            const binding = sessionBindingFor(sessions, inspector);
            if (!alive || binding === undefined) {
                setSession(undefined);
                return;
            }
            const update = () => setSession(projectVisibleSession(binding.session.getSnapshot()));
            update();
            off = binding.session.subscribe(update);
        };
        void hydrate();
        return () => { alive = false; off(); };
    }, [ctx, inspector, leadSessionId]);
    if (snapshot === null) {
        return React.createElement('div', { className: 'agc-surface' }, React.createElement('div', { className: 'agc-main' }, [0, 1, 2, 3].map((i) => React.createElement('div', { key: i, className: 'agc-skeleton', style: { width: `${80 - i * 15}%` } }))));
    }
    const counts = statusCounts(snapshot.members);
    const submittedPlans = snapshot.plans.filter((p) => p.status === 'submitted');
    const blockers = snapshot.progress.blocked;
    const openFindings = snapshot.findings.filter((f) => f.state === 'open');
    const memberName = (sid) => snapshot.members.find((m) => m.sessionId === sid)?.name ?? sid.slice(0, 8);
    const openInspector = (sessionId) => {
        setInspector(sessionId);
        setObserve([]);
    };
    const onSelectActivity = (item) => {
        if (item.sessionId !== undefined && snapshot.members.some((m) => m.sessionId === item.sessionId))
            setInspector(item.sessionId);
    };
    return React.createElement('div', { className: 'agc-surface', role: 'region', 'aria-label': 'Agent Teams Command Center', onClick: (event) => event.stopPropagation() }, React.createElement('div', { className: 'agc-head' }, React.createElement('span', { className: 'agc-title' }, snapshot.teamName.toUpperCase()), React.createElement('span', { className: `agc-status ${snapshot.teamStatus === 'completed' ? 'st-completed' : snapshot.teamStatus === 'active' ? 'st-working' : 'st-idle'}` }, `${snapshot.teamStatus === 'active' ? '●' : snapshot.teamStatus === 'completed' ? '✓' : '○'} ${snapshot.teamStatus.toUpperCase()}`), React.createElement('div', { className: 'agc-progress' }, React.createElement('div', { className: 'agc-progressfill', style: { width: `${Math.round(snapshot.progress.ratio * 100)}%` } })), React.createElement('span', { style: { fontSize: 11, opacity: .8 } }, `${Math.round(snapshot.progress.ratio * 100)}% · ${snapshot.progress.requiredDone} / ${snapshot.progress.requiredTotal} tasks`), React.createElement('div', { className: 'agc-chips' }, Object.entries(counts).map(([status, count]) => React.createElement('button', { key: status, className: 'agc-chip', onClick: () => setInspector(snapshot.members.find((m) => m.status === status)?.sessionId ?? null) }, `${statusMeta(status).icon} ${count} ${status.toUpperCase()}`))), onBack !== undefined && React.createElement('button', { className: 'agc-btn', onClick: onBack }, 'All teams'), React.createElement('span', { className: `agc-connection ${connection === 'reconnecting' ? 'reconnecting' : ''}` }, connection === 'connected' ? '● LIVE' : '↻ RECONNECTING…'), React.createElement('button', { className: 'agc-btn', onClick: () => setTimeline((v) => !v) }, timeline ? 'Feed' : 'Timeline'), React.createElement('button', { className: 'agc-close', onClick: onClose, 'aria-label': 'Close Command Center' }, '✕')), submittedPlans.length > 0 && React.createElement('div', { className: 'agc-banner plan', style: { margin: '0 14px' } }, React.createElement('div', { className: 'agc-paneltitle' }, 'PLAN REQUIRES REVIEW'), submittedPlans.map((p) => {
        const author = snapshot.members.find((m) => m.sessionId === p.authorSessionId);
        const task = snapshot.tasks.find((t) => t.id === p.taskId);
        return React.createElement('div', { key: p.id, style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } }, React.createElement('span', { style: { fontSize: 12 } }, `${author?.name ?? 'member'} — ${task?.title ?? p.taskId}`), React.createElement('button', { className: 'agc-btn primary', onClick: () => void bridge.approvePlan(snapshot.teamId, p.id) }, 'Approve'), React.createElement('input', { className: 'agc-input', style: { flex: 1, minWidth: 160 }, placeholder: 'Reject with feedback… (Enter)', onKeyDown: (event) => { if (event.key === 'Enter' && event.target.value.trim() !== '')
                void bridge.rejectPlan(snapshot.teamId, p.id, event.target.value.trim()); } }));
    })), blockers.length > 0 && React.createElement('div', { className: 'agc-banner block', style: { margin: '0 14px' } }, React.createElement('span', { className: 'agc-status st-blocked' }, `⚠ ${blockers.length} BLOCKER${blockers.length > 1 ? 'S' : ''}`), blockers.map((taskId) => { const t = snapshot.tasks.find((x) => x.id === taskId); return React.createElement('div', { key: taskId, style: { fontSize: 12, marginTop: 4 } }, `${t?.title ?? taskId} — owner ${memberName(t?.ownerSessionId ?? '')}`); })), openFindings.length > 0 && React.createElement('div', { className: 'agc-banner block', style: { margin: '0 14px' } }, React.createElement('span', { className: 'agc-status st-blocked' }, '⚠ REVIEW FINDINGS'), openFindings.map((f) => React.createElement('div', { key: f.id, style: { fontSize: 12, marginTop: 3 } }, `${f.severity.toUpperCase()}: ${f.summary}`))), snapshot.teamStatus === 'completed' && React.createElement('div', { className: 'agc-banner done', style: { margin: '0 14px' } }, React.createElement('span', { className: 'agc-status st-completed' }, `✓ TEAM COMPLETED — ${snapshot.progress.requiredDone} / ${snapshot.progress.requiredTotal} tasks`)), React.createElement('div', { className: 'agc-body' }, React.createElement('div', { className: 'agc-main' }, observe.length > 0
        ? React.createElement('div', { className: 'agc-observe' }, observe.map((sessionId) => {
            const m = snapshot.members.find((x) => x.sessionId === sessionId);
            const items = activity.filter((a) => a.sessionId === sessionId).slice(0, 6);
            return React.createElement('div', { className: 'agc-observecol', key: sessionId }, React.createElement('div', { className: 'agc-name' }, `${roleAvatar(m?.role ?? '')} ${m?.name ?? sessionId.slice(0, 8)}`), items.map((a) => React.createElement('div', { key: a.id, className: 'agc-feeditem' }, a.title)));
        }), React.createElement('button', { className: 'agc-btn', style: { alignSelf: 'flex-start' }, onClick: () => setObserve([]) }, 'Exit observe mode'))
        : React.createElement(React.Fragment, null, React.createElement(AgentGraph, { snapshot, animations, onOpen: openInspector, reduced }), React.createElement(TaskGraphPanel, { snapshot, depFlash }))), React.createElement('div', { className: 'agc-side' }, React.createElement('div', { className: 'agc-panel' }, React.createElement('div', { className: 'agc-paneltitle' }, 'OBSERVE MODE (up to 3)'), React.createElement('div', { className: 'agc-chips' }, snapshot.members.slice(0, 5).map((m) => React.createElement('button', { key: m.id, className: 'agc-chip', onClick: () => setObserve(observe.includes(m.sessionId) ? observe.filter((s) => s !== m.sessionId) : [...observe, m.sessionId].slice(0, 3)) }, `${observe.includes(m.sessionId) ? '◉' : '○'} ${m.name}`)))), React.createElement(ActivityFeed, { activity, filter, onFilter: setFilter, onSelect: onSelectActivity, timeline }))), inspector !== null && React.createElement(Inspector, { snapshot, sessionId: inspector, bridge, onClose: () => setInspector(null), activity, session }));
}
const inject = ['slots'];
function apply(ctx) {
    if (typeof React === 'undefined') {
        console.warn('[agent-teams] React runtime unavailable; Command Center disabled');
        return;
    }
    const styleService = typeof styles !== 'undefined' ? styles : undefined;
    const disposers = [];
    disposers.push(styleService?.insert(CSS) ?? installStaticCss());
    let csrfToken = '';
    const readResponse = async (res) => {
        const csrf = res.headers.get('X-Agent-Teams-CSRF');
        if (csrf !== null)
            csrfToken = csrf;
        const body = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new Error(String(body?.error ?? `Agent Teams request failed (${res.status})`));
        return body;
    };
    const bridge = {
        async listTeams() {
            const body = await readResponse(await fetch('/agent-teams/teams', { credentials: 'same-origin' }));
            if (Array.isArray(body))
                return body;
            const teams = body !== null && typeof body === 'object' ? body.teams : undefined;
            if (Array.isArray(teams))
                return teams;
            throw new Error('Agent Teams list response was not an array');
        },
        async snapshot(teamId) {
            return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/snapshot`, { credentials: 'same-origin' }));
        },
        subscribe(cb, state) {
            let source = null;
            try {
                source = new EventSource('/agent-teams/stream');
                source.onopen = () => state?.('connected');
                source.onmessage = (message) => {
                    try {
                        cb(JSON.parse(message.data));
                    }
                    catch {
                        /* ignore malformed frames */
                    }
                };
                source.onerror = () => { state?.('reconnecting'); source?.close(); };
            }
            catch {
                state?.('reconnecting');
            }
            return () => {
                source?.close();
            };
        },
        async sendMessage(teamId, toSessionId, body) {
            return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/message`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ toSessionId, body }) }));
        },
        async approvePlan(teamId, planId) {
            return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/plan/${encodeURIComponent(planId)}/approve`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Agent-Teams-CSRF': csrfToken } }));
        },
        async rejectPlan(teamId, planId, feedback) {
            return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/plan/${encodeURIComponent(planId)}/reject`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ feedback }) }));
        },
        async interrupt(teamId, sessionId) {
            return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/interrupt`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ sessionId }) }));
        },
        async removeMember(teamId, memberId) {
            return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/member/remove`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ memberId }) }));
        },
    };
    const slots = (ctx.slots ?? ctx.get('slots'));
    if (slots === undefined) {
        for (const d of disposers)
            d();
        return;
    }
    function OverlayEntry() {
        const [open, setOpen] = React.useState(false);
        const [teams, setTeams] = React.useState([]);
        const [selectedTeamId, setSelectedTeamId] = React.useState(() => {
            if (typeof window === 'undefined')
                return null;
            return teamIdFromHash(window.location.hash);
        });
        const selectTeam = (teamId) => {
            setSelectedTeamId(teamId);
            if (typeof window !== 'undefined') {
                const suffix = teamId === null ? `${window.location.pathname}${window.location.search}` : `${window.location.pathname}${window.location.search}#agent-team=${encodeURIComponent(teamId)}`;
                window.history.replaceState(null, '', suffix);
            }
        };
        React.useEffect(() => {
            if (typeof window === 'undefined')
                return;
            const syncFromLocation = () => setSelectedTeamId(teamIdFromHash(window.location.hash));
            window.addEventListener('hashchange', syncFromLocation);
            window.addEventListener('popstate', syncFromLocation);
            return () => {
                window.removeEventListener('hashchange', syncFromLocation);
                window.removeEventListener('popstate', syncFromLocation);
            };
        }, []);
        React.useEffect(() => {
            let alive = true;
            const refresh = async () => {
                try {
                    const list = await bridge.listTeams();
                    if (alive && Array.isArray(list))
                        setTeams(list);
                }
                catch {
                    /* keep last */
                }
            };
            void refresh();
            const id = timerOf(ctx).interval(() => void refresh(), 5000);
            return () => {
                alive = false;
                id();
            };
        }, []);
        const selectedExists = selectedTeamId !== null && Array.isArray(teams) && teams.some((team) => team.id === selectedTeamId);
        return React.createElement(React.Fragment, null, React.createElement('button', { className: 'agc-btn', onClick: () => setOpen((v) => !v) }, open ? 'Close Teams' : 'Teams'), open && selectedTeamId !== null && selectedExists && React.createElement(CommandCenter, { bridge, ctx, teamId: selectedTeamId, onBack: () => selectTeam(null), onClose: () => setOpen(false) }), open && selectedTeamId !== null && !selectedExists && React.createElement('div', { className: 'agc-drawer', role: 'dialog' }, React.createElement('div', { className: 'agc-drawerhead' }, React.createElement('span', { className: 'agc-title' }, 'Agent Teams'), React.createElement('button', { className: 'agc-close', onClick: () => setOpen(false) }, '✕')), React.createElement('div', { className: 'agc-drawerbody' }, teams.length === 0 ? React.createElement('div', { className: 'agc-empty' }, 'Loading teams…') : React.createElement(React.Fragment, null, React.createElement('div', { className: 'agc-banner block' }, `Team not found: ${selectedTeamId}`), React.createElement('button', { className: 'agc-btn', onClick: () => selectTeam(null) }, 'Back to team list')))), open && selectedTeamId === null && React.createElement('div', { className: 'agc-drawer', role: 'dialog', 'aria-label': 'Agent Teams' }, React.createElement('div', { className: 'agc-drawerhead' }, React.createElement('span', { className: 'agc-title' }, 'Agent Teams'), React.createElement('button', { className: 'agc-close', onClick: () => setOpen(false) }, '✕')), React.createElement('div', { className: 'agc-teamlist' }, teams.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No teams yet. Ask the Lead agent to create one.'), teams.map((team) => React.createElement('button', { key: team.id, className: 'agc-teamrow', onClick: () => selectTeam(team.id) }, React.createElement('span', { className: 'agc-avatar' }, '🧩'), React.createElement('span', { style: { flex: 1 } }, React.createElement('div', { className: 'agc-name' }, team.name ?? team.id), React.createElement('div', { className: 'agc-role' }, `${team.status ?? 'active'} · ${team.goal ?? team.id}`)), React.createElement('span', null, '→'))))));
    }
    ctx.effect(() => {
        return slots.register({ name: 'sidebar.footer.action', id: 'agent-teams-toggle', label: 'Agent Teams' }, () => React.createElement(OverlayEntry));
    }, 'agent-teams: sidebar action');
    ctx.effect(() => () => {
        for (const dispose of [...disposers].reverse())
            dispose();
    });
}

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
