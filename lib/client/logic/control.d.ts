/**
 * Event → UI adapter (pure, DOM-free, unit-testable).
 *
 * Pipeline: Agent Teams events / snapshot diffs → normalized UI events →
 * bounded activity buffer → animation hints. The React layer renders these;
 * nothing here touches DOM or React.
 * @module dsh-agent-teams/client/logic
 */
export type AgentStatusKind = 'working' | 'thinking' | 'waiting' | 'blocked' | 'reviewing' | 'idle' | 'completed' | 'failed' | 'starting' | 'stopped';
export interface UiMember {
    id: string;
    sessionId: string;
    name: string;
    role: string;
    status: string;
    currentTaskId?: string;
}
export interface UiTask {
    id: string;
    title: string;
    description?: string;
    status: string;
    priority: string;
    ownerSessionId?: string;
    dependencies: string[];
    result?: string;
}
export interface UiPlan {
    id: string;
    taskId: string;
    authorSessionId: string;
    status: string;
}
export interface UiFinding {
    id: string;
    severity: string;
    summary: string;
    state: string;
    authorSessionId: string;
    taskId?: string;
}
export interface UiMessage {
    id: string;
    fromSessionId: string;
    toSessionId?: string;
    type: string;
    body: string;
    createdAt: number;
    deliveryState?: string;
    deliveryError?: string;
}
export interface UiClaim {
    id: string;
    ownerSessionId: string;
    pattern: string;
    kind: string;
}
export interface UiSnapshot {
    teamId: string;
    teamName: string;
    teamGoal?: string;
    teamCreatedAt?: number;
    leadSessionId?: string;
    teamStatus: string;
    members: UiMember[];
    tasks: UiTask[];
    plans: UiPlan[];
    findings: UiFinding[];
    messages: UiMessage[];
    fileClaims: UiClaim[];
    progress: {
        requiredTotal: number;
        requiredDone: number;
        ratio: number;
        blocked: string[];
        awaitingPlanApproval: string[];
    };
}
export type UiEventKind = 'message' | 'task-created' | 'task-claimed' | 'task-completed' | 'task-failed' | 'task-blocked' | 'task-released' | 'plan-submitted' | 'plan-approved' | 'plan-rejected' | 'member-joined' | 'member-left' | 'member-status' | 'file-claimed' | 'file-released' | 'file-conflict' | 'finding' | 'team-completed';
export interface UiEvent {
    id: string;
    kind: UiEventKind;
    ts: number;
    teamId: string;
    sessionId?: string;
    targetSessionId?: string;
    taskId?: string;
    title?: string;
    preview?: string;
    severity?: string;
}
/** Status → icon + label + css suffix. Never color-only. */
export declare function statusMeta(status: string): {
    icon: string;
    label: string;
    css: string;
};
export declare function taskStatusMeta(status: string): {
    icon: string;
    label: string;
    css: string;
};
/** Role → default avatar icon; unknown roles fall back to Bot. */
export declare function roleAvatar(role: string): string;
/** Layered (topological) rows for the task DAG. */
export declare function layeredGraph(tasks: UiTask[]): UiTask[][];
/** Diff two snapshots into ordered UI events (older first). */
export declare function diffSnapshots(prev: UiSnapshot | undefined, next: UiSnapshot, nowTs: number): UiEvent[];
/** Merge an incoming raw event stream into a bounded activity buffer. */
export interface BufferedActivity {
    id: string;
    kind: string;
    ts: number;
    teamId: string;
    sessionId?: string;
    targetSessionId?: string;
    taskId?: string;
    title: string;
    preview?: string;
    severity?: string;
}
/**
 * Map one SSE frame (`{"type": "agent-teams/…", …payload}`) into a UI event.
 * Ids intentionally match `diffSnapshots` so pushBuffer dedupes against the
 * polling diff; unknown frames return undefined. No animation is invented
 * here — every returned event is backed by a real emitted payload.
 */
export declare function rawEventToUiEvent(frame: any, nowTs: number): UiEvent | undefined;
export declare function pushBuffer(buffer: BufferedActivity[], events: UiEvent[], cap?: number): BufferedActivity[];
export type ActivityFilter = 'ALL' | 'TASKS' | 'MESSAGES' | 'AGENTS' | 'FILES' | 'REVIEWS';
export declare function filterActivity(activity: BufferedActivity[], filter: ActivityFilter): BufferedActivity[];
/** Count members by semantic status for the header status map. */
export declare function statusCounts(members: UiMember[]): Record<string, number>;
/** Resolve an explicitly requested team; never silently chooses the first team. */
export declare function resolveSelectedTeamId(teams: readonly {
    id: string;
}[], requested: string | null | undefined): string | null;
/** Read the explicit Team route from a browser hash without falling back. */
export declare function teamIdFromHash(hash: string): string | null;
/** Normalize the raw snapshot payload into the UI model. */
export declare function normalizeSnapshot(raw: any): UiSnapshot;
/** True when reduced motion is requested by the OS (guard for particle animation). */
export declare function prefersReducedMotion(): boolean;
