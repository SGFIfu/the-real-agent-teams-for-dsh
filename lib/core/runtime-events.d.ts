import { type TeamStore } from './store.ts';
import type { RuntimeEvent, RuntimeEventId, RuntimeEventVisibility, SessionId, TeamId } from './types.ts';
export interface RuntimeEventAppendInput {
    teamId: TeamId;
    name: string;
    actorSessionId?: SessionId;
    targetSessionId?: SessionId;
    visibility?: RuntimeEventVisibility;
    payloadVersion?: 1;
    dedupeKey?: string;
    payload?: Record<string, unknown>;
    createdAt?: number;
    id?: RuntimeEventId;
}
/** Optional storage capability for cross-process-safe append semantics. */
export interface AtomicRuntimeEventStore extends TeamStore {
    /**
     * Must atomically perform dedupe lookup, sequence allocation, and insert.
     * The adapter owns the durable transaction; this helper validates its
     * result but does not emulate atomicity around it.
     */
    appendRuntimeEvent(input: Required<Pick<RuntimeEventAppendInput, 'teamId' | 'name'>> & RuntimeEventAppendInput): Promise<RuntimeEvent>;
}
export type RuntimeEventVisibilityFilter = RuntimeEventVisibility | 'all';
export interface RuntimeEventCursor {
    teamId: TeamId;
    /** The last raw team sequence observed by this reader. */
    sequence: number;
}
export interface RuntimeEventReadOptions {
    cursor?: RuntimeEventCursor;
    visibility?: RuntimeEventVisibilityFilter;
    limit?: number;
}
export interface RuntimeEventPage {
    teamId: TeamId;
    events: RuntimeEvent[];
    cursor: RuntimeEventCursor;
    latestSequence: number;
    hasMore: boolean;
}
export interface RuntimeEventReconcileResult extends RuntimeEventPage {
    /** Gaps in the raw per-team sequence, useful for recovery diagnostics. */
    missingSequences: number[];
}
export interface RuntimeEventCapabilities {
    /** Whether sequence/dedupe/insert is atomic in the backing store. */
    atomicAppend: boolean;
    /** True only when the backing store guarantees this across processes. */
    crossProcessSafe: boolean;
    limitation?: string;
}
type AtomicStoreLike = TeamStore & Partial<Pick<AtomicRuntimeEventStore, 'appendRuntimeEvent'>>;
/**
 * Durable event log with a reconnect-friendly, team-scoped cursor.
 */
export declare class RuntimeEventLog {
    private readonly store;
    readonly capabilities: RuntimeEventCapabilities;
    constructor(store: AtomicStoreLike);
    append(input: RuntimeEventAppendInput): Promise<RuntimeEvent>;
    read(teamId: TeamId, options?: RuntimeEventReadOptions): Promise<RuntimeEventPage>;
    reconcile(teamId: TeamId, options?: RuntimeEventReadOptions): Promise<RuntimeEventReconcileResult>;
    private listTeam;
    private findByDedupe;
}
export declare function createRuntimeEventLog(store: TeamStore): RuntimeEventLog;
export {};
