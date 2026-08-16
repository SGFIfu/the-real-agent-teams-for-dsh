import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from './store.ts';
import type { AgentTeam, TeamMember, TeamTask, TeamWorkspace } from './types.ts';
import { ReviewDomain, ReviewDomainError, type QaEvidenceInput } from './review.ts';
import { TeamError } from './errors.ts';

const LEAD = 'review-lead';
const ARCHITECT = 'review-architect';
const BACKEND = 'review-backend';
const REVIEWER = 'review-reviewer';
const OUTSIDER = 'review-outsider';

function evidence(reviewer = REVIEWER, outcome: QaEvidenceInput['outcome'] = 'passed'): QaEvidenceInput {
  return {
    id: `evidence-${Math.random().toString(36).slice(2)}`,
    kind: 'test',
    outcome,
    summary: 'focused review test completed',
    source: 'npm test -- review',
    recordedBySessionId: BACKEND,
    verifiedBySessionId: reviewer,
    verifiedAt: Date.now(),
  };
}

async function fixture() {
  const store = new MemoryStore();
  const now = Date.now();
  const team: AgentTeam = {
    id: 'team-review' as AgentTeam['id'],
    name: 'review team',
    goal: 'validate review gates',
    leadSessionId: LEAD,
    workspaceId: 'workspace-review',
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const members: TeamMember[] = [
    { id: 'member-architect' as TeamMember['id'], teamId: team.id, sessionId: ARCHITECT, name: 'Architect', role: 'architect', status: 'idle', joinedAt: now, lastActiveAt: now },
    { id: 'member-backend' as TeamMember['id'], teamId: team.id, sessionId: BACKEND, name: 'Backend', role: 'backend', status: 'idle', joinedAt: now, lastActiveAt: now },
    { id: 'member-reviewer' as TeamMember['id'], teamId: team.id, sessionId: REVIEWER, name: 'Reviewer', role: 'reviewer', status: 'idle', joinedAt: now, lastActiveAt: now },
  ];
  const task: TeamTask = {
    id: 'task-review' as TeamTask['id'],
    teamId: team.id,
    title: 'integration',
    description: 'integration task',
    status: 'completed',
    priority: 'normal',
    dependencies: [],
    requiresPlan: false,
    required: true,
    createdAt: now,
    completedAt: now,
  };
  const workspace: TeamWorkspace = {
    id: 'workspace-review' as TeamWorkspace['id'],
    teamId: team.id,
    taskId: task.id,
    repositoryRoot: 'C:/repo',
    branch: 'feature/review',
    worktreePath: 'C:/repo-worktree',
    status: 'clean',
    leaseId: 'lease-review',
    createdAt: now,
    updatedAt: now,
    lastHeartbeatAt: now,
  };
  await store.put('teams', team.id, team);
  for (const member of members) await store.put('members', member.id, member);
  await store.put('tasks', task.id, task);
  await store.put('workspaces', workspace.id, workspace);
  return { store, domain: new ReviewDomain({ store, clock: () => now + 1 }), team, task, workspace, reviewer: members[2] };
}

async function makeRequest() {
  const value = await fixture();
  const request = await value.domain.createRequest({
    teamId: value.team.id,
    taskId: value.task.id,
    workspaceId: value.workspace.id,
    requestedBy: LEAD,
    reviewerMemberId: value.reviewer.id,
    baseRef: 'main',
    headRef: 'feature/review',
  });
  return { ...value, request };
}

describe('review domain', () => {
  it('enforces independent reviewer lifecycle and supports fix/re-review', async () => {
    const value = await makeRequest();
    assert.equal(value.request.status, 'requested');
    const finding = await value.domain.createFinding({
      teamId: value.team.id,
      taskId: value.task.id,
      workspaceId: value.workspace.id,
      authorSessionId: REVIEWER,
      responsibleMemberId: 'member-backend',
      severity: 'high',
      title: 'missing edge case',
      description: 'partial update behavior is undocumented',
      evidence: 'reproduced with an empty patch body',
    });
    const inReview = await value.domain.startReview(value.request.id, REVIEWER);
    assert.equal(inReview.status, 'in_review');
    const changes = await value.domain.submitResult({
      requestId: value.request.id,
      reviewerSessionId: REVIEWER,
      verdict: 'changes_requested',
      evidence: [evidence()],
      findingIds: [finding.id],
    });
    assert.equal(changes.request.status, 'changes_requested');
    await value.domain.resolveFinding(finding.id, BACKEND, 'added partial-field validation and a regression test');
    const reReview = await value.domain.startReview(value.request.id, REVIEWER);
    assert.equal(reReview.status, 'in_review');
    const approved = await value.domain.submitResult({
      requestId: value.request.id,
      reviewerSessionId: REVIEWER,
      verdict: 'approved',
      evidence: [evidence()],
      findingIds: [finding.id],
    });
    assert.equal(approved.request.status, 'approved');
    assert.equal((await value.store.list('review_results')).length, 2);
    assert.equal((await value.domain.evaluateCompletionGate({ teamId: value.team.id, taskId: value.task.id, workspaceId: value.workspace.id, actorSessionId: LEAD })).approved, true);
  });

  it('rejects illegal and repeated state transitions', async () => {
    const value = await makeRequest();
    await assert.rejects(() => value.domain.submitResult({ requestId: value.request.id, reviewerSessionId: REVIEWER, verdict: 'approved', evidence: [evidence()] }), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'REVIEW_STATE_INVALID');
      return true;
    });
    await value.domain.startReview(value.request.id, REVIEWER);
    await assert.rejects(() => value.domain.startReview(value.request.id, REVIEWER), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'REVIEW_STATE_INVALID');
      return true;
    });
    await value.domain.submitResult({ requestId: value.request.id, reviewerSessionId: REVIEWER, verdict: 'approved', evidence: [evidence()] });
    await assert.rejects(() => value.domain.startReview(value.request.id, REVIEWER), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'REVIEW_STATE_INVALID');
      return true;
    });
  });

  it('requires same-team actors and separates author from reviewer', async () => {
    const value = await fixture();
    await assert.rejects(() => value.domain.createRequest({ teamId: value.team.id, taskId: value.task.id, workspaceId: value.workspace.id, requestedBy: REVIEWER, reviewerMemberId: value.reviewer.id, baseRef: 'main', headRef: 'feature' }), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'REVIEW_ACTOR_INVALID');
      return true;
    });
    await assert.rejects(() => value.domain.createRequest({ teamId: value.team.id, taskId: value.task.id, workspaceId: value.workspace.id, requestedBy: OUTSIDER, reviewerMemberId: value.reviewer.id, baseRef: 'main', headRef: 'feature' }), (error: unknown) => {
      assert.equal((error as TeamError).code, 'UNAUTHORIZED_TEAM_ACCESS');
      return true;
    });
    await assert.rejects(() => value.domain.startReview('missing-review', REVIEWER), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'REVIEW_NOT_FOUND');
      return true;
    });
  });

  it('cannot approve an unresolved medium/high finding or omit its linkage', async () => {
    const value = await makeRequest();
    const finding = await value.domain.createFinding({
      teamId: value.team.id,
      taskId: value.task.id,
      workspaceId: value.workspace.id,
      authorSessionId: REVIEWER,
      responsibleMemberId: 'member-backend',
      severity: 'medium',
      title: 'type contract drift',
      description: 'shared type is duplicated in two modules',
      evidence: 'observed in the diff',
    });
    await value.domain.startReview(value.request.id, REVIEWER);
    await assert.rejects(() => value.domain.submitResult({ requestId: value.request.id, reviewerSessionId: REVIEWER, verdict: 'approved', evidence: [evidence()], findingIds: [finding.id] }), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'REVIEW_NOT_APPROVABLE');
      return true;
    });
    await assert.rejects(() => value.domain.submitResult({ requestId: value.request.id, reviewerSessionId: REVIEWER, verdict: 'approved', evidence: [evidence()] }), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'REVIEW_NOT_APPROVABLE');
      return true;
    });
  });

  it('validates structured QA evidence and resolution authority', async () => {
    const value = await makeRequest();
    await value.domain.startReview(value.request.id, REVIEWER);
    await assert.rejects(() => value.domain.submitResult({ requestId: value.request.id, reviewerSessionId: REVIEWER, verdict: 'approved', evidence: [] }), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'QA_EVIDENCE_MISSING');
      return true;
    });
    await assert.rejects(() => value.domain.submitResult({ requestId: value.request.id, reviewerSessionId: REVIEWER, verdict: 'approved', evidence: [evidence(BACKEND)] }), (error: unknown) => {
      assert.equal((error as ReviewDomainError).code, 'QA_EVIDENCE_INVALID');
      return true;
    });
    const finding = await value.domain.createFinding({
      teamId: value.team.id,
      taskId: value.task.id,
      workspaceId: value.workspace.id,
      authorSessionId: REVIEWER,
      responsibleMemberId: 'member-backend',
      severity: 'low',
      title: 'naming polish',
      description: 'one identifier could be clearer',
      evidence: 'observed in the diff',
    });
    await assert.rejects(() => value.domain.resolveFinding(finding.id, ARCHITECT, 'changed naming'), (error: unknown) => {
      assert.equal((error as TeamError).code, 'UNAUTHORIZED_TEAM_ACCESS');
      return true;
    });
  });
});

