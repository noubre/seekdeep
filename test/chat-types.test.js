import test from 'brittle';
import {
  CHAT_ROLES,
  CHAT_RESPONSE_KINDS,
  MAX_MESSAGES,
  validateMessages,
  validateTools,
  normalizeFinishReason,
  nextToolCallId,
  estimateTokens
} from '../js/llm/chat-types.js';

test('roles and response kinds are the documented sets', async function (t) {
  t.alike([...CHAT_ROLES], ['system', 'user', 'assistant', 'tool']);
  t.alike([...CHAT_RESPONSE_KINDS], ['text', 'tool_call', 'done', 'error']);
});

test('validateMessages accepts the documented shapes', async function (t) {
  const messages = [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: '' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_time', argumentsJson: '{}' }] },
    { role: 'tool', content: '12:00', toolCallId: 'call_1', name: 'get_time' },
    { role: 'tool', content: 'ok', toolCallId: 'call_2' }
  ];
  t.alike(validateMessages(messages), messages);
});

test('validateMessages rejects malformed messages', async function (t) {
  t.exception.all(() => validateMessages('nope'), /array/i);
  t.exception.all(() => validateMessages([{ role: 'robot', content: 'x' }]), /role/i);
  t.exception.all(() => validateMessages([{ role: 'user', content: 42 }]), /content/i);
  t.exception.all(() => validateMessages([{ role: 'user', content: 'x', extra: 1 }]), /unsupported field/i);
  t.exception.all(() => validateMessages([{ role: 'user', content: 'x', toolCalls: [] }]), /unsupported field/i);
  t.exception.all(() => validateMessages([{ role: 'assistant', content: '', toolCalls: [{ name: 'x', argumentsJson: '{}' }] }]), /\.id/i);
  t.exception.all(() => validateMessages([{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'x', argumentsJson: 'not json' }] }]), /argumentsJson/i);
  t.exception.all(() => validateMessages([{ role: 'tool', content: 'x' }]), /toolCallId/i);
  const tooMany = Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'user', content: 'x' }));
  t.exception.all(() => validateMessages(tooMany), /at most/i);
});

test('validateTools returns normalized tools and drops unparseable schemas', async function (t) {
  const tools = validateTools([
    { name: 'get_time', description: 'clock', parametersJson: '{"type":"object"}' },
    { name: 'no_desc', parametersJson: '{}' },
    { name: 'broken', description: '', parametersJson: 'not json' }
  ]);
  t.alike(tools, [
    { name: 'get_time', description: 'clock', parametersJson: '{"type":"object"}' },
    { name: 'no_desc', description: '', parametersJson: '{}' }
  ]);
  t.exception.all(() => validateTools({}), /array/i);
  t.exception.all(() => validateTools([{ name: '', parametersJson: '{}' }]), /name/i);
  t.exception.all(() => validateTools([{ name: 'x', parametersJson: '{}', extra: 1 }]), /unsupported field/i);
});

test('normalizeFinishReason maps unknown reasons onto the normalized set', async function (t) {
  t.is(normalizeFinishReason('stop', false), 'stop');
  t.is(normalizeFinishReason('length', false), 'length');
  t.is(normalizeFinishReason('tool_calls', true), 'tool_calls');
  t.is(normalizeFinishReason(undefined, true), 'tool_calls');
  t.is(normalizeFinishReason('weird', false), 'stop');
  t.is(normalizeFinishReason(undefined, false), 'stop');
});

test('nextToolCallId returns distinct non-empty ids', async function (t) {
  const a = nextToolCallId();
  const b = nextToolCallId();
  t.ok(a && b && a !== b);
  t.ok(a.startsWith('call_'));
});

test('estimateTokens grows with content', async function (t) {
  const small = estimateTokens([{ role: 'user', content: 'hi' }]);
  const large = estimateTokens([{ role: 'user', content: 'hi'.repeat(400) }]);
  t.ok(large > small);
  t.is(estimateTokens([]), 0);
  t.ok(estimateTokens([{ role: 'tool', content: '' }], [{ name: 'x', description: 'y' }]) >= 1);
});