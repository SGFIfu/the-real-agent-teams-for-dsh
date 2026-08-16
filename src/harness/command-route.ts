/**
 * The Command Center HTTP surface for one Agent Teams service: read-only
 * endpoints (team list, snapshots), the SSE event stream, and the human
 * controls (send message, approve/reject plan, interrupt, remove member,
 * pause/resume). Shared by the static bundle and the dynamic session plugin;
 * only the interrupt primitive is injected.
 * @module dsh-agent-teams/harness
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import { teamError, TeamError } from '../core/errors.ts';
import type { AgentTeamsService } from '../core/service.ts';

export type CommandMutation =
  | 'message'
  | 'plan-approve'
  | 'plan-reject'
  | 'interrupt'
  | 'member-remove'
  | 'pause'
  | 'resume'
  | 'complete';

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
  interrupt(team: { leadSessionId: string }, sessionId: string): void;
  /**
   * Optional Harness caller authorization hook. The current host WebServer
   * exposes no principal service, so the route keeps a loopback browser
   * capability fallback until the Lead wires this hook to an authenticated
   * host caller context.
   */
  authorizeCaller?(
    req: IncomingMessage,
    context: CommandCallerContext,
  ): CommandCaller | undefined | Promise<CommandCaller | undefined>;
}

interface WebSession {
  csrf: string;
  expiresAt: number;
  /** Fallback capability is deliberately scoped to one Team. */
  boundTeamId?: string;
}

interface AuthenticatedWebSession {
  id: string;
  session: WebSession;
}

const SESSION_COOKIE = 'dsh_agent_teams_session';
const SESSION_TTL_MS = 60 * 60 * 1000;

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function cookie(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers.cookie ?? '';
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function issueSession(req: IncomingMessage, res: ServerResponse, sessions: Map<string, WebSession>): WebSession {
  const existingId = cookie(req, SESSION_COOKIE);
  const existing = existingId === undefined ? undefined : sessions.get(existingId);
  if (existing !== undefined && existing.expiresAt > Date.now()) {
    res.setHeader('X-Agent-Teams-CSRF', existing.csrf);
    return existing;
  }
  const id = randomBytes(24).toString('base64url');
  const session = { csrf: randomBytes(24).toString('base64url'), expiresAt: Date.now() + SESSION_TTL_MS };
  sessions.set(id, session);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/agent-teams; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; SameSite=Strict`,
  );
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Agent-Teams-CSRF', session.csrf);
  return session;
}

function validSession(req: IncomingMessage, sessions: Map<string, WebSession>): AuthenticatedWebSession | undefined {
  const id = cookie(req, SESSION_COOKIE);
  const session = id === undefined ? undefined : sessions.get(id);
  if (id === undefined || session === undefined) return undefined;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(id);
    return undefined;
  }
  return { id, session };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function loopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  if (address === '::1' || address === 'localhost') return true;
  if (address.startsWith('::ffff:')) return loopbackAddress(address.slice('::ffff:'.length));
  return isIP(address) === 4 && address.startsWith('127.');
}

function loopbackHost(hostHeader: string | undefined): boolean {
  if (hostHeader === undefined || hostHeader.length === 0) return false;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    if (parsed.username !== '' || parsed.password !== '') return false;
    const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  } catch {
    return false;
  }
}

function sameOriginLoopback(req: IncomingMessage): boolean {
  if (!loopbackAddress(req.socket.remoteAddress) || !loopbackAddress(req.socket.localAddress)) return false;
  const host = header(req, 'host');
  if (host !== undefined && !loopbackHost(host)) return false;

  const origin = header(req, 'origin');
  if (origin !== undefined) {
    try {
      const parsedOrigin = new URL(origin);
      const expectedHost = host === undefined ? undefined : new URL(`http://${host}`).host;
      if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') return false;
      if (!loopbackHost(parsedOrigin.host) || (expectedHost !== undefined && parsedOrigin.host !== expectedHost)) return false;
    } catch {
      return false;
    }
  }

  const fetchSite = header(req, 'sec-fetch-site');
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'same-site') return false;
  const referer = header(req, 'referer');
  if (origin === undefined && referer !== undefined) {
    try {
      const parsedReferer = new URL(referer);
      if (!loopbackHost(parsedReferer.host) || (host !== undefined && parsedReferer.host !== new URL(`http://${host}`).host)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function authenticatedMutation(req: IncomingMessage, sessions: Map<string, WebSession>): AuthenticatedWebSession {
  if (!sameOriginLoopback(req)) throw teamError('WEB_ORIGIN_FORBIDDEN', 'web caller must be a same-origin loopback request');
  const authenticated = validSession(req, sessions);
  if (authenticated === undefined) throw teamError('WEB_CALLER_UNAUTHORIZED', 'authenticated Harness browser session required');
  const provided = req.headers['x-agent-teams-csrf'];
  const csrf = Array.isArray(provided) ? provided[0] : provided;
  if (csrf === undefined) throw teamError('WEB_CALLER_UNAUTHORIZED', 'authenticated Harness browser session required');
  const providedBytes = Buffer.from(csrf);
  const expectedBytes = Buffer.from(authenticated.session.csrf);
  if (providedBytes.length !== expectedBytes.length || !timingSafeEqual(providedBytes, expectedBytes)) {
    throw teamError('WEB_CALLER_UNAUTHORIZED', 'authenticated Harness browser session required');
  }
  return authenticated;
}

function safeId(raw: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw teamError('UNSAFE_RESOURCE_ID', 'resource id is not safely encoded');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(decoded)) {
    throw teamError('UNSAFE_RESOURCE_ID', 'resource id is not safe for this route', { resourceId: raw });
  }
  return decoded;
}

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
      size += Buffer.byteLength(text, 'utf8');
      if (size > MAX_BODY_BYTES) {
        rejected = true;
        reject(teamError('INVALID_INPUT', 'request body exceeds the 64 KiB limit'));
        return;
      }
      data += text;
    });
    req.on('error', (error) => {
      if (!rejected) reject(teamError('INVALID_INPUT', `request body could not be read: ${String(error)}`));
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const parsed: unknown = JSON.parse(data || '{}');
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(teamError('INVALID_INPUT', 'request body must be a JSON object'));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        reject(teamError('INVALID_INPUT', 'request body must be valid JSON'));
      }
    });
  });
}

function bodyId(body: Record<string, unknown>, field: string, required = true): string | undefined {
  const value = body[field];
  if (value === undefined && !required) return undefined;
  if (typeof value !== 'string' || value.length === 0) throw teamError('INVALID_INPUT', `${field} must be a non-empty string`);
  return safeId(value);
}

function bodyText(body: Record<string, unknown>, field: string, maxLength: number, required = true): string {
  const value = body[field];
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw teamError('INVALID_INPUT', `${field} must be a string`);
  if (value.length > maxLength) throw teamError('INVALID_INPUT', `${field} exceeds the ${maxLength} character limit`);
  return value;
}

async function authorizeMutation(
  req: IncomingMessage,
  deps: CommandRouteDeps | undefined,
  authenticated: AuthenticatedWebSession,
  teamId: string,
  mutation: CommandMutation,
): Promise<void> {
  if (deps?.authorizeCaller !== undefined) {
    let caller: CommandCaller | undefined;
    try {
      caller = await deps.authorizeCaller(req, { browserSessionId: authenticated.id, teamId, mutation });
    } catch {
      throw teamError('WEB_CALLER_UNAUTHORIZED', 'Harness caller authorization failed');
    }
    if (caller === undefined || typeof caller.principalId !== 'string' || caller.principalId.length === 0) {
      throw teamError('WEB_CALLER_UNAUTHORIZED', 'Harness caller is not authenticated');
    }
    if (caller.teamIds !== undefined && !caller.teamIds.includes(teamId)) {
      throw teamError('WEB_CALLER_FORBIDDEN', 'caller is not authorized for this team', { teamId });
    }
    return;
  }

  // Compatibility fallback for the current host: the browser capability is
  // intentionally scoped to one Team. It prevents a session minted for Team
  // A from being replayed against Team B, but is not a multi-user identity.
  if (authenticated.session.boundTeamId === undefined) {
    authenticated.session.boundTeamId = teamId;
    return;
  }
  if (authenticated.session.boundTeamId !== teamId) {
    throw teamError('CROSS_TEAM_TARGET', 'browser caller is bound to a different team', {
      requestedTeamId: teamId,
      boundTeamId: authenticated.session.boundTeamId,
    });
  }
}

function errorStatus(error: unknown): number {
  if (!(error instanceof TeamError)) return 400;
  switch (error.code) {
    case 'WEB_CALLER_UNAUTHORIZED':
      return 401;
    case 'WEB_CALLER_FORBIDDEN':
    case 'WEB_ORIGIN_FORBIDDEN':
    case 'CROSS_TEAM_TARGET':
    case 'SESSION_NOT_IN_TEAM':
      return 403;
    default:
      return 400;
  }
}

export function commandRoute(service: AgentTeamsService, deps: CommandRouteDeps | undefined, sseClients: Set<ServerResponse>): WebRoute {
  const sessions = new Map<string, WebSession>();
  return {
    kind: 'prefix',
    path: '/agent-teams',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const pathname = new URL(req.url ?? '/', 'http://agent-teams.invalid').pathname;
      const segments = pathname.split('/').filter((p: string) => p.length > 0);
      const after = segments.slice(1);
      const method = req.method ?? 'GET';
      try {
        if (!sameOriginLoopback(req)) {
          return json(res, 403, { error: 'web caller must be a same-origin loopback request', code: 'WEB_ORIGIN_FORBIDDEN' });
        }
        const authenticated = method === 'POST' ? authenticatedMutation(req, sessions) : undefined;
        // ── read endpoints ──────────────────────────────────────────────────
        if (method === 'GET') {
          if (after.length === 0 || (after.length === 1 && after[0] === 'teams')) {
            issueSession(req, res, sessions);
            return json(res, 200, await service.listTeams());
          }
          if (after.length === 3 && after[0] === 'team' && after[2] === 'snapshot') {
            issueSession(req, res, sessions);
            return json(res, 200, await service.publicSnapshot(safeId(after[1])));
          }
          if (after.length === 1 && after[0] === 'stream') {
            // SSE: push every typed agent-teams event as `data: <json>\n\n`.
            if (!sameOriginLoopback(req) || validSession(req, sessions) === undefined) {
              return json(res, 401, { error: 'authenticated Harness browser session required' });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write(': agent-teams stream\n\n');
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
          }
          return json(res, 404, { error: 'not found' });
        }
        // ── human controls (POST) — actor is the team lead ─────────────────
        if (method === 'POST') {
          if (after.length === 3 && after[0] === 'team' && after[2] === 'message') {
            const teamId = safeId(after[1]);
            await authorizeMutation(req, deps, authenticated!, teamId, 'message');
            const body = await readBody(req);
            const team = await service.getTeam(teamId);
            const toSessionId = bodyId(body, 'toSessionId', false);
            const message = await service.sendMessage({
              teamId,
              fromSessionId: team.leadSessionId,
              toSessionId,
              body: bodyText(body, 'body', 32_768),
            });
            return json(res, 200, { ok: true, messageId: message.id, message });
          }
          if (after.length === 5 && after[0] === 'team' && after[2] === 'plan') {
            const teamId = safeId(after[1]);
            const planId = safeId(after[3]);
            const team = await service.getTeam(teamId);
            const plans = await service.listPlans(teamId, team.leadSessionId);
            if (!plans.some((plan) => plan.id === planId)) return json(res, 403, { error: 'plan does not belong to team' });
            if (after[4] === 'approve') {
              await authorizeMutation(req, deps, authenticated!, teamId, 'plan-approve');
              return json(res, 200, { ok: true, plan: await service.approvePlan(planId, team.leadSessionId) });
            }
            if (after[4] === 'reject') {
              await authorizeMutation(req, deps, authenticated!, teamId, 'plan-reject');
              const body = await readBody(req);
              return json(res, 200, { ok: true, plan: await service.rejectPlan(planId, team.leadSessionId, bodyText(body, 'feedback', 32_768, false)) });
            }
          }
          if (after.length === 3 && after[0] === 'team' && after[2] === 'interrupt') {
            const teamId = safeId(after[1]);
            await authorizeMutation(req, deps, authenticated!, teamId, 'interrupt');
            const body = await readBody(req);
            if (deps === undefined) return json(res, 503, { error: 'subagent runtime not mounted' });
            const team = await service.getTeam(teamId);
            const target = bodyId(body, 'sessionId') as string;
            if (target !== team.leadSessionId && (await service.memberBySession(teamId, target!)) === undefined) {
              return json(res, 403, { error: 'target session is not a member of team', code: 'SESSION_NOT_IN_TEAM' });
            }
            deps.interrupt(team, target);
            return json(res, 200, { ok: true });
          }
          if (after.length === 4 && after[0] === 'team' && after[2] === 'member' && after[3] === 'remove') {
            const teamId = safeId(after[1]);
            await authorizeMutation(req, deps, authenticated!, teamId, 'member-remove');
            const body = await readBody(req);
            const team = await service.getTeam(teamId);
            const member = await service.getMember(bodyId(body, 'memberId')!);
            if (member.teamId !== teamId) return json(res, 403, { error: 'member does not belong to team' });
            await service.removeMember(member.id, team.leadSessionId);
            return json(res, 200, { ok: true });
          }
          if (after.length === 3 && after[0] === 'team' && (after[2] === 'pause' || after[2] === 'resume')) {
            const teamId = safeId(after[1]);
            await authorizeMutation(req, deps, authenticated!, teamId, after[2]);
            const team = await service.getTeam(teamId);
            const result = after[2] === 'pause' ? await service.pauseTeam(teamId, team.leadSessionId) : await service.resumeTeam(teamId, team.leadSessionId);
            return json(res, 200, { ok: true, team: result });
          }
          if (after.length === 3 && after[0] === 'team' && after[2] === 'complete') {
            const teamId = safeId(after[1]);
            await authorizeMutation(req, deps, authenticated!, teamId, 'complete');
            const team = await service.getTeam(teamId);
            return json(res, 200, { ok: true, team: await service.completeTeam(teamId, team.leadSessionId) });
          }
          return json(res, 404, { error: 'not found' });
        }
        return json(res, 404, { error: 'not found' });
      } catch (error) {
        const teamError = error as { code?: string; message?: string };
        return json(res, errorStatus(error), {
          error: teamError.message ?? String(error),
          ...(teamError.code !== undefined ? { code: teamError.code } : {}),
          ...('details' in teamError && teamError.details !== undefined ? { details: teamError.details } : {}),
        });
      }
    },
  };
}
