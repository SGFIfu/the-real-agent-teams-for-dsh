/**
 * Direct HTTP boundary tests for the Command Center route.
 *
 * These tests deliberately use a tiny node:http-shaped double so that the
 * security contract is exercised without booting a model or a web server.
 * The service double still enforces Team membership for target sessions.
 */
import { EventEmitter } from 'node:events';
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentTeamsService } from '../core/service.ts';
import { teamError } from '../core/errors.ts';
import { commandRoute, type CommandRouteDeps } from './command-route.ts';

const TEAM_A = {
  id: 'team_a',
  name: 'Team A',
  goal: 'security test',
  leadSessionId: 'lead_a',
  workspaceId: 'workspace_a',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
} as const;

const TEAM_B = {
  ...TEAM_A,
  id: 'team_b',
  name: 'Team B',
  leadSessionId: 'lead_b',
  workspaceId: 'workspace_b',
} as const;

const MEMBER_A = {
  id: 'member_a',
  teamId: TEAM_A.id,
  sessionId: 'session_a',
  name: 'Backend',
  role: 'backend',
  status: 'idle',
  joinedAt: 1,
  lastActiveAt: 1,
} as const;

const MEMBER_B = {
  ...MEMBER_A,
  id: 'member_b',
  teamId: TEAM_B.id,
  sessionId: 'session_b',
} as const;

class FakeRequest extends EventEmitter {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  socket: { remoteAddress: string; localAddress: string };

  constructor(input: RequestInput) {
    super();
    this.method = input.method;
    this.url = input.url;
    this.headers = {
      host: '127.0.0.1:3080',
      ...(input.origin === undefined ? {} : { origin: input.origin }),
      ...(input.fetchSite === undefined ? {} : { 'sec-fetch-site': input.fetchSite }),
      ...(input.headers ?? {}),
    };
    this.socket = {
      remoteAddress: input.remoteAddress ?? '127.0.0.1',
      localAddress: '127.0.0.1',
    };
  }
}

class FakeResponse {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  readonly chunks: string[] = [];
  ended = false;

  setHeader(name: string, value: string | number | readonly string[]): this {
    this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join('; ') : String(value));
    return this;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  end(chunk?: string): this {
    if (chunk !== undefined) this.chunks.push(chunk);
    this.ended = true;
    return this;
  }
}

interface RequestInput {
  method: string;
  url: string;
  origin?: string;
  fetchSite?: string;
  headers?: IncomingHttpHeaders;
  remoteAddress?: string;
  body?: unknown;
}

interface ResponseResult {
  status: number;
  headers: Map<string, string>;
  body: Record<string, unknown> | unknown[] | undefined;
}

async function dispatch(route: ReturnType<typeof commandRoute>, input: RequestInput): Promise<ResponseResult> {
  const request = new FakeRequest(input);
  const response = new FakeResponse();
  const pending = route.handler(request as unknown as IncomingMessage, response as unknown as ServerResponse);
  if (input.body !== undefined) {
    setImmediate(() => {
      const body = typeof input.body === 'string' ? input.body : JSON.stringify(input.body);
      request.emit('data', Buffer.from(body));
      request.emit('end');
    });
  }
  await pending;
  const raw = response.chunks.join('');
  return {
    status: response.statusCode,
    headers: response.headers,
    body: raw.length === 0 ? undefined : (JSON.parse(raw) as Record<string, unknown> | unknown[]),
  };
}

function responseCode(result: ResponseResult): string | undefined {
  return (result.body as Record<string, unknown> | undefined)?.code as string | undefined;
}

function makeService(messageLog: Array<Record<string, unknown>>): AgentTeamsService {
  const teams = [TEAM_A, TEAM_B];
  const members = [MEMBER_A, MEMBER_B];
  return {
    listTeams: async () => teams,
    publicSnapshot: async (teamId: string) => {
      const team = teams.find((candidate) => candidate.id === teamId);
      if (team === undefined) throw teamError('TEAM_NOT_FOUND', `team ${teamId} not found`);
      return { team, members: members.filter((member) => member.teamId === teamId), tasks: [], messages: [], plans: [], fileClaims: [], findings: [], progress: {} };
    },
    getTeam: async (teamId: string) => {
      const team = teams.find((candidate) => candidate.id === teamId);
      if (team === undefined) throw teamError('TEAM_NOT_FOUND', `team ${teamId} not found`);
      return team;
    },
    sendMessage: async (input: { teamId: string; toSessionId?: string; body: string }) => {
      if (input.toSessionId !== undefined && (await Promise.resolve(members.find((member) => member.teamId === input.teamId && member.sessionId === input.toSessionId))) === undefined) {
        throw teamError('MEMBER_NOT_FOUND', `message target ${input.toSessionId} is not in team ${input.teamId}`);
      }
      const message = { id: `message_${messageLog.length + 1}`, ...input };
      messageLog.push(message);
      return message;
    },
    listPlans: async () => [],
    memberBySession: async (teamId: string, sessionId: string) => members.find((member) => member.teamId === teamId && member.sessionId === sessionId),
    getMember: async (memberId: string) => {
      const member = members.find((candidate) => candidate.id === memberId);
      if (member === undefined) throw teamError('MEMBER_NOT_FOUND', `member ${memberId} not found`);
      return member;
    },
    removeMember: async () => undefined,
    approvePlan: async () => { throw new Error('not used'); },
    rejectPlan: async () => { throw new Error('not used'); },
    pauseTeam: async (teamId: string) => teams.find((candidate) => candidate.id === teamId)!,
    resumeTeam: async (teamId: string) => teams.find((candidate) => candidate.id === teamId)!,
    completeTeam: async (teamId: string) => teams.find((candidate) => candidate.id === teamId)!,
  } as unknown as AgentTeamsService;
}

function authenticatedHeaders(auth: { cookie: string; csrf: string }): IncomingHttpHeaders {
  return {
    cookie: auth.cookie,
    'x-agent-teams-csrf': auth.csrf,
  };
}

async function openBrowser(route: ReturnType<typeof commandRoute>): Promise<{ cookie: string; csrf: string }> {
  const result = await dispatch(route, { method: 'GET', url: '/agent-teams/teams' });
  const setCookie = result.headers.get('set-cookie');
  const csrf = result.headers.get('x-agent-teams-csrf');
  assert.ok(setCookie);
  assert.ok(csrf);
  return { cookie: setCookie.split(';', 1)[0]!, csrf };
}

describe('Command Center web security boundary', () => {
  it('rejects mutation without the server session and CSRF capability', async () => {
    const route = commandRoute(makeService([]), { interrupt: () => undefined }, new Set());
    const result = await dispatch(route, { method: 'POST', url: '/agent-teams/team/team_a/pause', origin: 'http://127.0.0.1:3080', fetchSite: 'same-origin', body: {} });
    assert.equal(result.status, 401);
    assert.equal(responseCode(result), 'WEB_CALLER_UNAUTHORIZED');
  });

  it('rejects cross-origin and non-loopback callers even with a copied capability', async () => {
    const route = commandRoute(makeService([]), { interrupt: () => undefined }, new Set());
    const auth = await openBrowser(route);
    const crossOrigin = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/pause',
      origin: 'http://evil.example',
      fetchSite: 'cross-site',
      headers: authenticatedHeaders(auth),
      body: {},
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(responseCode(crossOrigin), 'WEB_ORIGIN_FORBIDDEN');

    const remote = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/pause',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      remoteAddress: '192.0.2.44',
      body: {},
    });
    assert.equal(remote.status, 403);
    assert.equal(responseCode(remote), 'WEB_ORIGIN_FORBIDDEN');
  });

  it('scopes the compatibility browser capability to one Team', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const route = commandRoute(makeService(messages), { interrupt: () => undefined }, new Set());
    const auth = await openBrowser(route);
    const teamA = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: { body: 'allowed in Team A' },
    });
    assert.equal(teamA.status, 200);

    const teamB = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_b/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: { body: 'must not cross the capability boundary' },
    });
    assert.equal(teamB.status, 403);
    assert.equal(responseCode(teamB), 'CROSS_TEAM_TARGET');
    assert.equal(messages.length, 1);
  });

  it('uses the host caller hook when supplied and never trusts a request body identity', async () => {
    const calls: Array<{ teamId: string; mutation: string; browserSessionId: string }> = [];
    const deps: CommandRouteDeps = {
      interrupt: () => undefined,
      authorizeCaller: (_req, context) => {
        calls.push(context);
        return context.teamId === TEAM_A.id ? { principalId: 'harness-user', teamIds: [TEAM_A.id] } : undefined;
      },
    };
    const route = commandRoute(makeService([]), deps, new Set());
    const auth = await openBrowser(route);
    const allowed = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: { fromSessionId: 'session_b', body: 'route must ignore this identity' },
    });
    assert.equal(allowed.status, 200);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.teamId, TEAM_A.id);
    assert.equal(calls[0]!.mutation, 'message');
    assert.ok(calls[0]!.browserSessionId.length > 0);

    const denied = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_b/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: { body: 'not authorized' },
    });
    assert.equal(denied.status, 401);
    assert.equal(responseCode(denied), 'WEB_CALLER_UNAUTHORIZED');
  });

  it('rejects traversal, unsafe ids, cross-Team target sessions, and malformed bodies', async () => {
    const route = commandRoute(makeService([]), { interrupt: () => undefined }, new Set());
    const auth = await openBrowser(route);
    const traversal = await dispatch(route, {
      method: 'GET',
      url: '/agent-teams/team/%2e%2e%2fteam_b/snapshot',
    });
    assert.equal(traversal.status, 400);
    assert.equal(responseCode(traversal), 'UNSAFE_RESOURCE_ID');

    const unsafeMember = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/member/remove',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: { memberId: '..\\escape' },
    });
    assert.equal(unsafeMember.status, 400);
    assert.equal(responseCode(unsafeMember), 'UNSAFE_RESOURCE_ID');

    const foreignSession = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/interrupt',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: { sessionId: MEMBER_B.sessionId },
    });
    assert.equal(foreignSession.status, 403);
    assert.equal(responseCode(foreignSession), 'SESSION_NOT_IN_TEAM');

    const malformed = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: '{"body":',
    });
    assert.equal(malformed.status, 400);
    assert.equal(responseCode(malformed), 'INVALID_INPUT');
  });

  it('enforces principal-based authentication when authorizeCaller hook is provided', async () => {
    const messages: Array<Record<string, unknown>> = [];
    const route = commandRoute(
      makeService(messages),
      {
        interrupt: () => undefined,
        authorizeCaller: async (req, context) => {
          // Simulate extracting principal from request headers (e.g., JWT token)
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return undefined;
          }
          const token = authHeader.slice(7);
          // Simulate token validation
          if (token === 'alice_token') {
            return { principalId: 'alice', teamIds: ['team_a'] };
          }
          if (token === 'bob_token') {
            return { principalId: 'bob', teamIds: ['team_b'] };
          }
          if (token === 'admin_token') {
            return { principalId: 'admin' }; // No teamIds restriction
          }
          return undefined;
        },
      },
      new Set(),
    );

    const auth = await openBrowser(route);

    // Test 1: No authorization header - should fail
    const noAuth = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: { body: 'no auth header' },
    });
    assert.equal(noAuth.status, 401);
    assert.equal(responseCode(noAuth), 'WEB_CALLER_UNAUTHORIZED');

    // Test 2: Invalid token - should fail
    const invalidAuth = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer invalid_token',
      },
      body: { body: 'invalid token' },
    });
    assert.equal(invalidAuth.status, 401);
    assert.equal(responseCode(invalidAuth), 'WEB_CALLER_UNAUTHORIZED');

    // Test 3: Valid user Alice accessing allowed team_a - should succeed
    const aliceTeamA = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer alice_token',
      },
      body: { body: 'alice to team_a' },
    });
    assert.equal(aliceTeamA.status, 200);
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.teamId, 'team_a');

    // Test 4: Valid user Alice accessing forbidden team_b - should fail
    const aliceTeamB = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_b/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer alice_token',
      },
      body: { body: 'alice to team_b' },
    });
    assert.equal(aliceTeamB.status, 403);
    assert.equal(responseCode(aliceTeamB), 'WEB_CALLER_FORBIDDEN');

    // Test 5: Valid user Bob accessing allowed team_b - should succeed
    const bobTeamB = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_b/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer bob_token',
      },
      body: { body: 'bob to team_b' },
    });
    assert.equal(bobTeamB.status, 200);
    assert.equal(messages.length, 2);
    assert.equal(messages[1]?.teamId, 'team_b');

    // Test 6: Admin with no team restrictions can access any team
    const adminTeamA = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer admin_token',
      },
      body: { body: 'admin to team_a' },
    });
    assert.equal(adminTeamA.status, 200);

    const adminTeamB = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_b/message',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer admin_token',
      },
      body: { body: 'admin to team_b' },
    });
    assert.equal(adminTeamB.status, 200);
  });

  it('logs authorization decisions for security auditing', async () => {
    const authLog: Array<{ principalId: string; teamId: string; mutation: string; allowed: boolean }> = [];
    const route = commandRoute(
      makeService([]),
      {
        interrupt: () => undefined,
        authorizeCaller: async (req, context) => {
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Bearer ')) {
            authLog.push({ principalId: 'anonymous', teamId: context.teamId, mutation: context.mutation, allowed: false });
            return undefined;
          }
          const token = authHeader.slice(7);
          if (token === 'user_token') {
            const caller = { principalId: 'user123', teamIds: ['team_a'] };
            const allowed = !caller.teamIds || caller.teamIds.includes(context.teamId);
            authLog.push({ principalId: caller.principalId, teamId: context.teamId, mutation: context.mutation, allowed });
            return caller;
          }
          authLog.push({ principalId: 'invalid', teamId: context.teamId, mutation: context.mutation, allowed: false });
          return undefined;
        },
      },
      new Set(),
    );

    const auth = await openBrowser(route);

    // Unauthorized access attempt
    await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/pause',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: authenticatedHeaders(auth),
      body: {},
    });

    // Authorized access
    await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/pause',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer user_token',
      },
      body: {},
    });

    // Cross-team access attempt
    await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_b/pause',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer user_token',
      },
      body: {},
    });

    // Verify all authorization attempts were logged
    assert.equal(authLog.length, 3);
    assert.equal(authLog[0]?.principalId, 'anonymous');
    assert.equal(authLog[0]?.allowed, false);
    assert.equal(authLog[1]?.principalId, 'user123');
    assert.equal(authLog[1]?.teamId, 'team_a');
    assert.equal(authLog[1]?.mutation, 'pause');
    assert.equal(authLog[1]?.allowed, true);
    assert.equal(authLog[2]?.principalId, 'user123');
    assert.equal(authLog[2]?.teamId, 'team_b');
    assert.equal(authLog[2]?.allowed, false);
  });

  it('handles authorizeCaller exceptions gracefully', async () => {
    const route = commandRoute(
      makeService([]),
      {
        interrupt: () => undefined,
        authorizeCaller: async () => {
          throw new Error('Authorization service unavailable');
        },
      },
      new Set(),
    );

    const auth = await openBrowser(route);
    const result = await dispatch(route, {
      method: 'POST',
      url: '/agent-teams/team/team_a/pause',
      origin: 'http://127.0.0.1:3080',
      fetchSite: 'same-origin',
      headers: {
        ...authenticatedHeaders(auth),
        authorization: 'Bearer user_token',
      },
      body: {},
    });

    assert.equal(result.status, 401);
    assert.equal(responseCode(result), 'WEB_CALLER_UNAUTHORIZED');
  });
});
