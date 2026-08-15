/**
 * dsh-agent-teams — host plugin entry.
 *
 * Provides `ctx.agentTeams` (the Agent Teams coordination service), opens the
 * durable `agent_teams` storage domain, registers the model-facing team_*
 * tools, the lead/teammate protocol prompt section, the `/team` command, the
 * snapshot HTTP route for the web panel, and bridges native agent/subagent
 * lifecycle events into team state.
 *
 * This plugin is a COORDINATION LAYER: it spawns no LLM loops, owns no model
 * calls, and adds no shell/fs/network tools. Agents, sessions, storage, and
 * the subagent runtime all belong to the harness.
 * @module dsh-agent-teams
 */
import s from '@deepseek-ai/schemastery';
import "./harness/declare.js";
import { AgentTeamsService } from "./core/service.js";
import { MemoryStore } from "./core/store.js";
import { LEAD_APPENDIX, TEAM_PROTOCOL_CORE } from "./core/prompts.js";
import { DomainStore } from "./harness/domain-store.js";
import { agentTeamsDomain } from "./harness/domain.js";
import { HarnessRuntimeAdapter, leadHandle } from "./harness/runtime.js";
import { CordisEventSink, bridgeNativeEvents } from "./harness/events-bridge.js";
import { ALL_EVENTS } from "./core/events.js";
import { commandRoute } from "./harness/command-route.js";
import { registerTeamTools } from "./tools/index.js";
export const name = 'agent-teams';
export const Config = s.object({
    defaultProvider: s.string().default('spawn'),
    maxActiveMembers: s.number().default(5),
    storageMode: s.union(['auto', 'memory']).default('auto'),
});
function promptSection() {
    return {
        name: 'agent-teams-protocol',
        order: 150,
        text: `You have Agent Teams capabilities through the team_* tools. Use them when the user asks to organize a multi-agent team (use agent teams / 组一个 agent team / 多个智能体一起做 / multi-agent / 团队开发).\n\n${LEAD_APPENDIX}\n\n${TEAM_PROTOCOL_CORE}`,
    };
}
function teamCommand(service, commandName) {
    return {
        name: commandName,
        description: commandName === 'real-agent-teams' ? 'The real agent teams — teams, tasks, agents, messages' : 'The real agent teams (alias): status, tasks, agents, messages',
        recordInput: true,
        handler: async (invocation) => {
            const raw = invocation.rawInput.trim();
            const actor = invocation.agent.id;
            const usage = (sub) => `usage: /${commandName} ${sub}`;
            try {
                if (raw === '' || raw.startsWith('status')) {
                    const teams = await service.listTeams(actor);
                    if (teams.length === 0)
                        return { kind: 'success', text: 'No agent teams. Say "use agent teams …" in chat to create one.' };
                    const rows = teams.map((t) => `- ${t.id}  ${t.name}  [${t.status}]`).join('\n');
                    return { kind: 'success', text: rows };
                }
                if (raw.startsWith('tasks')) {
                    const teamId = raw.split(/\s+/)[1];
                    if (teamId === undefined)
                        return { kind: 'error', text: usage('tasks <teamId>') };
                    const snapshot = await service.getSnapshot(teamId, actor);
                    const lines = snapshot.tasks.map((t) => `- [${t.status}] ${t.id} ${t.title}${t.ownerSessionId !== undefined ? ` (owner ${t.ownerSessionId})` : ''}`);
                    return { kind: 'success', text: lines.join('\n') };
                }
                if (raw.startsWith('agents')) {
                    const teamId = raw.split(/\s+/)[1];
                    if (teamId === undefined)
                        return { kind: 'error', text: usage('agents <teamId>') };
                    const members = await service.listMembers(teamId, actor);
                    const lines = members.map((m) => `- ${m.role} (${m.sessionId}) [${m.status}]${m.currentTaskId !== undefined ? ` → ${m.currentTaskId}` : ''}`);
                    return { kind: 'success', text: lines.join('\n') };
                }
                if (raw.startsWith('messages')) {
                    const teamId = raw.split(/\s+/)[1];
                    if (teamId === undefined)
                        return { kind: 'error', text: usage('messages <teamId>') };
                    const messages = await service.listMessages(teamId, actor, 20);
                    const lines = messages.map((m) => `[${m.type}] ${m.fromSessionId}${m.toSessionId !== undefined ? ` → ${m.toSessionId}` : ' → team'}: ${m.body.slice(0, 200)}`);
                    return { kind: 'success', text: lines.reverse().join('\n') };
                }
                return { kind: 'error', text: `usage: /${commandName} status | /${commandName} tasks <teamId> | /${commandName} agents <teamId> | /${commandName} messages <teamId>` };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return { kind: 'error', text: message };
            }
        },
    };
}
export function apply(ctx, config) {
    ctx.effect(async () => {
        const disposers = [];
        // Storage: harness domain when mounted, memory fallback otherwise.
        let store;
        const facility = ctx.get('storageDomain');
        if (facility !== undefined && config.storageMode !== 'memory') {
            const domain = await facility.open(agentTeamsDomain);
            store = new DomainStore(domain);
            disposers.push(() => domain.close());
            console.log('[agent-teams] storage: harness domain "agent_teams" (durable)');
        }
        else {
            store = new MemoryStore();
            console.log('[agent-teams] storage: in-memory fallback (storageDomain not mounted)');
        }
        // Runtime: native subagent runtime when mounted; the service still works
        // for coordination when absent, and spawn fails loudly.
        const subagents = ctx.get('subagents');
        const runtime = subagents === undefined ? undefined : new HarnessRuntimeAdapter({ ctx, subagents, defaultProvider: config.defaultProvider });
        const service = new AgentTeamsService({
            store,
            runtime,
            sink: new CordisEventSink(ctx),
            defaultProvider: config.defaultProvider,
            maxActiveMembers: config.maxActiveMembers,
        });
        console.log('[agent-teams] service constructed');
        await service.ready();
        console.log('[agent-teams] store ready');
        disposers.push(ctx.provide('agentTeams', service));
        console.log('[agent-teams] service provided');
        try {
            disposers.push(...registerTeamTools({ ctx, service, rawSchemas: true }));
            console.log('[agent-teams] tools registered');
        }
        catch (error) {
            console.error('[agent-teams] tool registration failed:', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
            throw error;
        }
        disposers.push(...bridgeNativeEvents({ ctx, service }));
        console.log('[agent-teams] event bridge registered');
        const systemPrompt = ctx.get('systemPrompt');
        if (systemPrompt !== undefined)
            disposers.push(systemPrompt.section(promptSection()));
        console.log('[agent-teams] prompt section registered');
        const commands = ctx.get('commands');
        if (commands !== undefined) {
            disposers.push(commands.register(teamCommand(service, 'real-agent-teams')));
            disposers.push(commands.register(teamCommand(service, 'team')));
        }
        console.log('[agent-teams] command registered');
        const webServer = ctx.get('webServer');
        if (webServer !== undefined) {
            // SSE broadcast set: every typed agent-teams event is pushed to every
            // open Command Center stream as `data: {"type": "...", ...payload}\n\n`.
            const sseClients = new Set();
            for (const eventName of ALL_EVENTS) {
                disposers.push(ctx.on(eventName, (payload) => {
                    const frame = JSON.stringify(payload !== null && typeof payload === 'object' ? { type: eventName, ...payload } : { type: eventName, payload });
                    for (const res of sseClients) {
                        try {
                            res.write(`data: ${frame}\n\n`);
                        }
                        catch {
                            sseClients.delete(res);
                        }
                    }
                }));
            }
            disposers.push(webServer.register(commandRoute(service, {
                interrupt: (team, sessionId) => {
                    runtime?.interrupt(sessionId, leadHandle(team.leadSessionId));
                },
            }, sseClients)));
            console.log('[agent-teams] web routes registered at /agent-teams (+ SSE stream)');
        }
        else {
            console.log('[agent-teams] webServer service unavailable — panel route skipped');
        }
        return async () => {
            for (const dispose of [...disposers].reverse())
                await dispose();
        };
    });
}
export default { name, Config, apply };
