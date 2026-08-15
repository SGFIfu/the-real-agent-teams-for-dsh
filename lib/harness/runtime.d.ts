/**
 * The harness runtime adapter: Agent Teams orchestration rides the NATIVE
 * subagent runtime (`ctx.subagents`) — continuable children, followup,
 * report, interrupt, and child listing. No second agent runtime exists.
 * @module dsh-agent-teams/harness
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { SpawnResult, SpawnSpec, TeamRuntimeAdapter } from '../core/types.ts';
export interface RuntimeDeps {
    ctx: Context;
    subagents?: SubagentRuntime;
    defaultProvider: string;
}
export declare class HarnessRuntimeAdapter implements TeamRuntimeAdapter {
    private readonly deps;
    constructor(deps: RuntimeDeps);
    private requireSubagents;
    startContinuable(spec: SpawnSpec): Promise<SpawnResult>;
    followup(parent: unknown, childId: string, text: string, senderSessionId?: string): Promise<void>;
    reportFrom(child: unknown, text: string): Promise<void>;
    interrupt(targetSessionId: string, ancestor: unknown): void;
    listChildrenOf(parentSessionId: string): Promise<Array<{
        sessionId: string;
        label?: string;
    }>>;
}
/** Member handle helper: wraps a member session id for reportFrom. */
export declare function memberHandle(sessionId: string): unknown;
/** Lead handle helper: wraps the lead session id for followup/interrupt. */
export declare function leadHandle(sessionId: string): unknown;
