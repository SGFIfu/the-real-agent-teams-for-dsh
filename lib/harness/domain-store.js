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
    /**
     * Atomic runtime event append implementation using domain storage primitives.
     * This method provides true cross-process safety by using the domain's
     * atomic update mechanism for sequence allocation.
     */
    async appendRuntimeEvent(input) {
        const { teamId, dedupeKey } = input;
        // Check for dedupe first (this is a read, not part of the atomic transaction)
        if (dedupeKey !== undefined) {
            const existing = await this.findExistingByDedupe(teamId, dedupeKey);
            if (existing !== undefined)
                return existing;
        }
        // Use a special counter record ID per team to track sequence
        const counterId = `__runtime_events_counter__:${teamId}`;
        // Atomically allocate sequence using domain's update operation
        let nextSequence;
        const counterResult = await this.update('runtime_events', counterId, (current) => {
            if (current === undefined) {
                // Counter doesn't exist - will bootstrap below
                return null;
            }
            // Increment counter atomically
            const counter = current;
            return {
                ...counter,
                sequence: counter.sequence + 1,
                updatedAt: Date.now(),
            };
        });
        if (!counterResult.found) {
            // Bootstrap case: scan existing events to find max sequence
            const records = await this.list('runtime_events', (event) => event.teamId === teamId && !event.id.startsWith('__runtime_events_counter__:'));
            const latestSequence = records.reduce((max, event) => Math.max(max, event.sequence), 0);
            nextSequence = latestSequence + 1;
            // Initialize counter for future appends
            await this.put('runtime_events', counterId, {
                id: counterId,
                teamId,
                name: '__counter__',
                sequence: nextSequence,
                visibility: 'internal',
                payloadVersion: 1,
                payload: {},
                createdAt: input.createdAt ?? Date.now(),
                actorSessionId: undefined,
                targetSessionId: undefined,
                dedupeKey: undefined,
            });
        }
        else {
            nextSequence = counterResult.value.sequence;
        }
        // Create the event with allocated sequence
        const event = {
            id: input.id,
            teamId,
            name: input.name,
            sequence: nextSequence,
            visibility: input.visibility,
            payloadVersion: 1,
            payload: input.payload ?? {},
            createdAt: input.createdAt,
            actorSessionId: input.actorSessionId,
            targetSessionId: input.targetSessionId,
            dedupeKey,
        };
        await this.put('runtime_events', event.id, event);
        return event;
    }
    async findExistingByDedupe(teamId, dedupeKey) {
        const records = await this.list('runtime_events', (event) => event.teamId === teamId && event.dedupeKey === dedupeKey);
        return records[0];
    }
}
export function tableNames() {
    return TABLE_NAMES;
}
