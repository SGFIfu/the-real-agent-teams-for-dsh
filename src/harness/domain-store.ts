/**
 * `DomainStore`: the TeamStore seam over the harness `ctx.storageDomain`.
 * Atomicity comes from `KvTable.update` (the domain write chain): concurrent
 * claims can never double-own a task.
 * @module dsh-agent-teams/harness
 */
import type { Domain, DomainSpec } from '@deepseek-ai/dsh-storage-domain';
import type { TeamStore, TableName, RecordOf, UpdateResult } from '../core/store.ts';

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

export class DomainStore implements TeamStore {
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
}

export function tableNames(): readonly TableName[] {
  return TABLE_NAMES;
}
