import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidTransition, validateTransition, resolveEffectiveStatus, VALID_STATUS_TRANSITIONS, } from "./member-state-machine.js";
await describe('Member state machine', async () => {
    await describe('VALID_STATUS_TRANSITIONS', async () => {
        await test('defines all member statuses', () => {
            const statuses = Object.keys(VALID_STATUS_TRANSITIONS);
            assert(statuses.includes('starting'));
            assert(statuses.includes('idle'));
            assert(statuses.includes('working'));
            assert(statuses.includes('blocked'));
            assert(statuses.includes('reviewing'));
            assert(statuses.includes('stopped'));
            assert(statuses.includes('failed'));
        });
        await test('terminal states have no outgoing transitions', () => {
            assert.deepEqual(VALID_STATUS_TRANSITIONS.stopped, []);
            assert.deepEqual(VALID_STATUS_TRANSITIONS.failed, []);
        });
        await test('starting can transition to idle or terminate', () => {
            assert(VALID_STATUS_TRANSITIONS.starting.includes('idle'));
            assert(VALID_STATUS_TRANSITIONS.starting.includes('failed'));
            assert(VALID_STATUS_TRANSITIONS.starting.includes('stopped'));
        });
        await test('idle can start working, reviewing, or terminate', () => {
            assert(VALID_STATUS_TRANSITIONS.idle.includes('working'));
            assert(VALID_STATUS_TRANSITIONS.idle.includes('reviewing'));
            assert(VALID_STATUS_TRANSITIONS.idle.includes('stopped'));
            assert(VALID_STATUS_TRANSITIONS.idle.includes('failed'));
        });
        await test('working can finish, block, review, or terminate', () => {
            assert(VALID_STATUS_TRANSITIONS.working.includes('idle'));
            assert(VALID_STATUS_TRANSITIONS.working.includes('blocked'));
            assert(VALID_STATUS_TRANSITIONS.working.includes('reviewing'));
            assert(VALID_STATUS_TRANSITIONS.working.includes('stopped'));
            assert(VALID_STATUS_TRANSITIONS.working.includes('failed'));
        });
        await test('blocked can resume, give up, or terminate', () => {
            assert(VALID_STATUS_TRANSITIONS.blocked.includes('working'));
            assert(VALID_STATUS_TRANSITIONS.blocked.includes('idle'));
            assert(VALID_STATUS_TRANSITIONS.blocked.includes('stopped'));
            assert(VALID_STATUS_TRANSITIONS.blocked.includes('failed'));
        });
        await test('reviewing can finish, work, block, or terminate', () => {
            assert(VALID_STATUS_TRANSITIONS.reviewing.includes('idle'));
            assert(VALID_STATUS_TRANSITIONS.reviewing.includes('working'));
            assert(VALID_STATUS_TRANSITIONS.reviewing.includes('blocked'));
            assert(VALID_STATUS_TRANSITIONS.reviewing.includes('stopped'));
            assert(VALID_STATUS_TRANSITIONS.reviewing.includes('failed'));
        });
    });
    await describe('isValidTransition', async () => {
        await test('allows no-op transitions (same status)', () => {
            assert.equal(isValidTransition('idle', 'idle'), true);
            assert.equal(isValidTransition('working', 'working'), true);
            assert.equal(isValidTransition('stopped', 'stopped'), true);
        });
        await test('allows valid transitions', () => {
            assert.equal(isValidTransition('starting', 'idle'), true);
            assert.equal(isValidTransition('idle', 'working'), true);
            assert.equal(isValidTransition('working', 'idle'), true);
            assert.equal(isValidTransition('working', 'blocked'), true);
            assert.equal(isValidTransition('blocked', 'working'), true);
            assert.equal(isValidTransition('working', 'reviewing'), true);
            assert.equal(isValidTransition('reviewing', 'idle'), true);
        });
        await test('rejects invalid transitions', () => {
            assert.equal(isValidTransition('starting', 'working'), false);
            assert.equal(isValidTransition('starting', 'blocked'), false);
            assert.equal(isValidTransition('idle', 'blocked'), false);
            assert.equal(isValidTransition('starting', 'reviewing'), false);
        });
        await test('rejects transitions from terminal states', () => {
            assert.equal(isValidTransition('stopped', 'idle'), false);
            assert.equal(isValidTransition('stopped', 'working'), false);
            assert.equal(isValidTransition('failed', 'idle'), false);
            assert.equal(isValidTransition('failed', 'working'), false);
        });
        await test('allows any state to terminate', () => {
            assert.equal(isValidTransition('starting', 'failed'), true);
            assert.equal(isValidTransition('idle', 'stopped'), true);
            assert.equal(isValidTransition('working', 'failed'), true);
            assert.equal(isValidTransition('blocked', 'stopped'), true);
            assert.equal(isValidTransition('reviewing', 'failed'), true);
        });
    });
    await describe('validateTransition', async () => {
        await test('returns valid=true for allowed transitions', () => {
            const result = validateTransition('idle', 'working');
            assert.equal(result.valid, true);
            assert.equal(result.error, undefined);
        });
        await test('returns valid=false with error for invalid transitions', () => {
            const result = validateTransition('idle', 'blocked');
            assert.equal(result.valid, false);
            assert(result.error?.includes('Invalid transition'));
            assert(result.error?.includes('idle'));
            assert(result.error?.includes('blocked'));
        });
        await test('returns error for terminal state transitions', () => {
            const result = validateTransition('stopped', 'idle');
            assert.equal(result.valid, false);
            assert(result.error?.includes('terminal state'));
        });
        await test('allows no-op transitions', () => {
            const result = validateTransition('working', 'working');
            assert.equal(result.valid, true);
        });
    });
    await describe('resolveEffectiveStatus', async () => {
        await test('allows valid transitions', () => {
            assert.equal(resolveEffectiveStatus('idle', 'working', false), 'working');
            assert.equal(resolveEffectiveStatus('working', 'idle', false), 'idle');
            assert.equal(resolveEffectiveStatus('working', 'blocked', true), 'blocked');
            assert.equal(resolveEffectiveStatus('working', 'reviewing', true), 'reviewing');
        });
        await test('rejects invalid transitions by keeping current status', () => {
            assert.equal(resolveEffectiveStatus('idle', 'blocked', false), 'idle');
            assert.equal(resolveEffectiveStatus('starting', 'working', false), 'starting');
            assert.equal(resolveEffectiveStatus('stopped', 'idle', false), 'stopped');
        });
        await test('prevents idle transition when member has active task', () => {
            // Member is working on a task, native event says 'idle' -> keep working
            assert.equal(resolveEffectiveStatus('working', 'idle', true), 'working');
            // Member is blocked on a task, native event says 'idle' -> keep blocked
            assert.equal(resolveEffectiveStatus('blocked', 'idle', true), 'blocked');
        });
        await test('allows idle transition when no active task', () => {
            assert.equal(resolveEffectiveStatus('working', 'idle', false), 'idle');
            assert.equal(resolveEffectiveStatus('blocked', 'idle', false), 'idle');
        });
        await test('allows terminal transitions even with active task', () => {
            assert.equal(resolveEffectiveStatus('working', 'failed', true), 'failed');
            assert.equal(resolveEffectiveStatus('working', 'stopped', true), 'stopped');
        });
        await test('preserves reviewing status during task ownership', () => {
            // When reviewing with task, idle transition should be blocked
            assert.equal(resolveEffectiveStatus('reviewing', 'idle', true), 'reviewing');
            // But when no task, allow idle
            assert.equal(resolveEffectiveStatus('reviewing', 'idle', false), 'idle');
        });
    });
});
