/**
 * Builds the self-contained dynamic Cordis package bodies (pkg-6) from the
 * compiled static `lib/` modules: imports/exports are stripped and the
 * modules are concatenated into single function bodies with the dynamic
 * sandbox glue (harness.defineTool/registerTool, webServer routes, SSE).
 * Run: node scripts/build-dynamic-pkg.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Strip module syntax: imports dropped, `export ` prefix removed, re-export lists dropped. */
function strip(source, options = {}) {
  let out = source
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line))
    .filter((line) => !/^\s*export\s*\{[^}]*\};?\s*$/.test(line))
    .map((line) => line.replace(/^\s*export\s+(?=(async\s+function|function|class|const|let|var))/, ''))
    .map((line) => (line.trim() === 'export default { apply };' ? 'return { inject: [\'timer\'], apply };' : line))
    .join('\n');
  if (options.namespace) {
    // `import * as X from ...` becomes a bare scope: drop `X.` qualifiers.
    out = out.replace(/events\./g, '');
  }
  return out;
}

/** Drop full-line // comments and blank lines (safe: no // inside the shipped strings). */
function compact(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      return trimmed !== '' && !trimmed.startsWith('//');
    })
    .map((line) => line.replace(/^\s{4}/, ''))
    .join('\n');
}

const hostModules = [
  ['lib/core/errors.js', {}],
  ['lib/harness/provider-resolution.js', {}],
  ['lib/core/ids.js', {}],
  ['lib/core/events.js', {}],
  ['lib/core/capabilities.js', {}],
  ['lib/core/store.js', {}],
  ['lib/core/service.js', { namespace: true }],
  ['lib/core/prompts.js', {}],
  ['lib/tools/index.js', {}],
  ['lib/harness/events-bridge.js', {}],
  ['lib/harness/command-route.js', {}],
];

const hostGlue = `
// ── dynamic sandbox glue (pkg-6: Animated AI Team Command Center) ──────
const isIP = (address) => /^\\d{1,3}(?:\\.\\d{1,3}){3}$/.test(address) ? 4 : (typeof address === 'string' && address.includes(':') ? 6 : 0);
const randomBytes = (size) => {
  const bytes = new Uint8Array(size);
  if (globalThis.crypto === undefined || typeof globalThis.crypto.getRandomValues !== 'function') throw new Error('secure random source unavailable');
  globalThis.crypto.getRandomValues(bytes);
  return { toString: (encoding) => encoding === 'base64url' ? globalThis.btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/g, '') : String.fromCharCode(...bytes) };
};
const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
};
const leadHandle = (sessionId) => ({ __teamLeadSessionId: sessionId });
const memberHandle = (sessionId) => ({ __teamMemberSessionId: sessionId });

return {
  inject: ['agents', 'subagents', 'commands', 'webServer'],
  apply(ctx) {
    const disposers = [];

    // SSE broadcast: the sink writes directly to open Command Center streams.
    const sseClients = new Set();
    const broadcast = (name, payload) => {
      let frame;
      try {
        frame = JSON.stringify(payload !== null && typeof payload === 'object' ? { type: name, ...payload } : { type: name, payload });
      } catch {
        return;
      }
      for (const res of sseClients) {
        try {
          res.write('data: ' + frame + '\\n\\n');
        } catch {
          sseClients.delete(res);
        }
      }
    };

    // Tool-call cancellation signal captured per execution (no AbortController
    // global in the dynamic sandbox).
    let currentSignal;
    const withSignalCapture = (tool) => ({
      ...tool,
      async execute(args, exec) {
        const previous = currentSignal;
        if (exec !== undefined && exec.signal !== undefined) currentSignal = exec.signal;
        try {
          return await tool.execute(args, exec);
        } finally {
          currentSignal = previous;
        }
      },
    });

    const dynamicRuntime = {
      async startContinuable(spec) {
        const leadId = spec.parent !== undefined && spec.parent.__teamLeadSessionId !== undefined ? spec.parent.__teamLeadSessionId : undefined;
        const lead = leadId === undefined ? undefined : ctx.agents.get(leadId);
        if (lead === undefined) throw teamError('SUBAGENT_UNAVAILABLE', 'lead agent ' + leadId + ' is not live');
        const resolved = resolveAgentSpec({ model: spec.model, modelProvider: spec.modelProvider, provider: spec.provider }, { availableProviders: ctx.subagents.list(), defaultProvider: 'spawn', defaultModel: 'deepseek-v4-flash' });
        try {
          const start = await ctx.subagents.startContinuable({
            provider: resolved.resolvedProvider,
            label: spec.label,
            request: {
              prompt: [{ type: 'text', text: spec.promptText }],
              parent: lead,
              ...(spec.maxDepth !== undefined ? { maxDepth: spec.maxDepth } : {}),
              ...(spec.toolFilter !== undefined ? { toolFilter: spec.toolFilter } : {}),
              ...(spec.persona !== undefined ? { persona: spec.persona } : {}),
              ...(resolved.resolvedModel !== undefined || resolved.resolvedModelProvider !== undefined ? { agentOptions: { ...(resolved.resolvedModelProvider === undefined ? {} : { provider: resolved.resolvedModelProvider }), ...(resolved.resolvedModel === undefined ? {} : { model: resolved.resolvedModel }) } } : {}),
            },
            signal: spec.signal,
          });
          return { childId: start.childId, messageId: start.messageId };
        } catch (error) {
          throw teamError('SUBAGENT_UNAVAILABLE', 'failed to start continuable teammate: ' + (error instanceof Error ? error.message : String(error)));
        }
      },
      async followup(handle, childId, text, senderSessionId) {
        const leadId = handle !== undefined && handle.__teamLeadSessionId !== undefined ? handle.__teamLeadSessionId : undefined;
        const lead = leadId === undefined ? undefined : ctx.agents.get(leadId);
        if (lead === undefined) throw teamError('SUBAGENT_UNAVAILABLE', 'lead agent ' + leadId + ' is not live');
        await ctx.subagents.followup(lead, childId, [{ type: 'text', text }], {
          source: { kind: 'coordinator', form: 'relay', senderSessionId: senderSessionId || leadId },
          signal: currentSignal,
        });
      },
      async reportFrom(handle, text) {
        const sessionId = handle !== undefined && handle.__teamMemberSessionId !== undefined ? handle.__teamMemberSessionId : undefined;
        const agent = sessionId === undefined ? undefined : ctx.agents.get(sessionId);
        if (agent === undefined) throw teamError('SUBAGENT_UNAVAILABLE', 'member agent ' + sessionId + ' is not live');
        await ctx.subagents.reportFrom(agent, [{ type: 'text', text }], { delivery: 'quiet', signal: currentSignal });
      },
      async wakeWorker(handle, childId, text, senderSessionId) {
        const leadId = handle !== undefined && handle.__teamLeadSessionId !== undefined ? handle.__teamLeadSessionId : undefined;
        const lead = leadId === undefined ? undefined : ctx.agents.get(leadId);
        if (lead === undefined) throw teamError('SUBAGENT_UNAVAILABLE', 'lead agent ' + leadId + ' is not live');
        await ctx.subagents.followup(lead, childId, [{ type: 'text', text }], {
          source: { kind: 'coordinator', form: 'relay', senderSessionId: senderSessionId || leadId },
          signal: currentSignal || new AbortController().signal,
        });
      },
      interrupt(targetSessionId, handle) {
        const leadId = handle !== undefined && handle.__teamLeadSessionId !== undefined ? handle.__teamLeadSessionId : undefined;
        const lead = leadId === undefined ? undefined : ctx.agents.get(leadId);
        if (lead !== undefined) ctx.subagents.interrupt(targetSessionId, { kind: 'ancestor', agent: lead });
      },
      async listChildrenOf(parentSessionId) {
        try {
          const children = await ctx.subagents.listChildren(parentSessionId);
          return children.map((child) => ({ sessionId: child.id, label: child.kind === 'child' ? child.label : undefined }));
        } catch {
          return [];
        }
      },
    };

    const service = new AgentTeamsService({
      store: new MemoryStore(),
      runtime: dynamicRuntime,
      sink: { emit: (name, payload) => broadcast(name, payload) },
      defaultProvider: 'spawn',
      maxActiveMembers: 5,
    });
    disposers.push(ctx.provide('agentTeams', service));

    // Tools: static definitions through the sandbox define/register pair.
    disposers.push(
      ...registerTeamTools({
        ctx,
        service,
        registerTool: (tool) => harness.registerTool(ctx, harness.defineTool(withSignalCapture(tool))),
      }),
    );

    disposers.push(
      ctx.commands.register({
        name: 'real-agent-teams',
        description: 'The real agent teams — teams, tasks, agents, messages',
        recordInput: true,
        handler: async (invocation) => {
          const raw = invocation.rawInput.trim();
          const actor = invocation.agent.id;
          const usage = (sub) => 'usage: /real-agent-teams ' + sub;
          try {
            if (raw === '' || raw.startsWith('status')) {
              const teams = await service.listTeams(actor);
              if (teams.length === 0) return { kind: 'success', text: 'No agent teams yet. Say "use agent teams …" in chat to create one.' };
              return { kind: 'success', text: teams.map((t) => '- ' + t.id + '  ' + t.name + '  [' + t.status + ']').join('\\n') };
            }
            if (raw.startsWith('tasks')) {
              const teamId = raw.split(/\\s+/)[1];
              if (teamId === undefined) return { kind: 'error', text: usage('tasks <teamId>') };
              const snapshot = await service.getSnapshot(teamId, actor);
              return { kind: 'success', text: snapshot.tasks.map((t) => '- [' + t.status + '] ' + t.id + ' ' + t.title + (t.ownerSessionId !== undefined ? ' (owner ' + t.ownerSessionId + ')' : '')).join('\\n') };
            }
            if (raw.startsWith('agents')) {
              const teamId = raw.split(/\\s+/)[1];
              if (teamId === undefined) return { kind: 'error', text: usage('agents <teamId>') };
              const members = await service.listMembers(teamId, actor);
              return { kind: 'success', text: members.map((m) => '- ' + m.role + ' (' + m.sessionId + ') [' + m.status + ']' + (m.currentTaskId !== undefined ? ' → ' + m.currentTaskId : '')).join('\\n') };
            }
            if (raw.startsWith('messages')) {
              const teamId = raw.split(/\\s+/)[1];
              if (teamId === undefined) return { kind: 'error', text: usage('messages <teamId>') };
              const messages = await service.listMessages(teamId, actor, 20);
              return { kind: 'success', text: messages.map((m) => '[' + m.type + '] ' + m.fromSessionId + (m.toSessionId !== undefined ? ' → ' + m.toSessionId : ' → team') + ': ' + m.body.slice(0, 200)).reverse().join('\\n') };
            }
            return { kind: 'error', text: 'usage: /real-agent-teams status | tasks <teamId> | agents <teamId> | messages <teamId>' };
          } catch (error) {
            return { kind: 'error', text: error instanceof Error ? error.message : String(error) };
          }
        },
      }),
    );

    // Native lifecycle bridge (agent/status + subagent/end → member status).
    disposers.push(...bridgeNativeEvents({ ctx, service }));

    // Web routes + SSE stream for the Command Center.
    disposers.push(
      ctx.webServer.register(
        commandRoute(
          service,
          { interrupt: (team, sessionId) => dynamicRuntime.interrupt(sessionId, leadHandle(team.leadSessionId)) },
          sseClients,
        ),
      ),
    );

    console.log('[agent-teams] The real agent teams live (pkg-6: Animated Command Center) — 47 tools + /agent-teams routes + SSE + panel');
    return () => {
      for (const dispose of disposers.reverse()) {
        try {
          const result = dispose();
          if (result !== undefined && typeof result.then === 'function') result.catch(() => {});
        } catch {
          /* ignore */
        }
      }
    };
  },
};
`;

const hostBody = compact(hostModules.map(([file, opts]) => strip(readFileSync(join(root, file), 'utf8'), opts)).join('\n') + hostGlue);

// ── client ────────────────────────────────────────────────────────────────
const clientBody = compact(
  strip(readFileSync(join(root, 'lib/client/logic/control.js'), 'utf8')) +
    '\n' +
    strip(readFileSync(join(root, 'lib/client.js'), 'utf8')),
);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/pkg6-host.js'), '// ── dsh-agent-teams dynamic host (pkg-6) — generated by scripts/build-dynamic-pkg.mjs ──\n' + hostBody, 'utf8');
writeFileSync(join(root, 'dist/pkg6-client.js'), '// ── dsh-agent-teams dynamic client (pkg-6) — generated by scripts/build-dynamic-pkg.mjs ──\n' + clientBody, 'utf8');
console.log('host body:', hostBody.length, 'chars');
console.log('client body:', clientBody.length, 'chars');
