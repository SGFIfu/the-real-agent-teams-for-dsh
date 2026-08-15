/**
 * The Command Center HTTP surface for one Agent Teams service: read-only
 * endpoints (team list, snapshots), the SSE event stream, and the human
 * controls (send message, approve/reject plan, interrupt, remove member,
 * pause/resume). Shared by the static bundle and the dynamic session plugin;
 * only the interrupt primitive is injected.
 * @module dsh-agent-teams/harness
 */
import type { ServerResponse } from 'node:http';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { AgentTeamsService } from '../core/service.ts';
export interface CommandRouteDeps {
    /** Interrupt one member session; caller supplies the lead handle. */
    interrupt(team: {
        leadSessionId: string;
    }, sessionId: string): void;
}
export declare function commandRoute(service: AgentTeamsService, deps: CommandRouteDeps | undefined, sseClients: Set<ServerResponse>): WebRoute;
