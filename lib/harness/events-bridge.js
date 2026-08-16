import { ALL_EVENTS } from "../core/events.js";
export class CordisEventSink {
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
    }
    emit(name, payload) {
        try {
            this.ctx.emit(name, payload);
        }
        catch {
            // Observer errors never break coordination.
        }
    }
}
/**
 * Register native lifecycle listeners; returns disposers owned by the plugin
 * fiber. Status mapping: native `running` ⇄ `working` (when a task is held),
 * `idle` ⇄ `idle`; a settled subagent ⇄ `stopped`.
 */
export function bridgeNativeEvents(deps) {
    const disposers = [];
    const memberOf = async (sessionId) => {
        let found;
        for (const team of await deps.service.listTeams()) {
            if (team.leadSessionId === sessionId)
                continue;
            const member = await deps.service.memberBySession(team.id, sessionId);
            if (member !== undefined) {
                if (found !== undefined && found.teamId !== member.teamId)
                    return undefined;
                found = member;
            }
        }
        return found;
    };
    disposers.push(deps.ctx.on('agent/status', (payload) => {
        void (async () => {
            const sessionId = payload.agent.id;
            const member = await memberOf(sessionId);
            if (member === undefined)
                return;
            const patch = payload.status === 'running' ? { status: 'working' } : { status: 'idle' };
            await deps.service.updateMemberFromRuntime(member.id, patch);
            await deps.service.retryPendingMessages(member.teamId, sessionId);
        })().catch(() => undefined);
    }));
    disposers.push(deps.ctx.on('subagent/end', (info) => {
        void (async () => {
            const sessionId = info.id;
            const member = await memberOf(sessionId);
            if (member === undefined)
                return;
            // `subagent/end` closes one run/activation epoch, not a continuable
            // teammate session. The continuation manager owns child disposal;
            // normal completion returns the teammate to idle and the service
            // preserves working/blocked when it still owns a task.
            const status = info.stopReason === 'error' || info.stopReason === 'aborted' ? 'failed' : 'idle';
            await deps.service.updateMemberFromRuntime(member.id, { status });
            if (status === 'idle')
                await deps.service.retryPendingMessages(member.teamId, sessionId);
        })().catch(() => undefined);
    }));
    return disposers;
}
export function knownEventNames() {
    return ALL_EVENTS;
}
