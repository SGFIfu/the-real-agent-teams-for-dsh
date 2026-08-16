/**
 * The Command Center HTTP surface for one Agent Teams service: read-only
 * endpoints (team list, snapshots), the SSE event stream, and the human
 * controls (send message, approve/reject plan, interrupt, remove member,
 * pause/resume). Shared by the static bundle and the dynamic session plugin;
 * only the interrupt primitive is injected.
 * @module dsh-agent-teams/harness
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { AgentTeamsService } from '../core/service.ts';
export type CommandMutation = 'message' | 'plan-approve' | 'plan-reject' | 'interrupt' | 'member-remove' | 'pause' | 'resume' | 'complete';
/**
 * Host-provided caller identity. The route never accepts this identity from a
 * request body or URL. `teamIds`, when supplied, is an allowlist owned by the
 * host caller-auth implementation.
 */
export interface CommandCaller {
    principalId: string;
    teamIds?: readonly string[];
}
export interface CommandCallerContext {
    /** The server-minted browser capability id, not a Harness session id. */
    browserSessionId: string;
    teamId: string;
    mutation: CommandMutation;
}
export interface CommandRouteDeps {
    /** Interrupt one member session; caller supplies the lead handle. */
    interrupt(team: {
        leadSessionId: string;
    }, sessionId: string): void;
    /**
     * Optional Harness caller authorization hook. The current host WebServer
     * exposes no principal service, so the route keeps a loopback browser
     * capability fallback until the Lead wires this hook to an authenticated
     * host caller context.
     */
    authorizeCaller?(req: IncomingMessage, context: CommandCallerContext): CommandCaller | undefined | Promise<CommandCaller | undefined>;
}
export declare function commandRoute(service: AgentTeamsService, deps: CommandRouteDeps | undefined, sseClients: Set<ServerResponse>): WebRoute;
