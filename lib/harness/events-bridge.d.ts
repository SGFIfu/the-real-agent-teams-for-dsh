/**
 * Harness event bridge: maps native `agent/status` / `subagent/end` lifecycle
 * into team member semantic state (orchestration metadata; the native state
 * remains the runtime truth). Also forwards typed `agent-teams/*` events
 * through Cordis `ctx.emit`.
 * @module dsh-agent-teams/harness
 */
import type { Context } from '@deepseek-ai/cordis';
import type { TeamEventSink } from '../core/types.ts';
export declare class CordisEventSink implements TeamEventSink {
    private readonly ctx;
    constructor(ctx: Context);
    emit(name: string, payload: unknown): void;
}
export interface BridgeDeps {
    ctx: Context;
    service: {
        memberBySession(teamId: string, sessionId: string): Promise<{
            id: string;
            teamId: string;
        } | undefined>;
        updateMemberFromRuntime(memberId: string, patch: {
            status?: 'starting' | 'working' | 'idle' | 'blocked' | 'reviewing' | 'stopped' | 'failed';
        }): Promise<unknown>;
        listTeams(): Promise<Array<{
            id: string;
            leadSessionId: string;
        }>>;
    };
}
/**
 * Register native lifecycle listeners; returns disposers owned by the plugin
 * fiber. Status mapping: native `running` ⇄ `working` (when a task is held),
 * `idle` ⇄ `idle`; a settled subagent ⇄ `stopped`.
 */
export declare function bridgeNativeEvents(deps: BridgeDeps): Array<() => void>;
export declare function knownEventNames(): readonly string[];
