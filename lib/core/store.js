/** In-memory backend: deterministic, synchronous transform semantics. */
export class MemoryStore {
    tables = new Map();
    constructor(seed) {
        for (const name of [
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
        ]) {
            const map = new Map();
            for (const [key, value] of Object.entries(seed?.[name] ?? {}))
                map.set(key, value);
            this.tables.set(name, map);
        }
    }
    async ready() { }
    table(name) {
        const table = this.tables.get(name);
        if (table === undefined)
            throw new Error(`unknown table ${name}`);
        return table;
    }
    async get(table, id) {
        return this.table(table).get(id);
    }
    async list(table, filter) {
        const records = [...this.table(table).values()];
        return filter === undefined ? records : records.filter(filter);
    }
    async put(table, id, value) {
        this.table(table).set(id, value);
    }
    async remove(table, id) {
        return this.table(table).delete(id);
    }
    async update(table, id, fn) {
        const current = this.table(table).get(id);
        if (current === undefined)
            return { found: false };
        const next = fn(current);
        if (next === undefined || next === null)
            return { found: true, value: current };
        this.table(table).set(id, next);
        return { found: true, value: next };
    }
}
/** Deep-clone helper for safe cross-store copies. */
export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}
