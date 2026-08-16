import { TeamError, teamError } from "../core/errors.js";
import { resolveAgentSpec } from "./provider-resolution.js";
function textBlock(text) {
    return [{ type: 'text', text }];
}
/** The exact live direct parent agent for followup authority. */
function liveAgent(ctx, sessionId) {
    const agents = ctx.get('agents');
    return agents?.get(sessionId);
}
export class HarnessRuntimeAdapter {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    resolveAgentSpec(input) {
        const subagents = this.requireSubagents();
        return resolveAgentSpec(input, {
            availableProviders: subagents.list(),
            defaultProvider: this.deps.defaultProvider,
            defaultModel: this.deps.defaultModel,
        });
    }
    requireSubagents() {
        if (this.deps.subagents === undefined) {
            throw teamError('SUBAGENT_UNAVAILABLE', 'the harness subagent runtime is not mounted');
        }
        return this.deps.subagents;
    }
    async startContinuable(spec) {
        const subagents = this.requireSubagents();
        // The spawn tool passes a lead HANDLE ({__teamLeadSessionId}); resolve it
        // to the live parent Agent — the native runtime reads real Agent fields
        // (e.g. its request header) and cannot accept the handle itself.
        const handle = spec.parent;
        const leadId = handle?.__teamLeadSessionId;
        const lead = leadId === undefined ? undefined : liveAgent(this.deps.ctx, leadId);
        if (lead === undefined)
            throw teamError('SUBAGENT_UNAVAILABLE', `lead agent ${leadId} is not live`);
        const resolved = this.resolveAgentSpec({ model: spec.model, modelProvider: spec.modelProvider, provider: spec.provider });
        try {
            const start = await subagents.startContinuable({
                provider: resolved.resolvedProvider,
                label: spec.label,
                request: {
                    prompt: textBlock(spec.promptText),
                    parent: lead,
                    ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
                    ...(spec.toolFilter !== undefined ? { toolFilter: spec.toolFilter } : {}),
                    ...(spec.persona !== undefined ? { persona: spec.persona } : {}),
                    ...(resolved.resolvedModel !== undefined || resolved.resolvedModelProvider !== undefined ? { agentOptions: { ...(resolved.resolvedModelProvider === undefined ? {} : { provider: resolved.resolvedModelProvider }), ...(resolved.resolvedModel === undefined ? {} : { model: resolved.resolvedModel }) } } : {}),
                },
                signal: spec.signal ?? new AbortController().signal,
            });
            return { childId: start.childId, messageId: start.messageId };
        }
        catch (error) {
            if (error instanceof TeamError)
                throw error;
            const message = error instanceof Error ? error.message : String(error);
            if (/capab/i.test(message)) {
                throw teamError('SUBAGENT_CAPABILITY_UNSUPPORTED', 'provider does not support a requested capability: ' + message, { provider: resolved.resolvedProvider });
            }
            throw teamError('SUBAGENT_UNAVAILABLE', 'failed to start continuable teammate: ' + message, {
                requestedModel: spec.model,
                resolvedModel: resolved.resolvedModel,
                requestedProvider: spec.provider,
                resolvedProvider: resolved.resolvedProvider,
                availableProviders: resolved.availableProviders,
            });
        }
    }
    async followup(parent, childId, text, senderSessionId) {
        const subagents = this.requireSubagents();
        const handle = parent;
        const sessionId = handle?.__teamLeadSessionId;
        if (sessionId === undefined)
            throw teamError('SUBAGENT_UNAVAILABLE', 'lead agent handle missing');
        const lead = liveAgent(this.deps.ctx, sessionId);
        if (lead === undefined)
            throw teamError('SUBAGENT_UNAVAILABLE', `lead agent ${sessionId} is not live`);
        try {
            await subagents.followup(lead, childId, textBlock(text), {
                source: { kind: 'coordinator', form: 'relay', senderSessionId: (senderSessionId ?? sessionId) },
                signal: new AbortController().signal,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw teamError('SUBAGENT_UNAVAILABLE', `followup delivery failed: ${message}`, { childId });
        }
    }
    async reportFrom(child, text) {
        const subagents = this.requireSubagents();
        const handle = child;
        const sessionId = handle?.__teamMemberSessionId;
        if (sessionId === undefined)
            throw teamError('SUBAGENT_UNAVAILABLE', 'member agent handle missing');
        const agent = liveAgent(this.deps.ctx, sessionId);
        if (agent === undefined)
            throw teamError('SUBAGENT_UNAVAILABLE', `member agent ${sessionId} is not live`);
        try {
            await subagents.reportFrom(agent, textBlock(text), {
                delivery: 'quiet',
                signal: new AbortController().signal,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw teamError('SUBAGENT_UNAVAILABLE', `report delivery failed: ${message}`, { sessionId });
        }
    }
    async wakeWorker(parent, childId, text, senderSessionId) {
        await this.followup(parent, childId, text, senderSessionId);
    }
    interrupt(targetSessionId, ancestor) {
        const subagents = this.requireSubagents();
        const handle = ancestor;
        const sessionId = handle?.__teamLeadSessionId;
        const lead = sessionId === undefined ? undefined : liveAgent(this.deps.ctx, sessionId);
        if (lead !== undefined) {
            subagents.interrupt(targetSessionId, { kind: 'ancestor', agent: lead });
        }
    }
    async listChildrenOf(parentSessionId) {
        const subagents = this.requireSubagents();
        try {
            const children = await subagents.listChildren(parentSessionId);
            return children.map((child) => ({ sessionId: child.id, label: child.kind === 'child' ? child.label : undefined }));
        }
        catch {
            return [];
        }
    }
}
/** Member handle helper: wraps a member session id for reportFrom. */
export function memberHandle(sessionId) {
    return { __teamMemberSessionId: sessionId };
}
/** Lead handle helper: wraps the lead session id for followup/interrupt. */
export function leadHandle(sessionId) {
    return { __teamLeadSessionId: sessionId };
}
