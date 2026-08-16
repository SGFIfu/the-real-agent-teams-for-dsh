import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeEventLog, RuntimeEventLog } from './runtime-events.ts';
import { MemoryStore } from './store.ts';
import type { RuntimeEvent, TeamId } from './types.ts';

const TEAM_A = 'team-a' as TeamId;
const TEAM_B = 'team-b' as TeamId;

function event(teamId: TeamId, name: string, options: Partial<Parameters<RuntimeEventLog['append']>[0]> = {}) {
  return { teamId, name, ...options };
}

describe('runtime event audit/recovery helper', () => {
  it('deduplicates a retry within a team and isolates the same key across teams', async () => {
    const store = new MemoryStore();
    const log = createRuntimeEventLog(store);
    const first = await log.append(event(TEAM_A, 'task_claimed', { dedupeKey: 'claim-1' }));
    const retry = await log.append(event(TEAM_A, 'task_claimed', { dedupeKey: 'claim-1', payload: { retry: true } }));
    const otherTeam = await log.append(event(TEAM_B, 'task_claimed', { dedupeKey: 'claim-1' }));

    assert.equal(retry.id, first.id);
    assert.equal(retry.sequence, first.sequence);
    assert.notEqual(otherTeam.id, first.id);
    assert.equal((await store.list('runtime_events')).length, 2);
  });

  it('filters public and internal projections with a team-scoped cursor', async () => {
    const log = createRuntimeEventLog(new MemoryStore());
    const publicOne = await log.append(event(TEAM_A, 'member_joined'));
    await log.append(event(TEAM_A, 'internal_runtime_note', { visibility: 'internal' }));
    const publicTwo = await log.append(event(TEAM_A, 'task_completed'));
    await log.append(event(TEAM_B, 'other_team_event'));

    const page = await log.read(TEAM_A, { visibility: 'public' });
    assert.deepEqual(page.events.map((item) => item.id), [publicOne.id, publicTwo.id]);
    assert.equal(page.latestSequence, 3);
    assert.equal(page.cursor.teamId, TEAM_A);
    assert.equal(page.cursor.sequence, 3);

    const internal = await log.read(TEAM_A, { visibility: 'internal' });
    assert.equal(internal.events.length, 1);
    assert.equal(internal.events[0].visibility, 'internal');

    const all = await log.read(TEAM_A, { cursor: { teamId: TEAM_A, sequence: 1 }, visibility: 'all' });
    assert.deepEqual(all.events.map((item) => item.name), ['internal_runtime_note', 'task_completed']);
    await assert.rejects(() => log.read(TEAM_A, { cursor: { teamId: TEAM_B, sequence: 0 }, visibility: 'all' }));
  });

  it('supports bounded pages without skipping raw sequences', async () => {
    const log = createRuntimeEventLog(new MemoryStore());
    await log.append(event(TEAM_A, 'one'));
    await log.append(event(TEAM_A, 'two'));
    await log.append(event(TEAM_A, 'three'));

    const first = await log.read(TEAM_A, { visibility: 'all', limit: 2 });
    assert.deepEqual(first.events.map((item) => item.name), ['one', 'two']);
    assert.equal(first.cursor.sequence, 2);
    assert.equal(first.hasMore, true);
    const second = await log.read(TEAM_A, { visibility: 'all', cursor: first.cursor });
    assert.deepEqual(second.events.map((item) => item.name), ['three']);
  });

  it('reports sequence gaps during reconciliation', async () => {
    const store = new MemoryStore();
    const log = createRuntimeEventLog(store);
    const one = await log.append(event(TEAM_A, 'one'));
    const originalThree = await log.append(event(TEAM_A, 'three'));
    const three = {
      ...originalThree,
      sequence: 3,
      id: 'event-gap' as RuntimeEvent['id'],
    } as RuntimeEvent;
    await store.remove('runtime_events', originalThree.id);
    await store.put('runtime_events', three.id, three);

    const result = await log.reconcile(TEAM_A, { cursor: { teamId: TEAM_A, sequence: one.sequence }, visibility: 'all' });
    assert.deepEqual(result.missingSequences, [2]);
    assert.equal(result.latestSequence, 3);
  });

  it('serializes concurrent fallback appends in one process but exposes its boundary', async () => {
    const log = createRuntimeEventLog(new MemoryStore());
    assert.equal(log.capabilities.atomicAppend, false);
    assert.equal(log.capabilities.crossProcessSafe, false);
    assert.match(log.capabilities.limitation ?? '', /process-local/);

    const events = await Promise.all(
      Array.from({ length: 32 }, (_, index) => log.append(event(TEAM_A, 'task_event', { dedupeKey: `event-${index}` }))),
    );
    assert.equal(new Set(events.map((item) => item.sequence)).size, 32);
    assert.deepEqual(
      events.map((item) => item.sequence).sort((a, b) => a - b),
      Array.from({ length: 32 }, (_, index) => index + 1),
    );
  });
});
