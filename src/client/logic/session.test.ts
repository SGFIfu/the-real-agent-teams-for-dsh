import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { projectVisibleSession, subagentAddressFromCatalog } from './session.ts';

describe('privacy-safe Harness session projection', () => {
  it('keeps visible assistant/tool data and drops typed reasoning blocks', () => {
    const result = projectVisibleSession({
      sessionId: 'session-backend',
      running: true,
      nodes: [
        { kind: 'assistant', seq: 1, blocks: [
          { kind: 'text', text: 'API contract is ready.' },
          { kind: 'reasoning', text: 'private chain of thought: choose implementation' },
          { kind: 'tool-call', callId: 'c1', name: 'read', argsRaw: 'src/types.ts' },
        ] },
        { kind: 'tool-result', seq: 2, content: [{ type: 'text', text: 'file contents' }], call: { name: 'read', argsRaw: 'src/types.ts' }, isError: false },
        { kind: 'assistant', seq: 3, blocks: [{ kind: 'reasoning', text: 'Think: private follow-up' }] },
      ],
    });
    assert.deepEqual(result.items.map((item) => item.kind), ['assistant', 'tool-call', 'tool-result']);
    assert.ok(result.items.every((item) => !item.text.includes('private')));
    assert.ok(result.items.some((item) => item.text === 'API contract is ready.'));
  });

  it('only admits explicitly public report context', () => {
    const result = projectVisibleSession({
      sessionId: 's',
      nodes: [
        { kind: 'context', seq: 1, form: 'subagent-report', content: [{ type: 'text', text: 'review report' }] },
        { kind: 'context', seq: 2, form: 'private', content: [{ type: 'text', text: 'internal prompt' }] },
      ],
    });
    assert.deepEqual(result.items.map((item) => item.text), ['review report']);
  });

  it('derives an official child address from a loaded direct-child catalog', () => {
    assert.deepEqual(
      subagentAddressFromCatalog('lead-1', 'child-1', [
        { kind: 'child', id: 'child-1', mode: 'continuable', label: 'Backend' },
        { kind: 'diagnostic', id: 'bad-1', reason: 'unavailable' },
      ]),
      { parentSessionId: 'lead-1', childSessionId: 'child-1', mode: 'continuable' },
    );
    assert.equal(subagentAddressFromCatalog('lead-1', 'missing', []), undefined);
    assert.equal(subagentAddressFromCatalog('lead-1', 'bad-1', [{ kind: 'diagnostic', id: 'bad-1', reason: 'unavailable' }]), undefined);
  });
});
