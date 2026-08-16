/**
 * Direct HTTP boundary tests for the Command Center route.
 *
 * These tests deliberately use a tiny node:http-shaped double so that the
 * security contract is exercised without booting a model or a web server.
 * The service double still enforces Team membership for target sessions.
 */
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { teamError } from "../core/errors.js";
import { commandRoute } from "./command-route.js";
const TEAM_A = {
    id: 'team_a',
    name: 'Team A',
    goal: 'security test',
    leadSessionId: 'lead_a',
    workspaceId: 'workspace_a',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
};
const TEAM_B = {
    ...TEAM_A,
    id: 'team_b',
    name: 'Team B',
    leadSessionId: 'lead_b',
    workspaceId: 'workspace_b',
};
const MEMBER_A = {
    id: 'member_a',
    teamId: TEAM_A.id,
    sessionId: 'session_a',
    name: 'Backend',
    role: 'backend',
    status: 'idle',
    joinedAt: 1,
    lastActiveAt: 1,
};
const MEMBER_B = {
    ...MEMBER_A,
    id: 'member_b',
    teamId: TEAM_B.id,
    sessionId: 'session_b',
};
class FakeRequest extends EventEmitter {
    method;
    url;
    headers;
    socket;
    constructor(input) {
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
    headers = new Map();
    chunks = [];
    ended = false;
    setHeader(name, value) {
        this.headers.set(name.toLowerCase(), Array.isArray(value) ? value.join('; ') : String(value));
        return this;
    }
    write(chunk) {
        this.chunks.push(chunk);
        return true;
    }
    end(chunk) {
        if (chunk !== undefined)
            this.chunks.push(chunk);
        this.ended = true;
        return this;
    }
}
async function dispatch(route, input) {
    const request = new FakeRequest(input);
    const response = new FakeResponse();
    const pending = route.handler(request, response);
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
        body: raw.length === 0 ? undefined : JSON.parse(raw),
    };
}
function responseCode(result) {
    return result.body?.code;
}
function makeService(messageLog) {
    const teams = [TEAM_A, TEAM_B];
    const members = [MEMBER_A, MEMBER_B];
    return {
        listTeams: async () => teams,
        publicSnapshot: async (teamId) => {
            const team = teams.find((candidate) => candidate.id === teamId);
            if (team === undefined)
                throw teamError('TEAM_NOT_FOUND', `team ${teamId} not found`);
            return { team, members: members.filter((member) => member.teamId === teamId), tasks: [], messages: [], plans: [], fileClaims: [], findings: [], progress: {} };
        },
        getTeam: async (teamId) => {
            const team = teams.find((candidate) => candidate.id === teamId);
            if (team === undefined)
                throw teamError('TEAM_NOT_FOUND', `team ${teamId} not found`);
            return team;
        },
        sendMessage: async (input) => {
            if (input.toSessionId !== undefined && (await Promise.resolve(members.find((member) => member.teamId === input.teamId && member.sessionId === input.toSessionId))) === undefined) {
                throw teamError('MEMBER_NOT_FOUND', `message target ${input.toSessionId} is not in team ${input.teamId}`);
            }
            const message = { id: `message_${messageLog.length + 1}`, ...input };
            messageLog.push(message);
            return message;
        },
        listPlans: async () => [],
        memberBySession: async (teamId, sessionId) => members.find((member) => member.teamId === teamId && member.sessionId === sessionId),
        getMember: async (memberId) => {
            const member = members.find((candidate) => candidate.id === memberId);
            if (member === undefined)
                throw teamError('MEMBER_NOT_FOUND', `member ${memberId} not found`);
            return member;
        },
        removeMember: async () => undefined,
        approvePlan: async () => { throw new Error('not used'); },
        rejectPlan: async () => { throw new Error('not used'); },
        pauseTeam: async (teamId) => teams.find((candidate) => candidate.id === teamId),
        resumeTeam: async (teamId) => teams.find((candidate) => candidate.id === teamId),
        completeTeam: async (teamId) => teams.find((candidate) => candidate.id === teamId),
    };
}
function authenticatedHeaders(auth) {
    return {
        cookie: auth.cookie,
        'x-agent-teams-csrf': auth.csrf,
    };
}
async function openBrowser(route) {
    const result = await dispatch(route, { method: 'GET', url: '/agent-teams/teams' });
    const setCookie = result.headers.get('set-cookie');
    const csrf = result.headers.get('x-agent-teams-csrf');
    assert.ok(setCookie);
    assert.ok(csrf);
    return { cookie: setCookie.split(';', 1)[0], csrf };
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
        const messages = [];
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
        const calls = [];
        const deps = {
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
        assert.equal(calls[0].teamId, TEAM_A.id);
        assert.equal(calls[0].mutation, 'message');
        assert.ok(calls[0].browserSessionId.length > 0);
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
});
