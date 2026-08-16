/**
 * Pure UI-logic tests for the Command Center adapter (no DOM, no React):
 * status metadata, layered DAG rows, snapshot diffing, the SSE frame mapper,
 * the bounded activity buffer, filtering and snapshot normalization.
 * @module dsh-agent-teams/client/logic
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { diffSnapshots, filterActivity, layeredGraph, normalizeSnapshot, pushBuffer, rawEventToUiEvent, resolveSelectedTeamId, roleAvatar, statusCounts, statusMeta, taskStatusMeta, teamIdFromHash, } from "./control.js";
test('team selection is explicit and has no first-team fallback', () => {
    assert.equal(resolveSelectedTeamId([{ id: 'team-a' }, { id: 'team-b' }], 'team-b'), 'team-b');
    assert.equal(resolveSelectedTeamId([{ id: 'team-a' }, { id: 'team-b' }], 'missing'), null);
    assert.equal(resolveSelectedTeamId([{ id: 'team-a' }, { id: 'team-b' }], null), null);
});
test('team hash routing updates when the browser hash changes', () => {
    assert.equal(teamIdFromHash('#agent-team=team-b'), 'team-b');
    assert.equal(teamIdFromHash('#agent-team=team%20b'), 'team b');
    assert.equal(teamIdFromHash('#agent-team='), null);
    assert.equal(teamIdFromHash('#agent-team=%E0%A4%A'), null);
    assert.equal(teamIdFromHash('#other=team-b'), null);
});
test('statusMeta never renders color-only state', () => {
    const working = statusMeta('working');
    assert.equal(working.icon, '●');
    assert.equal(working.label, 'WORKING');
    assert.ok(working.css.length > 0);
    const blocked = statusMeta('blocked');
    assert.equal(blocked.label, 'BLOCKED');
    const unknown = statusMeta('something-else');
    assert.equal(unknown.label, 'SOMETHING-ELSE');
    assert.equal(unknown.icon, '○');
});
test('taskStatusMeta covers every board status', () => {
    for (const status of ['pending', 'in_progress', 'blocked', 'completed', 'failed']) {
        const meta = taskStatusMeta(status);
        assert.ok(meta.icon.length > 0);
        assert.ok(meta.label.length > 0);
    }
});
test('roleAvatar maps team roles and falls back', () => {
    assert.equal(roleAvatar('lead'), '👑');
    assert.equal(roleAvatar('Backend'), '🖥');
    assert.equal(roleAvatar('mystery-role'), '🤖');
});
test('layeredGraph produces topological rows', () => {
    const tasks = [
        { id: 't1', title: 'A', status: 'pending', priority: 'normal', dependencies: [] },
        { id: 't2', title: 'B', status: 'pending', priority: 'normal', dependencies: ['t1'] },
        { id: 't3', title: 'C', status: 'pending', priority: 'normal', dependencies: ['t1', 't2'] },
    ];
    const rows = layeredGraph(tasks);
    assert.deepEqual(rows.map((r) => r.map((t) => t.id)), [['t1'], ['t2'], ['t3']]);
});
test('layeredGraph flushes cycles instead of looping', () => {
    const tasks = [
        { id: 'a', title: 'A', status: 'pending', priority: 'normal', dependencies: ['b'] },
        { id: 'b', title: 'B', status: 'pending', priority: 'normal', dependencies: ['a'] },
    ];
    const rows = layeredGraph(tasks);
    assert.equal(rows.reduce((n, r) => n + r.length, 0), 2);
});
function snapshot(overrides = {}) {
    return {
        teamId: 'team-1',
        teamName: 'Demo',
        teamStatus: 'active',
        members: [],
        tasks: [],
        plans: [],
        findings: [],
        messages: [],
        fileClaims: [],
        progress: { requiredTotal: 0, requiredDone: 0, ratio: 0, blocked: [], awaitingPlanApproval: [] },
        ...overrides,
    };
}
test('diffSnapshots seeds first observation without claiming events', () => {
    const next = snapshot({
        members: [{ id: 'm1', sessionId: 's1', name: 'Alice', role: 'lead', status: 'idle' }],
        tasks: [{ id: 't1', title: 'Write', status: 'completed', priority: 'normal', dependencies: [] }],
    });
    const events = diffSnapshots(undefined, next, 1000);
    assert.equal(events.length, 2);
    assert.ok(events.every((e) => e.ts === 1000));
});
test('diffSnapshots emits real status transitions only', () => {
    const before = snapshot({
        members: [{ id: 'm1', sessionId: 's1', name: 'Alice', role: 'lead', status: 'idle' }],
        tasks: [{ id: 't1', title: 'Write', status: 'pending', priority: 'normal', dependencies: [] }],
    });
    const after = snapshot({
        members: [{ id: 'm1', sessionId: 's1', name: 'Alice', role: 'lead', status: 'working' }],
        tasks: [{ id: 't1', title: 'Write', status: 'in_progress', priority: 'normal', dependencies: [], ownerSessionId: 's1' }],
    });
    const events = diffSnapshots(before, after, 2000);
    const kinds = events.map((e) => e.kind);
    assert.ok(kinds.includes('member-status'));
    assert.ok(kinds.includes('task-claimed'));
    // No message/plan/finding events invented.
    assert.ok(!kinds.some((k) => k === 'message' || k === 'finding'));
});
test('diffSnapshots detects new messages with previews', () => {
    const before = snapshot();
    const after = snapshot({
        messages: [{ id: 'msg1', fromSessionId: 's1', toSessionId: 's2', type: 'message', body: 'hello team', createdAt: 1 }],
    });
    const events = diffSnapshots(before, after, 3000);
    const message = events.find((e) => e.kind === 'message');
    assert.ok(message !== undefined);
    assert.equal(message.preview, 'hello team');
    assert.equal(message.targetSessionId, 's2');
});
test('rawEventToUiEvent maps every SSE family and rejects garbage', () => {
    assert.equal(rawEventToUiEvent(null, 0), undefined);
    assert.equal(rawEventToUiEvent({}, 0), undefined);
    assert.equal(rawEventToUiEvent({ type: 'other/x' }, 0), undefined);
    const msg = rawEventToUiEvent({ type: 'agent-teams/message-sent', message: { id: 'msg1', fromSessionId: 's1', toSessionId: 's2', body: 'ping' } }, 10);
    assert.equal(msg?.kind, 'message');
    assert.equal(msg?.id, 'msg-msg1');
    assert.equal(msg?.preview, 'ping');
    const claim = rawEventToUiEvent({ type: 'agent-teams/task-claimed', task: { id: 't1', title: 'X', status: 'in_progress', teamId: 'team-1' }, ownerSessionId: 's1' }, 11);
    assert.equal(claim?.kind, 'task-claimed');
    assert.equal(claim?.id, 't-t1-in_progress');
    assert.equal(claim?.sessionId, 's1');
    const blocked = rawEventToUiEvent({ type: 'agent-teams/task-blocked', task: { id: 't2', title: 'Integration', status: 'blocked', teamId: 'team-1', ownerSessionId: 's2' }, reason: 'waiting for Backend' }, 11.5);
    assert.equal(blocked?.kind, 'task-blocked');
    assert.equal(blocked?.sessionId, 's2');
    assert.equal(blocked?.preview, 'waiting for Backend');
    const joined = rawEventToUiEvent({ type: 'agent-teams/member-joined', member: { id: 'm1', sessionId: 's1', name: 'Ann', role: 'tester', teamId: 'team-1' } }, 12);
    assert.equal(joined?.id, 'm-m1-joined');
    const conflict = rawEventToUiEvent({ type: 'agent-teams/file-conflict', teamId: 'team-1', pattern: 'src/a.ts', attemptedBy: 's2', ownerSessionId: 's1', conflictingClaim: 'c1' }, 13);
    assert.equal(conflict?.kind, 'file-conflict');
    assert.equal(conflict?.id, 'fconflict-c1-s2');
    const finding = rawEventToUiEvent({ type: 'agent-teams/finding-added', finding: { id: 'f1', severity: 'critical', summary: 'broken', authorSessionId: 's3', taskId: 't1', teamId: 'team-1' } }, 14);
    assert.equal(finding?.kind, 'finding');
    assert.equal(finding?.severity, 'critical');
    const plan = rawEventToUiEvent({ type: 'agent-teams/plan-rejected', plan: { id: 'p1', taskId: 't1', authorSessionId: 's1', status: 'rejected', teamId: 'team-1' } }, 15);
    assert.equal(plan?.id, 'p-p1-rejected');
});
test('SSE ids and diff ids dedupe through pushBuffer', () => {
    const sse = rawEventToUiEvent({ type: 'agent-teams/task-completed', task: { id: 't1', title: 'X', status: 'completed', teamId: 'team-1', ownerSessionId: 's1' } }, 5000);
    assert.ok(sse !== undefined);
    const before = snapshot({ tasks: [{ id: 't1', title: 'X', status: 'in_progress', priority: 'normal', dependencies: [], ownerSessionId: 's1' }] });
    const after = snapshot({ tasks: [{ id: 't1', title: 'X', status: 'completed', priority: 'normal', dependencies: [], ownerSessionId: 's1' }] });
    const diffed = diffSnapshots(before, after, 5001).find((e) => e.kind === 'task-completed');
    assert.ok(diffed !== undefined);
    assert.equal(sse.id, diffed.id);
    const buffer = pushBuffer(pushBuffer([], [sse]), [diffed]);
    assert.equal(buffer.filter((b) => b.kind === 'task-completed').length, 1);
});
test('pushBuffer is bounded, sorted and deduplicated', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, kind: 'message', ts: i, teamId: 't', title: `m${i}` }));
    const buffer = pushBuffer([], events, 10);
    assert.equal(buffer.length, 10);
    assert.equal(buffer[0].id, 'e19');
    const again = pushBuffer(buffer, events.slice(0, 2), 10);
    assert.equal(again.length, 10);
});
test('filterActivity partitions by channel', () => {
    const activity = [
        { id: '1', kind: 'task-claimed', ts: 1, teamId: 't', title: 'x' },
        { id: '2', kind: 'message', ts: 2, teamId: 't', title: 'x' },
        { id: '3', kind: 'finding', ts: 3, teamId: 't', title: 'x' },
        { id: '4', kind: 'member-status', ts: 4, teamId: 't', title: 'x' },
    ];
    assert.equal(filterActivity(activity, 'ALL').length, 4);
    assert.deepEqual(filterActivity(activity, 'TASKS').map((a) => a.id), ['1']);
    assert.deepEqual(filterActivity(activity, 'MESSAGES').map((a) => a.id), ['2']);
    assert.deepEqual(filterActivity(activity, 'REVIEWS').map((a) => a.id), ['3']);
    assert.deepEqual(filterActivity(activity, 'AGENTS').map((a) => a.id), ['4']);
    assert.deepEqual(filterActivity(activity, 'FILES'), []);
});
test('statusCounts aggregates member states', () => {
    const counts = statusCounts([
        { id: '1', sessionId: 's1', name: 'a', role: 'lead', status: 'working' },
        { id: '2', sessionId: 's2', name: 'b', role: 'tester', status: 'working' },
        { id: '3', sessionId: 's3', name: 'c', role: 'reviewer', status: 'blocked' },
    ]);
    assert.deepEqual(counts, { working: 2, blocked: 1 });
});
test('normalizeSnapshot coerces the raw payload into the UI model', () => {
    const raw = {
        team: { id: 't', name: 'X', status: 'active' },
        members: [{ id: 'm1', sessionId: 's1', name: 'A', role: 'lead', status: 'idle' }],
        tasks: [{ id: 't1', title: 'W', status: 'pending', priority: 'high', ownerSessionId: undefined, dependencies: ['t0'], result: undefined }],
        plans: [],
        findings: [],
        messages: [],
        fileClaims: [{ id: 'c1', ownerSessionId: 's1', pattern: 'src/*.ts', kind: 'write' }],
        progress: { requiredTotal: 2, requiredDone: 1, ratio: 0.5, blocked: ['t0'], awaitingPlanApproval: [] },
    };
    const ui = normalizeSnapshot(raw);
    assert.equal(ui.teamId, 't');
    assert.equal(ui.members[0].name, 'A');
    assert.deepEqual(ui.tasks[0].dependencies, ['t0']);
    assert.equal(ui.fileClaims[0].pattern, 'src/*.ts');
    assert.equal(ui.progress.ratio, 0.5);
});
test('failed message delivery remains activity with an explicit failure event', () => {
    const failed = rawEventToUiEvent({
        type: 'agent-teams/message-sent',
        message: { id: 'bad', teamId: 'team-1', fromSessionId: 's1', toSessionId: 's2', body: 'ping', deliveryState: 'failed', deliveryError: 'session unavailable' },
    }, 20);
    assert.equal(failed?.kind, 'message');
    assert.equal(failed?.title, 'Message delivery failed');
    assert.match(failed?.preview ?? '', /delivery failed/);
    const explicitFailure = rawEventToUiEvent({
        type: 'agent-teams/message-delivery-failed',
        message: { id: 'bad', teamId: 'team-1', fromSessionId: 's1', toSessionId: 's2' },
        error: 'session unavailable',
    }, 21);
    assert.equal(explicitFailure?.title, 'Message delivery failed');
});
