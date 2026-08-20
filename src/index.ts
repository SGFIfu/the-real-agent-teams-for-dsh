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
import type { Context } from '@deepseek-ai/cordis';
import type { ServerResponse } from 'node:http';
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain';
import type { SubagentRuntime } from '@deepseek-ai/dsh-subagent';
import type { CommandDefinition } from '@deepseek-ai/dsh-commands';
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt';
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver';
import './harness/declare.ts';
import { AgentTeamsService } from './core/service.ts';
import { ReviewDomain } from './core/review.ts';
import { createRuntimeEventLog } from './core/runtime-events.ts';
import { WorkspaceManager } from './core/workspace.ts';
import { MemoryStore, type TeamStore } from './core/store.ts';
import { LEAD_APPENDIX, TEAM_PROTOCOL_CORE } from './core/prompts.ts';
import { DomainStore } from './harness/domain-store.ts';
import { agentTeamsDomain } from './harness/domain.ts';
import { HarnessRuntimeAdapter, leadHandle } from './harness/runtime.ts';
import { CordisEventSink, bridgeNativeEvents } from './harness/events-bridge.ts';
import { ALL_EVENTS } from './core/events.ts';
import { commandRoute } from './harness/command-route.ts';
import { registerTeamTools } from './tools/index.ts';

export const name = 'agent-teams';

export interface Config {
  defaultProvider: string;
  defaultModel?: string;
  maxActiveMembers: number;
  /** 'auto' opens the harness storage domain when mounted; 'memory' forces the in-memory store. */
  storageMode: 'auto' | 'memory';
}

export const Config: s<Config> = s.object({
  defaultProvider: s.string().default('spawn'),
  defaultModel: s.string().default('deepseek-v4-flash'),
  maxActiveMembers: s.number().default(5),
  storageMode: s.union(['auto', 'memory']).default('auto'),
});

interface StorageDomainFacility {
  open(spec: DomainSpec): Promise<Domain<DomainSpec>>;
}

function promptSection(): PromptSection {
  return {
    name: 'agent-teams-protocol',
    order: 150,
    text: `You have Agent Teams capabilities through the team_* tools. Use them when the user asks to organize a multi-agent team (use agent teams / 组一个 agent team / 多个智能体一起做 / multi-agent / 团队开发).\n\n${LEAD_APPENDIX}\n\n${TEAM_PROTOCOL_CORE}`,
  };
}

function teamCommand(service: AgentTeamsService, commandName: string): CommandDefinition {
  return {
    name: commandName,
    description: commandName === 'real-agent-teams' ? 'The real agent teams — teams, tasks, agents, messages' : 'The real agent teams (alias): status, tasks, agents, messages',
    recordInput: true,
    handler: async (invocation) => {
      const raw = invocation.rawInput.trim();
      const actor = invocation.agent.id;
      const usage = (sub: string) => `usage: /${commandName} ${sub}`;
      try {
        if (raw === '' || raw.startsWith('status')) {
          const teams = await service.listTeams(actor);
          if (teams.length === 0) return { kind: 'success', text: 'No agent teams. Say "use agent teams …" in chat to create one.' };
          const rows = teams.map((t) => `- ${t.id}  ${t.name}  [${t.status}]`).join('\n');
          return { kind: 'success', text: rows };
        }
        if (raw.startsWith('tasks')) {
          const teamId = raw.split(/\s+/)[1];
          if (teamId === undefined) return { kind: 'error', text: usage('tasks <teamId>') };
          const snapshot = await service.getSnapshot(teamId, actor);
          const lines = snapshot.tasks.map((t) => `- [${t.status}] ${t.id} ${t.title}${t.ownerSessionId !== undefined ? ` (owner ${t.ownerSessionId})` : ''}`);
          return { kind: 'success', text: lines.join('\n') };
        }
        if (raw.startsWith('agents')) {
          const teamId = raw.split(/\s+/)[1];
          if (teamId === undefined) return { kind: 'error', text: usage('agents <teamId>') };
          const members = await service.listMembers(teamId, actor);
          const lines = members.map((m) => `- ${m.role} (${m.sessionId}) [${m.status}]${m.currentTaskId !== undefined ? ` → ${m.currentTaskId}` : ''}`);
          return { kind: 'success', text: lines.join('\n') };
        }
        if (raw.startsWith('messages')) {
          const teamId = raw.split(/\s+/)[1];
          if (teamId === undefined) return { kind: 'error', text: usage('messages <teamId>') };
          const messages = await service.listMessages(teamId, actor, 20);
          const lines = messages.map((m) => `[${m.type}] ${m.fromSessionId}${m.toSessionId !== undefined ? ` → ${m.toSessionId}` : ' → team'}: ${m.body.slice(0, 200)}`);
          return { kind: 'success', text: lines.reverse().join('\n') };
        }
        return { kind: 'error', text: `usage: /${commandName} status | /${commandName} tasks <teamId> | /${commandName} agents <teamId> | /${commandName} messages <teamId>` };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { kind: 'error', text: message };
      }
    },
  };
}

export function apply(ctx: Context, config: Config): void {
  ctx.effect(async () => {
    const disposers: Array<() => unknown> = [];

    // Storage: harness domain when mounted, memory fallback otherwise.
    let store: TeamStore;
    const facility = ctx.get('storageDomain') as StorageDomainFacility | undefined;
    if (facility !== undefined && config.storageMode !== 'memory') {
      const domain = await facility.open(agentTeamsDomain);
      store = new DomainStore(domain);
      disposers.push(() => domain.close());
      console.log('[agent-teams] storage: harness domain "agent_teams" (durable)');
    } else {
      store = new MemoryStore();
      console.log('[agent-teams] storage: in-memory fallback (storageDomain not mounted)');
    }

    // Runtime: native subagent runtime when mounted; the service still works
    // for coordination when absent, and spawn fails loudly.
    const subagents = ctx.get('subagents') as SubagentRuntime | undefined;
    const runtime = subagents === undefined ? undefined : new HarnessRuntimeAdapter({ ctx, subagents, defaultProvider: config.defaultProvider, defaultModel: config.defaultModel });

    const service = new AgentTeamsService({
      store,
      runtime,
      review: new ReviewDomain({ store }),
      runtimeEvents: createRuntimeEventLog(store),
      workspace: new WorkspaceManager({ store }),
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
    } catch (error) {
      console.error('[agent-teams] tool registration failed:', error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error));
      throw error;
    }
    disposers.push(...bridgeNativeEvents({ ctx, service }));
    console.log('[agent-teams] event bridge registered');

    // Enforce the bounded capability policy at the Harness tool pipeline too.
    // Team_* tools retain their own service-level authorization; this hook
    // covers generic repo/process tools so a teammate's persisted capability
    // record is an actual deny boundary rather than prompt-only metadata.
    disposers.push(ctx.on('tools/pre-execute', async (execution, next) => {
      const actor = execution.agent?.id;
      if (actor === undefined) return next();
      const decision = await service.authorizeToolCapability({
        sessionId: actor,
        toolName: execution.name,
        arguments: execution.arguments,
      });
      if (decision.allowed) return next();
      return {
        kind: 'deny',
        reason: `CAPABILITY_DENIED: ${decision.reason ?? 'capability policy rejected this tool call'}`,
      };
    }));
    console.log('[agent-teams] capability guard registered');

    const systemPrompt = ctx.get('systemPrompt') as { section(section: PromptSection): () => void } | undefined;
    if (systemPrompt !== undefined) disposers.push(systemPrompt.section(promptSection()));
    console.log('[agent-teams] prompt section registered');

    const commands = ctx.get('commands') as { register(definition: CommandDefinition): () => void } | undefined;
    if (commands !== undefined) {
      disposers.push(commands.register(teamCommand(service, 'real-agent-teams')));
      disposers.push(commands.register(teamCommand(service, 'team')));
    }
    console.log('[agent-teams] command registered');

    const webServer = ctx.get('webServer') as { register(route: WebRoute): () => void } | undefined;
    if (webServer !== undefined) {
      // SSE broadcast set: every typed agent-teams event is pushed to every
      // open Command Center stream as `data: {"type": "...", ...payload}\n\n`.
      const sseClients = new Set<ServerResponse>();
      for (const eventName of ALL_EVENTS) {
        disposers.push(
          ctx.on(eventName, (payload: unknown) => {
            const frame = JSON.stringify(payload !== null && typeof payload === 'object' ? { type: eventName, ...payload } : { type: eventName, payload });
            for (const res of sseClients) {
              try {
                res.write(`data: ${frame}\n\n`);
              } catch {
                sseClients.delete(res);
              }
            }
          }),
        );
      }
      disposers.push(
        webServer.register(
          commandRoute(
            service,
            {
              interrupt: (team, sessionId) => {
                runtime?.interrupt(sessionId, leadHandle(team.leadSessionId));
              },
            },
            sseClients,
          ),
        ),
      );
      console.log('[agent-teams] web routes registered at /agent-teams (+ SSE stream)');
    } else {
      console.log('[agent-teams] webServer service unavailable — panel route skipped');
    }

    return async () => {
      for (const dispose of [...disposers].reverse()) await dispose();
    };
  });
}

export default { name, Config, apply };
