/**
 * Messaging tests: direct, broadcast, inbox filtering, typed delivery.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeFixture, S } from './testing.ts';
import { AgentTeamsService } from './service.ts';
import { MemoryStore } from './store.ts';
import type { TeamRuntimeAdapter } from './types.ts';

describe('messaging', () => {
  it('delivers member-to-member through native followup with true sender attribution', async () => {
    const calls: Array<{ childId: string; sender?: string }> = [];
    const runtime: TeamRuntimeAdapter = {
      async startContinuable() { return { childId: 'child', messageId: 'message' }; },
      async followup(_parent, childId, _text, senderSessionId) { calls.push({ childId, sender: senderSessionId }); },
      async reportFrom() {},
      interrupt() {},
      async listChildrenOf() { return []; },
    };
    const service = new AgentTeamsService({ store: new MemoryStore(), runtime });
    const team = await service.createTeam({ name: 'native', goal: 'deliver', leadSessionId: S.lead, workspaceId: 'w' });
    await service.registerMember({ teamId: team.id, sessionId: S.backend, name: 'backend', role: 'backend', actor: S.lead });
    await service.registerMember({ teamId: team.id, sessionId: S.frontend, name: 'frontend', role: 'frontend', actor: S.lead });
    const message = await service.sendMessage({ teamId: team.id, fromSessionId: S.backend, toSessionId: S.frontend, body: 'API contract is ready.' });
    assert.equal(message.deliveryState, 'delivered');
    assert.equal(message.deliveryTransport, 'native-followup');
    assert.deepEqual(calls, [{ childId: S.frontend, sender: S.backend }]);
  });
  it('lead → member direct message lands in the member inbox', async () => {
    const { service, teamId } = await makeFixture([{ name: 'b', role: 'b', sessionId: S.backend }]);
    await service.sendMessage({ teamId, fromSessionId: S.lead, toSessionId: S.backend, body: 'contract changed' });
    const inbox = await service.getInbox(teamId, S.backend);
    assert.equal(inbox.length, 1);
    assert.equal(inbox[0].body, 'contract changed');
    assert.equal(inbox[0].toSessionId, S.backend);
  });

  it('broadcast reaches every member but not other teams', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'b', role: 'b', sessionId: S.backend },
      { name: 'f', role: 'f', sessionId: S.frontend },
    ]);
    await service.broadcastMessage({ teamId, fromSessionId: S.lead, body: 'standup' });
    const backendInbox = await service.getInbox(teamId, S.backend);
    const frontendInbox = await service.getInbox(teamId, S.frontend);
    assert.equal(backendInbox.length, 1);
    assert.equal(frontendInbox.length, 1);
    const other = await service.createTeam({ name: 'other', goal: 'x', leadSessionId: S.lead, workspaceId: 'w' });
    await assert.rejects(() => service.getInbox(other.id, S.backend));
  });

  it('direct message to one member is invisible to another member', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'b', role: 'b', sessionId: S.backend },
      { name: 'f', role: 'f', sessionId: S.frontend },
    ]);
    await service.sendMessage({ teamId, fromSessionId: S.lead, toSessionId: S.backend, body: 'private' });
    const frontendInbox = await service.getInbox(teamId, S.frontend);
    assert.equal(frontendInbox.length, 0);
  });

  it('member → lead and member → member messages are recorded', async () => {
    const { service, teamId } = await makeFixture([
      { name: 'b', role: 'b', sessionId: S.backend },
      { name: 'f', role: 'f', sessionId: S.frontend },
    ]);
    await service.sendMessage({ teamId, fromSessionId: S.backend, toSessionId: S.frontend, type: 'warning', body: 'schema change' });
    const leadInbox = await service.getInbox(teamId, S.lead);
    assert.equal(leadInbox.length, 0, 'lead is not the addressee');
    const frontendInbox = await service.getInbox(teamId, S.frontend);
    assert.equal(frontendInbox.length, 1);
    assert.equal(frontendInbox[0].type, 'warning');
  });

  it('rejects messages to unknown targets', async () => {
    const { service, teamId } = await makeFixture([]);
    await assert.rejects(() => service.sendMessage({ teamId, fromSessionId: S.lead, toSessionId: 'sess-ghost', body: 'hi' }), (error: unknown) => {
      assert.equal((error as { code: string }).code, 'MEMBER_NOT_FOUND');
      return true;
    });
  });

  it('message history is newest-first for the board view', async () => {
    const { service, teamId } = await makeFixture([]);
    await service.broadcastMessage({ teamId, fromSessionId: S.lead, body: 'one' });
    await service.broadcastMessage({ teamId, fromSessionId: S.lead, body: 'two' });
    const history = await service.listMessages(teamId, S.lead);
    assert.equal(history[0].body, 'two');
    assert.equal(history[1].body, 'one');
  });
});
