import { TeamError } from "../core/errors.js";
import { memberHandle, leadHandle } from "../harness/runtime.js";
import { teammatePrompt } from "../core/prompts.js";
/**
 * RAW JSON-Schema forms — what the STATIC harness registry expects
 * (`ctx.tools.register` validates `parameters` and `output.schema` with
 * `assertSupportedJsonSchema`): root object wrappers with `required` arrays.
 */
const rawJsonSchema = (props, required = []) => ({
    type: 'object',
    properties: props,
    required,
    additionalProperties: false,
});
const rawOkSchema = () => ({
    oneOf: [
        {
            type: 'object',
            properties: { ok: { type: 'boolean', const: true }, value: {} },
            required: ['ok', 'value'],
            additionalProperties: false,
        },
        {
            type: 'object',
            properties: {
                ok: { type: 'boolean', const: false },
                error: {
                    type: 'object',
                    properties: {
                        code: { type: 'string' },
                        message: { type: 'string' },
                        details: { type: 'object', additionalProperties: true },
                    },
                    required: ['code', 'message'],
                    additionalProperties: false,
                },
            },
            required: ['ok', 'error'],
            additionalProperties: false,
        },
    ],
});
/**
 * ParameterSchemaSpec DSL + value-schema DSL — what the DYNAMIC sandbox
 * expects (`harness.defineTool`): implicit property map with per-property
 * `required: true`; oneOf branches carry no `required` arrays and object
 * nodes declare `additionalProperties` explicitly.
 */
const dslJsonSchema = (props, required = []) => {
    const out = {};
    for (const [key, schema] of Object.entries(props)) {
        out[key] = required.includes(key) ? { ...schema, required: true } : schema;
    }
    return out;
};
const dslOkSchema = () => ({
    oneOf: [
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ok: { type: 'boolean', const: true, required: true },
                value: { type: 'json', required: true },
            },
        },
        {
            type: 'object',
            additionalProperties: false,
            properties: {
                ok: { type: 'boolean', const: false, required: true },
                error: {
                    type: 'object',
                    additionalProperties: true,
                    required: true,
                    properties: {
                        code: { type: 'string', required: true },
                        message: { type: 'string', required: true },
                        details: { type: 'object', additionalProperties: true },
                    },
                },
            },
        },
    ],
});
const stringProp = (description) => ({ type: 'string', description });
const optionalStringProp = (description) => ({ type: 'string', description });
const arrayOfStrings = (description) => ({ type: 'array', items: { type: 'string' }, description });
function renderText(_args, value) {
    return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}
function resolveActor(ctx, exec) {
    const agent = exec.agent;
    if (agent !== undefined && typeof agent.id === 'string')
        return agent.id;
    const agents = ctx.get('agents');
    const initiator = agents?.requireInitiator();
    if (initiator !== undefined)
        return initiator.id;
    throw new TeamError('UNAUTHORIZED_TEAM_ACCESS', 'no executing agent identity available');
}
/** Wraps one service call with identity resolution and typed error mapping. */
function defineTool(deps, name, description, parameters, run) {
    return {
        name,
        description,
        parameters,
        output: { schema: (deps.rawSchemas === true ? rawOkSchema : dslOkSchema)(), render: renderText },
        async execute(args, exec) {
            const actor = resolveActor(deps.ctx, exec);
            try {
                const value = await run(args, actor, deps.service, exec);
                // Sanitize to lossless JSON (strips undefined fields like absent
                // toSessionId/result so the registry materialization never rejects).
                return JSON.parse(JSON.stringify({ ok: true, value: value === undefined ? { done: true } : value }));
            }
            catch (error) {
                if (error instanceof TeamError) {
                    return JSON.parse(JSON.stringify({ ok: false, error: { code: error.code, message: error.message, details: error.details ?? {} } }));
                }
                throw error;
            }
        },
    };
}
export function registerTeamTools(deps) {
    const ctx = deps.ctx;
    const tools = ctx.get('tools');
    if (tools === undefined && deps.registerTool === undefined)
        return [];
    const disposers = [];
    const register = (tool) => {
        if (deps.registerTool !== undefined) {
            disposers.push(deps.registerTool(tool));
        }
        else if (tools !== undefined) {
            disposers.push(tools.register(tool));
        }
    };
    const { service } = deps;
    /** Parameter dialect selection: raw JSON wrapper (static) vs DSL (dynamic). */
    const params = (props, required = []) => (deps.rawSchemas === true ? rawJsonSchema(props, required) : dslJsonSchema(props, required));
    /** Nested object schema in the selected dialect. */
    const nestedObject = (props, required = []) => deps.rawSchemas === true
        ? { type: 'object', properties: props, required, additionalProperties: false }
        : { type: 'object', additionalProperties: false, properties: dslJsonSchema(props, required) };
    // ── team ────────────────────────────────────────────────────────────────────
    register(defineTool(deps, 'team_create', 'Create a new agent team; the calling agent becomes its lead.', params({ name: stringProp('Team name'), goal: stringProp('Overall goal the team must achieve') }, ['name', 'goal']), (args, actor) => service.createTeam({ name: args.name, goal: args.goal, leadSessionId: actor, workspaceId: 'current' })));
    register(defineTool(deps, 'team_status', 'Read one team (id, goal, lead, status).', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.getTeamForActor(args.teamId, actor)));
    register(defineTool(deps, 'team_snapshot', 'Full team snapshot: members, tasks, dependency state, blocked tasks, file claims, recent messages, plans awaiting approval, review findings, progress. The primary team-status interface.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.getSnapshot(args.teamId, actor)));
    register(defineTool(deps, 'team_pause', 'Pause the team (no new claims); lead only.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.pauseTeam(args.teamId, actor)));
    register(defineTool(deps, 'team_resume', 'Resume a paused team; lead only.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.resumeTeam(args.teamId, actor)));
    register(defineTool(deps, 'team_complete', 'Complete the team. Fails with TEAM_NOT_COMPLETABLE while required tasks are incomplete, critical tasks are blocked, required plans are unapproved, or critical/high review findings remain open. Lead only.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.completeTeam(args.teamId, actor)));
    // ── members ────────────────────────────────────────────────────────────────
    register(defineTool(deps, 'team_member_spawn', 'Spawn a durable continuable teammate on the native subagent runtime (lead only). The teammate receives the team protocol and keeps working across tasks until stopped.', params({
        teamId: stringProp('Team id'),
        role: stringProp('Role, e.g. backend, frontend, tester, reviewer, architect'),
        name: optionalStringProp('Display name (defaults to role)'),
        provider: optionalStringProp('Subagent provider (default: team default)'),
        taskId: optionalStringProp('Initial task id to assign (optional)'),
    }, ['teamId', 'role']), async (args, actor, s, exec) => {
        const team = await s.getTeam(args.teamId);
        const name = args.name ?? args.role;
        const runtime = s.runtime;
        if (runtime === undefined)
            throw new TeamError('SUBAGENT_UNAVAILABLE', 'subagent runtime not mounted in this process');
        const initialTask = args.taskId === undefined ? undefined : await s.getTask(args.taskId, actor);
        // Unique placeholder identity; the harness assigns the real session id
        // once the continuable child is established (concurrent spawns safe).
        const placeholderSessionId = `__pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const member = await s.registerMember({ teamId: args.teamId, sessionId: placeholderSessionId, name, role: args.role, provider: args.provider, actor });
        try {
            const spawn = await runtime.startContinuable({
                provider: args.provider ?? s.defaultProvider,
                label: name,
                promptText: teammatePrompt({ team, role: args.role, name, initialTask }),
                parent: leadHandle(team.leadSessionId),
                // The tool-call cancellation signal: the spawn observes it without
                // creating an AbortController global (works in confined sandboxes).
                signal: exec.signal,
            });
            // The harness owns the real session identity: rewrite the placeholder.
            await s.bindMemberSession(member.id, spawn.childId, actor);
            return { memberId: member.id, sessionId: spawn.childId, messageId: spawn.messageId };
        }
        catch (error) {
            await s.markMemberSpawnFailed(member.id, actor);
            throw error;
        }
    }));
    register(defineTool(deps, 'team_member_register', 'Register an existing harness session as a team member (no spawn).', params({
        teamId: stringProp('Team id'),
        sessionId: stringProp('Real harness session id of the member'),
        name: stringProp('Display name'),
        role: stringProp('Role'),
    }, ['teamId', 'sessionId', 'name', 'role']), (args, actor, s) => s.registerMember({ teamId: args.teamId, sessionId: args.sessionId, name: args.name, role: args.role, actor })));
    register(defineTool(deps, 'team_members', 'List team members with runtime status and current task.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.listMembers(args.teamId, actor)));
    register(defineTool(deps, 'team_member_remove', 'Remove a team member (lead or the member itself); any in-flight task they own is released back to the board.', params({ memberId: stringProp('Member id') }, ['memberId']), async (args, actor, s) => {
        await s.removeMember(args.memberId, actor);
        return { removed: args.memberId };
    }));
    // ── tasks ───────────────────────────────────────────────────────────────────
    register(defineTool(deps, 'team_task_create', 'Create one task on the shared board.', params({
        teamId: stringProp('Team id'),
        title: stringProp('Short title'),
        description: stringProp('What done means'),
        priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'], description: 'Priority (default normal)' },
        dependencies: arrayOfStrings('Task ids that must complete first'),
        requiresPlan: { type: 'boolean', description: 'Task needs an approved plan before implementation' },
        required: { type: 'boolean', description: 'Counts toward team completion (default true)' },
    }, ['teamId', 'title', 'description']), (args, actor, s) => s.createTask({
        teamId: args.teamId,
        title: args.title,
        description: args.description,
        priority: args.priority,
        dependencies: args.dependencies,
        requiresPlan: args.requiresPlan,
        required: args.required,
        actor,
    })));
    register(defineTool(deps, 'team_task_create_many', 'Create many tasks in one call.', params({
        teamId: stringProp('Team id'),
        tasks: {
            type: 'array',
            items: nestedObject({
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['critical', 'high', 'normal', 'low'] },
                dependencies: { type: 'array', items: { type: 'string' } },
                requiresPlan: { type: 'boolean' },
                required: { type: 'boolean' },
            }, ['title', 'description']),
        },
    }, ['teamId', 'tasks']), (args, actor, s) => s.createTasks(args.tasks, actor, args.teamId)));
    register(defineTool(deps, 'team_task_list', 'List all tasks on the shared board.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.listTasks(args.teamId, actor)));
    register(defineTool(deps, 'team_task_get', 'Read one task.', params({ taskId: stringProp('Task id') }, ['taskId']), (args, actor, s) => s.getTask(args.taskId, actor)));
    register(defineTool(deps, 'team_task_claim', 'Atomically claim one task for the calling agent. Fails with TASK_ALREADY_CLAIMED or TASK_DEPENDENCIES_UNRESOLVED.', params({ taskId: stringProp('Task id') }, ['taskId']), (args, actor, s) => s.claimTask(args.taskId, actor)));
    register(defineTool(deps, 'team_task_claim_next', 'Self-scheduling: atomically claim the highest-priority unblocked task. Under concurrency exactly one agent wins each task.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.claimNextTask(args.teamId, actor)));
    register(defineTool(deps, 'team_task_complete', 'Complete the owned task and automatically self-claim the next available task for this persistent teammate. The result includes the next task or an idle reason. A requiresPlan task is rejected until its plan is approved by the Lead.', params({ taskId: stringProp('Task id'), result: optionalStringProp('Concise result summary') }, ['taskId']), (args, actor, s) => s.completeTaskAndSchedule(args.taskId, actor, args.result)));
    register(defineTool(deps, 'team_task_fail', 'Fail a task owned by the calling agent; record why.', params({ taskId: stringProp('Task id'), result: optionalStringProp('Failure reason') }, ['taskId']), (args, actor, s) => s.failTask(args.taskId, actor, args.result)));
    register(defineTool(deps, 'team_task_release', 'Release an owned (or lead-owned) task back to pending.', params({ taskId: stringProp('Task id'), reason: optionalStringProp('Why') }, ['taskId']), (args, actor, s) => s.releaseTask(args.taskId, actor, args.reason)));
    register(defineTool(deps, 'team_task_reassign', 'Lead reassigns a task to another member session.', params({ taskId: stringProp('Task id'), toSessionId: stringProp('Target member session id') }, ['taskId', 'toSessionId']), (args, actor, s) => s.reassignTask(args.taskId, actor, args.toSessionId)));
    register(defineTool(deps, 'team_task_block', 'Mark an owned in-progress task blocked with a reason.', params({ taskId: stringProp('Task id'), reason: optionalStringProp('Concrete blocker') }, ['taskId']), (args, actor, s) => s.setTaskBlocked(args.taskId, actor, args.reason)));
    register(defineTool(deps, 'team_task_add_dependency', 'Add a dependency edge. Fails with DEPENDENCY_CYCLE if it would create a cycle.', params({ teamId: stringProp('Team id'), taskId: stringProp('Task id'), dependencyId: stringProp('Task id it must wait for') }, ['teamId', 'taskId', 'dependencyId']), (args, actor, s) => s.addDependency(args.teamId, args.taskId, args.dependencyId, actor)));
    // ── messages ───────────────────────────────────────────────────────────────
    register(defineTool(deps, 'team_message_send', 'Send a message to one teammate or the lead. If the lead sends to a member, the native inbox delivers it.', params({
        teamId: stringProp('Team id'),
        toSessionId: optionalStringProp('Target member/lead session id; omit for broadcast'),
        type: { type: 'string', enum: ['message', 'question', 'result', 'warning', 'handoff', 'review', 'plan', 'shutdown'], description: 'Message type (default message)' },
        body: stringProp('Message body'),
    }, ['teamId', 'body']), (args, actor, s) => s.sendMessage({ teamId: args.teamId, fromSessionId: actor, toSessionId: args.toSessionId, type: args.type, body: args.body })));
    register(defineTool(deps, 'team_message_broadcast', 'Broadcast a message to the whole team.', params({ teamId: stringProp('Team id'), body: stringProp('Message body') }, ['teamId', 'body']), (args, actor, s) => s.broadcastMessage({ teamId: args.teamId, fromSessionId: actor, body: args.body })));
    register(defineTool(deps, 'team_messages', 'Read the calling agent\'s actual inbox (direct + broadcast messages), oldest first so a persistent teammate can drain it between tasks.', params({ teamId: stringProp('Team id'), limit: { type: 'integer', description: 'Max messages (default 50)' } }, ['teamId']), async (args, actor, s) => {
        const messages = await s.getInbox(args.teamId, actor);
        return messages.slice(-(args.limit ?? 50));
    }));
    // ── plans ───────────────────────────────────────────────────────────────────
    register(defineTool(deps, 'team_plan_submit', 'Submit an implementation plan for a requiresPlan task; the task blocks until decided.', params({ teamId: stringProp('Team id'), taskId: stringProp('Task id'), body: stringProp('Plan body (markdown)') }, ['teamId', 'taskId', 'body']), (args, actor, s) => s.submitPlan({ teamId: args.teamId, taskId: args.taskId, authorSessionId: actor, body: args.body })));
    register(defineTool(deps, 'team_plan_approve', 'Lead approves a submitted plan; the task becomes claimable.', params({ planId: stringProp('Plan id'), feedback: optionalStringProp('Optional feedback') }, ['planId']), (args, actor, s) => s.approvePlan(args.planId, actor, args.feedback)));
    register(defineTool(deps, 'team_plan_reject', 'Lead rejects a submitted plan with feedback.', params({ planId: stringProp('Plan id'), feedback: optionalStringProp('Why it was rejected') }, ['planId', 'feedback']), (args, actor, s) => s.rejectPlan(args.planId, actor, args.feedback)));
    register(defineTool(deps, 'team_plan_list', 'List plans for a team.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.listPlans(args.teamId, actor)));
    register(defineTool(deps, 'team_review_request', 'Request an independent teammate review for a task workspace.', params({ teamId: stringProp('Team id'), taskId: stringProp('Task id'), workspaceId: stringProp('Workspace id'), reviewerMemberId: stringProp('Independent reviewer member id'), baseRef: stringProp('Base Git ref'), headRef: stringProp('Head Git ref') }, ['teamId', 'taskId', 'workspaceId', 'reviewerMemberId', 'baseRef', 'headRef']), (args, actor, s) => s.createReviewRequest({ teamId: args.teamId, taskId: args.taskId, workspaceId: args.workspaceId, reviewerMemberId: args.reviewerMemberId, baseRef: args.baseRef, headRef: args.headRef }, actor)));
    register(defineTool(deps, 'team_review_start', 'Start a review as the assigned independent reviewer.', params({ requestId: stringProp('Review request id') }, ['requestId']), (args, actor, s) => s.startReview(args.requestId, actor)));
    register(defineTool(deps, 'team_review_finding', 'Record a structured review finding linked to one task workspace and responsible fixer.', params({ teamId: stringProp('Team id'), taskId: stringProp('Task id'), workspaceId: stringProp('Workspace id'), responsibleMemberId: stringProp('Responsible fixer member id'), severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, title: stringProp('Finding title'), description: stringProp('Finding description'), evidence: stringProp('Concrete diff/test evidence') }, ['teamId', 'taskId', 'workspaceId', 'responsibleMemberId', 'severity', 'title', 'description', 'evidence']), (args, actor, s) => s.createReviewFinding({ teamId: args.teamId, taskId: args.taskId, workspaceId: args.workspaceId, responsibleMemberId: args.responsibleMemberId, severity: args.severity, title: args.title, description: args.description, evidence: args.evidence }, actor)));
    register(defineTool(deps, 'team_review_resolve_finding', 'Resolve a finding after the responsible teammate fixes it and records evidence.', params({ findingId: stringProp('Finding id'), resolutionEvidence: stringProp('Test or diff evidence for the fix') }, ['findingId', 'resolutionEvidence']), (args, actor, s) => s.resolveReviewFinding(args.findingId, args.resolutionEvidence, actor)));
    register(defineTool(deps, 'team_review_submit', 'Submit the assigned reviewer verdict with structured QA evidence. Approval is rejected while medium/high/critical findings remain unresolved.', params({
        requestId: stringProp('Review request id'),
        verdict: { type: 'string', enum: ['approved', 'changes_requested', 'rejected'] },
        findingIds: arrayOfStrings('Finding ids reviewed'),
        evidence: {
            type: 'array',
            items: nestedObject({
                id: stringProp('Evidence id'),
                kind: { type: 'string', enum: ['test', 'manual', 'tool', 'artifact', 'runtime'] },
                outcome: { type: 'string', enum: ['passed', 'failed', 'observed'] },
                summary: stringProp('Evidence summary'),
                source: stringProp('Evidence source'),
                recordedBySessionId: stringProp('Session that recorded evidence'),
                verifiedBySessionId: stringProp('Assigned reviewer session'),
                verifiedAt: { type: 'number' },
            }, ['id', 'kind', 'outcome', 'summary', 'source', 'recordedBySessionId', 'verifiedBySessionId', 'verifiedAt']),
        },
    }, ['requestId', 'verdict', 'evidence']), (args, actor, s) => s.submitReviewResult({ requestId: args.requestId, verdict: args.verdict, findingIds: args.findingIds, evidence: args.evidence }, actor)));
    // ── file claims ────────────────────────────────────────────────────────────
    register(defineTool(deps, 'team_file_claim', 'Claim files/directories/globs for the calling agent. Fails with FILE_CLAIM_CONFLICT on overlap with another owner.', params({
        teamId: stringProp('Team id'),
        patterns: arrayOfStrings('Paths: src/a.ts (file), src/ (directory), src/server/** (glob)'),
        purpose: stringProp('Why the claim is needed'),
    }, ['teamId', 'patterns', 'purpose']), (args, actor, s) => s.claimFiles({ teamId: args.teamId, ownerSessionId: actor, patterns: args.patterns, purpose: args.purpose })));
    register(defineTool(deps, 'team_file_release', 'Release one or more of your file claims (lead may release any).', params({ claimIds: arrayOfStrings('Claim ids') }, ['claimIds']), (args, actor, s) => s.releaseFiles(args.claimIds, actor)));
    register(defineTool(deps, 'team_file_claims', 'List all file claims in the team.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.listFileClaims(args.teamId, actor)));
    // ── review findings ────────────────────────────────────────────────────────
    register(defineTool(deps, 'team_finding_add', 'Record a review finding (reviewer protocol).', params({
        teamId: stringProp('Team id'),
        severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
        summary: stringProp('One-line summary'),
        detail: stringProp('Detailed finding'),
        taskId: optionalStringProp('Related task id'),
        evidence: optionalStringProp('Concrete file/test evidence'),
        responsibleSessionId: optionalStringProp('Session responsible for the fix; defaults to related task owner'),
    }, ['teamId', 'severity', 'summary', 'detail']), (args, actor, s) => s.addFinding({ teamId: args.teamId, authorSessionId: actor, taskId: args.taskId, severity: args.severity, summary: args.summary, detail: args.detail, evidence: args.evidence, responsibleSessionId: args.responsibleSessionId })));
    register(defineTool(deps, 'team_finding_resolve', 'Mark a review finding resolved (owner or lead).', params({ findingId: stringProp('Finding id') }, ['findingId']), (args, actor, s) => s.resolveFinding(args.findingId, actor)));
    register(defineTool(deps, 'team_finding_accept', 'Lead explicitly accepts a finding without resolving it.', params({ findingId: stringProp('Finding id') }, ['findingId']), (args, actor, s) => s.acceptFinding(args.findingId, actor)));
    register(defineTool(deps, 'team_findings', 'List review findings for a team.', params({ teamId: stringProp('Team id') }, ['teamId']), (args, actor, s) => s.listFindings(args.teamId, actor)));
    return disposers;
}
export { memberHandle, leadHandle };
