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
        for (const team of await deps.service.listTeams()) {
            if (team.leadSessionId === sessionId)
                continue;
            const member = await deps.service.memberBySession(team.id, sessionId);
            if (member !== undefined)
                return member;
        }
        return undefined;
    };
    disposers.push(deps.ctx.on('agent/status', (payload) => {
        void (async () => {
            const sessionId = payload.agent.id;
            const member = await memberOf(sessionId);
            if (member === undefined)
                return;
            const patch = payload.status === 'running' ? { status: 'working' } : { status: 'idle' };
            await deps.service.updateMemberFromRuntime(member.id, patch);
        })();
    }));
    disposers.push(deps.ctx.on('subagent/end', (info) => {
        void (async () => {
            const sessionId = info.id;
            const member = await memberOf(sessionId);
            if (member === undefined)
                return;
            await deps.service.updateMemberFromRuntime(member.id, { status: 'stopped' });
        })();
    }));
    return disposers;
}
export function knownEventNames() {
    return ALL_EVENTS;
}
