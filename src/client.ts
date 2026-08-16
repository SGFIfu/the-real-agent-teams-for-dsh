/**
 * dsh-agent-teams — Animated AI Team Command Center (client module).
 *
 * Renders the team as a living workspace: agent nodes with status motion,
 * event-driven message particles, a dependency task graph, a live activity
 * feed + timeline, and an Agent Inspector drawer (real sessions via the
 * Harness session viewer, team messages, tasks, file claims, send-message
 * and interrupt controls). All data is REAL — snapshots from the host
 * `/agent-teams/*` routes, push events over the SSE stream.
 *
 * Respects `prefers-reduced-motion`, keyboard navigation and the Harness
 * theme tokens. No fake activity: animations only fire for real events.
 * @module dsh-agent-teams/client
 */
import {
  diffSnapshots,
  filterActivity,
  layeredGraph,
  normalizeSnapshot,
  prefersReducedMotion,
  pushBuffer,
  rawEventToUiEvent,
  roleAvatar,
  statusCounts,
  statusMeta,
  taskStatusMeta,
  teamIdFromHash,
  type BufferedActivity,
  type ActivityFilter,
  type UiSnapshot,
} from './client/logic/control.ts';
import { projectVisibleSession, subagentAddressFromCatalog, type SafeSessionSnapshot } from './client/logic/session.ts';

/** Minimal typed surface of the React runtime provided by the client shell. */
declare namespace React {
  function useState<S>(initial: S | (() => S)): [S, (update: S | ((prev: S) => S)) => void];
  function useState<S = undefined>(): [S | undefined, (update: S | undefined | ((prev: S | undefined) => S | undefined)) => void];
  function useEffect(effect: () => void | (() => void), deps?: unknown[]): void;
  function useMemo<T>(factory: () => T, deps: unknown[]): T;
  function useRef<T>(initial: T): { current: T };
  function createElement(type: any, props?: Record<string, unknown> | null, ...children: unknown[]): any;
  const Fragment: any;
}
declare const styles: { insert(css: string): () => void } | undefined;

/** Cordis timer when available (fiber-owned); browser fallback otherwise. */
function timerOf(ctx: any): { timeout(cb: () => void, ms: number): () => void; interval(cb: () => void, ms: number): () => void } {
  // `ctx.timer` is dependency-gated by Cordis and direct optional access still
  // throws when `timer` is not declared. `get()` is the supported optional
  // lookup; use the browser fallback only when the host has no timer service.
  const service = typeof ctx?.get === 'function' ? ctx.get('timer') : undefined;
  if (service !== undefined && typeof service.interval === 'function' && typeof service.timeout === 'function') return service;
  return {
    timeout: (cb, ms) => {
      const h = setTimeout(cb, ms);
      return () => clearTimeout(h);
    },
    interval: (cb, ms) => {
      const h = setInterval(cb, ms);
      return () => clearInterval(h);
    },
  };
}

export interface Bridge {
  listTeams(): Promise<Array<{ id: string; name?: string; goal?: string; status?: string }>>;
  snapshot(teamId: string): Promise<any>;
  subscribe(cb: (event: any) => void, state?: (state: 'connected' | 'reconnecting') => void): () => void;
  sendMessage(teamId: string, toSessionId: string | undefined, body: string): Promise<any>;
  approvePlan(teamId: string, planId: string): Promise<any>;
  rejectPlan(teamId: string, planId: string, feedback: string): Promise<any>;
  interrupt(teamId: string, sessionId: string): Promise<any>;
  removeMember(teamId: string, memberId: string): Promise<any>;
}

type SessionBindingLike = { session: { getSnapshot(): unknown; subscribe(listener: () => void): () => void } };

/**
 * The web session service has had two catalog shapes across Harness builds:
 * a reactive `list.getSnapshot()` facade and a direct `listChildren()` method.
 * Keep the compatibility code here, at the client boundary, and never fall
 * back to the host trajectory viewer (`sessions.open()`), which is not a
 * privacy-safe surface for Agent Teams.
 */
export async function resolvePublicSubagentAddress(
  sessions: unknown,
  parentSessionId: string | undefined,
  childSessionId: string,
): Promise<unknown> {
  if (sessions === null || typeof sessions !== 'object' || parentSessionId === undefined) return undefined;
  const service = sessions as Record<string, any>;
  const list = service.list as Record<string, any> | undefined;
  const directAddress = typeof service.subagentAddress === 'function'
    ? service.subagentAddress(childSessionId)
    : typeof list?.subagentAddress === 'function'
      ? list.subagentAddress(childSessionId)
      : undefined;
  if (directAddress !== undefined) return directAddress;

  const childListers: Array<{ owner: any; fn: (parent: string) => Promise<unknown> | unknown }> = [];
  for (const owner of [service, service.subagents, service.subagentRuntime, list]) {
    if (owner !== undefined && typeof owner.listChildren === 'function') childListers.push({ owner, fn: owner.listChildren });
  }
  for (const candidate of childListers) {
    try {
      const entries = await candidate.fn.call(candidate.owner, parentSessionId);
      const address = subagentAddressFromCatalog(parentSessionId, childSessionId, Array.isArray(entries) ? entries : undefined);
      if (address !== undefined) return address;
    } catch {
      // A missing optional client catalog must not prevent the retained
      // `binding(member.sessionId)` from being used below.
    }
  }

  const refreshers: Array<{ owner: any; fn: (parent: string) => Promise<unknown> | unknown }> = [];
  for (const owner of [service, list]) {
    if (owner === undefined) continue;
    for (const name of ['refreshSubagents', 'refreshChildren', 'refresh']) {
      if (typeof owner[name] === 'function') refreshers.push({ owner, fn: owner[name] });
    }
  }
  for (const candidate of refreshers) {
    try {
      await candidate.fn.call(candidate.owner, parentSessionId);
      const address = subagentAddressFromSnapshot(service, list, parentSessionId, childSessionId);
      if (address !== undefined) return address;
    } catch {
      // Try the next official catalog source; address resolution is best effort.
    }
  }
  return subagentAddressFromSnapshot(service, list, parentSessionId, childSessionId);
}

function subagentAddressFromSnapshot(
  service: Record<string, any>,
  list: Record<string, any> | undefined,
  parentSessionId: string,
  childSessionId: string,
): unknown {
  const snapshots: unknown[] = [];
  for (const owner of [list, service]) {
    if (owner !== undefined && typeof owner.getSnapshot === 'function') {
      try { snapshots.push(owner.getSnapshot()); } catch { /* optional facade */ }
    }
  }
  for (const snapshot of snapshots) {
    if (snapshot === null || typeof snapshot !== 'object') continue;
    const record = snapshot as Record<string, any>;
    const grouped = record.subagentsByParent?.[parentSessionId];
    const entries = Array.isArray(grouped) ? grouped : grouped !== null && typeof grouped === 'object' && Array.isArray(grouped.entries) ? grouped.entries : undefined;
    const address = subagentAddressFromCatalog(parentSessionId, childSessionId, entries);
    if (address !== undefined) return address;
  }
  return undefined;
}

/** Open only the explicit public child-session surface, never the host viewer. */
export async function openPublicSubagent(sessions: unknown, address: unknown): Promise<boolean> {
  if (sessions === null || typeof sessions !== 'object' || address === undefined) return false;
  const service = sessions as Record<string, any>;
  const list = service.list as Record<string, any> | undefined;
  for (const owner of [service, list]) {
    if (owner === undefined) continue;
    for (const name of ['openSubagent', 'openChildSubagent']) {
      if (typeof owner[name] !== 'function') continue;
      try {
        await owner[name](address);
        return true;
      } catch {
        // Continue to the next compatible explicit public opener.
      }
    }
  }
  return false;
}

/** Resolve a retained real binding by the persisted Harness session id. */
export function sessionBindingFor(sessions: unknown, sessionId: string): SessionBindingLike | undefined {
  if (sessions === null || typeof sessions !== 'object') return undefined;
  const service = sessions as Record<string, any>;
  if (typeof service.binding !== 'function') return undefined;
  try {
    const binding = service.binding(sessionId);
    return binding !== undefined && binding.session !== undefined ? binding as SessionBindingLike : undefined;
  } catch {
    return undefined;
  }
}

/** A successful delivery is the only message event allowed to fly. */
export function messageDeliverySucceeded(message: { deliveryState?: string } | undefined): boolean {
  return message?.deliveryState !== 'failed';
}

export function isFailedMessageFrame(frame: unknown): boolean {
  if (frame === null || typeof frame !== 'object') return false;
  const value = frame as Record<string, any>;
  if (value.type === 'agent-teams/message-delivery-failed') return true;
  const message = value.message;
  return value.type === 'agent-teams/message-sent' && message !== null && typeof message === 'object' && message.deliveryState === 'failed';
}

export function shouldAnimateMessage(eventId: string, messages: readonly { id: string; deliveryState?: string }[], frame?: unknown): boolean {
  if (isFailedMessageFrame(frame)) return false;
  const messageId = eventId.startsWith('msg-') ? eventId.slice(4).replace(/-failed$/, '') : eventId;
  return messageDeliverySucceeded(messages.find((message) => message.id === messageId));
}

interface Animation {
  id: string;
  kind: string;
  fromSessionId?: string;
  targetSessionId?: string;
  label: string;
  until: number;
}

const CSS = `
.agc-overlay { position: fixed; inset: 0; z-index: 8990; pointer-events: none; }
.agc-surface { --agc-bg: #0b0d10; --agc-panel: #11151a; --agc-card: #161b22; --agc-border: #2a2f36; --agc-text: #f0f3f6; --agc-muted: #9aa0a6; --agc-input: #0b0d10; position: fixed; inset: 0; z-index: 2147483000; background: var(--agc-bg); pointer-events: auto; display: flex; flex-direction: column; color: var(--agc-text); font-size: 13px; }
/* Harness theme bootstrap owns body[data-ds-dark-theme]. Keep the panel
 * aligned with that source of truth instead of maintaining a second theme
 * preference inside the plugin. */
body:not([data-ds-dark-theme]) .agc-surface, [data-agc-theme="light"], body[data-theme="light"] .agc-surface, html[data-theme="light"] .agc-surface, [data-ds-theme="light"] .agc-surface { --agc-bg: #f6f8fa; --agc-panel: #ffffff; --agc-card: #ffffff; --agc-border: #d0d7de; --agc-text: #1f2328; --agc-muted: #57606a; --agc-input: #ffffff; }
.agc-overlay { z-index: 2147483000; }
.agc-teamlist { display: flex; flex-direction: column; gap: 10px; padding: 18px; overflow: auto; }
.agc-teamrow { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; border: 1px solid var(--agc-border); border-radius: 12px; padding: 12px; background: var(--agc-card); color: inherit; cursor: pointer; }
.agc-teamrow:hover, .agc-teamrow:focus-visible { border-color: #58a6ff; outline: none; }
.agc-connection { font-size: 10px; letter-spacing: .06em; color: #3fb950; }
.agc-connection.reconnecting { color: #d29922; }
.agc-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--agc-border); flex-wrap: wrap; }
.agc-title { font-size: 16px; font-weight: 700; }
.agc-goal { opacity: .7; font-size: 12px; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agc-status { border-radius: 12px; padding: 2px 10px; font-size: 11px; font-weight: 700; letter-spacing: .06em; }
.agc-progress { flex: 1; min-width: 140px; height: 8px; border-radius: 4px; background: var(--agc-panel); border: 1px solid var(--agc-border); overflow: hidden; }
.agc-progressfill { height: 100%; background: #3fb950; transition: width .6s ease; }
.agc-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.agc-chip { border: 1px solid var(--agc-border); border-radius: 12px; padding: 2px 8px; font-size: 11px; cursor: pointer; background: transparent; color: inherit; }
.agc-close { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.agc-body { flex: 1; display: flex; min-height: 0; }
.agc-main { flex: 1; overflow: auto; padding: 14px; display: flex; flex-direction: column; gap: 14px; position: relative; }
.agc-side { width: 340px; border-left: 1px solid var(--agc-border); display: flex; flex-direction: column; min-height: 0; }
.agc-panel { padding: 10px 12px; border-bottom: 1px solid var(--agc-border); }
.agc-paneltitle { font-size: 11px; font-weight: 700; letter-spacing: .08em; opacity: .7; margin-bottom: 6px; }
.agc-workspace { position: relative; border: 1px solid var(--agc-border); border-radius: 12px; padding: 18px; min-height: 220px; }
.agc-agents { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; align-items: flex-start; }
.agc-leadrow { width: 100%; display: flex; justify-content: center; margin-bottom: 10px; }
.agc-node { position: relative; width: 150px; border: 1px solid var(--agc-border); border-radius: 12px; padding: 10px; cursor: pointer; background: var(--agc-card); text-align: center; outline: none; transition: border-color .25s ease, box-shadow .25s ease, opacity .25s ease; color: inherit; font: inherit; }
.agc-node:focus-visible { border-color: #58a6ff; box-shadow: 0 0 0 2px rgba(88,166,255,.4); }
.agc-node:hover { border-color: #58a6ff; }
.agc-avatar { font-size: 26px; }
.agc-name { font-weight: 700; margin-top: 2px; }
.agc-role { opacity: .65; font-size: 11px; }
.agc-statusrow { margin-top: 6px; display: flex; justify-content: center; align-items: center; gap: 4px; }
.agc-status { font-size: 10px; font-weight: 700; letter-spacing: .08em; }
.agc-task { margin-top: 4px; font-size: 11px; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agc-minibar { height: 3px; border-radius: 2px; background: #2a2f36; margin-top: 6px; overflow: hidden; }
.agc-minifill { height: 100%; background: #58a6ff; transition: width .8s ease; }
.st-working { color: #58a6ff; }
.st-thinking { color: #d29922; }
.st-blocked { color: #f85149; }
.st-reviewing { color: #bc8cff; }
.st-idle { color: #9aa0a6; }
.st-waiting { color: #9aa0a6; }
.st-completed { color: #3fb950; }
.st-failed { color: #f85149; }
.agc-pulse { animation: agcPulse 1.8s ease-in-out infinite; }
.agc-pulse-fast { animation: agcPulse 1.1s ease-in-out infinite; }
@keyframes agcPulse { 0%,100% { opacity: 1; } 50% { opacity: .55; } }
.agc-msgparticle { position: fixed; width: 6px; height: 6px; border-radius: 50%; background: #58a6ff; z-index: 9050; animation: agcTravel 1.8s ease-in forwards; pointer-events: none; }
.agc-msgparticle-finding { background: #f85149; }
.agc-msgparticle-plan { background: #d29922; }
@keyframes agcTravel { from { transform: translate(0,0); opacity: 1; } to { transform: translate(var(--dx, 0), var(--dy, 0)); opacity: 0; } }
.agc-msglabel { position: fixed; font-size: 11px; border: 1px solid #2a2f36; border-radius: 8px; padding: 3px 8px; background: #000; color: #fff; z-index: 9051; animation: agcFade 1.8s ease-in forwards; pointer-events: none; max-width: 220px; }
@keyframes agcFade { 0% { opacity: 0; } 12% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
.agc-taskgraph { border: 1px solid var(--agc-border); border-radius: 12px; padding: 14px; overflow: auto; }
.agc-graphrow { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 8px 0; position: relative; }
.agc-graphconn { text-align: center; color: #9aa0a6; font-size: 12px; margin: -4px 0; }
.agc-tasknode { border: 1px solid var(--agc-border); border-radius: 8px; padding: 6px 10px; font-size: 12px; background: var(--agc-card); min-width: 130px; transition: border-color .3s ease, opacity .3s ease; }
.agc-tasknode.blocked { border-color: #f85149; }
.agc-taskowner { font-size: 10px; opacity: .7; }
.agc-depedge { display: block; text-align: center; color: #58a6ff; font-size: 12px; animation: agcFade 1.6s ease-in forwards; }
.agc-feed { flex: 1; overflow: auto; padding: 8px 10px; }
.agc-feeditem { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 12px; border-bottom: 1px solid var(--agc-border); }
.agc-feeditem:hover { background: #111; }
body:not([data-ds-dark-theme]) .agc-feeditem:hover { background: #eef2f6; }
.agc-feedtime { opacity: .5; font-size: 10px; margin-right: 6px; }
.agc-filters { display: flex; gap: 4px; padding: 6px 10px; flex-wrap: wrap; }
.agc-filter { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 10px; font-size: 10px; padding: 2px 8px; cursor: pointer; }
.agc-filter.on { background: #1c2c45; border-color: #58a6ff; color: #dbeafe; }
.agc-banner { margin-bottom: 10px; border: 1px solid var(--agc-border); border-radius: 10px; padding: 10px 12px; }
.agc-banner.plan { border-color: #d29922; }
.agc-banner.block { border-color: #f85149; }
.agc-banner.done { border-color: #3fb950; }
.agc-drawer { position: fixed; top: 0; right: 0; bottom: 0; width: min(460px, 96vw); background: var(--agc-bg); border-left: 1px solid var(--agc-border); z-index: 2147483005; display: flex; flex-direction: column; pointer-events: auto; }
.agc-drawerhead { display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--agc-border); }
.agc-drawerbody { flex: 1; overflow: auto; padding: 12px 14px; }
.agc-tabs { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 10px; }
.agc-tab { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 8px; font-size: 11px; padding: 4px 10px; cursor: pointer; }
.agc-tab.on { background: #1c2c45; border-color: #58a6ff; color: #dbeafe; }
.agc-card { border: 1px solid var(--agc-border); border-radius: 10px; padding: 10px; margin-bottom: 10px; background: var(--agc-card); }
.agc-kv { display: flex; justify-content: space-between; font-size: 12px; padding: 2px 0; }
.agc-input { width: 100%; box-sizing: border-box; background: var(--agc-input); color: var(--agc-text); border: 1px solid var(--agc-border); border-radius: 8px; padding: 8px; font-size: 12px; }
.agc-btn { border: 1px solid var(--agc-border); background: transparent; color: inherit; border-radius: 8px; padding: 6px 12px; font-size: 12px; cursor: pointer; }
.agc-btn.primary { background: #1c2c45; border-color: #58a6ff; }
.agc-btn.danger { border-color: #f85149; color: #f85149; }
.agc-confirm { border: 1px solid #f85149; border-radius: 8px; padding: 8px; font-size: 12px; margin-top: 8px; }
.agc-tool { border: 1px solid var(--agc-border); border-radius: 8px; padding: 4px 8px; font-size: 11px; margin: 3px 0; }
.agc-empty { opacity: .6; font-size: 12px; padding: 14px; text-align: center; }
.agc-skeleton { height: 12px; border-radius: 6px; background: #1a1a1a; animation: agcPulse 1.4s ease-in-out infinite; margin: 6px 0; }
body:not([data-ds-dark-theme]) .agc-skeleton { background: #e1e7ee; }
.agc-observe { display: flex; gap: 10px; overflow: auto; }
.agc-observecol { flex: 1; min-width: 180px; border: 1px solid var(--agc-border); border-radius: 10px; padding: 8px; font-size: 11px; }
.agc-session-feed { max-height: 42vh; overflow: auto; border: 1px solid var(--agc-border); border-radius: 10px; padding: 8px; }
.agc-session-row { padding: 8px; border-bottom: 1px solid var(--agc-border); white-space: pre-wrap; overflow-wrap: anywhere; }
.agc-session-kind { font-size: 10px; color: var(--agc-muted); letter-spacing: .06em; margin-bottom: 3px; }
.agc-follow { border: 1px solid #58a6ff; border-radius: 8px; padding: 2px 8px; font-size: 10px; color: #58a6ff; cursor: pointer; }
.agc-newmsg { position: absolute; top: -8px; right: -8px; background: #1c2c45; border: 1px solid #58a6ff; color: #58a6ff; border-radius: 10px; font-size: 10px; padding: 0 6px; }
.agc-hideflow { opacity: .45; }
@media (prefers-reduced-motion: reduce) {
  .agc-pulse, .agc-pulse-fast, .agc-msgparticle, .agc-msglabel, .agc-depedge { animation: none !important; }
  .agc-progressfill, .agc-minifill { transition: none !important; }
}
@media (max-width: 700px) {
  .agc-head { gap: 7px; padding: 8px 10px; }
  .agc-title { font-size: 14px; }
  .agc-goal { max-width: 100%; width: 100%; }
  .agc-body { flex-direction: column; overflow: auto; min-height: 0; }
  .agc-main { flex: none; min-height: 48vh; padding: 10px; }
  .agc-side { width: 100%; flex: none; height: 260px; min-height: 220px; border-left: 0; border-top: 1px solid var(--agc-border); }
  .agc-node { width: 132px; }
  .agc-workspace { overflow: auto; }
  .agc-drawer { width: 100vw; border-left: 0; }
  .agc-session-feed { max-height: 48vh; }
}
@media (max-width: 380px) {
  .agc-head { align-items: flex-start; }
  .agc-progress { order: 5; flex-basis: 100%; min-width: 0; }
  .agc-node { width: calc(50vw - 30px); min-width: 118px; }
  .agc-workspace { padding: 10px; }
  .agc-drawerhead { padding: 10px; }
  .agc-drawerbody { padding: 10px; }
}
`;

/**
 * Static client bundles do not receive the dynamic runner's `styles` closure.
 * Mirror the Harness client packages by owning a marked style tag in the
 * document head and returning a disposer for plugin unload/HMR.
 */
function installStaticCss(): () => void {
  if (typeof document === 'undefined') return () => {};
  const pluginCssId = 'dsh-agent-teams/command-center';
  const existing = document.querySelector(`style[data-plugin-css="${pluginCssId}"]`);
  if (existing !== null) return () => {};
  const tag = document.createElement('style');
  tag.dataset.plugin = 'dsh-agent-teams';
  tag.dataset.pluginCss = pluginCssId;
  tag.textContent = CSS;
  document.head.appendChild(tag);
  return () => {
    if (tag.parentNode !== null) tag.parentNode.removeChild(tag);
  };
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function AgentNode(props: { member: any; snapshot: UiSnapshot; onOpen: (sessionId: string) => void; reduced: boolean }): any {
  const { member, snapshot, onOpen, reduced } = props;
  const meta = statusMeta(member.status);
  const currentTask = snapshot.tasks.find((t) => t.id === member.currentTaskId);
  const doneBy = snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId && t.status === 'completed').length;
  const pulse = member.status === 'thinking' || member.status === 'starting' ? 'agc-pulse' : member.status === 'working' ? (reduced ? '' : 'agc-pulse-fast') : '';
  return React.createElement(
    'button',
    {
      className: `agc-node ${member.status === 'idle' || member.status === 'completed' || member.status === 'stopped' ? 'agc-hideflow' : ''}`,
      onClick: () => onOpen(member.sessionId),
      tabIndex: 0,
      'aria-label': `${member.name} (${member.role}), ${meta.label}`,
      key: member.id,
    },
    React.createElement('div', { className: 'agc-avatar' }, roleAvatar(member.role)),
    React.createElement('div', { className: 'agc-name' }, member.name),
    React.createElement('div', { className: 'agc-role' }, member.role),
    React.createElement('div', { className: 'agc-statusrow' }, React.createElement('span', { className: `agc-status ${meta.css} ${pulse}` }, `${meta.icon} ${meta.label}`)),
    React.createElement('div', { className: 'agc-task' }, currentTask ? currentTask.title : doneBy > 0 ? `✓ ${doneBy} done` : '—'),
    React.createElement('div', { className: 'agc-minibar' }, React.createElement('div', { className: 'agc-minifill', style: { width: currentTask ? '70%' : '12%' } })),
  );
}

function MessageLayer(props: { animations: Animation[]; members: UiSnapshot['members'] }): any {
  const { animations } = props;
  const nodes = typeof document !== 'undefined' ? Array.from(document.querySelectorAll('[data-agc-session]')) : [];
  const pos = (sessionId?: string): { x: number; y: number } => {
    const el = nodes.find((n) => (n as HTMLElement).dataset.agcSession === sessionId) as HTMLElement | undefined;
    if (el !== undefined) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: -100, y: -100 };
  };
  return React.createElement(
    React.Fragment,
    null,
    animations.map((a) => {
      const from = pos(a.fromSessionId);
      const to = pos(a.targetSessionId);
      if (a.targetSessionId === undefined || from.x < 0 || to.x < 0) {
        return React.createElement('div', { key: a.id, className: 'agc-msglabel', style: { left: '30%', top: '12%' } }, a.label);
      }
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      return React.createElement(
        React.Fragment,
        { key: a.id },
        React.createElement('span', { className: `agc-msgparticle ${a.kind === 'finding' ? 'agc-msgparticle-finding' : a.kind === 'plan' ? 'agc-msgparticle-plan' : ''}`, style: { left: from.x, top: from.y, ['--dx' as any]: `${dx}px`, ['--dy' as any]: `${dy}px` } }),
        React.createElement('span', { className: 'agc-msglabel', style: { left: (from.x + to.x) / 2 - 60, top: (from.y + to.y) / 2 - 12 } }, a.label),
      );
    }),
  );
}

function AgentGraph(props: { snapshot: UiSnapshot; animations: Animation[]; onOpen: (s: string) => void; reduced: boolean }): any {
  const { snapshot, onOpen, animations, reduced } = props;
  const lead = snapshot.members.find((m) => m.role === 'lead');
  const others = snapshot.members.filter((m) => m !== lead);
  return React.createElement(
    'div',
    { className: 'agc-workspace' },
    React.createElement(
      'div',
      { className: 'agc-agents' },
      lead !== undefined &&
        React.createElement(
          'div',
          { className: 'agc-leadrow', 'data-agc-session': lead.sessionId },
          React.createElement(AgentNode, { member: lead, snapshot, onOpen, reduced }),
        ),
      others.map((member: any) =>
        React.createElement(
          'div',
          { 'data-agc-session': member.sessionId, key: member.id },
          React.createElement(AgentNode, { member, snapshot, onOpen, reduced }),
        ),
      ),
      snapshot.members.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No teammates yet. Ask the Lead to spawn the team and they will appear here.'),
    ),
    React.createElement(MessageLayer, { animations, members: snapshot.members }),
  );
}

function TaskGraphPanel(props: { snapshot: UiSnapshot; depFlash: Set<string> }): any {
  const { snapshot, depFlash } = props;
  const rows = layeredGraph(snapshot.tasks);
  const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const memberOf = new Map(snapshot.members.map((m) => [m.sessionId, m.name]));
  return React.createElement(
    'div',
    { className: 'agc-taskgraph' },
    React.createElement('div', { className: 'agc-paneltitle' }, 'TASK GRAPH'),
    rows.map((row, index) =>
      React.createElement(
        React.Fragment,
        { key: index },
        index > 0 && React.createElement('div', { className: 'agc-graphconn' }, '↓'),
        React.createElement(
          'div',
          { className: 'agc-graphrow' },
          row.map((task) => {
            const meta = taskStatusMeta(task.status);
            const blockedBy = task.status === 'blocked' ? task.dependencies.filter((d) => byId.get(d)?.status !== 'completed').map((d) => byId.get(d)?.title ?? d) : [];
            const flash = depFlash.has(task.id);
            return React.createElement(
              'div',
              { className: `agc-tasknode ${task.status}`, key: task.id },
              React.createElement('span', { className: `agc-status ${meta.css}` }, `${meta.icon} `),
              task.title,
              task.ownerSessionId !== undefined && React.createElement('div', { className: 'agc-taskowner' }, `owner: ${memberOf.get(task.ownerSessionId) ?? task.ownerSessionId.slice(0, 8)}`),
              blockedBy.length > 0 && React.createElement('div', { className: 'agc-taskowner' }, `⚠ Blocked by: ${blockedBy.join(', ')}`),
              flash && React.createElement('span', { className: 'agc-depedge' }, '▲ dependency released'),
            );
          }),
        ),
      ),
    ),
    snapshot.tasks.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No tasks created yet.'),
  );
}

function ActivityFeed(props: { activity: BufferedActivity[]; filter: ActivityFilter; onFilter: (f: ActivityFilter) => void; onSelect: (item: BufferedActivity) => void; timeline: boolean }): any {
  const { activity, filter, onFilter, onSelect, timeline } = props;
  const filters: ActivityFilter[] = ['ALL', 'TASKS', 'MESSAGES', 'AGENTS', 'FILES', 'REVIEWS'];
  const items = timeline ? [...activity].reverse() : filterActivity(activity, filter);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      { className: 'agc-filters' },
      filters.map((f) => React.createElement('button', { key: f, className: `agc-filter ${filter === f ? 'on' : ''}`, onClick: () => onFilter(f) }, f)),
    ),
    React.createElement(
      'div',
      { className: 'agc-feed' },
      items.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No activity yet. Team events will appear here in real time.'),
      items.map((item) =>
        React.createElement(
          'div',
          { className: 'agc-feeditem', key: item.id, onClick: () => onSelect(item), tabIndex: 0, role: 'button', 'aria-label': item.title },
          React.createElement('span', { className: 'agc-feedtime' }, fmtTime(item.ts)),
          item.title,
        ),
      ),
    ),
  );
}

function Inspector(props: { snapshot: UiSnapshot; sessionId: string; bridge: Bridge; onClose: () => void; activity: BufferedActivity[]; session?: SafeSessionSnapshot }): any {
  const { snapshot, sessionId, bridge, onClose, activity, session } = props;
  const [tab, setTab] = React.useState('activity');
  const [follow, setFollow] = React.useState(true);
  const [draft, setDraft] = React.useState('');
  const [confirmInterrupt, setConfirmInterrupt] = React.useState(false);
  const [sent, setSent] = React.useState<string | null>(null);
  const sessionFeed = React.useRef<any>(null);
  const member = snapshot.members.find((m) => m.sessionId === sessionId);
  React.useEffect(() => {
    const handler = (event: any) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  React.useEffect(() => {
    const element = sessionFeed.current as HTMLElement | null;
    if (follow && element !== null) element.scrollTop = element.scrollHeight;
  }, [follow, session?.items.length]);
  if (member === undefined) return null;
  const meta = statusMeta(member.status);
  const currentTask = snapshot.tasks.find((t) => t.id === member.currentTaskId);
  const myClaims = snapshot.fileClaims.filter((c) => c.ownerSessionId === member.sessionId);
  const myMessages = snapshot.messages.filter((m) => m.fromSessionId === member.sessionId || m.toSessionId === member.sessionId || m.toSessionId === undefined);
  const myActivity = activity.filter((a) => a.sessionId === member.sessionId || a.targetSessionId === member.sessionId);
  const tabs = ['activity', 'messages', 'tasks', 'files'];
  const send = async () => {
    if (draft.trim() === '') return;
    const result = await bridge.sendMessage(snapshot.teamId, member.sessionId, draft.trim());
    setDraft('');
    setSent(result?.message?.deliveryState === 'failed' ? 'Message delivery failed; see Activity.' : 'Message delivered to the agent session.');
  };
  const memberName = (sid: string): string => snapshot.members.find((m) => m.sessionId === sid)?.name ?? sid.slice(0, 8);
  return React.createElement(
    'div',
    { className: 'agc-drawer', role: 'dialog', 'aria-label': `${member.name} inspector` },
    React.createElement(
      'div',
      { className: 'agc-drawerhead' },
      React.createElement('span', { className: 'agc-avatar' }, roleAvatar(member.role)),
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('div', { className: 'agc-name' }, `${member.name} (${member.role})`),
        React.createElement('span', { className: `agc-status ${meta.css}` }, `${meta.icon} ${meta.label}`),
      ),
      follow && React.createElement('button', { className: 'agc-follow', onClick: () => setFollow(false), 'aria-label': 'Following; click to unfollow' }, '👁 FOLLOWING'),
      follow === false && React.createElement('button', { className: 'agc-follow', onClick: () => setFollow(true) }, 'FOLLOW'),
      React.createElement('button', { className: 'agc-close', onClick: onClose, 'aria-label': 'Close inspector' }, '✕'),
    ),
    React.createElement(
      'div',
      { className: 'agc-drawerbody' },
      React.createElement('div', { className: 'agc-card' },
        React.createElement('div', { className: 'agc-paneltitle' }, 'CURRENT TASK'),
        currentTask !== undefined
          ? React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, currentTask.title), React.createElement('span', { className: `agc-status ${taskStatusMeta(currentTask.status).css}` }, taskStatusMeta(currentTask.status).icon)),
              React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, 'Priority'), React.createElement('span', null, currentTask.priority.toUpperCase())),
              currentTask.dependencies.length > 0 && React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, 'Dependencies'), React.createElement('span', null, currentTask.dependencies.map((d) => { const dep = snapshot.tasks.find((t) => t.id === d); return `${dep?.status === 'completed' ? '✓' : '○'} ${dep?.title ?? d}`; }).join(', '))),
            )
          : React.createElement('div', { className: 'agc-empty' }, 'No current task.'),
      ),
      myClaims.length > 0 && React.createElement('div', { className: 'agc-card' },
        React.createElement('div', { className: 'agc-paneltitle' }, 'FILES CLAIMED'),
        myClaims.map((c) => React.createElement('div', { key: c.id, className: 'agc-tool' }, `${c.kind} ${c.pattern}`)),
      ),
      React.createElement('div', { className: 'agc-tabs' },
        tabs.map((t) => React.createElement('button', { key: t, className: `agc-tab ${tab === t ? 'on' : ''}`, onClick: () => setTab(t) }, t.toUpperCase())),
      ),
      tab === 'activity' && React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'agc-card' },
          React.createElement('div', { className: 'agc-paneltitle' }, 'LIVE SESSION · PRIVACY-SAFE VIEW'),
           React.createElement('div', { style: { fontSize: 11, opacity: .7 } }, session === undefined ? 'Session snapshot unavailable; reconnecting to the real Harness session.' : `${session.running ? '● LIVE' : '○ IDLE'} · ${session.items.length} public events · ${session.openState ?? 'unknown'} · reasoning hidden by typed visibility policy`),
        ),
        React.createElement('div', {
          className: 'agc-session-feed',
          ref: sessionFeed,
          onScroll: (event: any) => {
            const element = event.currentTarget as HTMLElement;
            if (element.scrollTop + element.clientHeight < element.scrollHeight - 24) setFollow(false);
          },
        },
          session?.items.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No public session events yet.'),
          session?.items.map((item) => React.createElement('div', { key: item.id, className: 'agc-session-row' },
            React.createElement('div', { className: 'agc-session-kind' }, item.kind === 'tool-call' ? `⚙ ${item.name ?? 'tool'} · call` : item.kind === 'tool-result' ? `✓ ${item.name ?? 'tool'} · result${item.error ? ' · failed' : ''}` : item.kind.toUpperCase()),
            item.text,
            item.args !== undefined && React.createElement('div', { className: 'agc-tool' }, item.args),
          )),
        ),
        !follow && React.createElement('button', { className: 'agc-follow', onClick: () => setFollow(true) }, '↓ Jump to latest'),
        myActivity.length > 0 && React.createElement('div', { className: 'agc-card' },
          React.createElement('div', { className: 'agc-paneltitle' }, 'TEAM ACTIVITY'),
          myActivity.map((a) => React.createElement('div', { key: a.id, className: 'agc-feeditem' }, React.createElement('span', { className: 'agc-feedtime' }, fmtTime(a.ts)), a.title)),
        ),
      ),
      tab === 'messages' && React.createElement(React.Fragment, null,
        myMessages.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No team messages yet. Messages between teammates will appear here.'),
        myMessages.map((m) => React.createElement('div', { key: m.id, className: 'agc-card' },
          React.createElement('div', { style: { fontSize: 11, opacity: .7 } }, `${memberName(m.fromSessionId)} → ${m.toSessionId === undefined ? 'team' : memberName(m.toSessionId)} · ${fmtTime(m.createdAt)} · ${m.deliveryState ?? 'legacy'}`),
          m.body,
        )),
        React.createElement('div', { className: 'agc-card' },
          React.createElement('input', { className: 'agc-input', value: draft, placeholder: `Message ${member.name}...`, onChange: (event: any) => setDraft(event.target.value), onKeyDown: (event: any) => { if (event.key === 'Enter') void send(); } }),
          React.createElement('button', { className: 'agc-btn primary', style: { marginTop: 6 }, onClick: () => void send() }, 'Send message'),
          sent !== null && React.createElement('div', { style: { fontSize: 11, color: '#3fb950', marginTop: 4 } }, sent),
        ),
      ),
      tab === 'tasks' && React.createElement(React.Fragment, null,
        snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId).length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No tasks owned yet.'),
        snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId).map((t) => React.createElement('div', { key: t.id, className: 'agc-card' },
          React.createElement('span', { className: `agc-status ${taskStatusMeta(t.status).css}` }, `${taskStatusMeta(t.status).icon} ${taskStatusMeta(t.status).label}`),
          ` ${t.title}`,
        )),
        React.createElement('div', { className: 'agc-paneltitle' }, 'AVAILABLE'),
        snapshot.tasks.filter((t) => t.status === 'pending').map((t) => React.createElement('div', { key: t.id, className: 'agc-tool' }, `○ ${t.title}`)),
      ),
      tab === 'files' && React.createElement(React.Fragment, null,
        myClaims.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No file claims for this agent.'),
        myClaims.map((c) => React.createElement('div', { key: c.id, className: 'agc-tool' }, `${c.kind} ${c.pattern}`)),
        React.createElement('div', { style: { fontSize: 11, opacity: .6, marginTop: 6 } }, 'File-level read/edit activity lives in the Harness session view (Activity tab).'),
      ),
      React.createElement('div', { className: 'agc-card' },
        React.createElement('button', { className: 'agc-btn danger', onClick: () => setConfirmInterrupt(true) }, 'Interrupt agent'),
        confirmInterrupt && React.createElement('div', { className: 'agc-confirm' },
          `Interrupt ${member.name}? Its current operation may stop.`,
          React.createElement('div', { style: { marginTop: 6, display: 'flex', gap: 6 } },
            React.createElement('button', { className: 'agc-btn', onClick: () => setConfirmInterrupt(false) }, 'Cancel'),
            React.createElement('button', { className: 'agc-btn danger', onClick: () => { void bridge.interrupt(snapshot.teamId, member.sessionId); setConfirmInterrupt(false); } }, 'Interrupt'),
          ),
        ),
      ),
    ),
  );
}

function CommandCenter(props: { bridge: Bridge; ctx: any; teamId: string; onClose: () => void; onBack?: () => void }): any {
  const { bridge, ctx, teamId, onClose, onBack } = props;
  const timer = timerOf(ctx);
  const [snapshot, setSnapshot] = React.useState<UiSnapshot | null>(null);
  const [activity, setActivity] = React.useState<BufferedActivity[]>([]);
  const [animations, setAnimations] = React.useState<Animation[]>([]);
  const [filter, setFilter] = React.useState<ActivityFilter>('ALL');
  const [timeline, setTimeline] = React.useState(false);
  const [inspector, setInspector] = React.useState<string | null>(null);
  const [depFlash, setDepFlash] = React.useState<Set<string>>(new Set());
  const [observe, setObserve] = React.useState<string[]>([]);
  const [connection, setConnection] = React.useState<'connected' | 'reconnecting'>('reconnecting');
  const [session, setSession] = React.useState<SafeSessionSnapshot | undefined>(undefined);
  const [reduced, setReduced] = React.useState(() => prefersReducedMotion());
  const prevRef = React.useRef<UiSnapshot | undefined>(undefined);
  const streamStateRef = React.useRef<'connected' | 'reconnecting'>('reconnecting');
  const leadSessionId = snapshot?.leadSessionId;

  React.useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  React.useEffect(() => {
    let alive = true;
    let off = () => {};
    let cancelRetry = () => {};
    let retryAttempt = 0;
    const refresh = async (animate = true) => {
      try {
        const raw = await bridge.snapshot(teamId);
        if (!alive) return;
        if (raw?.team?.id !== teamId) throw new Error('team snapshot identity mismatch');
        const next = normalizeSnapshot(raw);
        const prev = prevRef.current;
        const events = diffSnapshots(prev, next, Date.now());
        const fresh = prev === undefined ? events : events.filter((e) => e.kind !== 'member-joined');
        setActivity((buffer) => pushBuffer(buffer, fresh, 300));
        if (animate && prev !== undefined && !reduced) {
          const anims: Animation[] = fresh
            .filter((e) => (e.kind === 'message' || e.kind === 'finding' || e.kind === 'plan-approved' || e.kind === 'plan-rejected') && e.targetSessionId !== undefined)
            .filter((e) => e.kind !== 'message' || shouldAnimateMessage(e.id, next.messages))
            .map((e) => ({ id: e.id, kind: e.kind, fromSessionId: e.sessionId, targetSessionId: e.targetSessionId, label: e.kind === 'message' ? (e.preview ?? 'message') : e.title ?? '', until: Date.now() + 2000 }));
          if (anims.length > 0) setAnimations(anims);
        }
        if (prev !== undefined) {
          const flashed = new Set<string>();
          for (const task of next.tasks) {
            if (task.status !== 'pending') continue;
            const prevTask = prev.tasks.find((t) => t.id === task.id);
            if (prevTask !== undefined && prevTask.status === 'pending' && task.dependencies.some((d) => prev.tasks.find((t) => t.id === d)?.status !== 'completed' && next.tasks.find((t) => t.id === d)?.status === 'completed')) flashed.add(task.id);
          }
          if (flashed.size > 0) { setDepFlash(flashed); timer.timeout(() => setDepFlash(new Set()), 1800); }
        }
        prevRef.current = next;
        setSnapshot(next);
        if (streamStateRef.current === 'connected') setConnection('connected');
      } catch {
        streamStateRef.current = 'reconnecting';
        setConnection('reconnecting');
      }
    };
    const scheduleReconnect = () => {
      cancelRetry();
      const delay = Math.min(5000, 500 * 2 ** retryAttempt);
      retryAttempt = Math.min(retryAttempt + 1, 4);
      cancelRetry = timer.timeout(() => {
        void (async () => {
          await refresh(false);
          if (!alive) return;
          off = bridge.subscribe(onFrame, onStreamState);
        })();
      }, delay);
    };
    const onStreamState = (state: 'connected' | 'reconnecting') => {
      if (!alive) return;
      streamStateRef.current = state;
      setConnection(state);
      if (state === 'reconnecting') { off(); scheduleReconnect(); }
      else retryAttempt = 0;
    };
    const onFrame = (frame: any) => {
      if (!alive) return;
      const ui = rawEventToUiEvent(frame, Date.now());
      if (ui === undefined || ui.teamId !== teamId) return;
      setActivity((buffer) => pushBuffer(buffer, [ui], 300));
      if (!reduced && (ui.kind === 'message' || ui.kind === 'finding' || ui.kind === 'plan-approved' || ui.kind === 'plan-rejected') && (ui.kind !== 'message' || !isFailedMessageFrame(frame))) {
        setAnimations((a) => [...a.filter((x) => x.until > Date.now()), { id: ui.id, kind: ui.kind, fromSessionId: ui.sessionId, targetSessionId: ui.targetSessionId, label: ui.kind === 'message' ? (ui.preview ?? 'message') : ui.title ?? '', until: Date.now() + 2000 }]);
      }
      void refresh(true);
    };
    void (async () => { await refresh(false); if (alive) off = bridge.subscribe(onFrame, onStreamState); })();
    const id = timer.interval(() => void refresh(true), 2000);
    const prune = timer.interval(() => setAnimations((a) => a.filter((x) => x.until > Date.now())), 400);
    return () => { alive = false; off(); cancelRetry(); id(); prune(); };
  }, [teamId, reduced]);

  React.useEffect(() => {
    let alive = true;
    let off = () => {};
    if (inspector === null) { setSession(undefined); return () => { alive = false; }; }
    let sessions: unknown;
    try { sessions = ctx.get('sessions'); } catch { sessions = undefined; }
    const hydrate = async () => {
      // A child can be durable in the host while its catalog address has not
      // been pulled into this browser scope yet. Refresh the lead's official
      // catalog before resolving the child; no native trajectory viewer is
      // opened, and the resulting snapshot still passes through our typed
      // public-event projection below.
      // A retained binding is only a scope handle. It does not mean that the
      // child history window is staged/open. Always resolve the catalog address
      // and call the official openSubagent() path before reading the snapshot;
      // otherwise a real child can remain in its cold empty projection forever.
      const address = await resolvePublicSubagentAddress(sessions, leadSessionId, inspector);
      if (!alive) return;
      if (address !== undefined) await openPublicSubagent(sessions, address);
      const binding = sessionBindingFor(sessions, inspector);
      if (!alive || binding === undefined) { setSession(undefined); return; }
      const update = () => setSession(projectVisibleSession(binding!.session.getSnapshot()));
      update();
      off = binding.session.subscribe(update);
    };
    void hydrate();
    return () => { alive = false; off(); };
  }, [ctx, inspector, leadSessionId]);

  if (snapshot === null) {
    return React.createElement('div', { className: 'agc-surface' },
      React.createElement('div', { className: 'agc-main' },
        [0, 1, 2, 3].map((i) => React.createElement('div', { key: i, className: 'agc-skeleton', style: { width: `${80 - i * 15}%` } })),
      ),
    );
  }
  const counts = statusCounts(snapshot.members);
  const submittedPlans = snapshot.plans.filter((p) => p.status === 'submitted');
  const blockers = snapshot.progress.blocked;
  const openFindings = snapshot.findings.filter((f) => f.state === 'open');
  const memberName = (sid: string): string => snapshot.members.find((m) => m.sessionId === sid)?.name ?? sid.slice(0, 8);

  const openInspector = (sessionId: string) => {
    setInspector(sessionId);
    setObserve([]);
  };
  const onSelectActivity = (item: BufferedActivity) => {
    if (item.sessionId !== undefined && snapshot.members.some((m) => m.sessionId === item.sessionId)) setInspector(item.sessionId);
  };

  return React.createElement('div', { className: 'agc-surface', role: 'region', 'aria-label': 'Agent Teams Command Center', onClick: (event: any) => event.stopPropagation() },
    React.createElement('div', { className: 'agc-head' },
      React.createElement('span', { className: 'agc-title' }, snapshot.teamName.toUpperCase()),
      React.createElement('span', { className: `agc-status ${snapshot.teamStatus === 'completed' ? 'st-completed' : snapshot.teamStatus === 'active' ? 'st-working' : 'st-idle'}` }, `${snapshot.teamStatus === 'active' ? '●' : snapshot.teamStatus === 'completed' ? '✓' : '○'} ${snapshot.teamStatus.toUpperCase()}`),
      React.createElement('div', { className: 'agc-progress' }, React.createElement('div', { className: 'agc-progressfill', style: { width: `${Math.round(snapshot.progress.ratio * 100)}%` } })),
      React.createElement('span', { style: { fontSize: 11, opacity: .8 } }, `${Math.round(snapshot.progress.ratio * 100)}% · ${snapshot.progress.requiredDone} / ${snapshot.progress.requiredTotal} tasks`),
      React.createElement('div', { className: 'agc-chips' },
        Object.entries(counts).map(([status, count]) => React.createElement('button', { key: status, className: 'agc-chip', onClick: () => setInspector(snapshot.members.find((m) => m.status === status)?.sessionId ?? null) }, `${statusMeta(status).icon} ${count} ${status.toUpperCase()}`)),
      ),
      onBack !== undefined && React.createElement('button', { className: 'agc-btn', onClick: onBack }, 'All teams'),
      React.createElement('span', { className: `agc-connection ${connection === 'reconnecting' ? 'reconnecting' : ''}` }, connection === 'connected' ? '● LIVE' : '↻ RECONNECTING…'),
      React.createElement('button', { className: 'agc-btn', onClick: () => setTimeline((v) => !v) }, timeline ? 'Feed' : 'Timeline'),
      React.createElement('button', { className: 'agc-close', onClick: onClose, 'aria-label': 'Close Command Center' }, '✕'),
    ),
    submittedPlans.length > 0 && React.createElement('div', { className: 'agc-banner plan', style: { margin: '0 14px' } },
      React.createElement('div', { className: 'agc-paneltitle' }, 'PLAN REQUIRES REVIEW'),
      submittedPlans.map((p) => {
        const author = snapshot.members.find((m) => m.sessionId === p.authorSessionId);
        const task = snapshot.tasks.find((t) => t.id === p.taskId);
        return React.createElement('div', { key: p.id, style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          React.createElement('span', { style: { fontSize: 12 } }, `${author?.name ?? 'member'} — ${task?.title ?? p.taskId}`),
          React.createElement('button', { className: 'agc-btn primary', onClick: () => void bridge.approvePlan(snapshot.teamId, p.id) }, 'Approve'),
          React.createElement('input', { className: 'agc-input', style: { flex: 1, minWidth: 160 }, placeholder: 'Reject with feedback… (Enter)', onKeyDown: (event: any) => { if (event.key === 'Enter' && event.target.value.trim() !== '') void bridge.rejectPlan(snapshot.teamId, p.id, event.target.value.trim()); } }),
        );
      }),
    ),
    blockers.length > 0 && React.createElement('div', { className: 'agc-banner block', style: { margin: '0 14px' } },
      React.createElement('span', { className: 'agc-status st-blocked' }, `⚠ ${blockers.length} BLOCKER${blockers.length > 1 ? 'S' : ''}`),
      blockers.map((taskId) => { const t = snapshot.tasks.find((x) => x.id === taskId); return React.createElement('div', { key: taskId, style: { fontSize: 12, marginTop: 4 } }, `${t?.title ?? taskId} — owner ${memberName(t?.ownerSessionId ?? '')}`); }),
    ),
    openFindings.length > 0 && React.createElement('div', { className: 'agc-banner block', style: { margin: '0 14px' } },
      React.createElement('span', { className: 'agc-status st-blocked' }, '⚠ REVIEW FINDINGS'),
      openFindings.map((f) => React.createElement('div', { key: f.id, style: { fontSize: 12, marginTop: 3 } }, `${f.severity.toUpperCase()}: ${f.summary}`)),
    ),
    snapshot.teamStatus === 'completed' && React.createElement('div', { className: 'agc-banner done', style: { margin: '0 14px' } },
      React.createElement('span', { className: 'agc-status st-completed' }, `✓ TEAM COMPLETED — ${snapshot.progress.requiredDone} / ${snapshot.progress.requiredTotal} tasks`),
    ),
    React.createElement('div', { className: 'agc-body' },
      React.createElement('div', { className: 'agc-main' },
        observe.length > 0
          ? React.createElement('div', { className: 'agc-observe' },
              observe.map((sessionId) => {
                const m = snapshot.members.find((x) => x.sessionId === sessionId);
                const items = activity.filter((a) => a.sessionId === sessionId).slice(0, 6);
                return React.createElement('div', { className: 'agc-observecol', key: sessionId },
                  React.createElement('div', { className: 'agc-name' }, `${roleAvatar(m?.role ?? '')} ${m?.name ?? sessionId.slice(0, 8)}`),
                  items.map((a) => React.createElement('div', { key: a.id, className: 'agc-feeditem' }, a.title)),
                );
              }),
              React.createElement('button', { className: 'agc-btn', style: { alignSelf: 'flex-start' }, onClick: () => setObserve([]) }, 'Exit observe mode'),
            )
          : React.createElement(React.Fragment, null,
              React.createElement(AgentGraph, { snapshot, animations, onOpen: openInspector, reduced }),
              React.createElement(TaskGraphPanel, { snapshot, depFlash }),
            ),
      ),
      React.createElement('div', { className: 'agc-side' },
        React.createElement('div', { className: 'agc-panel' },
          React.createElement('div', { className: 'agc-paneltitle' }, 'OBSERVE MODE (up to 3)'),
          React.createElement('div', { className: 'agc-chips' },
            snapshot.members.slice(0, 5).map((m) => React.createElement('button', { key: m.id, className: 'agc-chip', onClick: () => setObserve(observe.includes(m.sessionId) ? observe.filter((s) => s !== m.sessionId) : [...observe, m.sessionId].slice(0, 3)) }, `${observe.includes(m.sessionId) ? '◉' : '○'} ${m.name}`)),
          ),
        ),
        React.createElement(ActivityFeed, { activity, filter, onFilter: setFilter, onSelect: onSelectActivity, timeline }),
      ),
    ),
    inspector !== null && React.createElement(Inspector, { snapshot, sessionId: inspector, bridge, onClose: () => setInspector(null), activity, session }),
  );
}

export const inject = ['slots'] as const;

export function apply(ctx: any): void {
  if (typeof React === 'undefined') {
    console.warn('[agent-teams] React runtime unavailable; Command Center disabled');
    return;
  }
  const styleService = typeof styles !== 'undefined' ? styles : undefined;
  const disposers: Array<() => void> = [];
  disposers.push(styleService?.insert(CSS) ?? installStaticCss());

  let csrfToken = '';
  const readResponse = async (res: Response): Promise<any> => {
    const csrf = res.headers.get('X-Agent-Teams-CSRF');
    if (csrf !== null) csrfToken = csrf;
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(String(body?.error ?? `Agent Teams request failed (${res.status})`));
    return body;
  };
  const bridge: Bridge = {
    async listTeams() {
      return (await readResponse(await fetch('/agent-teams/teams', { credentials: 'same-origin' }))) as Array<{ id: string; name?: string; goal?: string; status?: string }>;
    },
    async snapshot(teamId: string) {
      return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/snapshot`, { credentials: 'same-origin' }));
    },
    subscribe(cb, state) {
      let source: EventSource | null = null;
      try {
        source = new EventSource('/agent-teams/stream');
        source.onopen = () => state?.('connected');
        source.onmessage = (message) => {
          try {
            cb(JSON.parse(message.data));
          } catch {
            /* ignore malformed frames */
          }
        };
        source.onerror = () => { state?.('reconnecting'); source?.close(); };
      } catch {
        state?.('reconnecting');
      }
      return () => {
        source?.close();
      };
    },
    async sendMessage(teamId, toSessionId, body) {
      return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/message`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ toSessionId, body }) }));
    },
    async approvePlan(teamId, planId) {
      return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/plan/${encodeURIComponent(planId)}/approve`, { method: 'POST', credentials: 'same-origin', headers: { 'X-Agent-Teams-CSRF': csrfToken } }));
    },
    async rejectPlan(teamId, planId, feedback) {
      return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/plan/${encodeURIComponent(planId)}/reject`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ feedback }) }));
    },
    async interrupt(teamId, sessionId) {
      return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/interrupt`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ sessionId }) }));
    },
    async removeMember(teamId, memberId) {
      return readResponse(await fetch(`/agent-teams/team/${encodeURIComponent(teamId)}/member/remove`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Agent-Teams-CSRF': csrfToken }, body: JSON.stringify({ memberId }) }));
    },
  };

  const slots = (ctx.slots ?? ctx.get('slots')) as { inject(key: string, callback: () => unknown): () => void; register(opts: unknown, render: () => unknown): () => void } | undefined;
  if (slots === undefined) {
    for (const d of disposers) d();
    return;
  }

  function OverlayEntry(): any {
    const [open, setOpen] = React.useState(false);
    const [teams, setTeams] = React.useState<Array<{ id: string; name?: string; goal?: string; status?: string }>>([]);
    const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(() => {
      if (typeof window === 'undefined') return null;
      return teamIdFromHash(window.location.hash);
    });
    const selectTeam = (teamId: string | null) => {
      setSelectedTeamId(teamId);
      if (typeof window !== 'undefined') {
        const suffix = teamId === null ? `${window.location.pathname}${window.location.search}` : `${window.location.pathname}${window.location.search}#agent-team=${encodeURIComponent(teamId)}`;
        window.history.replaceState(null, '', suffix);
      }
    };
    React.useEffect(() => {
      if (typeof window === 'undefined') return;
      const syncFromLocation = () => setSelectedTeamId(teamIdFromHash(window.location.hash));
      window.addEventListener('hashchange', syncFromLocation);
      window.addEventListener('popstate', syncFromLocation);
      return () => {
        window.removeEventListener('hashchange', syncFromLocation);
        window.removeEventListener('popstate', syncFromLocation);
      };
    }, []);
    React.useEffect(() => {
      let alive = true;
      const refresh = async () => {
        try {
          const list = await bridge.listTeams();
          if (alive) setTeams(list);
        } catch {
          /* keep last */
        }
      };
      void refresh();
      const id = timerOf(ctx).interval(() => void refresh(), 5000);
      return () => {
        alive = false;
        id();
      };
    }, []);
    const selectedExists = selectedTeamId !== null && teams.some((team) => team.id === selectedTeamId);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { className: 'agc-btn', onClick: () => setOpen((v: boolean) => !v) }, open ? 'Close Teams' : 'Teams'),
      open && selectedTeamId !== null && selectedExists && React.createElement(CommandCenter, { bridge, ctx, teamId: selectedTeamId, onBack: () => selectTeam(null), onClose: () => setOpen(false) }),
      open && selectedTeamId !== null && !selectedExists && React.createElement('div', { className: 'agc-drawer', role: 'dialog' },
        React.createElement('div', { className: 'agc-drawerhead' }, React.createElement('span', { className: 'agc-title' }, 'Agent Teams'), React.createElement('button', { className: 'agc-close', onClick: () => setOpen(false) }, '✕')),
        React.createElement('div', { className: 'agc-drawerbody' }, teams.length === 0 ? React.createElement('div', { className: 'agc-empty' }, 'Loading teams…') : React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'agc-banner block' }, `Team not found: ${selectedTeamId}`),
          React.createElement('button', { className: 'agc-btn', onClick: () => selectTeam(null) }, 'Back to team list'),
        ))),
      open && selectedTeamId === null && React.createElement('div', { className: 'agc-drawer', role: 'dialog', 'aria-label': 'Agent Teams' },
        React.createElement('div', { className: 'agc-drawerhead' }, React.createElement('span', { className: 'agc-title' }, 'Agent Teams'), React.createElement('button', { className: 'agc-close', onClick: () => setOpen(false) }, '✕')),
        React.createElement('div', { className: 'agc-teamlist' },
          teams.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No teams yet. Ask the Lead agent to create one.'),
          teams.map((team) => React.createElement('button', { key: team.id, className: 'agc-teamrow', onClick: () => selectTeam(team.id) },
            React.createElement('span', { className: 'agc-avatar' }, '🧩'),
            React.createElement('span', { style: { flex: 1 } },
              React.createElement('div', { className: 'agc-name' }, team.name ?? team.id),
              React.createElement('div', { className: 'agc-role' }, `${team.status ?? 'active'} · ${team.goal ?? team.id}`),
            ),
            React.createElement('span', null, '→'),
          )),
        )),
    );
  }

  ctx.effect(() => {
    return slots.register({ name: 'sidebar.footer.action', id: 'agent-teams-toggle', label: 'Agent Teams' }, () => React.createElement(OverlayEntry));
  }, 'agent-teams: sidebar action');

  ctx.effect(() => () => {
    for (const dispose of [...disposers].reverse()) dispose();
  });
}
