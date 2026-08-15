/**
 * Model-facing tools: validation + `ctx.agentTeams` delegation. All business
 * logic lives in the service; a tool never mutates team state directly.
 * Identity always comes from the executing agent — never from model input.
 * @module dsh-agent-teams/tools
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import type { AgentTeamsService } from '../core/service.ts';
import { memberHandle, leadHandle } from '../harness/runtime.ts';
export interface ToolsDeps {
    ctx: Context;
    service: AgentTeamsService;
    /** Optional registration override (dynamic sandboxes pass `harness.registerTool`). */
    registerTool?: (tool: ToolDefinition) => () => void;
    /**
     * Schema dialect: true → raw JSON-schema forms (static registry);
     * false/undefined → ParameterSchemaSpec + value-schema DSL (dynamic sandbox).
     */
    rawSchemas?: boolean;
}
export declare function registerTeamTools(deps: ToolsDeps): Array<() => void>;
export { memberHandle, leadHandle };
