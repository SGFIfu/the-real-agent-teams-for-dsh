import { teamError } from "./errors.js";
import { newId } from "./ids.js";
/** Typed errors local to the bounded review domain. */
export class ReviewDomainError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'ReviewDomainError';
        this.code = code;
        this.details = details;
    }
}
function reviewError(code, message, details) {
    return new ReviewDomainError(code, message, details);
}
function json(value) {
    return JSON.stringify(value);
}
function nonEmpty(value, field) {
    if (value.trim().length === 0)
        throw reviewError('QA_EVIDENCE_INVALID', `${field} must not be empty`, { field });
    return value.trim();
}
function findingEnvelope(finding) {
    if (finding.evidence === undefined) {
        throw reviewError('REVIEW_FINDING_INVALID', `finding ${finding.id} has no structured workspace evidence`, { findingId: finding.id });
    }
    try {
        const parsed = JSON.parse(finding.evidence);
        if (parsed.schemaVersion !== 1 || typeof parsed.workspaceId !== 'string' || typeof parsed.observation !== 'string') {
            throw new Error('invalid envelope');
        }
        return parsed;
    }
    catch {
        throw reviewError('REVIEW_FINDING_INVALID', `finding ${finding.id} has invalid structured workspace evidence`, { findingId: finding.id });
    }
}
function normalizeQaEvidence(input, reviewerSessionId) {
    if (input.length === 0)
        throw reviewError('QA_EVIDENCE_MISSING', 'a review result requires at least one QA evidence record');
    const ids = new Set();
    return input.map((raw) => {
        if (ids.has(raw.id))
            throw reviewError('QA_EVIDENCE_INVALID', `duplicate QA evidence id ${raw.id}`, { evidenceId: raw.id });
        ids.add(nonEmpty(raw.id, 'evidence id'));
        if (!['test', 'manual', 'tool', 'artifact', 'runtime'].includes(raw.kind)) {
            throw reviewError('QA_EVIDENCE_INVALID', `unsupported QA evidence kind ${raw.kind}`, { kind: raw.kind });
        }
        if (!['passed', 'failed', 'observed'].includes(raw.outcome)) {
            throw reviewError('QA_EVIDENCE_INVALID', `unsupported QA evidence outcome ${raw.outcome}`, { outcome: raw.outcome });
        }
        nonEmpty(raw.summary, 'evidence summary');
        nonEmpty(raw.source, 'evidence source');
        nonEmpty(raw.recordedBySessionId, 'recordedBySessionId');
        nonEmpty(raw.verifiedBySessionId, 'verifiedBySessionId');
        if (!Number.isFinite(raw.verifiedAt) || raw.verifiedAt <= 0) {
            throw reviewError('QA_EVIDENCE_INVALID', 'verifiedAt must be a positive timestamp', { evidenceId: raw.id });
        }
        if (reviewerSessionId !== undefined && raw.verifiedBySessionId !== reviewerSessionId) {
            throw reviewError('QA_EVIDENCE_INVALID', 'evidence must be verified by the assigned reviewer', {
                evidenceId: raw.id,
                reviewerSessionId,
                verifiedBySessionId: raw.verifiedBySessionId,
            });
        }
        return { ...raw, schemaVersion: 1 };
    });
}
/** Parse durable ReviewResult evidence and enforce its structured shape. */
export function parseQaEvidence(encoded) {
    if (encoded.length === 0)
        throw reviewError('QA_EVIDENCE_MISSING', 'review result contains no QA evidence');
    return normalizeQaEvidence(encoded.map((value) => {
        try {
            const parsed = JSON.parse(value);
            if (parsed.schemaVersion !== 1)
                throw new Error('unsupported evidence version');
            return parsed;
        }
        catch {
            throw reviewError('QA_EVIDENCE_INVALID', 'review result contains non-structured QA evidence');
        }
    }));
}
export function isQaEvidenceComplete(encoded) {
    try {
        parseQaEvidence(encoded);
        return true;
    }
    catch {
        return false;
    }
}
export class ReviewDomain {
    store;
    clock;
    idFactory;
    constructor(deps) {
        this.store = deps.store;
        this.clock = deps.clock ?? (() => Date.now());
        this.idFactory = deps.idFactory ?? newId;
    }
    nextTimestamp(...previous) {
        return Math.max(this.clock(), ...previous.map((value) => value + 1));
    }
    async requireTeam(teamId) {
        const team = await this.store.get('teams', teamId);
        if (team === undefined)
            throw teamError('TEAM_NOT_FOUND', `team ${teamId} not found`, { teamId });
        return team;
    }
    async requireTask(taskId, teamId) {
        const task = await this.store.get('tasks', taskId);
        if (task === undefined || task.teamId !== teamId) {
            throw teamError('TASK_NOT_FOUND', `task ${taskId} is not in team ${teamId}`, { taskId, teamId });
        }
        return task;
    }
    async requireWorkspace(workspaceId, teamId) {
        const workspace = await this.store.get('workspaces', workspaceId);
        if (workspace === undefined || workspace.teamId !== teamId) {
            throw reviewError('REVIEW_CONTEXT_INVALID', `workspace ${workspaceId} is not in team ${teamId}`, { workspaceId, teamId });
        }
        return workspace;
    }
    async requireMember(memberId, teamId) {
        const member = await this.store.get('members', memberId);
        if (member === undefined || member.teamId !== teamId) {
            throw teamError('MEMBER_NOT_FOUND', `member ${memberId} is not in team ${teamId}`, { memberId, teamId });
        }
        return member;
    }
    async authorizeActor(teamId, sessionId) {
        const team = await this.requireTeam(teamId);
        if (team.leadSessionId === sessionId)
            return { team };
        const members = await this.store.list('members', (member) => member.teamId === teamId && member.sessionId === sessionId);
        if (members.length === 0) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', `session ${sessionId} is not in team ${teamId}`, { teamId, sessionId });
        }
        return { team, member: members[0] };
    }
    async requireRequest(requestId) {
        const request = await this.store.get('review_requests', requestId);
        if (request === undefined)
            throw reviewError('REVIEW_NOT_FOUND', `review request ${requestId} not found`, { requestId });
        return request;
    }
    async assertAssignedReviewer(request, sessionId) {
        const reviewer = await this.requireMember(request.reviewerMemberId, request.teamId);
        if (reviewer.sessionId !== sessionId) {
            throw reviewError('REVIEW_ACTOR_INVALID', 'only the assigned independent reviewer may perform this review action', {
                requestId: request.id,
                reviewerMemberId: request.reviewerMemberId,
                sessionId,
            });
        }
        return reviewer;
    }
    async createRequest(input) {
        const { team } = await this.authorizeActor(input.teamId, input.requestedBy);
        await this.requireTask(input.taskId, team.id);
        await this.requireWorkspace(input.workspaceId, team.id);
        const reviewer = await this.requireMember(input.reviewerMemberId, team.id);
        if (reviewer.sessionId === input.requestedBy) {
            throw reviewError('REVIEW_ACTOR_INVALID', 'review author and reviewer must be different team sessions', {
                requestedBy: input.requestedBy,
                reviewerMemberId: input.reviewerMemberId,
            });
        }
        const existing = await this.store.list('review_requests', (request) => request.teamId === team.id &&
            request.taskId === input.taskId &&
            request.workspaceId === input.workspaceId &&
            ['requested', 'in_review', 'changes_requested'].includes(request.status));
        if (existing.length > 0) {
            throw reviewError('REVIEW_STATE_INVALID', 'an active review request already exists for this task workspace', {
                requestId: existing[0].id,
            });
        }
        const timestamp = this.clock();
        const request = {
            id: this.idFactory('review_request'),
            teamId: team.id,
            taskId: input.taskId,
            workspaceId: input.workspaceId,
            requestedBy: input.requestedBy,
            reviewerMemberId: reviewer.id,
            baseRef: nonEmpty(input.baseRef, 'baseRef'),
            headRef: nonEmpty(input.headRef, 'headRef'),
            status: 'requested',
            createdAt: timestamp,
            updatedAt: timestamp,
        };
        await this.store.put('review_requests', request.id, request);
        return request;
    }
    async startReview(requestId, reviewerSessionId) {
        const request = await this.requireRequest(requestId);
        await this.assertAssignedReviewer(request, reviewerSessionId);
        if (request.status !== 'requested' && request.status !== 'changes_requested') {
            throw reviewError('REVIEW_STATE_INVALID', `review request ${request.id} cannot start from ${request.status}`, {
                requestId: request.id,
                status: request.status,
            });
        }
        const result = await this.store.update('review_requests', request.id, (current) => {
            if (current.status !== 'requested' && current.status !== 'changes_requested') {
                throw reviewError('REVIEW_STATE_INVALID', `review request ${current.id} cannot start from ${current.status}`, {
                    requestId: current.id,
                    status: current.status,
                });
            }
            return { ...current, status: 'in_review', updatedAt: this.nextTimestamp(current.updatedAt) };
        });
        if (!result.found)
            throw reviewError('REVIEW_NOT_FOUND', `review request ${requestId} not found`, { requestId });
        return result.value;
    }
    async createFinding(input) {
        const { team } = await this.authorizeActor(input.teamId, input.authorSessionId);
        await this.requireTask(input.taskId, team.id);
        await this.requireWorkspace(input.workspaceId, team.id);
        const responsible = await this.requireMember(input.responsibleMemberId, team.id);
        if (responsible.sessionId === input.authorSessionId) {
            throw reviewError('REVIEW_ACTOR_INVALID', 'a finding author cannot be its own responsible fixer', {
                responsibleMemberId: input.responsibleMemberId,
            });
        }
        const observation = nonEmpty(input.evidence, 'finding evidence');
        const timestamp = this.clock();
        const finding = {
            id: this.idFactory('finding'),
            teamId: team.id,
            authorSessionId: input.authorSessionId,
            taskId: input.taskId,
            severity: input.severity,
            summary: nonEmpty(input.title, 'finding title'),
            detail: nonEmpty(input.description, 'finding description'),
            title: input.title,
            description: input.description,
            evidence: json({ schemaVersion: 1, workspaceId: input.workspaceId, observation }),
            responsibleMemberId: responsible.id,
            state: 'open',
            createdAt: timestamp,
        };
        await this.store.put('findings', finding.id, finding);
        return finding;
    }
    async resolveFinding(findingId, actorSessionId, resolutionEvidence) {
        const finding = await this.store.get('findings', findingId);
        if (finding === undefined)
            throw reviewError('REVIEW_FINDING_INVALID', `finding ${findingId} not found`, { findingId });
        const { team } = await this.authorizeActor(finding.teamId, actorSessionId);
        const responsibleId = finding.responsibleMemberId;
        if (responsibleId === undefined)
            throw reviewError('REVIEW_FINDING_INVALID', `finding ${findingId} has no responsible member`, { findingId });
        const responsible = await this.requireMember(responsibleId, team.id);
        if (team.leadSessionId !== actorSessionId && responsible.sessionId !== actorSessionId) {
            throw teamError('UNAUTHORIZED_TEAM_ACCESS', 'only the responsible member or lead may resolve a finding', { findingId, actorSessionId });
        }
        if (finding.state !== 'open') {
            throw reviewError('REVIEW_FINDING_INVALID', `finding ${findingId} is already ${finding.state}`, { findingId, state: finding.state });
        }
        const envelope = findingEnvelope(finding);
        const resolvedAt = this.nextTimestamp(finding.createdAt, finding.resolvedAt ?? 0);
        const updated = await this.store.update('findings', findingId, (current) => {
            if (current.state !== 'open') {
                throw reviewError('REVIEW_FINDING_INVALID', `finding ${findingId} is already ${current.state}`, { findingId, state: current.state });
            }
            return {
                ...current,
                state: 'resolved',
                resolvedAt,
                evidence: json({
                    ...envelope,
                    resolution: {
                        resolvedBySessionId: actorSessionId,
                        summary: nonEmpty(resolutionEvidence, 'resolution evidence'),
                        resolvedAt,
                    },
                }),
            };
        });
        if (!updated.found)
            throw reviewError('REVIEW_FINDING_INVALID', `finding ${findingId} not found`, { findingId });
        return updated.value;
    }
    async reviewFindings(request, findingIds) {
        const all = await this.store.list('findings', (finding) => finding.teamId === request.teamId && finding.taskId === request.taskId);
        const relevant = all.filter((finding) => findingEnvelope(finding).workspaceId === request.workspaceId);
        const selected = new Set(findingIds);
        const selectedFindings = [];
        for (const findingId of selected) {
            const finding = relevant.find((candidate) => candidate.id === findingId);
            if (finding === undefined) {
                throw reviewError('REVIEW_FINDING_INVALID', `finding ${findingId} is not linked to this review context`, {
                    findingId,
                    requestId: request.id,
                });
            }
            selectedFindings.push(finding);
        }
        return selectedFindings;
    }
    async submitResult(input) {
        const request = await this.requireRequest(input.requestId);
        const reviewer = await this.assertAssignedReviewer(request, input.reviewerSessionId);
        if (request.status !== 'in_review') {
            throw reviewError('REVIEW_STATE_INVALID', `review request ${request.id} cannot submit from ${request.status}`, {
                requestId: request.id,
                status: request.status,
            });
        }
        const evidence = normalizeQaEvidence(input.evidence, reviewer.sessionId);
        const findingIds = [...new Set(input.findingIds ?? [])];
        const selectedFindings = await this.reviewFindings(request, findingIds);
        const allRelevant = await this.store.list('findings', (finding) => finding.teamId === request.teamId &&
            finding.taskId === request.taskId &&
            findingEnvelope(finding).workspaceId === request.workspaceId);
        const blockingFindings = allRelevant.filter((finding) => (finding.severity === 'critical' || finding.severity === 'high' || finding.severity === 'medium') && finding.state !== 'resolved');
        if (input.verdict === 'approved') {
            if (evidence.some((item) => item.outcome === 'failed')) {
                throw reviewError('REVIEW_NOT_APPROVABLE', 'a review with failed QA evidence cannot be approved', { requestId: request.id });
            }
            if (blockingFindings.length > 0) {
                throw reviewError('REVIEW_NOT_APPROVABLE', 'medium/high/critical findings must be resolved before approval', {
                    requestId: request.id,
                    findingIds: blockingFindings.map((finding) => finding.id),
                });
            }
            const allFindingIds = new Set(allRelevant.map((finding) => finding.id));
            for (const findingId of allFindingIds) {
                if (!findingIds.includes(findingId)) {
                    throw reviewError('REVIEW_NOT_APPROVABLE', 'approved review must reference every linked finding', {
                        requestId: request.id,
                        missingFindingId: findingId,
                    });
                }
            }
        }
        if (input.verdict === 'changes_requested' && blockingFindings.length === 0 && evidence.every((item) => item.outcome !== 'failed')) {
            throw reviewError('REVIEW_NOT_APPROVABLE', 'changes_requested requires an unresolved finding or failed QA evidence', { requestId: request.id });
        }
        const previousResults = await this.store.list('review_results', (candidate) => candidate.requestId === request.id);
        const resultCreatedAt = this.nextTimestamp(...previousResults.map((candidate) => candidate.createdAt));
        const result = {
            id: this.idFactory('review_result'),
            requestId: request.id,
            reviewerMemberId: reviewer.id,
            verdict: input.verdict,
            evidence: evidence.map((item) => json(item)),
            findingIds,
            createdAt: resultCreatedAt,
        };
        await this.store.put('review_results', result.id, result);
        const updated = await this.store.update('review_requests', request.id, (current) => {
            if (current.status !== 'in_review') {
                throw reviewError('REVIEW_STATE_INVALID', `review request ${request.id} cannot submit from ${current.status}`, {
                    requestId: request.id,
                    status: current.status,
                });
            }
            return { ...current, status: input.verdict, updatedAt: this.nextTimestamp(current.updatedAt, resultCreatedAt) };
        });
        if (!updated.found)
            throw reviewError('REVIEW_NOT_FOUND', `review request ${request.id} not found`, { requestId: request.id });
        return { request: updated.value, result, findings: selectedFindings };
    }
    async evaluateCompletionGate(input) {
        await this.authorizeActor(input.teamId, input.actorSessionId);
        const requests = await this.store.list('review_requests', (request) => request.teamId === input.teamId && request.taskId === input.taskId && request.workspaceId === input.workspaceId);
        if (requests.length === 0) {
            return { approved: false, blockingFindingIds: [], reasons: ['no review request exists'] };
        }
        const request = [...requests].sort((a, b) => b.updatedAt - a.updatedAt)[0];
        const results = await this.store.list('review_results', (result) => result.requestId === request.id);
        const latest = [...results].sort((a, b) => b.createdAt - a.createdAt)[0];
        const findings = await this.store.list('findings', (finding) => finding.teamId === input.teamId && finding.taskId === input.taskId && findingEnvelope(finding).workspaceId === input.workspaceId);
        const blockingFindingIds = findings
            .filter((finding) => (finding.severity === 'critical' || finding.severity === 'high' || finding.severity === 'medium') && finding.state !== 'resolved')
            .map((finding) => finding.id);
        const reasons = [];
        if (request.status !== 'approved' || latest?.verdict !== 'approved')
            reasons.push(`review request is ${request.status}`);
        if (latest === undefined || !isQaEvidenceComplete(latest.evidence))
            reasons.push('approved review has no valid QA evidence');
        if (blockingFindingIds.length > 0)
            reasons.push(`blocking findings remain: ${blockingFindingIds.join(', ')}`);
        return { approved: reasons.length === 0, requestId: request.id, blockingFindingIds, reasons };
    }
}
