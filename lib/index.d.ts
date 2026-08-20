/**
 * dsh-agent-teams — host plugin entry.
 *
 * Provides `ctx.agentTeams` (the Agent Teams coordination service), opens the
 * durable `agent_teams` storage domain, registers the model-facing team_*
 * tools, the lead/teammate protocol prompt section, the `/team` command, the
 * snapshot HTTP route for the web panel, and bridges native agent/subagent
 * lifecycle events into team state.
 *
 * This plugin is a COORDINATION LAYER: it spawns no LLM loops, owns no model
 * calls, and adds no shell/fs/network tools. Agents, sessions, storage, and
 * the subagent runtime all belong to the harness.
 * @module dsh-agent-teams
 */
import s from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import './harness/declare.ts';
export declare const name = "agent-teams";
export interface Config {
    defaultProvider: string;
    defaultModel?: string;
    maxActiveMembers: number;
    /** 'auto' opens the harness storage domain when mounted; 'memory' forces the in-memory store. */
    storageMode: 'auto' | 'memory';
}
export declare const Config: s<Config>;
export declare function apply(ctx: Context, config: Config): void;
declare const _default: {
    name: string;
    Config: s<Config>;
    apply: typeof apply;
};
export default _default;
