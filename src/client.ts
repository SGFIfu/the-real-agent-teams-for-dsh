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
  type UiTask,
  type UiMember,
} from './client/logic/control.ts';
import { projectVisibleSession, subagentAddressFromCatalog, type SafeSessionItem, type SafeSessionSnapshot } from './client/logic/session.ts';
import {
  parseLanguage,
  parseOverridesByLanguage,
  resolveLabels,
  type UiLabelOverrides,
  type UiLabelOverridesByLanguage,
  type UiLabels,
  type UiLanguage,
} from './client/logic/locale.ts';

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

const CSS = `.agc-overlay{position:fixed;inset:0;z-index:8990;pointer-events:none}.agc-surface{--agc-bg:#0b0d10;--agc-panel:#11151a;--agc-card:#161b22;--agc-border:#2a2f36;--agc-text:#f0f3f6;--agc-muted:#9aa0a6;--agc-input:#0b0d10;position:fixed;inset:0;z-index:2147483000;background:var(--agc-bg);pointer-events:auto;display:flex;flex-direction:column;color:var(--agc-text);font-size:13px}body:not([data-ds-dark-theme]).agc-surface,[data-agc-theme=light],body[data-theme=light] .agc-surface,html[data-theme=light] .agc-surface,[data-ds-theme=light] .agc-surface{--agc-bg:#f6f8fa;--agc-panel:#ffffff;--agc-card:#ffffff;--agc-border:#d0d7de;--agc-text:#1f2328;--agc-muted:#57606a;--agc-input:#ffffff}.agc-overlay{z-index:2147483000}.agc-teamlist{display:flex;flex-direction:column;gap:10px;padding:18px;overflow:auto}.agc-teamrow{display:flex;align-items:center;gap:12px;width:100%;text-align:left;border:1px solid var(--agc-border);border-radius:12px;padding:12px;background:var(--agc-card);color:inherit;cursor:pointer}.agc-teamrow:hover,.agc-teamrow:focus-visible{border-color:#58a6ff;outline:none}.agc-connection{font-size:10px;letter-spacing:.06em;color:#3fb950}.agc-connection.reconnecting{color:#d29922}.agc-head{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--agc-border);flex-wrap:wrap}.agc-title{font-size:16px;font-weight:700}.agc-goal{opacity:.7;font-size:12px;max-width:40%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agc-status{border-radius:12px;padding:2px 10px;font-size:11px;font-weight:700;letter-spacing:.06em}.agc-progress{flex:1;min-width:140px;height:8px;border-radius:4px;background:var(--agc-panel);border:1px solid var(--agc-border);overflow:hidden}.agc-progressfill{height:100%;background:#3fb950;transition:width .6s ease}.agc-chips{display:flex;gap:6px;flex-wrap:wrap}.agc-chip{border:1px solid var(--agc-border);border-radius:12px;padding:2px 8px;font-size:11px;cursor:pointer;background:transparent;color:inherit}.agc-close{border:1px solid var(--agc-border);background:transparent;color:inherit;border-radius:6px;padding:4px 10px;cursor:pointer}.agc-body{flex:1;display:flex;min-height:0}.agc-main{flex:1;overflow:auto;padding:14px;display:flex;flex-direction:column;gap:14px;position:relative}.agc-side{width:340px;border-left:1px solid var(--agc-border);display:flex;flex-direction:column;min-height:0}.agc-panel{padding:10px 12px;border-bottom:1px solid var(--agc-border)}.agc-paneltitle{font-size:11px;font-weight:700;letter-spacing:.08em;opacity:.7;margin-bottom:6px}.agc-workspace{position:relative;border:1px solid var(--agc-border);border-radius:12px;padding:18px;min-height:220px}.agc-agents{display:flex;flex-wrap:wrap;gap:12px;justify-content:center;align-items:flex-start}.agc-leadrow{width:100%;display:flex;justify-content:center;margin-bottom:10px}.agc-node{position:relative;width:150px;border:1px solid var(--agc-border);border-radius:12px;padding:10px;cursor:pointer;background:var(--agc-card);text-align:center;outline:none;transition:border-color .25s ease,box-shadow .25s ease,opacity .25s ease;color:inherit;font:inherit}.agc-node:focus-visible{border-color:#58a6ff;box-shadow:0 0 0 2px rgba(88,166,255,.4)}.agc-node:hover{border-color:#58a6ff}.agc-avatar{font-size:26px}.agc-name{font-weight:700;margin-top:2px}.agc-role{opacity:.65;font-size:11px}.agc-statusrow{margin-top:6px;display:flex;justify-content:center;align-items:center;gap:4px}.agc-status{font-size:10px;font-weight:700;letter-spacing:.08em}.agc-task{margin-top:4px;font-size:11px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.agc-minibar{height:3px;border-radius:2px;background:#2a2f36;margin-top:6px;overflow:hidden}.agc-minifill{height:100%;background:#58a6ff;transition:width .8s ease}.st-working{color:#58a6ff}.st-thinking{color:#d29922}.st-blocked{color:#f85149}.st-reviewing{color:#bc8cff}.st-idle{color:#9aa0a6}.st-waiting{color:#9aa0a6}.st-completed{color:#3fb950}.st-failed{color:#f85149}.agc-pulse{animation:agcPulse 1.8s ease-in-out infinite}.agc-pulse-fast{animation:agcPulse 1.1s ease-in-out infinite}@keyframes agcPulse{0%,100%{opacity:1}50%{opacity:.55}}.agc-msgparticle{position:fixed;width:6px;height:6px;border-radius:50%;background:#58a6ff;z-index:9050;animation:agcTravel 1.8s ease-in forwards;pointer-events:none}.agc-msgparticle-finding{background:#f85149}.agc-msgparticle-plan{background:#d29922}@keyframes agcTravel{from{transform:translate(0,0);opacity:1}to{transform:translate(var(--dx,0),var(--dy,0));opacity:0}}.agc-msglabel{position:fixed;font-size:11px;border:1px solid #2a2f36;border-radius:8px;padding:3px 8px;background:#000;color:#fff;z-index:9051;animation:agcFade 1.8s ease-in forwards;pointer-events:none;max-width:220px}@keyframes agcFade{0%{opacity:0}12%{opacity:1}80%{opacity:1}100%{opacity:0}}.agc-taskgraph{border:1px solid var(--agc-border);border-radius:12px;padding:14px;overflow:auto}.agc-graphrow{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:8px 0;position:relative}.agc-graphconn{text-align:center;color:#9aa0a6;font-size:12px;margin:-4px 0}.agc-tasknode{border:1px solid var(--agc-border);border-radius:8px;padding:6px 10px;font-size:12px;background:var(--agc-card);min-width:130px;transition:border-color .3s ease,opacity .3s ease}.agc-tasknode[role='button']{cursor:pointer}.agc-tasknode[role='button']:hover,.agc-tasknode[role='button']:focus-visible{border-color:var(--agc-primary);outline:none;box-shadow:0 0 0 3px rgba(77,134,247,.14)}.agc-tasknode.blocked{border-color:#f85149}.agc-taskowner{font-size:10px;opacity:.7}.agc-depedge{display:block;text-align:center;color:#58a6ff;font-size:12px;animation:agcFade 1.6s ease-in forwards}.agc-taskdetail{position:fixed;left:24px;top:92px;z-index:2147483005;width:min(360px,calc(100vw - 48px));padding:18px;border:1px solid var(--agc-border);border-radius:18px;background:var(--agc-panel);color:var(--agc-text);box-shadow:0 24px 70px rgba(21,47,80,.22);backdrop-filter:blur(18px)}.agc-taskdetail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.agc-taskdetail h2{margin:4px 0 12px;font-size:18px;line-height:1.2}.agc-taskdetail-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.agc-taskdetail-section{margin-top:14px}.agc-task-description{color:var(--agc-text);font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.agc-task-result{padding:10px;border:1px solid var(--agc-border);border-radius:10px;color:var(--agc-muted);font-size:11px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}.agc-feed{flex:1;overflow:auto;padding:8px 10px}.agc-feeditem{padding:6px 8px;border-radius:6px;cursor:pointer;font-size:12px;border-bottom:1px solid var(--agc-border)}.agc-feeditem:hover{background:#111}body:not([data-ds-dark-theme]).agc-feeditem:hover{background:#eef2f6}.agc-feedtime{opacity:.5;font-size:10px;margin-right:6px}.agc-filters{display:flex;gap:4px;padding:6px 10px;flex-wrap:wrap}.agc-filter{border:1px solid var(--agc-border);background:transparent;color:inherit;border-radius:10px;font-size:10px;padding:2px 8px;cursor:pointer}.agc-filter.on{background:#1c2c45;border-color:#58a6ff;color:#dbeafe}.agc-banner{margin-bottom:10px;border:1px solid var(--agc-border);border-radius:10px;padding:10px 12px}.agc-banner.plan{border-color:#d29922}.agc-banner.block{border-color:#f85149}.agc-banner.done{border-color:#3fb950}.agc-drawer{--agc-bg:#f7fbff;--agc-panel:rgba(255,255,255,.97);--agc-card:rgba(255,255,255,.94);--agc-border:#dce8f4;--agc-border-strong:#bed4e9;--agc-text:#172033;--agc-muted:#6f7f95;--agc-input:#ffffff;--agc-primary:#4d86f7;--agc-primary-soft:#edf4ff;position:fixed;top:0;right:0;bottom:0;width:min(460px,96vw);max-width:100vw;box-sizing:border-box;overflow:hidden;background:var(--agc-bg);color:var(--agc-text);border-left:1px solid var(--agc-border);z-index:2147483005;display:flex;flex-direction:column;pointer-events:auto;isolation:isolate}body[data-ds-dark-theme] .agc-drawer{--agc-bg:#0d1422;--agc-panel:rgba(20,30,47,.98);--agc-card:rgba(25,38,59,.96);--agc-border:#2a3d58;--agc-border-strong:#3c5678;--agc-text:#e8eef7;--agc-muted:#9fb0c7;--agc-input:#111d2f;--agc-primary:#78a8ff;--agc-primary-soft:rgba(77,134,247,.16)}.agc-drawerhead{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--agc-border)}.agc-drawerbody{flex:1;min-width:0;max-width:100%;overflow-x:hidden;overflow-y:auto;padding:12px 14px}.agc-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px}.agc-tab{border:1px solid var(--agc-border);background:transparent;color:inherit;border-radius:8px;font-size:11px;padding:4px 10px;cursor:pointer}.agc-tab.on{background:#1c2c45;border-color:#58a6ff;color:#dbeafe}.agc-card{border:1px solid var(--agc-border);border-radius:10px;padding:10px;margin-bottom:10px;background:var(--agc-card)}.agc-kv{display:flex;justify-content:space-between;font-size:12px;padding:2px 0}.agc-input{width:100%;box-sizing:border-box;background:var(--agc-input);color:var(--agc-text);border:1px solid var(--agc-border);border-radius:8px;padding:8px;font-size:12px}.agc-btn{border:1px solid var(--agc-border);background:transparent;color:inherit;border-radius:8px;padding:6px 12px;font-size:12px;cursor:pointer}.agc-btn.primary{background:#1c2c45;border-color:#58a6ff}.agc-btn.danger{border-color:#f85149;color:#f85149}.agc-confirm{border:1px solid #f85149;border-radius:8px;padding:8px;font-size:12px;margin-top:8px}.agc-tool{border:1px solid var(--agc-border);border-radius:8px;padding:4px 8px;font-size:11px;margin:3px 0}.agc-empty{opacity:.6;font-size:12px;padding:14px;text-align:center}.agc-skeleton{height:12px;border-radius:6px;background:#1a1a1a;animation:agcPulse 1.4s ease-in-out infinite;margin:6px 0}body:not([data-ds-dark-theme]).agc-skeleton{background:#e1e7ee}.agc-observe{display:flex;gap:10px;overflow:auto}.agc-observecol{flex:1;min-width:180px;border:1px solid var(--agc-border);border-radius:10px;padding:8px;font-size:11px}.agc-session-feed{min-width:0;max-width:100%;max-height:42vh;overflow-x:hidden;overflow-y:auto;border:1px solid var(--agc-border);border-radius:10px;padding:8px}.agc-session-row{min-width:0;max-width:100%;box-sizing:border-box;padding:8px;border-bottom:1px solid var(--agc-border);white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.agc-session-kind{font-size:10px;color:var(--agc-muted);letter-spacing:.06em;margin-bottom:3px}.agc-session-tool{min-width:0;max-width:100%;box-sizing:border-box;margin:4px 0;border:1px solid var(--agc-border);border-radius:8px;overflow:hidden;background:var(--agc-panel)}.agc-session-tool summary{display:flex;min-width:0;gap:8px;align-items:baseline;padding:8px;cursor:pointer;color:var(--agc-text);font-size:11px;font-weight:700;list-style-position:inside}.agc-session-tool summary::marker{color:var(--agc-primary)}.agc-session-tool-preview{min-width:0;overflow:hidden;color:var(--agc-muted);font-size:10px;font-weight:400;text-overflow:ellipsis;white-space:nowrap}.agc-session-tool-summary{padding:0 8px 8px;color:var(--agc-muted);font-size:10px;line-height:1.45;overflow-wrap:anywhere;word-break:break-word}.agc-session-tool pre{max-width:100%;box-sizing:border-box;margin:0;padding:8px;border-top:1px solid var(--agc-border);overflow-x:auto;color:var(--agc-text);font:10px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}.agc-follow{border:1px solid #58a6ff;border-radius:8px;padding:2px 8px;font-size:10px;color:#58a6ff;cursor:pointer}.agc-newmsg{position:absolute;top:-8px;right:-8px;background:#1c2c45;border:1px solid #58a6ff;color:#58a6ff;border-radius:10px;font-size:10px;padding:0 6px}.agc-hideflow{opacity:.45}@media(prefers-reduced-motion:reduce){.agc-pulse,.agc-pulse-fast,.agc-msgparticle,.agc-msglabel,.agc-depedge{animation:none !important}.agc-progressfill,.agc-minifill{transition:none !important}}@media(max-width:700px){.agc-head{gap:7px;padding:8px 10px}.agc-title{font-size:14px}.agc-goal{max-width:100%;width:100%}.agc-body{flex-direction:column;overflow:auto;min-height:0}.agc-main{flex:none;min-height:48vh;padding:10px}.agc-side{width:100%;flex:none;height:260px;min-height:220px;border-left:0;border-top:1px solid var(--agc-border)}.agc-node{width:132px}.agc-workspace{overflow:auto}.agc-taskdetail{left:10px;right:10px;top:74px;width:auto}.agc-drawer{width:100vw;border-left:0}.agc-session-feed{max-height:48vh}}@media(max-width:380px){.agc-head{align-items:flex-start}.agc-progress{order:5;flex-basis:100%;min-width:0}.agc-node{width:calc(50vw - 30px);min-width:118px}.agc-workspace{padding:10px}.agc-drawerhead{padding:10px}.agc-drawerbody{padding:10px}}.agc-surface{--agc-bg:#f7fbff;--agc-panel:rgba(255,255,255,.92);--agc-card:rgba(255,255,255,.86);--agc-border:#dce8f4;--agc-border-strong:#bed4e9;--agc-text:#162844;--agc-muted:#6c7e99;--agc-primary:#4d86f7;--agc-primary-soft:#edf4ff;--agc-success:#26b978;--agc-warning:#f0ad3d;--agc-danger:#ec6e73;--agc-review:#9073db;--agc-input:#ffffff;background:radial-gradient(circle at 8% 0%,rgba(155,205,255,.18),transparent 30%),radial-gradient(circle at 92% 14%,rgba(210,191,255,.14),transparent 28%),var(--agc-bg);color:var(--agc-text)}body[data-ds-dark-theme] .agc-surface{--agc-bg:#0d1422;--agc-panel:rgba(20,30,47,.95);--agc-card:rgba(25,38,59,.92);--agc-border:#2b405d;--agc-border-strong:#42688f;--agc-text:#eef5ff;--agc-muted:#a4b6ce;--agc-primary:#7aa8ff;--agc-primary-soft:#172d4c;--agc-success:#58d59b;--agc-warning:#f8c25f;--agc-danger:#ff8f93;--agc-review:#b9a0ff;--agc-input:#111e31}.agc-surface::before{position:absolute;inset:0;pointer-events:none;content:'';background-image:radial-gradient(rgba(92,140,198,.09)1px,transparent 1px);background-size:24px 24px;opacity:.36}.agc-head,.agc-banner,.agc-body{position:relative;z-index:1}.agc-head{min-height:64px;padding:12px 24px;border-color:var(--agc-border);background:rgba(255,255,255,.66);backdrop-filter:blur(16px)}body[data-ds-dark-theme] .agc-head{background:rgba(13,20,34,.72)}.agc-title{font-size:18px;letter-spacing:-.02em}.agc-goal{color:var(--agc-muted)}.agc-progress{height:9px;background:var(--agc-primary-soft);border:0}.agc-progressfill{background:linear-gradient(90deg,#4d86f7,#6ea6ff)}.agc-btn,.agc-chip,.agc-close,.agc-tab,.agc-filter{border-color:var(--agc-border-strong);color:var(--agc-text);background:rgba(255,255,255,.48)}body[data-ds-dark-theme] .agc-btn,body[data-ds-dark-theme] .agc-chip,body[data-ds-dark-theme] .agc-close,body[data-ds-dark-theme] .agc-tab,body[data-ds-dark-theme] .agc-filter{background:rgba(20,30,47,.72)}.agc-btn:hover,.agc-chip:hover,.agc-close:hover,.agc-tab:hover,.agc-filter:hover{border-color:var(--agc-primary)}.agc-btn:disabled{cursor:not-allowed;opacity:.45}.agc-btn.primary,.agc-tab.on,.agc-filter.on{background:var(--agc-primary-soft);border-color:var(--agc-primary);color:var(--agc-primary)}.agc-main{padding:24px;gap:18px}.agc-side{width:360px;border-color:var(--agc-border);background:rgba(255,255,255,.42)}body[data-ds-dark-theme] .agc-side{background:rgba(13,20,34,.36)}.agc-panel,.agc-workspace,.agc-taskgraph,.agc-card,.agc-observecol{border-color:var(--agc-border);background:var(--agc-card);box-shadow:0 8px 28px rgba(64,112,164,.06)}.agc-workspace,.agc-taskgraph{border-radius:18px}.agc-node,.agc-tasknode{border-color:var(--agc-border);background:var(--agc-card);box-shadow:0 6px 16px rgba(64,112,164,.06)}.agc-node:hover,.agc-node:focus-visible{border-color:var(--agc-primary);box-shadow:0 0 0 3px rgba(77,134,247,.16),0 8px 18px rgba(64,112,164,.1)}.agc-status{padding:3px 8px;border-radius:999px;letter-spacing:.04em}.st-working{color:var(--agc-primary)}.st-thinking{color:var(--agc-warning)}.st-blocked,.st-failed{color:var(--agc-danger)}.st-reviewing{color:var(--agc-review)}.st-idle,.st-waiting{color:var(--agc-muted)}.st-completed{color:var(--agc-success)}.agc-feeditem:hover{background:var(--agc-primary-soft)}.agc-overview{display:flex;flex-direction:column;gap:12px}.agc-overview-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.agc-metric-card{min-width:0;padding:12px 14px;border:1px solid var(--agc-border);border-radius:14px;background:var(--agc-card);box-shadow:0 8px 24px rgba(64,112,164,.05)}.agc-metric-card span,.agc-metric-card small{display:block;color:var(--agc-muted);font-size:10px}.agc-metric-card strong{display:block;margin:5px 0 2px;font-size:22px;letter-spacing:-.04em}.agc-overview-row{display:grid;grid-template-columns:minmax(0,1.1fr)minmax(0,1fr);gap:12px}.agc-captain-card,.agc-status-card{display:flex;align-items:center;gap:12px;min-height:72px;padding:12px 14px;border:1px solid var(--agc-border);border-radius:16px;background:var(--agc-card)}.agc-avatar-large{font-size:36px !important}.agc-captain-card strong,.agc-captain-card small{display:block}.agc-captain-card small{margin-top:4px;color:var(--agc-muted);font-size:10px}.agc-captain-mark{margin-left:auto;color:var(--agc-warning);font-size:22px}.agc-status-card{display:block}.agc-status-card-title{display:block;color:var(--agc-muted);font-size:10px;font-weight:800}.agc-status-card-items{display:flex;flex-wrap:wrap;gap:8px 12px;margin-top:11px;font-size:10px}.agc-status-card-items span{display:inline-flex;align-items:center;gap:5px}.agc-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--agc-muted)}.agc-dot.working{background:var(--agc-primary)}.agc-dot.waiting{background:var(--agc-warning)}.agc-dot.reviewing{background:var(--agc-review)}.agc-dot.completed{background:var(--agc-success)}.agc-workspace-shell{background:#f7f9fc;color:var(--agc-text)}.agc-workspace-head{min-height:58px;display:flex;align-items:center;gap:12px;padding:10px 22px;border-bottom:1px solid var(--agc-border);background:rgba(255,255,255,.9)}.agc-brand-mark{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;font-size:25px;filter:saturate(.9)}.agc-brand-divider{width:1px;height:25px;background:var(--agc-border)}.agc-brand-name{color:var(--agc-text);font-size:12px;letter-spacing:-.015em;white-space:nowrap}.agc-workspace-team-title{min-width:0;display:flex;align-items:center;gap:8px}.agc-workspace-team-title strong{font-size:14px;letter-spacing:-.01em}.agc-workspace-team-title span:not(.agc-team-chevron){max-width:360px;overflow:hidden;color:var(--agc-muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.agc-team-chevron{color:var(--agc-muted);font-size:15px}.agc-workspace-head-actions{display:flex;align-items:center;gap:8px;margin-left:auto}.agc-workspace-layout{display:flex;flex:1;min-height:0}.agc-workspace-nav{width:86px;flex:none;display:flex;flex-direction:column;gap:7px;padding:18px 9px;border-right:1px solid var(--agc-border);background:rgba(255,255,255,.58)}.agc-navitem{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;min-height:56px;padding:7px 4px;border:1px solid transparent;border-radius:12px;background:transparent;color:var(--agc-muted);font:inherit;font-size:9px;line-height:1.2;cursor:pointer;text-align:center}.agc-navitem:hover,.agc-navitem:focus-visible{border-color:var(--agc-border-strong);background:var(--agc-primary-soft);color:var(--agc-primary);outline:none}.agc-navitem.on{border-color:rgba(77,134,247,.28);background:var(--agc-primary-soft);color:var(--agc-primary);font-weight:800}.agc-navicon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;font-size:18px}.agc-workspace-main{flex:1;min-width:0;overflow:auto;padding:18px 22px 24px}.agc-workspace-main-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:14px}.agc-workspace-main-head h1{margin:2px 0 0;font-size:20px;letter-spacing:-.035em}.agc-eyebrow{color:var(--agc-primary);font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.agc-workspace-alerts{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.agc-workspace-alert{display:inline-flex;align-items:center;gap:8px;padding:7px 10px;border:1px solid var(--agc-border);border-radius:10px;background:var(--agc-card);color:var(--agc-muted);font-size:10px}.agc-workspace-alert.plan{border-color:rgba(144,115,219,.45);color:var(--agc-review)}.agc-workspace-alert.block{border-color:rgba(236,110,115,.45);color:var(--agc-danger)}.agc-workspace-alert.review{border-color:rgba(240,173,61,.48);color:var(--agc-warning)}.agc-plan-alert{display:flex;flex-direction:column;align-items:stretch;flex:1 1 100%;gap:7px}.agc-plan-alert-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.agc-plan-review-row{display:grid;grid-template-columns:minmax(0,1fr)auto minmax(150px,.8fr);gap:7px;align-items:center;padding-top:7px;border-top:1px solid var(--agc-border);color:var(--agc-text)}.agc-plan-review-row>span{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.agc-plan-reject-input{width:100%;min-width:0;box-sizing:border-box;padding:6px 8px;border:1px solid var(--agc-border);border-radius:8px;background:var(--agc-panel);color:var(--agc-text);font:inherit;font-size:9px}.agc-plan-reject-input:focus{border-color:var(--agc-review);outline:none;box-shadow:0 0 0 3px rgba(144,115,219,.12)}.agc-workspace-grid{display:grid;grid-template-columns:1.12fr 1.12fr 1fr 1.15fr;grid-template-rows:auto auto minmax(158px,auto);grid-template-areas:'summary summary captain activity' 'members members dependencies activity' 'live live message inspector';gap:12px;align-items:stretch}.agc-workspace-card{min-width:0;min-height:0;overflow:hidden;border:1px solid var(--agc-border);border-radius:16px;background:var(--agc-card);box-shadow:0 5px 18px rgba(64,112,164,.055)}.agc-workspace-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:38px;padding:11px 13px 7px}.agc-workspace-card-head h2{margin:0;color:var(--agc-text);font-size:12px;font-weight:800;letter-spacing:-.01em}.agc-workspace-card-body{min-width:0;padding:5px 13px 13px}.agc-summary-card{grid-area:summary}.agc-captain-workspace-card{grid-area:captain}.agc-activity-workspace-card{grid-area:activity}.agc-members-workspace-card{grid-area:members}.agc-dependencies-workspace-card{grid-area:dependencies}.agc-live-workspace-card{grid-area:live}.agc-message-workspace-card{grid-area:message}.agc-inspector-workspace-card{grid-area:inspector}.agc-summary-progress-head{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--agc-muted);font-size:10px}.agc-summary-progress-head strong{color:var(--agc-text);font-size:18px}.agc-summary-progress{display:flex;gap:3px;height:7px;margin:9px 0 12px}.agc-summary-progress span{flex:1;min-width:2px;border-radius:999px;background:var(--agc-border)}.agc-summary-progress span[data-state='in_progress'],.agc-summary-progress span[data-state='working']{background:#61c7aa}.agc-summary-progress span[data-state='pending']{background:#d9e4ef}.agc-summary-progress span[data-state='blocked']{background:#f2b45a}.agc-summary-progress span[data-state='completed']{background:#8abbe9}.agc-summary-progress span[data-state='failed']{background:#e98b92}.agc-summary-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.agc-summary-stat{min-width:0;padding:8px 7px;border:1px solid var(--agc-border);border-radius:10px;background:rgba(255,255,255,.5);text-align:center}.agc-summary-stat strong{display:block;font-size:16px}.agc-summary-stat span{display:block;margin-top:2px;color:var(--agc-muted);font-size:8px;font-weight:800;text-transform:uppercase}.agc-summary-stat.working{border-color:rgba(38,185,120,.28);color:var(--agc-success);background:rgba(38,185,120,.07)}.agc-summary-stat.waiting{border-color:rgba(240,173,61,.28);color:var(--agc-warning);background:rgba(240,173,61,.08)}.agc-summary-stat.reviewing{border-color:rgba(144,115,219,.28);color:var(--agc-review);background:rgba(144,115,219,.07)}.agc-summary-stat.completed{border-color:rgba(77,134,247,.24);color:var(--agc-primary);background:rgba(77,134,247,.07)}.agc-summary-meta{margin-top:12px;color:var(--agc-muted);font-size:9px}.agc-captain-profile{display:flex;align-items:center;width:100%;min-height:132px;gap:10px;padding:7px;border:1px solid transparent;border-radius:12px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.agc-captain-profile:hover,.agc-captain-profile:focus-visible{border-color:var(--agc-border-strong);background:var(--agc-primary-soft);outline:none}.agc-avatar-captain{filter:saturate(1.1)}.agc-captain-copy{min-width:0;display:flex;flex-direction:column;gap:4px}.agc-captain-copy strong{font-size:13px}.agc-captain-copy small{overflow:hidden;color:var(--agc-muted);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.agc-captain-star{margin-left:auto;align-self:flex-start;color:var(--agc-warning);font-size:19px}.agc-select{min-width:62px;padding:5px 7px;border:1px solid var(--agc-border);border-radius:8px;background:var(--agc-panel);color:var(--agc-text);font:inherit;font-size:9px}.agc-activity-select{max-width:80px}.agc-workspace-activity-list{display:flex;flex-direction:column;gap:3px}.agc-workspace-activity-row{display:grid;grid-template-columns:23px minmax(0,1fr)auto;gap:7px;align-items:center;width:100%;padding:6px 3px;border:0;border-bottom:1px solid var(--agc-border);background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.agc-workspace-activity-row:last-child{border-bottom:0}.agc-workspace-activity-row:hover,.agc-workspace-activity-row:focus-visible{background:var(--agc-primary-soft);outline:none}.agc-activity-avatar{display:flex;align-items:center;justify-content:center;width:21px;height:21px;border-radius:7px;background:var(--agc-primary-soft);font-size:12px}.agc-activity-copy{min-width:0;display:flex;flex-direction:column;gap:2px}.agc-activity-copy strong{overflow:hidden;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.agc-activity-copy small{overflow:hidden;color:var(--agc-muted);font-size:8px;text-overflow:ellipsis;white-space:nowrap}.agc-activity-right{display:flex;flex-direction:column;align-items:flex-end;gap:3px}.agc-activity-right time{color:var(--agc-muted);font-size:8px;white-space:nowrap}.agc-activity-right .agc-status{padding:2px 5px;font-size:7px}.agc-delegation{position:relative;padding-top:5px}.agc-delegation-lead{display:flex;align-items:center;gap:8px;margin:0 auto 22px;padding:7px 16px;border:1px solid rgba(77,134,247,.35);border-radius:11px;background:var(--agc-primary-soft);color:inherit;font:inherit;cursor:pointer}.agc-delegation-lead:hover,.agc-delegation-lead:focus-visible{outline:none;border-color:var(--agc-primary)}.agc-delegation-lead strong,.agc-delegation-lead small{display:block}.agc-delegation-lead strong{font-size:10px}.agc-delegation-lead small{margin-top:2px;color:var(--agc-muted);font-size:8px}.agc-delegation-lines{position:absolute;top:51px;left:13%;right:13%;height:22px;border-top:1px solid var(--agc-border-strong)}.agc-delegation-lines span{position:relative;display:inline-block;width:25%;height:21px;border-left:1px solid var(--agc-border-strong)}.agc-delegation-lines span::after{position:absolute;bottom:0;left:-1px;width:100%;height:1px;background:var(--agc-border-strong);content:''}.agc-delegation-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.agc-delegation-member{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:0;padding:8px 4px 6px;border:1px solid var(--agc-border);border-radius:11px;background:rgba(255,255,255,.46);color:inherit;font:inherit;cursor:pointer;text-align:center}.agc-delegation-member:hover,.agc-delegation-member:focus-visible{border-color:var(--agc-primary);outline:none}.agc-delegation-member strong{max-width:100%;overflow:hidden;font-size:9px;text-overflow:ellipsis;white-space:nowrap}.agc-delegation-member small{color:var(--agc-muted);font-size:8px}.agc-avatar-small{font-size:24px !important}.agc-delegation-member .agc-status{padding:2px 5px;font-size:7px}.agc-dependencies-workspace-card .agc-workspace-card-body{padding-top:1px}.agc-dependencies-workspace-card .agc-taskgraph{padding:0;border:0;background:transparent;box-shadow:none}.agc-dependencies-workspace-card .agc-taskgraph>.agc-paneltitle{display:none}.agc-dependencies-workspace-card .agc-graphrow{margin:5px 0;gap:5px}.agc-dependencies-workspace-card .agc-graphconn{margin:-5px 0}.agc-dependencies-workspace-card .agc-tasknode{min-width:0;flex:1;padding:6px 5px;font-size:9px;text-align:center}.agc-dependencies-workspace-card .agc-taskowner{font-size:7px}.agc-dependencies-workspace-card .agc-status{padding:1px 4px;font-size:7px}.agc-live-mark{color:var(--agc-success);font-size:9px;font-weight:800}.agc-live-mark.idle{color:var(--agc-muted)}.agc-terminal{min-height:128px;padding:9px 10px;overflow:hidden;border:1px solid #263b51;border-radius:11px;background:#111d2a;color:#d9e8f6;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.agc-terminal-target{margin-bottom:7px;color:#9bd2ff;font-size:9px}.agc-terminal-row{display:grid;grid-template-columns:50px 92px minmax(0,1fr);gap:7px;align-items:baseline;padding:4px 0;border-bottom:1px solid rgba(179,215,244,.1);font-size:8px}.agc-terminal-row time{color:#7594ad}.agc-terminal-row strong{overflow:hidden;color:#9bd2ff;text-overflow:ellipsis;white-space:nowrap}.agc-terminal-row span{overflow:hidden;color:#d9e8f6;text-overflow:ellipsis;white-space:nowrap}.agc-terminal-empty{display:flex;align-items:center;justify-content:center;min-height:100px;color:#7594ad;font-size:10px}.agc-message-recipient{width:100%;margin-bottom:7px}.agc-message-input{width:100%;box-sizing:border-box;resize:vertical;padding:9px;border:1px solid var(--agc-border);border-radius:10px;background:var(--agc-panel);color:var(--agc-text);font:inherit;font-size:10px;outline:none}.agc-message-input:focus{border-color:var(--agc-primary);box-shadow:0 0 0 3px rgba(77,134,247,.13)}.agc-message-actions{display:flex;align-items:center;gap:7px;margin-top:7px}.agc-message-tools{color:var(--agc-muted);font-size:13px;letter-spacing:.12em}.agc-send{width:31px;height:31px;padding:0;margin-left:auto;border-radius:9px}.agc-message-feedback{color:var(--agc-success);font-size:8px}.agc-inspector-profile{display:flex;align-items:center;gap:10px;padding:4px 0 10px}.agc-avatar-inspector{display:flex;align-items:center;justify-content:center;width:45px;height:45px;border-radius:14px;background:var(--agc-primary-soft);font-size:34px !important}.agc-inspector-profile strong,.agc-inspector-profile span{display:block}.agc-inspector-profile strong{font-size:12px}.agc-inspector-profile .agc-status{display:inline-block;margin-top:4px;padding:2px 5px;font-size:7px}.agc-inspector-lines{display:flex;flex-direction:column;gap:6px}.agc-inspector-lines>div{display:flex;justify-content:space-between;gap:8px;font-size:9px}.agc-inspector-lines span{color:var(--agc-muted)}.agc-inspector-lines strong{max-width:62%;overflow:hidden;font-size:9px;font-weight:600;text-align:right;text-overflow:ellipsis;white-space:nowrap}.agc-inspector-handoff{display:flex;align-items:center;gap:9px;min-height:86px;color:var(--agc-muted);font-size:10px;line-height:1.45}.agc-inspector-handoff>div{min-width:0;display:flex;flex-direction:column;gap:4px}.agc-inspector-handoff strong{color:var(--agc-text);font-size:11px}.agc-workspace-grid>*{min-width:0;min-height:0;max-width:100%}.agc-workspace-card{box-sizing:border-box;max-width:100%}.agc-workspace-card-body{min-width:0;max-width:100%;overflow:hidden}.agc-workspace-route-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:stretch}.agc-workspace-route-grid>.agc-workspace-card{grid-area:auto;min-width:0}.agc-route-card-wide{grid-column:1 / -1}.agc-settings-workspace-card{max-width:720px}.agc-settings-summary{display:flex;flex-direction:column;gap:5px;color:var(--agc-muted);font-size:11px;line-height:1.5}.agc-settings-summary strong{color:var(--agc-text);font-size:14px}.agc-settings-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.agc-inspector-open{width:100%;margin-top:11px;padding:7px 9px;border:1px solid var(--agc-primary);border-radius:9px;background:var(--agc-primary-soft);color:var(--agc-primary);font:inherit;font-size:9px;font-weight:800;cursor:pointer}.agc-inspector-open:hover{background:var(--agc-primary);color:white}body[data-ds-dark-theme] .agc-workspace-head,body[data-ds-dark-theme] .agc-workspace-nav{background:rgba(13,20,34,.88)}body[data-ds-dark-theme] .agc-workspace-shell{background:#0d1422}body[data-ds-dark-theme] .agc-summary-stat,body[data-ds-dark-theme] .agc-delegation-member{background:rgba(20,30,47,.72)}@media(max-width:1180px){.agc-workspace-main{padding:16px}.agc-workspace-grid{grid-template-columns:repeat(2,minmax(0,1fr));grid-template-areas:'summary summary' 'captain activity' 'members members' 'dependencies activity' 'live live' 'message inspector'}}@media(max-width:760px){.agc-workspace-head{gap:8px;padding:9px 12px}.agc-brand-divider,.agc-brand-name,.agc-workspace-team-title>span:not(.agc-team-chevron),.agc-workspace-head-actions .agc-connection{display:none}.agc-workspace-head-actions{gap:5px}.agc-workspace-layout{display:block}.agc-workspace-nav{width:100%;flex-direction:row;gap:4px;overflow:auto;padding:6px;border-right:0;border-bottom:1px solid var(--agc-border)}.agc-navitem{flex:1 0 52px;min-height:47px}.agc-navitem span:not(.agc-navicon){display:none}.agc-navitem:last-child{margin-left:auto}.agc-workspace-main{padding:12px 10px 18px}.agc-workspace-main-head{align-items:flex-start}.agc-workspace-main-head h1{font-size:17px}.agc-workspace-grid{display:flex;flex-direction:column;gap:10px}.agc-workspace-route-grid{display:flex;flex-direction:column;gap:10px}.agc-route-card-wide{grid-column:auto}.agc-workspace-card{min-height:auto}.agc-summary-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.agc-delegation-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.agc-plan-review-row{grid-template-columns:1fr auto}.agc-plan-reject-input{grid-column:1 / -1}.agc-terminal-row{grid-template-columns:42px 76px minmax(0,1fr)}}.agc-compact,.agc-compact-badge,.agc-preferences{--agc-panel:rgba(255,255,255,.96);--agc-card:rgba(255,255,255,.88);--agc-border:#dce8f4;--agc-border-strong:#bed4e9;--agc-text:#162844;--agc-muted:#6c7e99;--agc-primary:#4d86f7;--agc-primary-soft:#edf4ff;--agc-success:#26b978;--agc-warning:#f0ad3d;--agc-danger:#ec6e73;--agc-review:#9073db;--agc-input:#ffffff}body[data-ds-dark-theme] .agc-compact,body[data-ds-dark-theme] .agc-compact-badge,body[data-ds-dark-theme] .agc-preferences{--agc-panel:rgba(20,30,47,.97);--agc-card:rgba(25,38,59,.94);--agc-border:#2b405d;--agc-border-strong:#42688f;--agc-text:#eef5ff;--agc-muted:#a4b6ce;--agc-primary:#7aa8ff;--agc-primary-soft:#172d4c;--agc-success:#58d59b;--agc-warning:#f8c25f;--agc-danger:#ff8f93;--agc-review:#b9a0ff;--agc-input:#111e31}.agc-compact{position:fixed;top:78px;right:18px;z-index:2147483000;width:min(348px,calc(100vw - 32px));max-height:min(720px,calc(100vh - 96px));overflow:hidden;color:var(--agc-text);border:1px solid var(--agc-border);border-radius:20px;background:var(--agc-panel);box-shadow:0 20px 60px rgba(33,70,110,.18),0 3px 12px rgba(33,70,110,.08);backdrop-filter:blur(22px)saturate(1.08);pointer-events:auto;animation:agcCompactIn 180ms ease-out both}.agc-compact-head{display:flex;align-items:center;gap:10px;padding:15px 16px;border-bottom:1px solid var(--agc-border)}.agc-compact-title{min-width:0;flex:1;font-weight:800;letter-spacing:-.015em}.agc-compact-title small{display:block;margin-top:3px;color:var(--agc-muted);font-size:10px;font-weight:600;letter-spacing:.04em}.agc-compact-connection{flex:none;color:var(--agc-success);font-size:9px;font-weight:800;letter-spacing:.05em}.agc-compact-connection.reconnecting{color:var(--agc-warning)}.agc-compact-close{width:28px;height:28px;border:0;border-radius:9px;background:transparent;color:var(--agc-muted);cursor:pointer}.agc-compact-close:hover{background:var(--agc-primary-soft);color:var(--agc-primary)}.agc-compact-body{max-height:calc(min(720px,100vh - 96px)- 60px);overflow:auto;padding:14px}.agc-compact-team{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(77,134,247,.28);border-radius:13px;background:linear-gradient(135deg,rgba(237,244,255,.9),rgba(255,255,255,.78))}body[data-ds-dark-theme] .agc-compact-team{background:linear-gradient(135deg,rgba(23,45,76,.92),rgba(25,38,59,.9))}.agc-compact-team .agc-avatar{flex:none;font-size:26px}.agc-compact-team-copy{min-width:0;flex:1}.agc-compact-team-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:800}.agc-compact-team-meta{display:block;overflow:hidden;margin-top:3px;color:var(--agc-muted);font-size:10px;text-overflow:ellipsis;white-space:nowrap}.agc-compact-actions{display:flex;gap:6px}.agc-icon-btn{width:30px;height:30px;border:1px solid var(--agc-border);border-radius:9px;background:transparent;color:var(--agc-muted);cursor:pointer}.agc-icon-btn:hover{border-color:var(--agc-primary);color:var(--agc-primary);background:var(--agc-primary-soft)}.agc-compact-progress{margin:14px 0 12px}.agc-compact-progress-head,.agc-compact-rowhead{display:flex;align-items:center;justify-content:space-between;gap:8px}.agc-compact-progress-head{color:var(--agc-muted);font-size:10px;font-weight:700}.agc-compact-progress-value{color:var(--agc-text);font-size:18px;font-weight:800}.agc-segments{display:flex;gap:3px;margin-top:8px}.agc-segments span{flex:1;height:6px;border-radius:999px;background:var(--agc-border)}.agc-segments span[data-state='working'],.agc-segments span[data-state='in_progress']{background:var(--agc-primary)}.agc-segments span[data-state='waiting'],.agc-segments span[data-state='blocked']{background:var(--agc-warning)}.agc-segments span[data-state='reviewing']{background:var(--agc-review)}.agc-segments span[data-state='completed']{background:var(--agc-success)}.agc-compact-stats{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;color:var(--agc-muted);font-size:10px}.agc-compact-stat{padding:4px 7px;border-radius:999px;background:var(--agc-primary-soft)}.agc-compact-stat[data-tone='success']{color:var(--agc-success);background:rgba(38,185,120,.1)}.agc-compact-stat[data-tone='warning']{color:var(--agc-warning);background:rgba(240,173,61,.12)}.agc-compact-section{margin-top:14px}.agc-compact-section-title{display:flex;align-items:center;gap:6px;margin-bottom:7px;color:var(--agc-muted);font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase}.agc-compact-members{display:flex;flex-direction:column;gap:5px}.agc-compact-member{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:1px solid transparent;border-radius:10px;background:transparent;color:inherit;cursor:pointer;text-align:left}.agc-compact-member:hover,.agc-compact-member:focus-visible{border-color:var(--agc-border-strong);background:var(--agc-primary-soft);outline:none}.agc-compact-member .agc-avatar{width:28px;font-size:21px;text-align:center}.agc-compact-member-copy{min-width:0;flex:1}.agc-compact-member-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:750}.agc-compact-member-task{overflow:hidden;margin-top:2px;color:var(--agc-muted);font-size:9.5px;text-overflow:ellipsis;white-space:nowrap}.agc-compact-event{display:flex;gap:8px;padding:7px 0;border-bottom:1px solid var(--agc-border)}.agc-compact-event:last-child{border-bottom:0}.agc-compact-event-dot{flex:none;width:7px;height:7px;margin-top:4px;border-radius:50%;background:var(--agc-primary)}.agc-compact-event-copy{min-width:0;flex:1;font-size:10px;line-height:1.4}.agc-compact-event-time{display:block;margin-top:2px;color:var(--agc-muted);font-size:9px}.agc-compact-footer{display:flex;gap:7px;margin-top:13px}.agc-compact-footer .agc-btn{flex:1;padding:8px 10px;font-size:10px}.agc-compact-picker{padding:16px}.agc-compact-picker h3{margin:0 0 6px;font-size:14px}.agc-compact-picker p{margin:0 0 12px;color:var(--agc-muted);font-size:11px;line-height:1.5}.agc-compact-picker-list{display:flex;flex-direction:column;gap:7px;max-height:350px;overflow:auto}.agc-compact-picker-list .agc-teamrow{padding:9px}.agc-notice{margin-bottom:12px;padding:9px 10px;border:1px solid var(--agc-border);border-radius:10px;color:var(--agc-muted);font-size:11px;line-height:1.45}.agc-notice-danger{border-color:var(--agc-danger);color:var(--agc-danger);background:rgba(236,110,115,.08)}.agc-compact-badge{position:fixed;top:78px;right:18px;z-index:2147482999;display:flex;align-items:center;gap:7px;padding:8px 11px;border:1px solid var(--agc-border);border-radius:999px;background:var(--agc-panel);color:var(--agc-text);box-shadow:0 10px 30px rgba(33,70,110,.14);cursor:pointer;backdrop-filter:blur(16px)}.agc-compact-badge:hover{border-color:var(--agc-primary)}.agc-compact-badge-dot{width:7px;height:7px;border-radius:50%;background:var(--agc-success)}.agc-compact-badge-dot[data-busy='true']{background:var(--agc-primary);animation:agcPulse 1.7s ease-in-out infinite}.agc-mode-pill{display:inline-flex;align-items:center;gap:4px;padding:4px;border:1px solid var(--agc-border);border-radius:999px;background:var(--agc-primary-soft)}.agc-mode-pill button{border:0;border-radius:999px;padding:4px 8px;background:transparent;color:var(--agc-muted);font:inherit;font-size:10px;cursor:pointer;white-space:nowrap}.agc-mode-pill button[data-on='true']{background:var(--agc-panel);color:var(--agc-primary);box-shadow:0 1px 4px rgba(33,70,110,.12)}.agc-preferences{position:fixed;inset:0;z-index:2147483010;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(14,28,49,.28);backdrop-filter:blur(4px)}.agc-preferences-card{width:min(520px,100%);max-height:min(720px,calc(100vh - 40px));overflow:auto;padding:22px;border:1px solid var(--agc-border);border-radius:18px;background:var(--agc-panel);color:var(--agc-text);box-shadow:0 24px 80px rgba(21,47,80,.25)}.agc-preferences-head{display:flex;align-items:flex-start;gap:12px;justify-content:space-between;margin-bottom:14px}.agc-preferences-head h2{margin:0;font-size:18px}.agc-preferences-head p{margin:5px 0 0;color:var(--agc-muted);font-size:11px}.agc-preferences-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px 12px}.agc-preferences-grid label{display:flex;flex-direction:column;gap:5px;color:var(--agc-muted);font-size:10px;font-weight:700}.agc-preferences-grid input{width:100%;box-sizing:border-box;padding:8px 9px;border:1px solid var(--agc-border);border-radius:9px;background:var(--agc-input);color:var(--agc-text);font:inherit;font-size:11px}.agc-preferences-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}@keyframes agcCompactIn{from{opacity:1;transform:translateY(-6px)scale(.99)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.agc-compact,.agc-compact-badge,.agc-compact-badge-dot{animation:none !important;transition:none !important}}@media(max-width:840px){.agc-compact{top:64px;right:10px;width:min(360px,calc(100vw - 20px))}.agc-compact-badge{top:64px;right:10px}.agc-preferences-grid{grid-template-columns:1fr}}@media(max-width:640px){.agc-compact{left:10px;right:10px;width:auto;max-height:calc(100vh - 80px)}.agc-compact-badge{right:10px}.agc-head{padding:10px 14px}.agc-main{padding:12px}.agc-side{width:100%}}@media(max-width:900px){.agc-overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:620px){.agc-overview-row{grid-template-columns:1fr}.agc-overview-metrics{gap:7px}.agc-metric-card{padding:10px}.agc-metric-card strong{font-size:18px}}`;

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

function TaskGraphPanel(props: { snapshot: UiSnapshot; depFlash: Set<string>; labels?: UiLabels; onSelect?: (task: UiTask) => void }): any {
  const { snapshot, depFlash, labels = resolveLabels('en-US'), onSelect } = props;
  const rows = layeredGraph(snapshot.tasks);
  const byId = new Map(snapshot.tasks.map((t) => [t.id, t]));
  const memberOf = new Map(snapshot.members.map((m) => [m.sessionId, m.name]));
  return React.createElement(
    'div',
    { className: 'agc-taskgraph' },
    React.createElement('div', { className: 'agc-paneltitle' }, labels.dependencies),
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
              {
                className: `agc-tasknode ${task.status}`,
                key: task.id,
                role: onSelect === undefined ? undefined : 'button',
                tabIndex: onSelect === undefined ? undefined : 0,
                onClick: onSelect === undefined ? undefined : () => onSelect(task),
                onKeyDown: onSelect === undefined ? undefined : (event: any) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(task); } },
                'aria-label': onSelect === undefined ? undefined : `${task.title} · ${meta.label}`,
              },
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
    snapshot.tasks.length === 0 && React.createElement('div', { className: 'agc-empty' }, labels.noTasks),
  );
}

function ActivityFeed(props: { activity: BufferedActivity[]; filter: ActivityFilter; onFilter: (f: ActivityFilter) => void; onSelect: (item: BufferedActivity) => void; timeline: boolean; labels?: UiLabels }): any {
  const { activity, filter, onFilter, onSelect, timeline, labels = resolveLabels('en-US') } = props;
  const filters: ActivityFilter[] = ['ALL', 'TASKS', 'MESSAGES', 'AGENTS', 'FILES', 'REVIEWS'];
  const filterLabels: Record<ActivityFilter, string> = { ALL: labels.allActivity, TASKS: labels.tasks, MESSAGES: labels.messages, AGENTS: labels.agents, FILES: labels.files, REVIEWS: labels.reviews };
  const items = timeline ? [...activity].reverse() : filterActivity(activity, filter);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      { className: 'agc-filters' },
      filters.map((f) => React.createElement('button', { key: f, className: `agc-filter ${filter === f ? 'on' : ''}`, onClick: () => onFilter(f) }, filterLabels[f])),
    ),
    React.createElement(
      'div',
      { className: 'agc-feed' },
      items.length === 0 && React.createElement('div', { className: 'agc-empty' }, 'No activity yet. Team events will appear here in real time.'),
      items.map((item) =>
        React.createElement(
          'div',
          { className: 'agc-feeditem', key: item.id, onClick: () => onSelect(item), onKeyDown: (event: any) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(item); } }, tabIndex: 0, role: 'button', 'aria-label': item.title },
          React.createElement('span', { className: 'agc-feedtime' }, fmtTime(item.ts)),
          item.title,
        ),
      ),
    ),
  );
}

function localizedMemberStatus(status: string, labels: UiLabels): string {
  switch (status) {
    case 'working':
    case 'thinking':
    case 'starting':
      return labels.working;
    case 'reviewing':
      return labels.reviewing;
    case 'waiting':
    case 'idle':
    case 'blocked':
      return status === 'blocked' ? `${labels.waiting} · BLOCKED` : labels.waiting;
    case 'completed':
      return labels.completed;
    default:
      return status.toUpperCase();
  }
}

function localizedTaskStatus(status: string, labels: UiLabels): string {
  switch (status) {
    case 'pending':
      return labels.waiting;
    case 'in_progress':
      return labels.working;
    case 'blocked':
      return `${labels.waiting} · BLOCKED`;
    case 'completed':
      return labels.completed;
    default:
      return status.toUpperCase();
  }
}

function TaskDetail(props: { task: UiTask; snapshot: UiSnapshot; labels: UiLabels; onClose: () => void }): any {
  const { task, snapshot, labels, onClose } = props;
  const owner = task.ownerSessionId === undefined ? undefined : snapshot.members.find((member) => member.sessionId === task.ownerSessionId);
  const dependencyNames = task.dependencies.map((dependencyId) => {
    const dependency = snapshot.tasks.find((candidate) => candidate.id === dependencyId);
    return `${dependency?.status === 'completed' ? '✓' : '○'} ${dependency?.title ?? dependencyId}`;
  });
  const taskMeta = taskStatusMeta(task.status);
  return React.createElement('aside', { className: 'agc-taskdetail', role: 'dialog', 'aria-label': task.title },
    React.createElement('div', { className: 'agc-taskdetail-head' },
      React.createElement('div', null,
        React.createElement('div', { className: 'agc-paneltitle' }, labels.currentTask),
        React.createElement('h2', null, task.title),
      ),
      React.createElement('button', { className: 'agc-close', onClick: onClose, 'aria-label': labels.collapsePanel }, '×'),
    ),
    React.createElement('div', { className: `agc-status ${taskMeta.css}` }, `${taskMeta.icon} ${localizedTaskStatus(task.status, labels)}`),
    task.description !== undefined && task.description.trim() !== '' && React.createElement('div', { className: 'agc-taskdetail-section' },
      React.createElement('div', { className: 'agc-paneltitle' }, 'Description'),
      React.createElement('div', { className: 'agc-task-description' }, task.description),
    ),
    React.createElement('div', { className: 'agc-taskdetail-grid' },
      React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, labels.members), React.createElement('strong', null, owner?.name ?? '—')),
      React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, 'Priority'), React.createElement('strong', null, task.priority.toUpperCase())),
    ),
    React.createElement('div', { className: 'agc-taskdetail-section' },
      React.createElement('div', { className: 'agc-paneltitle' }, labels.dependencies),
      dependencyNames.length === 0 ? React.createElement('div', { className: 'agc-empty' }, labels.noTasks) : dependencyNames.map((name, index) => React.createElement('div', { key: `${task.id}-dependency-${index}`, className: 'agc-tool' }, name)),
    ),
    React.createElement('div', { className: 'agc-taskdetail-section' },
      React.createElement('div', { className: 'agc-paneltitle' }, labels.result),
      React.createElement('div', { className: 'agc-task-result' }, task.result ?? labels.noTasks),
    ),
  );
}

function compactEventCopy(item: BufferedActivity, labels: UiLabels): string {
  if (item.kind === 'message') return item.preview ?? labels.activity;
  if (item.kind === 'task-completed') return `${labels.completed} · ${item.title}`;
  if (item.kind === 'task-blocked') return `${labels.waitingDependencies} · ${item.title}`;
  return item.title || labels.activity;
}

function CompactActivity(props: {
  readonly snapshot: UiSnapshot;
  readonly activity: BufferedActivity[];
  readonly labels: UiLabels;
  readonly language: UiLanguage;
  readonly connection: 'connected' | 'reconnecting';
  readonly recoveredEventsCount: number;
  readonly onOpen: (sessionId: string) => void;
  readonly onExpand: () => void;
  readonly onClose: () => void;
  readonly onLanguage: () => void;
  readonly onPreferences: () => void;
}) : any {
  const { snapshot, activity, labels, language, connection, recoveredEventsCount, onOpen, onExpand, onClose, onLanguage, onPreferences } = props;
  const done = snapshot.progress.requiredDone;
  const total = snapshot.progress.requiredTotal || snapshot.tasks.length;
  const ratio = Math.round(snapshot.progress.ratio * 100);
  const working = snapshot.members.filter((m) => ['working', 'thinking', 'starting'].includes(m.status)).length;
  const waiting = snapshot.members.filter((m) => ['waiting', 'blocked', 'idle'].includes(m.status)).length;
  const reviewing = snapshot.members.filter((m) => m.status === 'reviewing').length;
  const recent = activity.slice(0, 4);
  return React.createElement(
    'aside',
    { className: 'agc-compact', id: 'agent-teams-panel', role: 'region', 'aria-label': labels.teamActivity },
    React.createElement('header', { className: 'agc-compact-head' },
      React.createElement('span', { className: 'agc-avatar', 'aria-hidden': true }, '🐳'),
      React.createElement('span', { className: 'agc-compact-title' },
        labels.teamActivity,
        React.createElement('small', null, language === 'zh-CN' ? '原生 Harness 专注模式' : 'Native Harness focus mode'),
      ),
      React.createElement('span', { className: `agc-compact-connection ${connection === 'reconnecting' ? 'reconnecting' : ''}` }, connection === 'connected' ? '● LIVE' : '↻ RECONNECTING'),
      recoveredEventsCount > 0 && React.createElement('span', {
        style: {
          fontSize: '9px',
          letterSpacing: '.06em',
          color: '#3fb950',
          marginLeft: '6px',
        },
      }, `↻ ${recoveredEventsCount}`),
      React.createElement('button', { className: 'agc-icon-btn', onClick: onLanguage, title: '中 / EN', 'aria-label': 'Toggle language' }, language === 'zh-CN' ? '中' : 'EN'),
      React.createElement('button', { className: 'agc-icon-btn', onClick: onPreferences, title: labels.customizeLabels, 'aria-label': labels.customizeLabels }, '⚙'),
      React.createElement('button', { className: 'agc-compact-close', onClick: onClose, title: labels.collapsePanel, 'aria-label': labels.collapsePanel }, '×'),
    ),
    React.createElement('div', { className: 'agc-compact-body' },
      React.createElement('section', { className: 'agc-compact-team' },
        React.createElement('span', { className: 'agc-avatar', 'aria-hidden': true }, '👑'),
        React.createElement('span', { className: 'agc-compact-team-copy' },
          React.createElement('span', { className: 'agc-compact-team-name' }, snapshot.teamName),
          React.createElement('span', { className: 'agc-compact-team-meta' }, `${snapshot.members.length} ${labels.members} · ${snapshot.teamGoal ?? snapshot.teamStatus}`),
        ),
        React.createElement('span', { className: `agc-status ${snapshot.teamStatus === 'completed' ? 'st-completed' : 'st-working'}` }, snapshot.teamStatus === 'completed' ? '✓' : '●'),
      ),
      React.createElement('section', { className: 'agc-compact-progress', 'aria-label': labels.overallProgress },
        React.createElement('div', { className: 'agc-compact-progress-head' },
          React.createElement('span', null, labels.overallProgress),
          React.createElement('span', { className: 'agc-compact-progress-value' }, `${ratio}%`),
        ),
        React.createElement('div', { className: 'agc-segments', 'aria-hidden': true },
          snapshot.tasks.map((task) => React.createElement('span', { key: task.id, 'data-state': task.status, title: task.title })),
        ),
        React.createElement('div', { className: 'agc-compact-stats' },
          React.createElement('span', { className: 'agc-compact-stat' }, `${working} ${labels.working}`),
          React.createElement('span', { className: 'agc-compact-stat', 'data-tone': 'warning' }, `${waiting} ${labels.waiting}`),
          React.createElement('span', { className: 'agc-compact-stat' }, `${reviewing} ${labels.reviewing}`),
          React.createElement('span', { className: 'agc-compact-stat', 'data-tone': 'success' }, `${done}/${total} ${labels.completed}`),
        ),
      ),
      React.createElement('section', { className: 'agc-compact-section' },
        React.createElement('div', { className: 'agc-compact-section-title' }, `◌ ${labels.members}`),
        React.createElement('div', { className: 'agc-compact-members' },
          snapshot.members.slice(0, 5).map((member) => {
            const task = snapshot.tasks.find((item) => item.id === member.currentTaskId);
            return React.createElement('button', { key: member.id, className: 'agc-compact-member', onClick: () => onOpen(member.sessionId), 'aria-label': `${member.name}, ${localizedMemberStatus(member.status, labels)}` },
              React.createElement('span', { className: 'agc-avatar', 'aria-hidden': true }, roleAvatar(member.role)),
              React.createElement('span', { className: 'agc-compact-member-copy' },
                React.createElement('span', { className: 'agc-compact-member-name' }, member.name),
                React.createElement('span', { className: 'agc-compact-member-task' }, task?.title ?? member.role),
              ),
              React.createElement('span', { className: `agc-status ${statusMeta(member.status).css}` }, localizedMemberStatus(member.status, labels)),
            );
          }),
        ),
      ),
      React.createElement('section', { className: 'agc-compact-section' },
        React.createElement('div', { className: 'agc-compact-section-title' }, `✦ ${labels.activity}`),
        recent.length === 0
          ? React.createElement('div', { className: 'agc-empty' }, labels.activity)
          : recent.map((item) => React.createElement('div', { key: item.id, className: 'agc-compact-event' },
              React.createElement('span', { className: 'agc-compact-event-dot', 'aria-hidden': true }),
              React.createElement('span', { className: 'agc-compact-event-copy' }, compactEventCopy(item, labels), React.createElement('span', { className: 'agc-compact-event-time' }, fmtTime(item.ts))),
            )),
      ),
      React.createElement('footer', { className: 'agc-compact-footer' },
        React.createElement('button', { className: 'agc-btn primary', onClick: onExpand }, labels.expandWorkspace),
        React.createElement('button', { className: 'agc-btn', onClick: () => onOpen(snapshot.leadSessionId ?? ''), disabled: snapshot.leadSessionId === undefined }, labels.openInspector),
      ),
    ),
  );
}

const CUSTOM_LABEL_KEYS: Array<keyof UiLabels> = [
  'productName', 'agentTeams', 'focusMode', 'workspaceMode', 'overview', 'sessions', 'settings', 'teamActivity', 'teamSummary', 'membersDelegation', 'livePreview', 'captain', 'started', 'elapsed', 'openInInspector', 'teamRoster', 'status', 'priority', 'result', 'noEvents', 'noCurrentTask', 'overallProgress', 'members', 'activity',
  'dependencies', 'customizeLabels', 'expandWorkspace', 'openInspector', 'messageTeam', 'liveSession',
  'currentTask', 'files', 'send', 'interrupt', 'cancel', 'allActivity', 'tasks', 'messages', 'agents', 'reviews', 'noTasks',
  'reconnecting', 'waitingDependencies', 'working', 'waiting', 'reviewing', 'completed',
];

function PreferencesDialog(props: {
  readonly language: UiLanguage;
  readonly labels: UiLabels;
  readonly overrides: UiLabelOverrides;
  readonly onClose: () => void;
  readonly onLanguage: (language: UiLanguage) => void;
  readonly onSave: (overrides: UiLabelOverrides) => void;
}): any {
  const { language, labels, overrides, onClose, onLanguage, onSave } = props;
  const [draft, setDraft] = React.useState<UiLabelOverrides>(() => ({ ...overrides }));
  React.useEffect(() => setDraft({ ...overrides }), [language, overrides]);
  React.useEffect(() => {
    const handler = (event: any) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);
  return React.createElement('div', { className: 'agc-preferences', role: 'dialog', 'aria-modal': true, 'aria-label': labels.customizeLabels, onClick: onClose },
    React.createElement('div', { className: 'agc-preferences-card', onClick: (event: any) => event.stopPropagation() },
      React.createElement('div', { className: 'agc-preferences-head' },
        React.createElement('div', null,
          React.createElement('h2', null, labels.customizeLabels),
          React.createElement('p', null, language === 'zh-CN' ? '切换语言，或覆盖常用界面词汇。Runtime ID 不会改变。' : 'Switch language or customize common UI labels. Runtime IDs stay unchanged.'),
        ),
        React.createElement('button', { className: 'agc-close', onClick: onClose, 'aria-label': 'Close' }, '×'),
      ),
      React.createElement('div', { className: 'agc-mode-pill', role: 'group', 'aria-label': 'Language' },
        React.createElement('button', { type: 'button', 'data-on': language === 'zh-CN', onClick: () => onLanguage('zh-CN') }, '中文'),
        React.createElement('button', { type: 'button', 'data-on': language === 'en-US', onClick: () => onLanguage('en-US') }, 'English'),
      ),
      React.createElement('div', { className: 'agc-preferences-grid', style: { marginTop: 16 } },
        CUSTOM_LABEL_KEYS.map((key) => React.createElement('label', { key },
          key,
          React.createElement('input', {
            value: draft[key] ?? '',
            placeholder: labels[key],
            maxLength: 80,
            onChange: (event: any) => setDraft((previous) => ({ ...previous, [key]: event.target.value })),
          }),
        )),
      ),
      React.createElement('div', { className: 'agc-preferences-actions' },
        React.createElement('button', { className: 'agc-btn', onClick: onClose }, language === 'zh-CN' ? '取消' : 'Cancel'),
        React.createElement('button', { className: 'agc-btn primary', onClick: () => { onSave(draft); onClose(); } }, language === 'zh-CN' ? '保存' : 'Save'),
      ),
    ),
  );
}

function WorkspaceOverview(props: { readonly snapshot: UiSnapshot; readonly labels: UiLabels }): any {
  const { snapshot, labels } = props;
  const counts = statusCounts(snapshot.members);
  const working = (counts.working ?? 0) + (counts.thinking ?? 0) + (counts.starting ?? 0);
  const waiting = (counts.waiting ?? 0) + (counts.blocked ?? 0);
  const reviewing = counts.reviewing ?? 0;
  const completed = snapshot.progress.requiredDone;
  return React.createElement('section', { className: 'agc-overview' },
    React.createElement('div', { className: 'agc-overview-metrics' },
      React.createElement('div', { className: 'agc-metric-card' }, React.createElement('span', null, labels.members), React.createElement('strong', null, snapshot.members.length), React.createElement('small', null, 'Team roster')),
      React.createElement('div', { className: 'agc-metric-card' }, React.createElement('span', null, labels.tasks), React.createElement('strong', null, snapshot.tasks.length), React.createElement('small', null, `${completed} ${labels.completed}`)),
      React.createElement('div', { className: 'agc-metric-card' }, React.createElement('span', null, labels.overallProgress), React.createElement('strong', null, `${Math.round(snapshot.progress.ratio * 100)}%`), React.createElement('small', null, snapshot.teamStatus)),
      React.createElement('div', { className: 'agc-metric-card' }, React.createElement('span', null, labels.messages), React.createElement('strong', null, snapshot.messages.length), React.createElement('small', null, snapshot.teamName)),
    ),
    React.createElement('div', { className: 'agc-overview-row' },
      React.createElement('div', { className: 'agc-captain-card' },
        React.createElement('span', { className: 'agc-avatar agc-avatar-large', 'aria-hidden': true }, '🐳'),
        React.createElement('span', null,
          React.createElement('strong', null, snapshot.teamName),
          React.createElement('small', null, `${working > 0 ? `${working} ${labels.working}` : labels.waiting}${snapshot.teamGoal === undefined ? '' : ` · ${snapshot.teamGoal}`}`),
        ),
        React.createElement('span', { className: 'agc-captain-mark' }, '✦'),
      ),
      React.createElement('div', { className: 'agc-status-card' },
        React.createElement('span', { className: 'agc-status-card-title' }, labels.activity),
        React.createElement('span', { className: 'agc-status-card-items' },
          React.createElement('span', null, React.createElement('i', { className: 'agc-dot working' }), `${working} ${labels.working}`),
          React.createElement('span', null, React.createElement('i', { className: 'agc-dot waiting' }), `${waiting} ${labels.waiting}`),
          React.createElement('span', null, React.createElement('i', { className: 'agc-dot reviewing' }), `${reviewing} ${labels.reviewing}`),
          React.createElement('span', null, React.createElement('i', { className: 'agc-dot completed' }), `${completed} ${labels.completed}`),
        ),
      ),
    ),
  );
}

type WorkspaceTab = 'overview' | 'activity' | 'members' | 'dependencies' | 'sessions' | 'settings';

function formatElapsed(createdAt?: number): string {
  if (createdAt === undefined || !Number.isFinite(createdAt)) return '—';
  const seconds = Math.max(0, Math.floor((Date.now() - createdAt) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = seconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function WorkspaceSidebar(props: { active: WorkspaceTab; labels: UiLabels; onSelect: (tab: WorkspaceTab) => void; onSettings: () => void }): any {
  const { active, labels, onSelect, onSettings } = props;
  const items: Array<{ id: WorkspaceTab; icon: string; label: string }> = [
    { id: 'overview', icon: '⌂', label: labels.overview },
    { id: 'activity', icon: '◌', label: labels.activity },
    { id: 'members', icon: '♧', label: labels.members },
    { id: 'dependencies', icon: '⌘', label: labels.dependencies },
    { id: 'sessions', icon: '▣', label: labels.sessions },
  ];
  return React.createElement('nav', { className: 'agc-workspace-nav', 'aria-label': labels.workspaceMode },
    items.map((item) => React.createElement('button', {
      key: item.id,
      className: `agc-navitem ${active === item.id ? 'on' : ''}`,
      onClick: () => onSelect(item.id),
      'aria-current': active === item.id ? 'page' : undefined,
    }, React.createElement('span', { className: 'agc-navicon', 'aria-hidden': true }, item.icon), React.createElement('span', null, item.label))),
    React.createElement('button', { className: `agc-navitem ${active === 'settings' ? 'on' : ''}`, onClick: onSettings, 'aria-current': active === 'settings' ? 'page' : undefined }, React.createElement('span', { className: 'agc-navicon', 'aria-hidden': true }, '⚙'), React.createElement('span', null, labels.settings)),
  );
}

function WorkspaceCard(props: { title: string; className?: string; children: unknown; action?: unknown }): any {
  const { title, className = '', children, action } = props;
  return React.createElement('section', { className: `agc-workspace-card ${className}` },
    React.createElement('header', { className: 'agc-workspace-card-head' }, React.createElement('h2', null, title), action),
    React.createElement('div', { className: 'agc-workspace-card-body' }, children),
  );
}

function TeamSummaryCard(props: { snapshot: UiSnapshot; labels: UiLabels }): any {
  const { snapshot, labels } = props;
  const counts = statusCounts(snapshot.members);
  const stats = [
    { key: 'working', label: labels.working, value: (counts.working ?? 0) + (counts.thinking ?? 0) + (counts.starting ?? 0), tone: 'working' },
    { key: 'waiting', label: labels.waiting, value: (counts.waiting ?? 0) + (counts.idle ?? 0) + (counts.blocked ?? 0), tone: 'waiting' },
    { key: 'reviewing', label: labels.reviewing, value: counts.reviewing ?? 0, tone: 'reviewing' },
    { key: 'completed', label: labels.completed, value: counts.completed ?? 0, tone: 'completed' },
  ];
  return React.createElement(WorkspaceCard, { title: labels.teamSummary, className: 'agc-summary-card' },
    React.createElement('div', { className: 'agc-summary-progress-head' }, React.createElement('span', null, `${labels.overallProgress} / Progress`), React.createElement('strong', null, `${Math.round(snapshot.progress.ratio * 100)}%`)),
    React.createElement('div', { className: 'agc-summary-progress' }, snapshot.tasks.map((task) => React.createElement('span', { key: task.id, 'data-state': task.status, title: task.title }))),
    React.createElement('div', { className: 'agc-summary-stats' }, stats.map((stat) => React.createElement('div', { className: `agc-summary-stat ${stat.tone}`, key: stat.key }, React.createElement('strong', null, stat.value), React.createElement('span', null, stat.label)))),
    React.createElement('div', { className: 'agc-summary-meta' }, `${labels.started} ${snapshot.teamCreatedAt === undefined ? '—' : fmtTime(snapshot.teamCreatedAt)}  ·  ${labels.elapsed} ${formatElapsed(snapshot.teamCreatedAt)}`),
  );
}

function CaptainCard(props: { snapshot: UiSnapshot; labels: UiLabels; onOpen: (sessionId: string) => void }): any {
  const { snapshot, labels, onOpen } = props;
  const captain = snapshot.members.find((member) => member.role === 'lead') ?? snapshot.members[0];
  const task = captain?.currentTaskId === undefined ? undefined : snapshot.tasks.find((candidate) => candidate.id === captain.currentTaskId);
  const meta = captain === undefined ? undefined : statusMeta(captain.status);
  return React.createElement(WorkspaceCard, { title: labels.captain, className: 'agc-captain-workspace-card' },
    captain === undefined ? React.createElement('div', { className: 'agc-empty' }, labels.noTeams) : React.createElement('button', { className: 'agc-captain-profile', onClick: () => onOpen(captain.sessionId) },
      React.createElement('span', { className: 'agc-avatar agc-avatar-captain', 'aria-hidden': true }, '🐳'),
      React.createElement('span', { className: 'agc-captain-copy' }, React.createElement('strong', null, captain.name), React.createElement('span', { className: `agc-status ${meta?.css ?? 'st-idle'}` }, `${meta?.icon ?? '○'} ${meta?.label ?? labels.waiting}`), React.createElement('small', null, task?.title ?? labels.waitingDependencies), React.createElement('small', null, snapshot.teamGoal ?? labels.teamActivity)),
      React.createElement('span', { className: 'agc-captain-star', 'aria-hidden': true }, '✦'),
    ),
  );
}

function WorkspaceActivityCard(props: { activity: BufferedActivity[]; labels: UiLabels; onSelect: (item: BufferedActivity) => void }): any {
  const { activity, labels, onSelect } = props;
  const [filter, setFilter] = React.useState<ActivityFilter>('ALL');
  const filters: ActivityFilter[] = ['ALL', 'TASKS', 'MESSAGES', 'AGENTS', 'FILES', 'REVIEWS'];
  const filterLabels: Record<ActivityFilter, string> = { ALL: labels.allActivity, TASKS: labels.tasks, MESSAGES: labels.messages, AGENTS: labels.agents, FILES: labels.files, REVIEWS: labels.reviews };
  const items = filterActivity(activity, filter).slice(0, 7);
  return React.createElement(WorkspaceCard, { title: `${labels.activity} / Activity`, className: 'agc-activity-workspace-card', action: React.createElement('select', { className: 'agc-select agc-activity-select', value: filter, onChange: (event: any) => setFilter(event.target.value as ActivityFilter), 'aria-label': labels.activity }, filters.map((item) => React.createElement('option', { key: item, value: item }, filterLabels[item]))) },
    items.length === 0 ? React.createElement('div', { className: 'agc-empty' }, labels.noEvents) : React.createElement('div', { className: 'agc-workspace-activity-list' }, items.map((item) => React.createElement('button', { key: item.id, className: 'agc-workspace-activity-row', onClick: () => onSelect(item) }, React.createElement('span', { className: 'agc-activity-avatar', 'aria-hidden': true }, item.kind === 'message' ? '💬' : item.kind.startsWith('task') ? '◇' : item.kind === 'finding' ? '◈' : '•'), React.createElement('span', { className: 'agc-activity-copy' }, React.createElement('strong', null, item.title || labels.activity), React.createElement('small', null, item.preview ?? compactEventCopy(item, labels))), React.createElement('span', { className: 'agc-activity-right' }, React.createElement('time', null, fmtTime(item.ts)), React.createElement('span', { className: `agc-status ${item.kind === 'task-completed' ? 'st-completed' : item.kind === 'task-blocked' ? 'st-blocked' : 'st-working'}` }, item.kind === 'task-completed' ? labels.completed : item.kind === 'task-blocked' ? labels.waiting : labels.working))))),
  );
}

function MembersDelegationCard(props: { snapshot: UiSnapshot; labels: UiLabels; onOpen: (sessionId: string) => void }): any {
  const { snapshot, labels, onOpen } = props;
  // Some persisted Teams expose the captain as a host session rather than a
  // member row. Keep the hierarchy useful by promoting the first real member
  // as the visual captain instead of rendering an empty delegation card.
  const lead = snapshot.members.find((member) => member.role === 'lead') ?? snapshot.members[0];
  const others = snapshot.members.filter((member) => member !== lead).slice(0, 4);
  const memberCard = (member: UiMember) => {
    const meta = statusMeta(member.status);
    return React.createElement('button', { key: member.id, className: 'agc-delegation-member', onClick: () => onOpen(member.sessionId) }, React.createElement('span', { className: 'agc-avatar agc-avatar-small', 'aria-hidden': true }, roleAvatar(member.role)), React.createElement('strong', null, member.name), React.createElement('small', null, member.role), React.createElement('span', { className: `agc-status ${meta.css}` }, `${meta.icon} ${localizedMemberStatus(member.status, labels)}`));
  };
  return React.createElement(WorkspaceCard, { title: `${labels.members} / ${labels.membersDelegation}`, className: 'agc-members-workspace-card' },
    lead === undefined ? React.createElement('div', { className: 'agc-empty' }, labels.noTeams) : React.createElement('div', { className: 'agc-delegation' }, React.createElement('button', { className: 'agc-delegation-lead', onClick: () => onOpen(lead.sessionId) }, React.createElement('span', { className: 'agc-avatar agc-avatar-small agc-avatar-captain', 'aria-hidden': true }, '🐳'), React.createElement('span', null, React.createElement('strong', null, lead.name), React.createElement('small', null, labels.captain))), React.createElement('div', { className: 'agc-delegation-lines', 'aria-hidden': true }, others.map((member) => React.createElement('span', { key: member.id }))), React.createElement('div', { className: 'agc-delegation-grid' }, others.map(memberCard))),
  );
}

function firstLinePreview(text: string, maxLength = 140): string {
  const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? '';
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, Math.max(0, maxLength - 1))}…`;
}

function sessionItemPreview(item: SafeSessionItem): string {
  if (item.kind === 'tool-result') {
    const lineCount = item.text.split(/\r?\n/).length;
    const preview = firstLinePreview(item.text) || '✓ completed';
    return lineCount > 1 ? `${preview} · ${lineCount} lines · click to expand` : preview;
  }
  return firstLinePreview(item.text || item.args || 'event');
}

function SessionItemRow(props: { item: SafeSessionItem }): any {
  const { item } = props;
  const kind = item.kind === 'tool-call'
    ? `⚙ ${item.name ?? 'tool'} · call`
    : item.kind === 'tool-result'
      ? `✓ ${item.name ?? 'tool'} · result${item.error ? ' · failed' : ''}`
      : item.kind.toUpperCase();
  if (item.kind === 'tool-call' || item.kind === 'tool-result') {
    return React.createElement('details', { className: 'agc-session-tool' },
      React.createElement('summary', null, kind, React.createElement('span', { className: 'agc-session-tool-preview' }, sessionItemPreview(item))),
      item.kind === 'tool-call'
        ? React.createElement('pre', null, item.args ?? item.text)
        : React.createElement(React.Fragment, null,
            React.createElement('div', { className: 'agc-session-tool-summary' }, sessionItemPreview(item)),
            React.createElement('pre', null, item.text || '✓ completed'),
          ),
    );
  }
  return React.createElement('div', { className: 'agc-session-row' },
    React.createElement('div', { className: 'agc-session-kind' }, kind),
    React.createElement('div', null, item.text),
  );
}

function LiveSessionCard(props: { snapshot: UiSnapshot; session?: SafeSessionSnapshot; sessionId?: string; activity: BufferedActivity[]; labels: UiLabels }): any {
  const { snapshot, session, sessionId, activity, labels } = props;
  const member = sessionId === undefined ? undefined : snapshot.members.find((candidate) => candidate.sessionId === sessionId);
  const fallback = sessionId === undefined ? [] : activity.filter((item) => item.sessionId === sessionId).slice(0, 5);
  return React.createElement(WorkspaceCard, { title: `${labels.livePreview} / ${labels.liveSession}`, className: 'agc-live-workspace-card', action: React.createElement('span', { className: `agc-live-mark ${session?.running ? '' : 'idle'}` }, session?.running ? '● Live' : '○ Idle') },
    React.createElement('div', { className: 'agc-terminal' },
      member !== undefined && React.createElement('div', { className: 'agc-terminal-target' }, `${roleAvatar(member.role)} ${member.name}`),
      session?.items.length ? session.items.slice(-5).map((item) => React.createElement('div', { className: 'agc-terminal-row', key: item.id }, React.createElement('time', null, item.time === undefined ? '—' : fmtTime(item.time)), React.createElement('strong', null, item.kind === 'tool-call' ? `⚙ ${item.name ?? 'tool'}` : item.kind === 'tool-result' ? `✓ ${item.name ?? 'tool'}` : member?.name ?? 'Agent'), React.createElement('span', { title: sessionItemPreview(item) }, sessionItemPreview(item)))) : fallback.length ? fallback.map((item) => React.createElement('div', { className: 'agc-terminal-row', key: item.id }, React.createElement('time', null, fmtTime(item.ts)), React.createElement('strong', null, member?.name ?? 'Agent'), React.createElement('span', null, compactEventCopy(item, labels)))) : React.createElement('div', { className: 'agc-terminal-empty' }, labels.noEvents),
    ),
  );
}

function TeamMessageCard(props: { snapshot: UiSnapshot; bridge: Bridge; labels: UiLabels }): any {
  const { snapshot, bridge, labels } = props;
  const [recipient, setRecipient] = React.useState('team');
  const [draft, setDraft] = React.useState('');
  const [feedback, setFeedback] = React.useState<string | null>(null);
  const send = async () => {
    if (draft.trim() === '') return;
    const result = await bridge.sendMessage(snapshot.teamId, recipient === 'team' ? undefined : recipient, draft.trim());
    setFeedback(result?.message?.deliveryState === 'failed' ? 'Message delivery failed' : 'Message delivered');
    setDraft('');
  };
  return React.createElement(WorkspaceCard, { title: `${labels.messages} / Message`, className: 'agc-message-workspace-card' },
    React.createElement('select', { className: 'agc-message-recipient agc-select', value: recipient, onChange: (event: any) => setRecipient(event.target.value), 'aria-label': labels.messageTeam }, React.createElement('option', { value: 'team' }, `${labels.messageTeam} · ${snapshot.teamName}`), snapshot.members.map((member) => React.createElement('option', { key: member.sessionId, value: member.sessionId }, `${labels.messageTeam} · ${member.name}`))),
    React.createElement('textarea', { className: 'agc-message-input', value: draft, placeholder: `${labels.messageTeam} · ${snapshot.teamName}...`, rows: 3, onChange: (event: any) => setDraft(event.target.value), onKeyDown: (event: any) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send(); } }),
    React.createElement('div', { className: 'agc-message-actions' }, React.createElement('span', { className: 'agc-message-tools', 'aria-hidden': true }, '⌕  @  </>'), React.createElement('button', { className: 'agc-btn primary agc-send', onClick: () => void send() }, '➤'), feedback !== null && React.createElement('span', { className: 'agc-message-feedback' }, feedback)),
  );
}

function AgentInspectorCard(props: { snapshot: UiSnapshot; activity: BufferedActivity[]; sessionId?: string; inspectorOpen: boolean; labels: UiLabels; onOpen: (sessionId: string) => void }): any {
  const { snapshot, activity, sessionId, inspectorOpen, labels, onOpen } = props;
  const member = sessionId === undefined ? undefined : snapshot.members.find((candidate) => candidate.sessionId === sessionId);
  if (member === undefined) return React.createElement(WorkspaceCard, { title: labels.agentTeams, className: 'agc-inspector-workspace-card' }, React.createElement('div', { className: 'agc-empty' }, labels.noTeams));
  if (inspectorOpen) return React.createElement(WorkspaceCard, { title: `${labels.agentTeams} · ${labels.openInspector}`, className: 'agc-inspector-workspace-card' },
    React.createElement('div', { className: 'agc-inspector-handoff' },
      React.createElement('span', { className: 'agc-avatar agc-avatar-inspector', 'aria-hidden': true }, '↗'),
      React.createElement('div', null, React.createElement('strong', null, labels.openInspector), React.createElement('span', null, 'The selected member is open in the side panel.')),
    ),
  );
  const meta = statusMeta(member.status);
  const task = member.currentTaskId === undefined ? undefined : snapshot.tasks.find((candidate) => candidate.id === member.currentTaskId);
  const claims = snapshot.fileClaims.filter((claim) => claim.ownerSessionId === member.sessionId);
  const lastActivity = activity.find((item) => item.sessionId === member.sessionId);
  return React.createElement(WorkspaceCard, { title: labels.agentTeams, className: 'agc-inspector-workspace-card' },
    React.createElement('div', { className: 'agc-inspector-profile' }, React.createElement('span', { className: 'agc-avatar agc-avatar-inspector', 'aria-hidden': true }, roleAvatar(member.role)), React.createElement('div', null, React.createElement('strong', null, member.name), React.createElement('span', { className: `agc-status ${meta.css}` }, `${meta.icon} ${localizedMemberStatus(member.status, labels)}`))),
    React.createElement('div', { className: 'agc-inspector-lines' }, React.createElement('div', null, React.createElement('span', null, labels.currentTask), React.createElement('strong', null, task?.title ?? labels.noCurrentTask)), React.createElement('div', null, React.createElement('span', null, labels.files), React.createElement('strong', null, claims.length > 0 ? claims.map((claim) => claim.pattern).join(', ') : '—')), React.createElement('div', null, React.createElement('span', null, labels.activity), React.createElement('strong', null, lastActivity?.title ?? labels.noEvents))),
    React.createElement('button', { className: 'agc-inspector-open', onClick: () => onOpen(member.sessionId) }, labels.openInInspector, ' ↗'),
  );
}

function WorkspaceSettingsCard(props: { labels: UiLabels; language: UiLanguage; onLanguage: () => void; onPreferences: () => void }): any {
  const { labels, language, onLanguage, onPreferences } = props;
  return React.createElement(WorkspaceCard, { title: labels.settings, className: 'agc-settings-workspace-card' },
    React.createElement('div', { className: 'agc-settings-summary' },
      React.createElement('strong', null, labels.customizeLabels),
      React.createElement('span', null, language === 'zh-CN' ? '当前界面语言：中文' : 'Current interface language: English'),
    ),
    React.createElement('div', { className: 'agc-settings-actions' },
      React.createElement('button', { className: 'agc-btn', onClick: onLanguage }, language === 'zh-CN' ? '中文 / English' : 'English / 中文'),
      React.createElement('button', { className: 'agc-btn primary', onClick: onPreferences }, labels.customizeLabels),
    ),
  );
}

function WorkspaceLayout(props: {
  snapshot: UiSnapshot;
  activity: BufferedActivity[];
  labels: UiLabels;
  language: UiLanguage;
  bridge: Bridge;
  session?: SafeSessionSnapshot;
  sessionId?: string;
  inspectorOpen: boolean;
  depFlash: Set<string>;
  connection: 'connected' | 'reconnecting';
  recoveredEventsCount: number;
  activeTab: WorkspaceTab;
  submittedPlans: UiSnapshot['plans'];
  blockers: string[];
  openFindings: UiSnapshot['findings'];
  onTab: (tab: WorkspaceTab) => void;
  onSettings: () => void;
  onOpen: (sessionId: string) => void;
  onActivity: (item: BufferedActivity) => void;
  onTask: (task: UiTask) => void;
  onClose: () => void;
  onBack?: () => void;
  onLanguage: () => void;
  onPreferences: () => void;
}): any {
  const { snapshot, activity, labels, language, bridge, session, sessionId, inspectorOpen, depFlash, connection, recoveredEventsCount, activeTab, submittedPlans, blockers, openFindings, onTab, onSettings, onOpen, onActivity, onTask, onClose, onBack, onLanguage, onPreferences } = props;
  const memberName = (sid: string): string => snapshot.members.find((member) => member.sessionId === sid)?.name ?? sid.slice(0, 8);
  const overviewGrid = React.createElement('div', { className: 'agc-workspace-grid', 'data-active-tab': activeTab },
    React.createElement(TeamSummaryCard, { snapshot, labels }),
    React.createElement(CaptainCard, { snapshot, labels, onOpen }),
    React.createElement(WorkspaceActivityCard, { activity, labels, onSelect: onActivity }),
    React.createElement(MembersDelegationCard, { snapshot, labels, onOpen }),
    React.createElement(WorkspaceCard, { title: `${labels.dependencies} / Dependencies`, className: 'agc-dependencies-workspace-card' }, React.createElement(TaskGraphPanel, { snapshot, depFlash, labels, onSelect: onTask })),
    React.createElement(LiveSessionCard, { snapshot, session, sessionId, activity, labels }),
    React.createElement(TeamMessageCard, { snapshot, bridge, labels }),
    React.createElement(AgentInspectorCard, { snapshot, activity, sessionId, inspectorOpen, labels, onOpen }),
  );
  const routeGrid = (children: unknown[]): any => React.createElement('div', { className: 'agc-workspace-route-grid', 'data-active-tab': activeTab }, children);
  const routeContent = activeTab === 'overview'
    ? overviewGrid
    : activeTab === 'activity'
      ? routeGrid([
          React.createElement(WorkspaceActivityCard, { key: 'activity', activity, labels, onSelect: onActivity }),
          React.createElement(TeamSummaryCard, { key: 'summary', snapshot, labels }),
        ])
      : activeTab === 'members'
        ? routeGrid([
            React.createElement(MembersDelegationCard, { key: 'members', snapshot, labels, onOpen }),
            React.createElement(CaptainCard, { key: 'captain', snapshot, labels, onOpen }),
            React.createElement(AgentInspectorCard, { key: 'inspector', snapshot, activity, sessionId, inspectorOpen, labels, onOpen }),
          ])
        : activeTab === 'dependencies'
          ? routeGrid([
              React.createElement(WorkspaceCard, { key: 'dependencies', title: `${labels.dependencies} / Dependencies`, className: 'agc-route-card agc-route-card-wide' }, React.createElement(TaskGraphPanel, { snapshot, depFlash, labels, onSelect: onTask })),
              React.createElement(TeamSummaryCard, { key: 'summary', snapshot, labels }),
            ])
          : activeTab === 'sessions'
            ? routeGrid([
                React.createElement(LiveSessionCard, { key: 'live', snapshot, session, sessionId, activity, labels }),
                React.createElement(TeamMessageCard, { key: 'message', snapshot, bridge, labels }),
                React.createElement(AgentInspectorCard, { key: 'inspector', snapshot, activity, sessionId, inspectorOpen, labels, onOpen }),
              ])
            : routeGrid([
                React.createElement(WorkspaceSettingsCard, { key: 'settings', labels, language, onLanguage, onPreferences }),
              ]);
  return React.createElement('div', { className: 'agc-surface agc-workspace-shell', id: 'agent-teams-panel', role: 'region', 'aria-label': labels.workspaceMode, onClick: (event: any) => event.stopPropagation() },
    React.createElement('header', { className: 'agc-workspace-head' },
      React.createElement('span', { className: 'agc-brand-mark', 'aria-hidden': true }, '🐳'),
      React.createElement('span', { className: 'agc-brand-divider', 'aria-hidden': true }),
      React.createElement('strong', { className: 'agc-brand-name' }, labels.productName),
      React.createElement('span', { className: 'agc-brand-divider', 'aria-hidden': true }),
      React.createElement('div', { className: 'agc-workspace-team-title' }, React.createElement('strong', null, snapshot.teamName), React.createElement('span', null, snapshot.teamGoal ?? labels.workspaceMode), React.createElement('span', { className: 'agc-team-chevron', 'aria-hidden': true }, '⌄')),
      React.createElement('div', { className: 'agc-workspace-head-actions' },
        React.createElement('span', { className: `agc-connection ${connection === 'reconnecting' ? 'reconnecting' : ''}` }, connection === 'connected' ? '● LIVE' : '↻ RECONNECTING…'),
        recoveredEventsCount > 0 && React.createElement('span', {
          style: {
            fontSize: '10px',
            letterSpacing: '.06em',
            color: '#3fb950',
            marginLeft: '8px',
            animation: 'fadeIn 0.3s ease-in',
          },
        }, `↻ Recovered ${recoveredEventsCount} event${recoveredEventsCount > 1 ? 's' : ''}`),
        React.createElement('span', { className: 'agc-mode-pill', role: 'group', 'aria-label': labels.workspaceMode }, React.createElement('button', { type: 'button', 'data-on': false, onClick: onClose }, labels.focusMode), React.createElement('button', { type: 'button', 'data-on': true }, labels.workspaceMode)),
        React.createElement('button', { className: 'agc-icon-btn', onClick: onLanguage, title: '中 / EN', 'aria-label': 'Toggle language' }, language === 'zh-CN' ? '中' : 'EN'),
        React.createElement('button', { className: 'agc-icon-btn', onClick: onPreferences, title: labels.customizeLabels, 'aria-label': labels.customizeLabels }, '⚙'),
        onBack !== undefined && React.createElement('button', { className: 'agc-btn', onClick: onBack }, labels.agentTeams),
        React.createElement('button', { className: 'agc-close', onClick: onClose, 'aria-label': labels.collapsePanel }, '×'),
      ),
    ),
    React.createElement('div', { className: 'agc-workspace-layout' },
      React.createElement(WorkspaceSidebar, { active: activeTab, labels, onSelect: onTab, onSettings }),
      React.createElement('main', { className: 'agc-workspace-main' },
        React.createElement('div', { className: 'agc-workspace-main-head' }, React.createElement('div', null, React.createElement('span', { className: 'agc-eyebrow' }, activeTab === 'overview' ? labels.overview : activeTab === 'settings' ? labels.settings : labels[activeTab === 'sessions' ? 'sessions' : activeTab]), React.createElement('h1', null, snapshot.teamName)), React.createElement('span', { className: `agc-status ${snapshot.teamStatus === 'completed' ? 'st-completed' : snapshot.teamStatus === 'active' ? 'st-working' : 'st-idle'}` }, `${snapshot.teamStatus === 'active' ? '●' : snapshot.teamStatus === 'completed' ? '✓' : '○'} ${snapshot.teamStatus.toUpperCase()}`)),
        (submittedPlans.length > 0 || blockers.length > 0 || openFindings.length > 0) && React.createElement('div', { className: 'agc-workspace-alerts' },
          submittedPlans.length > 0 && React.createElement('div', { className: 'agc-workspace-alert plan agc-plan-alert' },
            React.createElement('div', { className: 'agc-plan-alert-head' }, `◈ ${submittedPlans.length} plan${submittedPlans.length > 1 ? 's' : ''} awaiting review`),
            submittedPlans.map((plan) => {
              const author = snapshot.members.find((member) => member.sessionId === plan.authorSessionId);
              const task = snapshot.tasks.find((candidate) => candidate.id === plan.taskId);
              return React.createElement('div', { key: plan.id, className: 'agc-plan-review-row' },
                React.createElement('span', null, `${author?.name ?? 'member'} · ${task?.title ?? plan.taskId}`),
                React.createElement('button', { className: 'agc-btn primary', onClick: () => void bridge.approvePlan(snapshot.teamId, plan.id) }, 'Approve'),
                React.createElement('input', { className: 'agc-plan-reject-input', placeholder: 'Reject with feedback…', onKeyDown: (event: any) => { if (event.key === 'Enter' && event.target.value.trim() !== '') void bridge.rejectPlan(snapshot.teamId, plan.id, event.target.value.trim()); } }),
              );
            }),
          ),
          blockers.length > 0 && React.createElement('div', { className: 'agc-workspace-alert block' }, `⚠ ${blockers.length} blocked ${labels.tasks}`),
          openFindings.length > 0 && React.createElement('div', { className: 'agc-workspace-alert review' }, `◈ ${openFindings.length} ${labels.reviews}`),
        ),
        routeContent,
      ),
    ),
  );
}

function Inspector(props: { snapshot: UiSnapshot; sessionId: string; bridge: Bridge; onClose: () => void; activity: BufferedActivity[]; session?: SafeSessionSnapshot; labels?: UiLabels }): any {
  const { snapshot, sessionId, bridge, onClose, activity, session, labels = resolveLabels('en-US') } = props;
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
  }, [onClose]);
  React.useEffect(() => {
    setTab('activity');
    setFollow(true);
    setDraft('');
    setConfirmInterrupt(false);
    setSent(null);
  }, [sessionId]);
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
        React.createElement('div', { className: 'agc-paneltitle' }, labels.currentTask),
        currentTask !== undefined
          ? React.createElement(React.Fragment, null,
              React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, currentTask.title), React.createElement('span', { className: `agc-status ${taskStatusMeta(currentTask.status).css}` }, taskStatusMeta(currentTask.status).icon)),
              React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, 'Priority'), React.createElement('span', null, currentTask.priority.toUpperCase())),
              currentTask.dependencies.length > 0 && React.createElement('div', { className: 'agc-kv' }, React.createElement('span', null, 'Dependencies'), React.createElement('span', null, currentTask.dependencies.map((d) => { const dep = snapshot.tasks.find((t) => t.id === d); return `${dep?.status === 'completed' ? '✓' : '○'} ${dep?.title ?? d}`; }).join(', '))),
            )
          : React.createElement('div', { className: 'agc-empty' }, 'No current task.'),
      ),
      myClaims.length > 0 && React.createElement('div', { className: 'agc-card' },
        React.createElement('div', { className: 'agc-paneltitle' }, labels.files),
        myClaims.map((c) => React.createElement('div', { key: c.id, className: 'agc-tool' }, `${c.kind} ${c.pattern}`)),
      ),
      React.createElement('div', { className: 'agc-tabs' },
        tabs.map((t) => React.createElement('button', { key: t, className: `agc-tab ${tab === t ? 'on' : ''}`, onClick: () => setTab(t) }, t.toUpperCase())),
      ),
      tab === 'activity' && React.createElement(React.Fragment, null,
        React.createElement('div', { className: 'agc-card' },
          React.createElement('div', { className: 'agc-paneltitle' }, `${labels.liveSession} · PRIVACY-SAFE VIEW`),
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
          session?.items.map((item) => React.createElement(SessionItemRow, { key: item.id, item })),
        ),
        !follow && React.createElement('button', { className: 'agc-follow', onClick: () => setFollow(true) }, '↓ Jump to latest'),
        myActivity.length > 0 && React.createElement('div', { className: 'agc-card' },
          React.createElement('div', { className: 'agc-paneltitle' }, labels.activity),
          myActivity.map((a) => React.createElement('div', { key: a.id, className: 'agc-feeditem' }, React.createElement('span', { className: 'agc-feedtime' }, fmtTime(a.ts)), a.title)),
        ),
      ),
      tab === 'messages' && React.createElement(React.Fragment, null,
        myMessages.length === 0 && React.createElement('div', { className: 'agc-empty' }, `${labels.messages} — ${labels.activity}`),
        myMessages.map((m) => React.createElement('div', { key: m.id, className: 'agc-card' },
          React.createElement('div', { style: { fontSize: 11, opacity: .7 } }, `${memberName(m.fromSessionId)} → ${m.toSessionId === undefined ? 'team' : memberName(m.toSessionId)} · ${fmtTime(m.createdAt)} · ${m.deliveryState ?? 'legacy'}`),
          m.body,
        )),
        React.createElement('div', { className: 'agc-card' },
          React.createElement('input', { className: 'agc-input', value: draft, placeholder: `${labels.messageTeam} · ${member.name}`, onChange: (event: any) => setDraft(event.target.value), onKeyDown: (event: any) => { if (event.key === 'Enter') void send(); } }),
          React.createElement('button', { className: 'agc-btn primary', style: { marginTop: 6 }, onClick: () => void send() }, labels.send),
          sent !== null && React.createElement('div', { style: { fontSize: 11, color: '#3fb950', marginTop: 4 } }, sent),
        ),
      ),
      tab === 'tasks' && React.createElement(React.Fragment, null,
        snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId).length === 0 && React.createElement('div', { className: 'agc-empty' }, labels.noTasks),
        snapshot.tasks.filter((t) => t.ownerSessionId === member.sessionId).map((t) => React.createElement('div', { key: t.id, className: 'agc-card' },
          React.createElement('span', { className: `agc-status ${taskStatusMeta(t.status).css}` }, `${taskStatusMeta(t.status).icon} ${taskStatusMeta(t.status).label}`),
          ` ${t.title}`,
        )),
        React.createElement('div', { className: 'agc-paneltitle' }, labels.waiting),
        snapshot.tasks.filter((t) => t.status === 'pending').map((t) => React.createElement('div', { key: t.id, className: 'agc-tool' }, `○ ${t.title}`)),
      ),
      tab === 'files' && React.createElement(React.Fragment, null,
        myClaims.length === 0 && React.createElement('div', { className: 'agc-empty' }, `${labels.files} — ${labels.noTasks}`),
        myClaims.map((c) => React.createElement('div', { key: c.id, className: 'agc-tool' }, `${c.kind} ${c.pattern}`)),
        React.createElement('div', { style: { fontSize: 11, opacity: .6, marginTop: 6 } }, 'File-level read/edit activity lives in the Harness session view (Activity tab).'),
      ),
      React.createElement('div', { className: 'agc-card' },
        React.createElement('button', { className: 'agc-btn danger', onClick: () => setConfirmInterrupt(true) }, labels.interrupt),
        confirmInterrupt && React.createElement('div', { className: 'agc-confirm' },
          `Interrupt ${member.name}? Its current operation may stop.`,
          React.createElement('div', { style: { marginTop: 6, display: 'flex', gap: 6 } },
            React.createElement('button', { className: 'agc-btn', onClick: () => setConfirmInterrupt(false) }, labels.cancel),
            React.createElement('button', { className: 'agc-btn danger', onClick: () => { void bridge.interrupt(snapshot.teamId, member.sessionId); setConfirmInterrupt(false); } }, labels.interrupt),
          ),
        ),
      ),
    ),
  );
}

function CommandCenter(props: {
  bridge: Bridge;
  ctx: any;
  teamId: string;
  onClose: () => void;
  onBack?: () => void;
  compact?: boolean;
  labels: UiLabels;
  language: UiLanguage;
  onExpand?: () => void;
  onLanguage?: () => void;
  onPreferences?: () => void;
}): any {
  const { bridge, ctx, teamId, onClose, onBack, compact = false, labels, language, onExpand, onLanguage, onPreferences } = props;
  const timer = timerOf(ctx);
  const [snapshot, setSnapshot] = React.useState<UiSnapshot | null>(null);
  const [activity, setActivity] = React.useState<BufferedActivity[]>([]);
  const [animations, setAnimations] = React.useState<Animation[]>([]);
  const [filter, setFilter] = React.useState<ActivityFilter>('ALL');
  const [timeline, setTimeline] = React.useState(false);
  const [inspector, setInspector] = React.useState<string | null>(null);
  const [taskInspector, setTaskInspector] = React.useState<string | null>(null);
  const [workspaceTab, setWorkspaceTab] = React.useState<WorkspaceTab>('overview');
  const [previewSessionId, setPreviewSessionId] = React.useState<string | null>(null);
  const [depFlash, setDepFlash] = React.useState<Set<string>>(new Set());
  const [observe, setObserve] = React.useState<string[]>([]);
  const [connection, setConnection] = React.useState<'connected' | 'reconnecting'>('reconnecting');
  const [session, setSession] = React.useState<SafeSessionSnapshot | undefined>(undefined);
  const [reduced, setReduced] = React.useState(() => prefersReducedMotion());
  const prevRef = React.useRef<UiSnapshot | undefined>(undefined);
  const snapshotBeforeDisconnectRef = React.useRef<UiSnapshot | undefined>(undefined);
  const streamStateRef = React.useRef<'connected' | 'reconnecting'>('reconnecting');
  const [recoveredEventsCount, setRecoveredEventsCount] = React.useState<number>(0);
  const leadSessionId = snapshot?.leadSessionId;
  const defaultPreviewSessionId = snapshot?.members.find((member) => ['working', 'reviewing', 'thinking'].includes(member.status))?.sessionId ?? leadSessionId ?? snapshot?.members[0]?.sessionId;
  const sessionTargetId = inspector ?? previewSessionId ?? defaultPreviewSessionId;

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
          const beforeReconnect = snapshotBeforeDisconnectRef.current;
          await refresh(false);
          if (!alive) return;

          // If we had a snapshot before disconnect, explicitly compute recovered events
          if (beforeReconnect !== undefined && prevRef.current !== undefined) {
            const recoveredEvents = diffSnapshots(beforeReconnect, prevRef.current, Date.now());
            if (recoveredEvents.length > 0) {
              // Filter out member-joined events as they're noisy on reconnect
              const significantEvents = recoveredEvents.filter((e) => e.kind !== 'member-joined');
              if (significantEvents.length > 0) {
                setRecoveredEventsCount(significantEvents.length);
                // Clear the notification after 3 seconds
                timer.timeout(() => setRecoveredEventsCount(0), 3000);
              }
            }
            snapshotBeforeDisconnectRef.current = undefined;
          }

          off = bridge.subscribe(onFrame, onStreamState);
        })();
      }, delay);
    };
    const onStreamState = (state: 'connected' | 'reconnecting') => {
      if (!alive) return;
      const wasConnected = streamStateRef.current === 'connected';
      streamStateRef.current = state;
      setConnection(state);
      if (state === 'reconnecting') {
        // Store current snapshot before disconnection for recovery
        if (wasConnected && prevRef.current !== undefined) {
          snapshotBeforeDisconnectRef.current = prevRef.current;
        }
        off();
        scheduleReconnect();
      } else {
        retryAttempt = 0;
      }
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
    if (sessionTargetId === undefined) { setSession(undefined); return () => { alive = false; }; }
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
      const address = await resolvePublicSubagentAddress(sessions, leadSessionId, sessionTargetId);
      if (!alive) return;
      if (address !== undefined) await openPublicSubagent(sessions, address);
      const binding = sessionBindingFor(sessions, sessionTargetId);
      if (!alive || binding === undefined) { setSession(undefined); return; }
      const update = () => setSession(projectVisibleSession(binding!.session.getSnapshot()));
      update();
      off = binding.session.subscribe(update);
    };
    void hydrate();
    return () => { alive = false; off(); };
  }, [ctx, sessionTargetId, leadSessionId]);

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
  const selectedTask = taskInspector === null ? undefined : snapshot.tasks.find((task) => task.id === taskInspector);
  const memberName = (sid: string): string => snapshot.members.find((m) => m.sessionId === sid)?.name ?? sid.slice(0, 8);

  const openInspector = (sessionId: string) => {
    if (sessionId === '') return;
    setPreviewSessionId(sessionId);
    setInspector(sessionId);
    setObserve([]);
  };
  const onSelectActivity = (item: BufferedActivity) => {
    if (item.sessionId !== undefined && snapshot.members.some((m) => m.sessionId === item.sessionId)) openInspector(item.sessionId);
  };

  if (compact) {
    return React.createElement(React.Fragment, null,
      React.createElement(CompactActivity, {
        snapshot,
        activity,
        labels,
        language,
        connection,
        recoveredEventsCount,
        onOpen: openInspector,
        onExpand: onExpand ?? (() => {}),
        onClose,
        onLanguage: onLanguage ?? (() => {}),
        onPreferences: onPreferences ?? (() => {}),
      }),
      inspector !== null && React.createElement(Inspector, { snapshot, sessionId: inspector, bridge, onClose: () => setInspector(null), activity, session, labels }),
    );
  }

  if (!compact) {
    return React.createElement(React.Fragment, null,
      React.createElement(WorkspaceLayout, {
        snapshot,
        activity,
        labels,
        language,
        bridge,
        session,
        sessionId: sessionTargetId,
        inspectorOpen: inspector !== null,
        depFlash,
        connection,
        recoveredEventsCount,
        activeTab: workspaceTab,
        submittedPlans,
        blockers,
        openFindings,
        onTab: setWorkspaceTab,
        onSettings: () => setWorkspaceTab('settings'),
        onOpen: openInspector,
        onActivity: onSelectActivity,
        onTask: (task: UiTask) => setTaskInspector(task.id),
        onClose,
        onBack,
        onLanguage: onLanguage ?? (() => {}),
        onPreferences: onPreferences ?? (() => {}),
      }),
      selectedTask !== undefined && React.createElement(TaskDetail, { snapshot, task: selectedTask, labels, onClose: () => setTaskInspector(null) }),
      inspector !== null && React.createElement(Inspector, { key: inspector, snapshot, sessionId: inspector, bridge, onClose: () => setInspector(null), activity, session, labels }),
    );
  }

  return React.createElement('div', { className: 'agc-surface', id: 'agent-teams-panel', role: 'region', 'aria-label': labels.workspaceMode, onClick: (event: any) => event.stopPropagation() },
    React.createElement('div', { className: 'agc-head' },
      React.createElement('span', { className: 'agc-title' }, snapshot.teamName),
      React.createElement('span', { className: 'agc-goal', title: snapshot.teamGoal ?? labels.workspaceMode }, snapshot.teamGoal ?? labels.workspaceMode),
      React.createElement('span', { className: `agc-status ${snapshot.teamStatus === 'completed' ? 'st-completed' : snapshot.teamStatus === 'active' ? 'st-working' : 'st-idle'}` }, `${snapshot.teamStatus === 'active' ? '●' : snapshot.teamStatus === 'completed' ? '✓' : '○'} ${snapshot.teamStatus.toUpperCase()}`),
      React.createElement('div', { className: 'agc-progress' }, React.createElement('div', { className: 'agc-progressfill', style: { width: `${Math.round(snapshot.progress.ratio * 100)}%` } })),
      React.createElement('span', { style: { fontSize: 11, opacity: .8 } }, `${Math.round(snapshot.progress.ratio * 100)}% · ${snapshot.progress.requiredDone} / ${snapshot.progress.requiredTotal} ${labels.tasks}`),
      React.createElement('div', { className: 'agc-chips' },
        Object.entries(counts).map(([status, count]) => React.createElement('button', { key: status, className: 'agc-chip', onClick: () => setInspector(snapshot.members.find((m) => m.status === status)?.sessionId ?? null) }, `${statusMeta(status).icon} ${count} ${status.toUpperCase()}`)),
      ),
      React.createElement('span', { className: 'agc-mode-pill', role: 'group', 'aria-label': 'View mode' },
        React.createElement('button', { type: 'button', 'data-on': false, onClick: onClose }, labels.focusMode),
        React.createElement('button', { type: 'button', 'data-on': true }, labels.workspaceMode),
      ),
      React.createElement('button', { className: 'agc-icon-btn', onClick: onLanguage ?? (() => {}), title: '中 / EN', 'aria-label': 'Toggle language' }, language === 'zh-CN' ? '中' : 'EN'),
      React.createElement('button', { className: 'agc-icon-btn', onClick: onPreferences ?? (() => {}), title: labels.customizeLabels, 'aria-label': labels.customizeLabels }, '⚙'),
      onBack !== undefined && React.createElement('button', { className: 'agc-btn', onClick: onBack }, labels.agentTeams),
      React.createElement('span', { className: `agc-connection ${connection === 'reconnecting' ? 'reconnecting' : ''}` }, connection === 'connected' ? '● LIVE' : '↻ RECONNECTING…'),
      React.createElement('button', { className: 'agc-btn', onClick: () => setTimeline((v) => !v) }, timeline ? labels.activity : 'Timeline'),
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
        React.createElement(WorkspaceOverview, { snapshot, labels }),
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
              React.createElement(TaskGraphPanel, { snapshot, depFlash, labels, onSelect: (task: UiTask) => setTaskInspector(task.id) }),
            ),
      ),
      React.createElement('div', { className: 'agc-side' },
        React.createElement('div', { className: 'agc-panel' },
          React.createElement('div', { className: 'agc-paneltitle' }, 'OBSERVE MODE (up to 3)'),
          React.createElement('div', { className: 'agc-chips' },
            snapshot.members.slice(0, 5).map((m) => React.createElement('button', { key: m.id, className: 'agc-chip', onClick: () => setObserve(observe.includes(m.sessionId) ? observe.filter((s) => s !== m.sessionId) : [...observe, m.sessionId].slice(0, 3)) }, `${observe.includes(m.sessionId) ? '◉' : '○'} ${m.name}`)),
          ),
        ),
        React.createElement(ActivityFeed, { activity, filter, onFilter: setFilter, onSelect: onSelectActivity, timeline, labels }),
      ),
    ),
    selectedTask !== undefined && React.createElement(TaskDetail, { snapshot, task: selectedTask, labels, onClose: () => setTaskInspector(null) }),
    inspector !== null && React.createElement(Inspector, { snapshot, sessionId: inspector, bridge, onClose: () => setInspector(null), activity, session, labels }),
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
      const body = await readResponse(await fetch('/agent-teams/teams', { credentials: 'same-origin' }));
      if (Array.isArray(body)) return body as Array<{ id: string; name?: string; goal?: string; status?: string }>;
      const teams = body !== null && typeof body === 'object' ? (body as { teams?: unknown }).teams : undefined;
      if (Array.isArray(teams)) return teams as Array<{ id: string; name?: string; goal?: string; status?: string }>;
      throw new Error('Agent Teams list response was not an array');
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
    const [panelOpen, setPanelOpen] = React.useState(() => {
      if (typeof window === 'undefined') return false;
      return teamIdFromHash(window.location.hash) !== null || window.localStorage.getItem('agent-teams:selected-team') !== null;
    });
    const [mode, setMode] = React.useState<'compact' | 'workspace'>(() => {
      if (typeof window === 'undefined') return 'compact';
      const requestedMode = new URLSearchParams(window.location.search).get('agent-teams-view');
      if (requestedMode === 'workspace' || requestedMode === 'compact') return requestedMode;
      return window.localStorage.getItem('agent-teams:view-mode') === 'workspace' ? 'workspace' : 'compact';
    });
    const [preferencesOpen, setPreferencesOpen] = React.useState(false);
    const [language, setLanguage] = React.useState<UiLanguage>(() => {
      if (typeof window === 'undefined') return 'zh-CN';
      return parseLanguage(window.localStorage.getItem('agent-teams:language'));
    });
    const [overridesByLanguage, setOverridesByLanguage] = React.useState<UiLabelOverridesByLanguage>(() => {
      if (typeof window === 'undefined') return {};
      try { return parseOverridesByLanguage(JSON.parse(window.localStorage.getItem('agent-teams:labels') ?? '{}')); } catch { return {}; }
    });
    const overrides = React.useMemo(() => overridesByLanguage[language] ?? {}, [overridesByLanguage, language]);
    const labels = React.useMemo(() => resolveLabels(language, overrides), [language, overrides]);
    const [teams, setTeams] = React.useState<Array<{ id: string; name?: string; goal?: string; status?: string }>>([]);
    const [teamListLoaded, setTeamListLoaded] = React.useState(false);
    const [selectedTeamId, setSelectedTeamId] = React.useState<string | null>(() => {
      if (typeof window === 'undefined') return null;
      return teamIdFromHash(window.location.hash) ?? window.localStorage.getItem('agent-teams:selected-team');
    });
    const selectTeam = (teamId: string | null) => {
      setSelectedTeamId(teamId);
      setPanelOpen(teamId !== null);
      if (typeof window !== 'undefined') {
        if (teamId === null) window.localStorage.removeItem('agent-teams:selected-team');
        else window.localStorage.setItem('agent-teams:selected-team', teamId);
      }
      if (typeof window !== 'undefined') {
        const suffix = teamId === null ? `${window.location.pathname}${window.location.search}` : `${window.location.pathname}${window.location.search}#agent-team=${encodeURIComponent(teamId)}`;
        window.history.replaceState(null, '', suffix);
      }
    };
    React.useEffect(() => {
      if (typeof window === 'undefined') return;
      const syncFromLocation = () => {
        const fromHash = teamIdFromHash(window.location.hash);
        if (fromHash !== null) {
          setSelectedTeamId(fromHash);
          setPanelOpen(true);
          return;
        }
        setSelectedTeamId(window.localStorage.getItem('agent-teams:selected-team'));
      };
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
          if (alive && Array.isArray(list)) {
            setTeams(list);
            setTeamListLoaded(true);
            setSelectedTeamId((current) => {
              if (current !== null) return current;
              if (typeof window === 'undefined') return current;
              const saved = window.localStorage.getItem('agent-teams:selected-team');
              return saved !== null && list.some((team) => team.id === saved) ? saved : null;
            });
          }
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
    const selectedExists = selectedTeamId !== null && Array.isArray(teams) && teams.some((team) => team.id === selectedTeamId);
    const selectedTeamMissing = teamListLoaded && selectedTeamId !== null && !selectedExists;
    const selectionNeedsPicker = selectedTeamId === null || selectedTeamMissing;
    const toggleLanguage = () => {
      const next = language === 'zh-CN' ? 'en-US' : 'zh-CN';
      setLanguage(next);
      if (typeof window !== 'undefined') window.localStorage.setItem('agent-teams:language', next);
    };
    const saveOverrides = (next: UiLabelOverrides) => {
      setOverridesByLanguage((current) => {
        const all = { ...current, [language]: next };
        if (typeof window !== 'undefined') window.localStorage.setItem('agent-teams:labels', JSON.stringify(all));
        return all;
      });
    };
    const setViewMode = (next: 'compact' | 'workspace') => {
      setMode(next);
      setPanelOpen(true);
      if (typeof window !== 'undefined') window.localStorage.setItem('agent-teams:view-mode', next);
    };
    const picker = React.createElement('aside', { className: 'agc-compact', id: 'agent-teams-panel', role: 'dialog', 'aria-label': labels.agentTeams },
      React.createElement('header', { className: 'agc-compact-head' },
        React.createElement('span', { className: 'agc-avatar', 'aria-hidden': true }, '🐳'),
        React.createElement('span', { className: 'agc-compact-title' }, labels.agentTeams, React.createElement('small', null, labels.focusMode)),
        React.createElement('button', { className: 'agc-icon-btn', onClick: toggleLanguage, 'aria-label': 'Toggle language' }, language === 'zh-CN' ? '中' : 'EN'),
        React.createElement('button', { className: 'agc-icon-btn', onClick: () => setPreferencesOpen(true), 'aria-label': labels.customizeLabels }, '⚙'),
        React.createElement('button', { className: 'agc-compact-close', onClick: () => setPanelOpen(false), 'aria-label': labels.collapsePanel }, '×'),
      ),
      React.createElement('div', { className: 'agc-compact-picker' },
        React.createElement('h3', null, labels.agentTeams),
        selectedTeamMissing
          ? React.createElement('div', { className: 'agc-notice agc-notice-danger', role: 'alert' }, labels.teamNotFound)
          : React.createElement('p', null, teams.length === 0 ? labels.noTeams : labels.teamActivity),
        React.createElement('div', { className: 'agc-compact-picker-list' },
          teams.length === 0 ? React.createElement('div', { className: 'agc-empty' }, labels.noTeams) : teams.map((team) => React.createElement('button', { key: team.id, className: 'agc-teamrow', onClick: () => selectTeam(team.id) },
            React.createElement('span', { className: 'agc-avatar', 'aria-hidden': true }, '🐳'),
            React.createElement('span', { style: { flex: 1, minWidth: 0 } }, React.createElement('div', { className: 'agc-name' }, team.name ?? team.id), React.createElement('div', { className: 'agc-role' }, `${team.status ?? 'active'} · ${team.goal ?? team.id}`)),
            React.createElement('span', null, '→'),
          )),
        ),
      ),
    );
    return React.createElement(React.Fragment, null,
      React.createElement('button', { className: 'agc-btn', onClick: () => setPanelOpen(true), 'aria-expanded': panelOpen, 'aria-controls': 'agent-teams-panel' }, labels.agentTeams),
      panelOpen && selectedTeamId !== null && selectedExists && React.createElement(CommandCenter, {
        bridge, ctx, teamId: selectedTeamId, compact: mode === 'compact', labels, language,
        onBack: () => selectTeam(null),
        onClose: mode === 'compact' ? () => setPanelOpen(false) : () => setViewMode('compact'),
        onExpand: () => setViewMode('workspace'),
        onLanguage: toggleLanguage,
        onPreferences: () => setPreferencesOpen(true),
      }),
      panelOpen && selectionNeedsPicker && picker,
      !panelOpen && selectedTeamId !== null && selectedExists && React.createElement('button', { className: 'agc-compact-badge', onClick: () => setPanelOpen(true), 'aria-label': labels.teamActivity },
        React.createElement('span', { className: 'agc-compact-badge-dot', 'data-busy': teams.some((team) => team.id === selectedTeamId && team.status === 'active') }), labels.agentTeams),
      preferencesOpen && React.createElement(PreferencesDialog, { language, labels, overrides, onClose: () => setPreferencesOpen(false), onLanguage: (next: UiLanguage) => { setLanguage(next); if (typeof window !== 'undefined') window.localStorage.setItem('agent-teams:language', next); }, onSave: saveOverrides }),
    );
  }

  ctx.effect(() => {
    return slots.register({ name: 'sidebar.footer.action', id: 'agent-teams-toggle', label: 'Agent Teams' }, () => React.createElement(OverlayEntry));
  }, 'agent-teams: sidebar action');

  ctx.effect(() => () => {
    for (const dispose of [...disposers].reverse()) dispose();
  });
}
