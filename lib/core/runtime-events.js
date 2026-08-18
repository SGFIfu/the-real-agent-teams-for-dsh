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
import { runtimeEventSchema } from "./schemas.js";
import { newId } from "./ids.js";
import { cloneJson } from "./store.js";
const teamLocks = new Map();
async function withTeamLock(teamId, work) {
    const previous = teamLocks.get(teamId) ?? Promise.resolve();
    let release;
    const next = new Promise((resolve) => {
        release = resolve;
    });
    teamLocks.set(teamId, next);
    await previous;
    try {
        return await work();
    }
    finally {
        release();
        if (teamLocks.get(teamId) === next)
            teamLocks.delete(teamId);
    }
}
function normalizeInput(input) {
    return {
        ...input,
        visibility: input.visibility ?? 'public',
        payloadVersion: 1,
        payload: input.payload ?? {},
        createdAt: input.createdAt ?? Date.now(),
        id: input.id ?? newId('event'),
    };
}
function parseEvent(value) {
    return cloneJson(runtimeEventSchema.parse(value));
}
function assertCursor(cursor, teamId) {
    if (cursor === undefined)
        return 0;
    if (cursor.teamId !== teamId) {
        throw new Error(`runtime event cursor belongs to team ${cursor.teamId}, not ${teamId}`);
    }
    if (!Number.isInteger(cursor.sequence) || cursor.sequence < 0) {
        throw new Error(`runtime event cursor sequence must be a non-negative integer`);
    }
    return cursor.sequence;
}
function validateLimit(limit) {
    if (limit === undefined)
        return undefined;
    if (!Number.isInteger(limit) || limit < 1)
        throw new Error('runtime event read limit must be a positive integer');
    return limit;
}
/**
 * Durable event log with a reconnect-friendly, team-scoped cursor.
 */
export class RuntimeEventLog {
    store;
    capabilities;
    constructor(store) {
        this.store = store;
        const atomicAppend = typeof store.appendRuntimeEvent === 'function';
        this.capabilities = atomicAppend
            ? { atomicAppend: true, crossProcessSafe: true }
            : {
                atomicAppend: false,
                crossProcessSafe: false,
                limitation: 'TeamStore has no atomic counter-plus-insert operation; fallback serialization is process-local and is not safe across multiple service processes or writers that bypass RuntimeEventLog.',
            };
    }
    async append(input) {
        const normalized = normalizeInput(input);
        if (typeof this.store.appendRuntimeEvent === 'function') {
            return parseEvent(await this.store.appendRuntimeEvent(normalized));
        }
        return withTeamLock(normalized.teamId, async () => {
            const existing = await this.findByDedupe(normalized.teamId, normalized.dedupeKey);
            if (existing !== undefined)
                return existing;
            const records = await this.listTeam(normalized.teamId);
            const latestSequence = records.reduce((max, event) => Math.max(max, event.sequence), 0);
            const event = parseEvent({
                ...normalized,
                sequence: latestSequence + 1,
            });
            await this.store.put('runtime_events', event.id, event);
            return cloneJson(event);
        });
    }
    async read(teamId, options = {}) {
        const after = assertCursor(options.cursor, teamId);
        const limit = validateLimit(options.limit);
        const visibility = options.visibility ?? 'public';
        const records = await this.listTeam(teamId);
        const latestSequence = records.at(-1)?.sequence ?? 0;
        const rawAfter = records.filter((event) => event.sequence > after);
        const events = [];
        let scannedThrough = after;
        for (const event of rawAfter) {
            if (limit !== undefined && events.length >= limit)
                break;
            scannedThrough = event.sequence;
            if (visibility === 'all' || event.visibility === visibility)
                events.push(cloneJson(event));
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
    async reconcile(teamId, options = {}) {
        const page = await this.read(teamId, options);
        const after = assertCursor(options.cursor, teamId);
        const records = await this.listTeam(teamId);
        const missingSequences = [];
        let expected = after + 1;
        for (const event of records) {
            if (event.sequence < expected)
                continue;
            while (expected < event.sequence)
                missingSequences.push(expected++);
            expected = event.sequence + 1;
        }
        return { ...page, missingSequences };
    }
    async listTeam(teamId) {
        const records = await this.store.list('runtime_events', (event) => event.teamId === teamId && !event.id.startsWith('__runtime_events_counter__:'));
        return records.map(parseEvent).sort((a, b) => a.sequence - b.sequence);
    }
    async findByDedupe(teamId, dedupeKey) {
        if (dedupeKey === undefined)
            return undefined;
        const records = await this.store.list('runtime_events', (event) => event.teamId === teamId && event.dedupeKey === dedupeKey && !event.id.startsWith('__runtime_events_counter__:'));
        const event = records[0];
        return event === undefined ? undefined : parseEvent(event);
    }
}
export function createRuntimeEventLog(store) {
    return new RuntimeEventLog(store);
}
