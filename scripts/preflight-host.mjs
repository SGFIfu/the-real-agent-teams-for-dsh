/**
 * Pre-flight for the generated dynamic host body: runs it against stub
 * services and exercises team creation, task claiming, the web route and the
 * SSE broadcast before the package is loaded into the live session.
 * Run: node scripts/preflight-host.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { defineTool as realDefineTool } from 'file:///C:/Users/%E8%8D%A3%E8%80%80/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-tools/lib/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'dist/pkg6-host.js'), 'utf8');

const registeredTools = [];
let routeCapture;
const sseWrites = [];
const harness = {
  defineTool: (t) => ({ ...t, __dynamic: true }),
  registerTool: (_ctx, t) => {
    registeredTools.push(t);
    return () => {};
  },
  handle: () => {},
};
const factory = new Function('harness', src);
const plugin = factory(harness);
assert.equal(typeof plugin.apply, 'function');
assert.deepEqual(plugin.inject, ['agents', 'subagents', 'commands', 'webServer']);
const ctx = {
  agents: { get: (id) => ({ id }), requireInitiator: () => ({ id: 'lead-1' }) },
  subagents: {
    startContinuable: async (opts) => ({ childId: 'child-1', messageId: 'm-1' }),
    followup: async () => {},
    reportFrom: async () => {},
    interrupt: () => {},
    listChildren: async () => [],
  },
  commands: { register: () => () => {} },
  webServer: { register: (route) => { routeCapture = route; return () => {}; } },
  on: () => () => {},
  provide: () => () => {},
  get: (name) => ({
    tools: { register: () => () => {} },
    agents: ctx.agents,
    subagents: ctx.subagents,
    webServer: ctx.webServer,
  })[name],
};
// SSE responses: route handler will register into sseClients on /stream.
const fakeRes = {
  statusCode: 200,
  headers: {},
  body: '',
  setHeader(k, v) { this.headers[k] = v; },
  write(chunk) { sseWrites.push(chunk); return true; },
  end(chunk) { this.body += chunk ?? ''; },
};
const fakeReq = (url, method = 'GET', headers = {}) => ({
  url,
  method,
  headers: { host: '127.0.0.1:3080', ...headers },
  socket: { remoteAddress: '127.0.0.1', localAddress: '127.0.0.1' },
  listeners: {},
  on(event, cb) { this.listeners[event] = cb; return this; },
  emit(event, ...args) { if (this.listeners[event]) this.listeners[event](...args); return true; },
});
// For POST bodies: emit data/end on the next tick so readBody resolves.
const postReq = (url, bodyObj, headers = {}) => {
  const req = fakeReq(url, 'POST', headers);
  const payload = JSON.stringify(bodyObj ?? {});
  setTimeout(() => {
    req.emit('data', payload);
    req.emit('end');
  }, 0);
  return req;
};

// apply
const dispose = plugin.apply(ctx);
assert.equal(registeredTools.length, 47, `expected 47 tools, got ${registeredTools.length}`);
const findTool = (name) => registeredTools.find((t) => t.name === name);
assert.ok(findTool('team_create'));
assert.ok(findTool('team_task_claim_next'));
assert.ok(findTool('team_member_remove'));

// Compile every tool through the REAL dsh-tools defineTool — the exact
// compile the dynamic sandbox runs (parameters DSL + output value DSL).
for (const tool of registeredTools) {
  assert.equal(typeof tool.name, 'string');
  assert.equal(typeof tool.execute, 'function');
  const raw = tool.parameters;
  assert.ok(raw !== null && typeof raw === 'object', `${tool.name}: parameters must be an object`);
  assert.doesNotThrow(() => realDefineTool({ ...tool, execute: async () => ({}) }), `${tool.name}: real defineTool must compile`);
}

// 1. team_create via tool execute
const teamCreate = findTool('team_create');
const teamResult = await teamCreate.execute({ name: 'Preflight', goal: 'smoke' }, { agent: { id: 'lead-1' }, signal: undefined });
assert.equal(teamResult.ok, true);
const teamId = teamResult.value.id;

// 2. create + claim task
const taskCreate = findTool('team_task_create');
const task = await taskCreate.execute({ teamId, title: 'T1', description: 'do it' }, { agent: { id: 'lead-1' } });
assert.equal(task.ok, true);
const claim = await findTool('team_task_claim').execute({ taskId: task.value.id }, { agent: { id: 'lead-1' } });
assert.equal(claim.ok, true);
assert.equal(claim.value.status, 'in_progress');

// 3. web route: teams list
fakeRes.body = ''; fakeRes.statusCode = 200;
await routeCapture.handler(fakeReq('/agent-teams/teams'), fakeRes);
assert.equal(fakeRes.statusCode, 200, fakeRes.body);
const teams = JSON.parse(fakeRes.body);
assert.equal(teams.length, 1);
assert.equal(teams[0].id, teamId);
const sessionCookie = String(fakeRes.headers['Set-Cookie'] ?? '').split(';')[0];
const sessionCsrf = String(fakeRes.headers['X-Agent-Teams-CSRF'] ?? '');

// 4. SSE stream: open, then a real event must push a frame
fakeRes.body = ''; fakeRes.statusCode = 200;
await routeCapture.handler(fakeReq('/agent-teams/stream', 'GET', { cookie: sessionCookie }), fakeRes);
assert.ok(sseWrites.length >= 1, 'stream greeting expected');
const before = sseWrites.length;
await findTool('team_task_complete').execute({ taskId: task.value.id, result: 'done' }, { agent: { id: 'lead-1' } });
assert.ok(sseWrites.length > before, 'task-completed frame expected');
const frame = JSON.parse(String(sseWrites[sseWrites.length - 1]).replace(/^data: /, '').trim());
assert.equal(frame.type, 'agent-teams/task-completed');
assert.equal(frame.task.id, task.value.id);

// 5. snapshot route
fakeRes.body = ''; fakeRes.statusCode = 200;
await routeCapture.handler(fakeReq(`/agent-teams/team/${teamId}/snapshot`), fakeRes);
assert.equal(fakeRes.statusCode, 200);
const snap = JSON.parse(fakeRes.body);
assert.equal(snap.tasks[0].status, 'completed');

// 6. POST message route (lead actor)
fakeRes.body = ''; fakeRes.statusCode = 200;
await routeCapture.handler(postReq(`/agent-teams/team/${teamId}/message`, { body: 'hi team' }, { cookie: sessionCookie, 'x-agent-teams-csrf': sessionCsrf }), fakeRes);
assert.equal(fakeRes.statusCode, 200);
assert.equal(JSON.parse(fakeRes.body).ok, true);

dispose();
console.log('preflight-host: ALL CHECKS PASSED (47 tools, routes, SSE push, actions)');
