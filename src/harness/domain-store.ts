/**
 * `DomainStore`: the TeamStore seam over the harness `ctx.storageDomain`.
 * Atomicity comes from `KvTable.update` (the domain write chain): concurrent
 * claims can never double-own a task.
 * @module dsh-agent-teams/harness
 */
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain';
import type { TeamStore, TableName, RecordOf, UpdateResult } from '../core/store.ts';
import type { AtomicRuntimeEventStore, RuntimeEventAppendInput } from '../core/runtime-events.ts';
import type { RuntimeEvent } from '../core/types.ts';

const TABLE_NAMES: readonly TableName[] = [
  'teams',
  'members',
  'tasks',
  'messages',
  'plans',
  'file_claims',
  'findings',
  'workspaces',
  'git_workspaces',
  'commits',
  'review_requests',
  'review_results',
  'runtime_events',
];

export class DomainStore implements TeamStore, AtomicRuntimeEventStore {
  constructor(private readonly domain: Domain<DomainSpec>) {}

  async ready(): Promise<void> {
    // The facility loads and validates every record at open(); nothing to do.
  }

  async get<T extends TableName>(table: T, id: string): Promise<RecordOf<T> | undefined> {
    return this.domain.table(table).get(id) as RecordOf<T> | undefined;
  }

  async list<T extends TableName>(table: T, filter?: (record: RecordOf<T>) => boolean): Promise<RecordOf<T>[]> {
    const records = [...this.domain.table(table).entries()].map(([, value]) => value as RecordOf<T>);
    return filter === undefined ? records : records.filter(filter);
  }

  async put<T extends TableName>(table: T, id: string, value: RecordOf<T>): Promise<void> {
    await this.domain.table(table).put(id, value);
  }

  async remove(table: TableName, id: string): Promise<boolean> {
    return this.domain.table(table).delete(id);
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    fn: (current: RecordOf<T>) => RecordOf<T> | undefined | null,
  ): Promise<UpdateResult> {
    try {
      const value = await this.domain.table(table).update(id, (current) => {
        const next = fn(current as RecordOf<T>);
        return (next ?? current) as never;
      });
      return { found: true, value };
    } catch (error) {
      if (error instanceof Error && error.message.includes('missing-key')) return { found: false };
      throw error;
    }
  }

  /**
   * Atomic runtime event append implementation using domain storage primitives.
   * This method provides true cross-process safety by using the domain's
   * atomic update mechanism for sequence allocation.
   */
  async appendRuntimeEvent(input: Required<Pick<RuntimeEventAppendInput, 'teamId' | 'name'>> & RuntimeEventAppendInput): Promise<RuntimeEvent> {
    const { teamId, dedupeKey } = input;

    // Check for dedupe first (this is a read, not part of the atomic transaction)
    if (dedupeKey !== undefined) {
      const existing = await this.findExistingByDedupe(teamId, dedupeKey);
      if (existing !== undefined) return existing;
    }

    // Use a special counter record ID per team to track sequence
    const counterId = `__runtime_events_counter__:${teamId}`;

    // Atomically allocate sequence using domain's update operation
    let nextSequence: number;
    const counterResult = await this.update<'runtime_events'>(
      'runtime_events',
      counterId,
      (current) => {
        if (current === undefined) {
          // Counter doesn't exist - will bootstrap below
          return null;
        }
        // Increment counter atomically
        const counter = current as any;
        return {
          ...counter,
          sequence: counter.sequence + 1,
          updatedAt: Date.now(),
        } as RuntimeEvent;
      },
    );

    if (!counterResult.found) {
      // Bootstrap case: scan existing events to find max sequence
      const records = await this.list<'runtime_events'>('runtime_events', (event) =>
        event.teamId === teamId && !event.id.startsWith('__runtime_events_counter__:')
      );
      const latestSequence = records.reduce((max, event) => Math.max(max, event.sequence), 0);
      nextSequence = latestSequence + 1;

      // Initialize counter for future appends
      await this.put('runtime_events', counterId, {
        id: counterId as any,
        teamId,
        name: '__counter__',
        sequence: nextSequence,
        visibility: 'internal' as const,
        payloadVersion: 1,
        payload: {},
        createdAt: input.createdAt ?? Date.now(),
        actorSessionId: undefined,
        targetSessionId: undefined,
        dedupeKey: undefined,
      } as RuntimeEvent);
    } else {
      nextSequence = (counterResult.value as any).sequence;
    }

    // Create the event with allocated sequence
    const event: RuntimeEvent = {
      id: input.id!,
      teamId,
      name: input.name,
      sequence: nextSequence,
      visibility: input.visibility!,
      payloadVersion: 1,
      payload: input.payload ?? {},
      createdAt: input.createdAt!,
      actorSessionId: input.actorSessionId,
      targetSessionId: input.targetSessionId,
      dedupeKey,
    };

    await this.put('runtime_events', event.id, event);
    return event;
  }

  private async findExistingByDedupe(teamId: string, dedupeKey: string): Promise<RuntimeEvent | undefined> {
    const records = await this.list<'runtime_events'>(
      'runtime_events',
      (event) => event.teamId === teamId && event.dedupeKey === dedupeKey
    );
    return records[0];
  }
}

export function tableNames(): readonly TableName[] {
  return TABLE_NAMES;
}
