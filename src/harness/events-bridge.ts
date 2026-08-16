/**
 * Harness event bridge: maps native `agent/status` / `subagent/end` lifecycle
 * into team member semantic state (orchestration metadata; the native state
 * remains the runtime truth). Also forwards typed `agent-teams/*` events
 * through Cordis `ctx.emit`.
 * @module dsh-agent-teams/harness
 */
import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { SubagentRunEndInfo } from '@deepseek-ai/dsh-subagent';
import { ALL_EVENTS } from '../core/events.ts';
import type { TeamEventSink } from '../core/types.ts';

export class CordisEventSink implements TeamEventSink {
  constructor(private readonly ctx: Context) {}

  emit(name: string, payload: unknown): void {
    try {
      (this.ctx.emit as unknown as (eventName: string, eventPayload: unknown) => void)(name, payload);
    } catch {
      // Observer errors never break coordination.
    }
  }
}

export interface BridgeDeps {
  ctx: Context;
  service: {
    memberBySession(teamId: string, sessionId: string): Promise<{ id: string; teamId: string } | undefined>;
    updateMemberFromRuntime(
      memberId: string,
      patch: { status?: 'starting' | 'working' | 'idle' | 'blocked' | 'reviewing' | 'stopped' | 'failed' },
    ): Promise<unknown>;
    retryPendingMessages(teamId: string, sessionId?: string): Promise<unknown>;
    listTeams(): Promise<Array<{ id: string; leadSessionId: string }>>;
  };
}

/**
 * Register native lifecycle listeners; returns disposers owned by the plugin
 * fiber. Status mapping: native `running` ⇄ `working` (when a task is held),
 * `idle` ⇄ `idle`; a settled subagent ⇄ `stopped`.
 */
export function bridgeNativeEvents(deps: BridgeDeps): Array<() => void> {
  const disposers: Array<() => void> = [];

  const memberOf = async (sessionId: string): Promise<{ id: string; teamId: string } | undefined> => {
    let found: { id: string; teamId: string } | undefined;
    for (const team of await deps.service.listTeams()) {
      if (team.leadSessionId === sessionId) continue;
      const member = await deps.service.memberBySession(team.id, sessionId);
      if (member !== undefined) {
        if (found !== undefined && found.teamId !== member.teamId) return undefined;
        found = member;
      }
    }
    return found;
  };

  disposers.push(
    deps.ctx.on('agent/status', (payload: { agent: Agent; status: 'idle' | 'running' }) => {
      void (async () => {
        const sessionId = payload.agent.id;
        const member = await memberOf(sessionId);
        if (member === undefined) return;
        const patch = payload.status === 'running' ? { status: 'working' as const } : { status: 'idle' as const };
        await deps.service.updateMemberFromRuntime(member.id, patch);
        await deps.service.retryPendingMessages(member.teamId, sessionId);
      })().catch(() => undefined);
    }),
  );

  disposers.push(
    deps.ctx.on('subagent/end', (info: SubagentRunEndInfo) => {
      void (async () => {
        const sessionId = info.id;
        const member = await memberOf(sessionId);
        if (member === undefined) return;
        // `subagent/end` closes one run/activation epoch, not a continuable
        // teammate session. The continuation manager owns child disposal;
        // normal completion returns the teammate to idle and the service
        // preserves working/blocked when it still owns a task.
        const status = info.stopReason === 'error' || info.stopReason === 'aborted' ? 'failed' as const : 'idle' as const;
        await deps.service.updateMemberFromRuntime(member.id, { status });
        if (status === 'idle') await deps.service.retryPendingMessages(member.teamId, sessionId);
      })().catch(() => undefined);
    }),
  );

  return disposers;
}

export function knownEventNames(): readonly string[] {
  return ALL_EVENTS;
}
