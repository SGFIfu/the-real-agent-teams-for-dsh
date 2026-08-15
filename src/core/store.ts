/**
 * Storage seam: one small interface with two implementations —
 * `MemoryStore` (tests, simulation) and the harness `DomainStore`
 * (durable, `ctx.storageDomain`-backed) in `src/harness/domain-store.ts`.
 *
 * The service never talks to a concrete backend; it talks to this seam, so
 * the whole coordination layer works over json/sqlite/whatever the harness
 * routes the `agent_teams` domain to.
 * @module dsh-agent-teams/core
 */
import type { AgentTeam, TeamMember, TeamTask, TeamMessage, TeamPlan, FileClaim, ReviewFinding } from './types.ts';

export type TableName = 'teams' | 'members' | 'tasks' | 'messages' | 'plans' | 'file_claims' | 'findings';

export type RecordOf<T extends TableName> = T extends 'teams'
  ? AgentTeam
  : T extends 'members'
    ? TeamMember
    : T extends 'tasks'
      ? TeamTask
      : T extends 'messages'
        ? TeamMessage
        : T extends 'plans'
          ? TeamPlan
          : T extends 'file_claims'
            ? FileClaim
            : T extends 'findings'
              ? ReviewFinding
              : never;

export type TableFilter<T extends TableName> = (record: RecordOf<T>) => boolean;

export interface UpdateResult {
  found: boolean;
  value?: unknown;
}

/**
 * Atomicity contract: `update` is a read-modify-write whose `fn` sees the
 * value current at its execution slot and whose write cannot interleave with
 * another `update` on the same key. The harness `DomainStore` maps this to
 * `KvTable.update` (the domain write chain); `MemoryStore` relies on the
 * single-threaded synchronous transform.
 */
export interface TeamStore {
  get<T extends TableName>(table: T, id: string): Promise<RecordOf<T> | undefined>;
  list<T extends TableName>(table: T, filter?: TableFilter<T>): Promise<RecordOf<T>[]>;
  put<T extends TableName>(table: T, id: string, value: RecordOf<T>): Promise<void>;
  remove(table: TableName, id: string): Promise<boolean>;
  update<T extends TableName>(
    table: T,
    id: string,
    fn: (current: RecordOf<T>) => RecordOf<T> | undefined | null,
  ): Promise<UpdateResult>;
  /** Called once by the service; no-op for backends that need no loading. */
  ready(): Promise<void>;
}

/** In-memory backend: deterministic, synchronous transform semantics. */
export class MemoryStore implements TeamStore {
  private readonly tables = new Map<TableName, Map<string, unknown>>();

  constructor(seed?: Partial<Record<TableName, Record<string, unknown>>>) {
    for (const name of ['teams', 'members', 'tasks', 'messages', 'plans', 'file_claims', 'findings'] as TableName[]) {
      const map = new Map<string, unknown>();
      for (const [key, value] of Object.entries(seed?.[name] ?? {})) map.set(key, value);
      this.tables.set(name, map);
    }
  }

  async ready(): Promise<void> {}

  private table(name: TableName): Map<string, unknown> {
    const table = this.tables.get(name);
    if (table === undefined) throw new Error(`unknown table ${name}`);
    return table;
  }

  async get<T extends TableName>(table: T, id: string): Promise<RecordOf<T> | undefined> {
    return this.table(table).get(id) as RecordOf<T> | undefined;
  }

  async list<T extends TableName>(table: T, filter?: TableFilter<T>): Promise<RecordOf<T>[]> {
    const records = [...this.table(table).values()] as RecordOf<T>[];
    return filter === undefined ? records : records.filter(filter);
  }

  async put<T extends TableName>(table: T, id: string, value: RecordOf<T>): Promise<void> {
    this.table(table).set(id, value);
  }

  async remove(table: TableName, id: string): Promise<boolean> {
    return this.table(table).delete(id);
  }

  async update<T extends TableName>(
    table: T,
    id: string,
    fn: (current: RecordOf<T>) => RecordOf<T> | undefined | null,
  ): Promise<UpdateResult> {
    const current = this.table(table).get(id) as RecordOf<T> | undefined;
    if (current === undefined) return { found: false };
    const next = fn(current);
    if (next === undefined || next === null) return { found: true, value: current };
    this.table(table).set(id, next);
    return { found: true, value: next };
  }
}

/** Deep-clone helper for safe cross-store copies. */
export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
