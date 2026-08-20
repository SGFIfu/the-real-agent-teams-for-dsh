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
 * Host-provided caller identity for principal-based authentication.
 *
 * The route NEVER accepts this identity from a request body or URL parameter
 * (that would be trivially spoofable). Instead, the host's `authorizeCaller`
 * hook extracts and validates the principal identity from trusted request
 * context (e.g., validated JWT token, session cookie verified against a
 * principal service, mTLS client certificate).
 *
 * **Security properties**:
 * - `principalId`: REQUIRED non-empty string identifying the authenticated user
 * - `teamIds`: OPTIONAL allowlist of teams this principal can access
 *   - When undefined/absent: principal can access ANY team (admin-level access)
 *   - When defined: principal can ONLY access teams in this list
 *
 * **Example implementations**:
 * ```typescript
 * // JWT-based authentication with team claims
 * authorizeCaller: async (req) => {
 *   const token = extractJWT(req.headers.authorization);
 *   const claims = await verifyJWT(token);
 *   return {
 *     principalId: claims.sub,
 *     teamIds: claims.teams, // ['team_a', 'team_b']
 *   };
 * }
 *
 * // Session-based authentication with principal service lookup
 * authorizeCaller: async (req) => {
 *   const sessionId = req.headers.cookie;
 *   const principal = await principalService.getPrincipal(sessionId);
 *   const teams = await principalService.getTeamAccess(principal.id);
 *   return {
 *     principalId: principal.id,
 *     teamIds: teams.map(t => t.id),
 *   };
 * }
 * ```
 */
export interface CommandCaller {
    principalId: string;
    teamIds?: readonly string[];
}
/**
 * Context provided to the `authorizeCaller` hook for authorization decisions.
 *
 * This context allows the authorization hook to make informed access control
 * decisions based on:
 * - Which browser session is making the request (for session tracking)
 * - Which team is being targeted (for team-based access control)
 * - Which mutation is being attempted (for fine-grained permissions)
 */
export interface CommandCallerContext {
    /** The server-minted browser capability id, not a Harness session id. */
    browserSessionId: string;
    /** The team being targeted by this mutation request. */
    teamId: string;
    /** The specific mutation operation being attempted. */
    mutation: CommandMutation;
}
export interface CommandRouteDeps {
    /** Interrupt one member session; caller supplies the lead handle. */
    interrupt(team: {
        leadSessionId: string;
    }, sessionId: string): void;
    /**
     * **SECURITY CRITICAL**: Principal-based caller authorization hook.
     *
     * When provided, this hook MUST return a valid `CommandCaller` with a
     * non-empty `principalId` for every authenticated request. The route
     * will REJECT any request where this hook returns `undefined` or an
     * invalid caller.
     *
     * **Multi-user environments**: This hook is MANDATORY for production
     * deployments and shared development environments. Without it, the route
     * falls back to a browser capability model that provides NO multi-user
     * identity verification.
     *
     * **Single-user development**: The fallback browser capability is suitable
     * ONLY for single-user localhost development where the loopback restriction
     * provides sufficient isolation.
     *
     * **Implementation requirements**:
     * 1. Extract principal identity from trusted request context (JWT, session, mTLS)
     * 2. Validate the principal's authentication (verify token/session)
     * 3. Return undefined for unauthenticated requests
     * 4. Optionally provide `teamIds` allowlist for team-based access control
     * 5. Throw errors for transient failures (DB down, etc.) - route will convert to 401
     *
     * **Access control semantics**:
     * - `teamIds` undefined: Principal can access ANY team (admin/super-user)
     * - `teamIds` defined: Principal can ONLY access teams in the allowlist
     *
     * @param req - The incoming HTTP request with headers/cookies for identity extraction
     * @param context - The operation context (teamId, mutation, browserSessionId)
     * @returns CommandCaller with principalId and optional teamIds, or undefined if not authenticated
     * @throws Error for transient failures (will be converted to 401)
     */
    authorizeCaller?(req: IncomingMessage, context: CommandCallerContext): CommandCaller | undefined | Promise<CommandCaller | undefined>;
}
export declare function commandRoute(service: AgentTeamsService, deps: CommandRouteDeps | undefined, sseClients: Set<ServerResponse>): WebRoute;
