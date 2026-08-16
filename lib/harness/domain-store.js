const TABLE_NAMES = [
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
export class DomainStore {
    domain;
    constructor(domain) {
        this.domain = domain;
    }
    async ready() {
        // The facility loads and validates every record at open(); nothing to do.
    }
    async get(table, id) {
        return this.domain.table(table).get(id);
    }
    async list(table, filter) {
        const records = [...this.domain.table(table).entries()].map(([, value]) => value);
        return filter === undefined ? records : records.filter(filter);
    }
    async put(table, id, value) {
        await this.domain.table(table).put(id, value);
    }
    async remove(table, id) {
        return this.domain.table(table).delete(id);
    }
    async update(table, id, fn) {
        try {
            const value = await this.domain.table(table).update(id, (current) => {
                const next = fn(current);
                return (next ?? current);
            });
            return { found: true, value };
        }
        catch (error) {
            if (error instanceof Error && error.message.includes('missing-key'))
                return { found: false };
            throw error;
        }
    }
}
export function tableNames() {
    return TABLE_NAMES;
}
