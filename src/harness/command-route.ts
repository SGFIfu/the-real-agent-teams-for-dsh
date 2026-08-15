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
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import type { AgentTeamsService } from '../core/service.ts';

export interface CommandRouteDeps {
  /** Interrupt one member session; caller supplies the lead handle. */
  interrupt(team: { leadSessionId: string }, sessionId: string): void;
}

interface WebSession {
  csrf: string;
  expiresAt: number;
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
    if (key === name) return decodeURIComponent(rest.join('='));
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
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/agent-teams; HttpOnly; SameSite=Strict`);
  res.setHeader('X-Agent-Teams-CSRF', session.csrf);
  return session;
}

function validSession(req: IncomingMessage, sessions: Map<string, WebSession>): WebSession | undefined {
  const id = cookie(req, SESSION_COOKIE);
  const session = id === undefined ? undefined : sessions.get(id);
  return session === undefined || session.expiresAt <= Date.now() ? undefined : session;
}

function authenticatedMutation(req: IncomingMessage, sessions: Map<string, WebSession>): boolean {
  const session = validSession(req, sessions);
  if (session === undefined) return false;
  const provided = req.headers['x-agent-teams-csrf'];
  const csrf = Array.isArray(provided) ? provided[0] : provided;
  if (csrf === undefined || csrf.length !== session.csrf.length) return false;
  return timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf));
}

function safeId(raw: string): string {
  const decoded = decodeURIComponent(raw);
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) throw new Error('unsafe resource id');
  return decoded;
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}') as Record<string, unknown>);
      } catch {
        resolve({});
      }
    });
  });
}

export function commandRoute(service: AgentTeamsService, deps: CommandRouteDeps | undefined, sseClients: Set<ServerResponse>): WebRoute {
  const sessions = new Map<string, WebSession>();
  return {
    kind: 'prefix',
    path: '/agent-teams',
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      const url = (req.url ?? '').split('?')[0];
      const segments = url.split('/').filter((p: string) => p.length > 0);
      const after = segments.slice(1);
      const method = req.method ?? 'GET';
      try {
        if (method === 'GET') issueSession(req, res, sessions);
        if (method === 'POST' && !authenticatedMutation(req, sessions)) {
          return json(res, 401, { error: 'authenticated Harness browser session required' });
        }
        // ── read endpoints ──────────────────────────────────────────────────
        if (method === 'GET') {
          if (after.length === 0 || (after.length === 1 && after[0] === 'teams')) {
            return json(res, 200, await service.listTeams());
          }
          if (after.length === 3 && after[0] === 'team' && after[2] === 'snapshot') {
            return json(res, 200, await service.publicSnapshot(safeId(after[1])));
          }
          if (after.length === 1 && after[0] === 'stream') {
            // SSE: push every typed agent-teams event as `data: <json>\n\n`.
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            if (validSession(req, sessions) === undefined) return json(res, 401, { error: 'authenticated Harness browser session required' });
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
            const body = await readBody(req);
            const team = await service.getTeam(teamId);
            const message = await service.sendMessage({
              teamId,
              fromSessionId: team.leadSessionId,
              toSessionId: typeof body.toSessionId === 'string' ? body.toSessionId : undefined,
              body: String(body.body ?? ''),
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
              return json(res, 200, { ok: true, plan: await service.approvePlan(planId, team.leadSessionId) });
            }
            if (after[4] === 'reject') {
              const body = await readBody(req);
              return json(res, 200, { ok: true, plan: await service.rejectPlan(planId, team.leadSessionId, String(body.feedback ?? '')) });
            }
          }
          if (after.length === 3 && after[0] === 'team' && after[2] === 'interrupt') {
            const teamId = safeId(after[1]);
            const body = await readBody(req);
            if (deps === undefined) return json(res, 503, { error: 'subagent runtime not mounted' });
            const team = await service.getTeam(teamId);
            const target = String(body.sessionId ?? '');
            if (target !== team.leadSessionId && (await service.memberBySession(teamId, target)) === undefined) return json(res, 403, { error: 'target session is not a member of team' });
            deps.interrupt(team, target);
            return json(res, 200, { ok: true });
          }
          if (after.length === 4 && after[0] === 'team' && after[2] === 'member' && after[3] === 'remove') {
            const teamId = safeId(after[1]);
            const body = await readBody(req);
            const team = await service.getTeam(teamId);
            const member = await service.getMember(String(body.memberId ?? ''));
            if (member.teamId !== teamId) return json(res, 403, { error: 'member does not belong to team' });
            await service.removeMember(member.id, team.leadSessionId);
            return json(res, 200, { ok: true });
          }
          if (after.length === 3 && after[0] === 'team' && (after[2] === 'pause' || after[2] === 'resume')) {
            const teamId = safeId(after[1]);
            const team = await service.getTeam(teamId);
            const result = after[2] === 'pause' ? await service.pauseTeam(teamId, team.leadSessionId) : await service.resumeTeam(teamId, team.leadSessionId);
            return json(res, 200, { ok: true, team: result });
          }
          if (after.length === 3 && after[0] === 'team' && after[2] === 'complete') {
            const teamId = safeId(after[1]);
            const team = await service.getTeam(teamId);
            return json(res, 200, { ok: true, team: await service.completeTeam(teamId, team.leadSessionId) });
          }
          return json(res, 404, { error: 'not found' });
        }
        return json(res, 404, { error: 'not found' });
      } catch (error) {
        const teamError = error as { code?: string; message?: string };
        return json(res, 400, {
          error: teamError.message ?? String(error),
          ...(teamError.code !== undefined ? { code: teamError.code } : {}),
          ...('details' in teamError && teamError.details !== undefined ? { details: teamError.details } : {}),
        });
      }
    },
  };
}
