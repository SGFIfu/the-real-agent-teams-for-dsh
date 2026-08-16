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
import type { AgentTeam, TeamMember, TeamTask, TeamMessage, TeamPlan, FileClaim, ReviewFinding, TeamWorkspace, GitWorkspace, WorkspaceCommit, ReviewRequest, ReviewResult, RuntimeEvent } from './types.ts';
export type TableName = 'teams' | 'members' | 'tasks' | 'messages' | 'plans' | 'file_claims' | 'findings' | 'workspaces' | 'git_workspaces' | 'commits' | 'review_requests' | 'review_results' | 'runtime_events';
export type RecordOf<T extends TableName> = T extends 'teams' ? AgentTeam : T extends 'members' ? TeamMember : T extends 'tasks' ? TeamTask : T extends 'messages' ? TeamMessage : T extends 'plans' ? TeamPlan : T extends 'file_claims' ? FileClaim : T extends 'findings' ? ReviewFinding : T extends 'workspaces' ? TeamWorkspace : T extends 'git_workspaces' ? GitWorkspace : T extends 'commits' ? WorkspaceCommit : T extends 'review_requests' ? ReviewRequest : T extends 'review_results' ? ReviewResult : T extends 'runtime_events' ? RuntimeEvent : never;
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
    update<T extends TableName>(table: T, id: string, fn: (current: RecordOf<T>) => RecordOf<T> | undefined | null): Promise<UpdateResult>;
    /** Called once by the service; no-op for backends that need no loading. */
    ready(): Promise<void>;
}
/** In-memory backend: deterministic, synchronous transform semantics. */
export declare class MemoryStore implements TeamStore {
    private readonly tables;
    constructor(seed?: Partial<Record<TableName, Record<string, unknown>>>);
    ready(): Promise<void>;
    private table;
    get<T extends TableName>(table: T, id: string): Promise<RecordOf<T> | undefined>;
    list<T extends TableName>(table: T, filter?: TableFilter<T>): Promise<RecordOf<T>[]>;
    put<T extends TableName>(table: T, id: string, value: RecordOf<T>): Promise<void>;
    remove(table: TableName, id: string): Promise<boolean>;
    update<T extends TableName>(table: T, id: string, fn: (current: RecordOf<T>) => RecordOf<T> | undefined | null): Promise<UpdateResult>;
}
/** Deep-clone helper for safe cross-store copies. */
export declare function cloneJson<T>(value: T): T;
