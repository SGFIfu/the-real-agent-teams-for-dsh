import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultLabels, parseLanguage, parseOverrides, parseOverridesByLanguage, resolveLabels } from './locale.ts';

test('locale defaults are available in both supported languages', () => {
  assert.equal(defaultLabels('zh-CN').overallProgress, '总进度');
  assert.equal(defaultLabels('en-US').overallProgress, 'Overall Progress');
});

test('custom labels override only presentation text', () => {
  const labels = resolveLabels('en-US', { members: 'Crew', completed: 'Shipped', agentTeams: '' });
  assert.equal(labels.members, 'Crew');
  assert.equal(labels.completed, 'Shipped');
  assert.equal(labels.agentTeams, 'Agent Teams');
});

test('preference parsing rejects unknown and oversized values', () => {
  assert.equal(parseLanguage('fr-FR'), 'zh-CN');
  assert.deepEqual(parseOverrides({ members: 'Crew', unknown: 'ignored', activity: 'x'.repeat(81) }), { members: 'Crew' });
});

test('preference parsing keeps Chinese and English overrides independent', () => {
  const parsed = parseOverridesByLanguage({ 'zh-CN': { members: '成员' }, 'en-US': { members: 'Crew' } });
  assert.equal(resolveLabels('zh-CN', parsed['zh-CN']).members, '成员');
  assert.equal(resolveLabels('en-US', parsed['en-US']).members, 'Crew');
});

test('error boundary labels are present in both languages', () => {
  const zh = defaultLabels('zh-CN');
  const en = defaultLabels('en-US');
  assert.ok(zh.errorBoundaryTitle);
  assert.ok(zh.errorBoundaryMessage);
  assert.ok(zh.errorBoundaryRetry);
  assert.ok(zh.errorBoundaryDetails);
  assert.ok(en.errorBoundaryTitle);
  assert.ok(en.errorBoundaryMessage);
  assert.ok(en.errorBoundaryRetry);
  assert.ok(en.errorBoundaryDetails);
});
