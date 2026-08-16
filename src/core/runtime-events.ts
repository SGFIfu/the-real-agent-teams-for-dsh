/**
 * Durable runtime-event audit/projection helper.
 *
 * This module deliberately does not replace the existing TeamEventSink. The
 * sink remains the live notification path; RuntimeEventLog is the durable
 * recovery path used to replay public team state after a reconnect.
 *
 * TeamStore currently exposes atomic update only for an existing record. It
 * has no atomic counter-plus-insert operation, so the default implementation
 * uses a process-local per-team mutex around list/max/put and exposes that
 * limitation through `capabilities`. A storage adapter that can atomically
 * deduplicate and allocate a sequence may implement `appendRuntimeEvent` to
 * remove that cross-process limitation.
 */
import { runtimeEventSchema } from './schemas.ts';
import { newId } from './ids.ts';
import { cloneJson, type TeamStore } from './store.ts';
import type {
  RuntimeEvent,
  RuntimeEventId,
  RuntimeEventVisibility,
  SessionId,
  TeamId,
} from './types.ts';

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

const teamLocks = new Map<string, Promise<void>>();

async function withTeamLock<T>(teamId: TeamId, work: () => Promise<T>): Promise<T> {
  const previous = teamLocks.get(teamId) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  teamLocks.set(teamId, next);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (teamLocks.get(teamId) === next) teamLocks.delete(teamId);
  }
}

function normalizeInput(input: RuntimeEventAppendInput): Required<Pick<RuntimeEventAppendInput, 'teamId' | 'name'>> & RuntimeEventAppendInput {
  return {
    ...input,
    visibility: input.visibility ?? 'public',
    payloadVersion: 1,
    payload: input.payload ?? {},
    createdAt: input.createdAt ?? Date.now(),
    id: input.id ?? (newId('event') as RuntimeEventId),
  };
}

function parseEvent(value: RuntimeEvent): RuntimeEvent {
  return cloneJson(runtimeEventSchema.parse(value) as RuntimeEvent);
}

function assertCursor(cursor: RuntimeEventCursor | undefined, teamId: TeamId): number {
  if (cursor === undefined) return 0;
  if (cursor.teamId !== teamId) {
    throw new Error(`runtime event cursor belongs to team ${cursor.teamId}, not ${teamId}`);
  }
  if (!Number.isInteger(cursor.sequence) || cursor.sequence < 0) {
    throw new Error(`runtime event cursor sequence must be a non-negative integer`);
  }
  return cursor.sequence;
}

function validateLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('runtime event read limit must be a positive integer');
  return limit;
}

/**
 * Durable event log with a reconnect-friendly, team-scoped cursor.
 */
export class RuntimeEventLog {
  readonly capabilities: RuntimeEventCapabilities;

  constructor(private readonly store: AtomicStoreLike) {
    const atomicAppend = typeof store.appendRuntimeEvent === 'function';
    this.capabilities = atomicAppend
      ? { atomicAppend: true, crossProcessSafe: true }
      : {
          atomicAppend: false,
          crossProcessSafe: false,
          limitation:
            'TeamStore has no atomic counter-plus-insert operation; fallback serialization is process-local and is not safe across multiple service processes or writers that bypass RuntimeEventLog.',
        };
  }

  async append(input: RuntimeEventAppendInput): Promise<RuntimeEvent> {
    const normalized = normalizeInput(input);
    if (typeof this.store.appendRuntimeEvent === 'function') {
      return parseEvent(await this.store.appendRuntimeEvent(normalized));
    }

    return withTeamLock(normalized.teamId, async () => {
      const existing = await this.findByDedupe(normalized.teamId, normalized.dedupeKey);
      if (existing !== undefined) return existing;

      const records = await this.listTeam(normalized.teamId);
      const latestSequence = records.reduce((max, event) => Math.max(max, event.sequence), 0);
      const event = parseEvent({
        ...normalized,
        sequence: latestSequence + 1,
      } as RuntimeEvent);
      await this.store.put('runtime_events', event.id, event);
      return cloneJson(event);
    });
  }

  async read(teamId: TeamId, options: RuntimeEventReadOptions = {}): Promise<RuntimeEventPage> {
    const after = assertCursor(options.cursor, teamId);
    const limit = validateLimit(options.limit);
    const visibility = options.visibility ?? 'public';
    const records = await this.listTeam(teamId);
    const latestSequence = records.at(-1)?.sequence ?? 0;
    const rawAfter = records.filter((event) => event.sequence > after);
    const events: RuntimeEvent[] = [];
    let scannedThrough = after;
    for (const event of rawAfter) {
      if (limit !== undefined && events.length >= limit) break;
      scannedThrough = event.sequence;
      if (visibility === 'all' || event.visibility === visibility) events.push(cloneJson(event));
    }
    const hasMore = rawAfter.some((event) => event.sequence > scannedThrough);
    return {
      teamId,
      events,
      cursor: { teamId, sequence: scannedThrough },
      latestSequence,
      hasMore,
    };
  }

  async reconcile(teamId: TeamId, options: RuntimeEventReadOptions = {}): Promise<RuntimeEventReconcileResult> {
    const page = await this.read(teamId, options);
    const after = assertCursor(options.cursor, teamId);
    const records = await this.listTeam(teamId);
    const missingSequences: number[] = [];
    let expected = after + 1;
    for (const event of records) {
      if (event.sequence < expected) continue;
      while (expected < event.sequence) missingSequences.push(expected++);
      expected = event.sequence + 1;
    }
    return { ...page, missingSequences };
  }

  private async listTeam(teamId: TeamId): Promise<RuntimeEvent[]> {
    const records = await this.store.list('runtime_events', (event) => event.teamId === teamId);
    return records.map(parseEvent).sort((a, b) => a.sequence - b.sequence);
  }

  private async findByDedupe(teamId: TeamId, dedupeKey: string | undefined): Promise<RuntimeEvent | undefined> {
    if (dedupeKey === undefined) return undefined;
    const records = await this.store.list('runtime_events', (event) => event.teamId === teamId && event.dedupeKey === dedupeKey);
    const event = records[0];
    return event === undefined ? undefined : parseEvent(event);
  }
}

export function createRuntimeEventLog(store: TeamStore): RuntimeEventLog {
  return new RuntimeEventLog(store);
}
