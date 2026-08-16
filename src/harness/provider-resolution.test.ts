import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentSpec } from './provider-resolution.ts';
import { TeamError } from '../core/errors.ts';

describe('provider/model resolution', () => {
  it('keeps native runtime provider separate from the v4 flash model alias', () => {
    const resolved = resolveAgentSpec({ model: 'v4-flash', modelProvider: 'deepseek-official' }, {
      availableProviders: ['spawn', 'fork'],
      defaultProvider: 'spawn',
    });
    assert.equal(resolved.resolvedProvider, 'spawn');
    assert.equal(resolved.resolvedModel, 'deepseek-v4-flash');
    assert.equal(resolved.resolvedModelProvider, 'deepseek-official');
  });

  it('rejects an unregistered runtime provider before durable member creation', () => {
    assert.throws(
      () => resolveAgentSpec({ provider: 'missing-runtime' }, { availableProviders: ['spawn'], defaultProvider: 'spawn' }),
      (error: unknown) => (error as TeamError).code === 'SUBAGENT_PROVIDER_NOT_FOUND' && (error as TeamError).details?.availableProviders?.toString() === 'spawn',
    );
  });
});
