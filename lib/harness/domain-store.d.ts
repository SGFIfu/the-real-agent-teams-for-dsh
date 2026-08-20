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
export declare class DomainStore implements TeamStore, AtomicRuntimeEventStore {
    private readonly domain;
    constructor(domain: Domain<DomainSpec>);
    ready(): Promise<void>;
    get<T extends TableName>(table: T, id: string): Promise<RecordOf<T> | undefined>;
    list<T extends TableName>(table: T, filter?: (record: RecordOf<T>) => boolean): Promise<RecordOf<T>[]>;
    put<T extends TableName>(table: T, id: string, value: RecordOf<T>): Promise<void>;
    remove(table: TableName, id: string): Promise<boolean>;
    update<T extends TableName>(table: T, id: string, fn: (current: RecordOf<T>) => RecordOf<T> | undefined | null): Promise<UpdateResult>;
    /**
     * Atomic runtime event append implementation using domain storage primitives.
     * This method provides true cross-process safety by using the domain's
     * atomic update mechanism for sequence allocation.
     */
    appendRuntimeEvent(input: Required<Pick<RuntimeEventAppendInput, 'teamId' | 'name'>> & RuntimeEventAppendInput): Promise<RuntimeEvent>;
    private findExistingByDedupe;
}
export declare function tableNames(): readonly TableName[];
