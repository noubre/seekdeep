import test from 'brittle';
import {
  parseChatCompletionsRequest,
  createChatCompletionsWriter,
  parseCompletionsRequest,
  createCompletionsWriter
} from '../js/openai/codec-openai.js';
import { parseMessagesRequest, createMessagesWriter, countInputTokens } from '../js/openai/codec-anthropic.js';
import { parseResponsesRequest, createResponsesWriter } from '../js/openai/codec-responses.js';
import { createToolRegistry } from '../js/openai/tool-registry.js';

function makeRes() {
  const parts = [];
  return {
    status: null,
    headers: null,
    writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    write(chunk) { parts.push(chunk); },
    end(chunk) { if (chunk) parts.push(chunk); this.writableEnded = true; },
    body() { return parts.join(''); },
    blocks() { return this.body().split('\n\n').filter((block) => block.trim()); },
    dataLines() {
      return this.blocks()
        .filter((block) => block.startsWith('data:'))
        .map((block) => block.slice('data:'.length).trim());
    },
    jsonBlocks() {
      return this.dataLines().filter((line) => line !== '[DONE]').map((line) => JSON.parse(line));
    }
  };
}

test('OpenAI chat completions parses parts, tools, tool results, and aliases', async function (t) {
  const registry = createToolRegistry();
  registry.record('call_1', 'get_time');
  const request = parseChatCompletionsRequest({
    model: 'llama',
    messages: [
      { role: 'system', content: [{ type: 'text', text: 'be terse' }, { type: 'image_url', image_url: { url: 'x' } }] },
      { role: 'user', content: [{ type: 'text', text: 'time?' }] },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_time', arguments: '{"zone":"utc"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '12:00' }
    ],
    tools: [
      { type: 'function', function: { name: 'get_time', description: 'clock', parameters: { type: 'object' } } },
      { type: 'not_a_function', function: { name: 'ignored' } }
    ],
    max_completion_tokens: 64,
    stop: 'END',
    stream: true
  }, registry);

  t.is(request.model, 'llama');
  t.alike(request.messages[0], { role: 'system', content: 'be terse' });
  t.alike(request.messages[1], { role: 'user', content: 'time?' });
  t.alike(request.messages[2], { role: 'assistant', content: '', toolCalls: [{ id: 'call_1', name: 'get_time', argumentsJson: '{"zone":"utc"}' }] });
  t.alike(request.messages[3], { role: 'tool', content: '12:00', toolCallId: 'call_1', name: 'get_time' });
  t.alike(request.tools, [{ name: 'get_time', description: 'clock', parametersJson: '{"type":"object"}' }]);
  t.is(request.maxTokens, 64);
  t.alike(request.stop, ['END']);
  t.is(request.stream, true);
});

test('OpenAI chat completions rejects a missing model or messages', async function (t) {
  t.exception.all(() => parseChatCompletionsRequest({ messages: [] }, null), /model/i);
  t.exception.all(() => parseChatCompletionsRequest({ model: 'm' }, null), /messages/i);
});

test('OpenAI chat writer streams the documented chunk sequence', async function (t) {
  const res = makeRes();
  const writer = createChatCompletionsWriter({ res, model: 'm', stream: true, toolNames: createToolRegistry() });
  writer.text('hel');
  writer.text('lo');
  writer.toolCall({ index: 0, id: 'call_1', name: 'get_time', argumentsDelta: '{"a":1}' });
  writer.finish({ finishReason: 'tool_calls', usage: { promptTokens: 3, completionTokens: 4 } });

  t.is(res.status, 200);
  t.is(res.headers['Content-Type'], 'text/event-stream');
  const body = res.body();
  t.ok(body.endsWith('data: [DONE]\n\n'));

  const chunks = res.jsonBlocks();
  t.is(chunks[0].object, 'chat.completion.chunk');
  t.alike(chunks[0].choices[0].delta, { role: 'assistant', content: '' });
  t.is(chunks[1].choices[0].delta.content, 'hel');
  t.is(chunks[2].choices[0].delta.content, 'lo');
  const toolDelta = chunks[3].choices[0].delta.tool_calls[0];
  t.is(toolDelta.index, 0);
  t.is(toolDelta.id, 'call_1');
  t.is(toolDelta.type, 'function');
  t.is(toolDelta.function.name, 'get_time');
  t.is(toolDelta.function.arguments, '{"a":1}');
  const last = chunks.at(-1).choices[0];
  t.is(last.finish_reason, 'tool_calls');
  t.alike(last.delta, {});
});

test('OpenAI chat writer non-streaming matches the documented body', async function (t) {
  const res = makeRes();
  const writer = createChatCompletionsWriter({ res, model: 'm', stream: false });
  writer.text('ok');
  writer.finish({ finishReason: 'stop', usage: { promptTokens: 1, completionTokens: 2 } });
  const body = JSON.parse(res.body());
  t.is(body.object, 'chat.completion');
  t.is(body.choices[0].message.role, 'assistant');
  t.is(body.choices[0].message.content, 'ok');
  t.alike(body.choices[0].message.tool_calls, []);
  t.is(body.choices[0].finish_reason, 'stop');
  t.alike(body.usage, { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 });
});

test('OpenAI legacy completions parses a joined prompt and writes chunks', async function (t) {
  const request = parseCompletionsRequest({ model: 'm', prompt: ['a', 'b'], stream: true });
  t.alike(request.messages, [{ role: 'user', content: 'a\nb' }]);

  const res = makeRes();
  const writer = createCompletionsWriter({ res, model: 'm', stream: false });
  writer.text('hi');
  writer.finish({ finishReason: 'length' });
  const body = JSON.parse(res.body());
  t.is(body.object, 'text_completion');
  t.is(body.choices[0].text, 'hi');
  t.is(body.choices[0].finish_reason, 'length');
});

test('OpenAI writer emits an error event mid-stream', async function (t) {
  const res = makeRes();
  const writer = createChatCompletionsWriter({ res, model: 'm', stream: true });
  writer.text('x');
  writer.error(new Error('boom'));
  t.ok(res.body().includes('boom'));
  t.ok(res.body().includes('event: error'));
});

test('Anthropic messages parses system, tool_use, and tool_result blocks', async function (t) {
  const request = parseMessagesRequest({
    model: 'claude',
    system: [{ type: 'text', text: 'sys' }],
    max_tokens: 128,
    stop_sequences: ['END'],
    stream: true,
    tools: [{ name: 'get_time', description: 'clock', input_schema: { type: 'object' } }],
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'one moment' }, { type: 'tool_use', id: 'toolu_1', name: 'get_time', input: { zone: 'utc' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '12:00' }, { type: 'text', text: 'thanks' }] }
    ]
  });
  t.alike(request.messages[0], { role: 'system', content: 'sys' });
  t.alike(request.messages[1], { role: 'user', content: 'hi' });
  t.alike(request.messages[2], { role: 'assistant', content: 'one moment', toolCalls: [{ id: 'toolu_1', name: 'get_time', argumentsJson: '{"zone":"utc"}' }] });
  t.alike(request.messages[3], { role: 'tool', content: '12:00', toolCallId: 'toolu_1' });
  t.alike(request.messages[4], { role: 'user', content: 'thanks' });
  t.is(request.maxTokens, 128);
  t.alike(request.stop, ['END']);
  t.alike(request.tools, [{ name: 'get_time', description: 'clock', parametersJson: '{"type":"object"}' }]);
  t.is(request.stream, true);
});

test('Anthropic count_tokens returns an estimate', async function (t) {
  const result = countInputTokens({ model: 'claude', max_tokens: 8, messages: [{ role: 'user', content: 'hello there' }] });
  t.ok(Number.isSafeInteger(result.input_tokens));
  t.ok(result.input_tokens >= 1);
});

test('Anthropic writer streams message_start to message_stop with tool_use', async function (t) {
  const res = makeRes();
  const writer = createMessagesWriter({ res, model: 'claude', stream: true, toolNames: createToolRegistry() });
  writer.text('hi');
  writer.toolCall({ index: 0, id: 'toolu_1', name: 'get_time', argumentsDelta: '{"a":1}' });
  writer.finish({ finishReason: 'tool_calls', usage: { completionTokens: 5 } });

  const sequence = res.blocks().map((block) => {
    const lines = block.split('\n');
    const name = lines.find((line) => line.startsWith('event:'))?.slice(6).trim();
    const data = JSON.parse(lines.find((line) => line.startsWith('data:')).slice(5).trim());
    return { name, data };
  });
  t.alike(sequence.map((entry) => entry.name), [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'message_delta',
    'message_stop'
  ]);
  t.is(sequence[0].data.message.type, 'message');
  t.is(sequence[1].data.content_block.type, 'text');
  t.is(sequence[2].data.delta.type, 'text_delta');
  t.is(sequence[2].data.delta.text, 'hi');
  t.is(sequence[4].data.content_block.type, 'tool_use');
  t.is(sequence[4].data.content_block.id, 'toolu_1');
  t.is(sequence[5].data.delta.type, 'input_json_delta');
  t.is(sequence[7].data.delta.stop_reason, 'tool_use');
  t.is(sequence.every((entry) => entry.data.type === entry.name), true);
});

test('Anthropic writer non-streaming returns a message body', async function (t) {
  const res = makeRes();
  const writer = createMessagesWriter({ res, model: 'claude', stream: false });
  writer.text('ok');
  writer.finish({ finishReason: 'stop' });
  const body = JSON.parse(res.body());
  t.is(body.type, 'message');
  t.is(body.content[0].type, 'text');
  t.is(body.content[0].text, 'ok');
  t.is(body.stop_reason, 'end_turn');
  t.is(body.usage.input_tokens, 0);
});

test('Anthropic writer emits the error event mid-stream', async function (t) {
  const res = makeRes();
  const writer = createMessagesWriter({ res, model: 'claude', stream: true });
  writer.text('x');
  writer.error(new Error('boom'));
  t.ok(res.body().includes('event: error'));
  t.ok(res.body().includes('boom'));
});

test('Responses parses instructions, function_call, and function_call_output', async function (t) {
  const registry = createToolRegistry();
  registry.record('call_9', 'get_time');
  const request = parseResponsesRequest({
    model: 'gpt',
    instructions: 'be terse',
    max_output_tokens: 32,
    tools: [{ type: 'function', name: 'get_time', description: 'clock', parameters: { type: 'object' } }, { type: 'web_search' }],
    input: [
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'time?' }] },
      { type: 'function_call', call_id: 'call_9', name: 'get_time', arguments: '{"a":1}' },
      { type: 'function_call_output', call_id: 'call_9', output: [{ type: 'output_text', text: '12:00' }] }
    ]
  }, registry);
  t.alike(request.messages[0], { role: 'system', content: 'be terse' });
  t.alike(request.messages[1], { role: 'user', content: 'time?' });
  t.alike(request.messages[2], { role: 'assistant', content: '', toolCalls: [{ id: 'call_9', name: 'get_time', argumentsJson: '{"a":1}' }] });
  t.alike(request.messages[3], { role: 'tool', content: '12:00', toolCallId: 'call_9', name: 'get_time' });
  t.alike(request.tools, [{ name: 'get_time', description: 'clock', parametersJson: '{"type":"object"}' }]);
  t.is(request.maxTokens, 32);
});

test('Responses writer streams created..completed with a function_call item', async function (t) {
  const res = makeRes();
  const writer = createResponsesWriter({ res, model: 'gpt', stream: true, toolNames: createToolRegistry() });
  writer.text('hi');
  writer.toolCall({ index: 0, id: 'call_1', name: 'get_time', argumentsDelta: '{"a":1}' });
  writer.finish({ usage: { promptTokens: 2, completionTokens: 3 } });

  const blocks = res.blocks().map((block) => JSON.parse(block.slice(block.indexOf('data:') + 5).trim()));
  t.is(blocks[0].type, 'response.created');
  t.is(blocks[1].type, 'response.in_progress');
  t.alike(blocks.map((block) => block.type).slice(-1), ['response.completed']);
  t.is(blocks.every((block, index) => block.sequence_number === index), true);
  t.ok(blocks.some((block) => block.type === 'response.output_text.delta' && block.delta === 'hi'));
  t.ok(blocks.some((block) => block.type === 'response.function_call_arguments.delta' && block.delta === '{"a":1}'));
  const completed = blocks.at(-1).response;
  t.is(completed.status, 'completed');
  t.ok(completed.output.some((item) => item.type === 'function_call' && item.call_id === 'call_1' && item.name === 'get_time'));
  t.alike(completed.usage, { input_tokens: 2, output_tokens: 3, total_tokens: 5 });
});

test('Responses writer non-streaming returns the documented body', async function (t) {
  const res = makeRes();
  const writer = createResponsesWriter({ res, model: 'gpt', stream: false });
  writer.text('ok');
  writer.finish({ usage: {} });
  const body = JSON.parse(res.body());
  t.is(body.object, 'response');
  t.is(body.status, 'completed');
  t.alike(body.output[0].content, [{ type: 'output_text', text: 'ok', annotations: [] }]);
});

test('Responses writer emits an error event mid-stream', async function (t) {
  const res = makeRes();
  const writer = createResponsesWriter({ res, model: 'gpt', stream: true });
  writer.text('x');
  writer.error(new Error('boom'));
  t.ok(res.body().includes('event: error'));
  t.ok(res.body().includes('boom'));
});
test('Responses writer reports a truncated response when the provider hits the length limit', async function (t) {
  const res = makeRes();
  const writer = createResponsesWriter({ res, model: 'gpt', stream: false });
  writer.text('partial');
  writer.finish({ finishReason: 'length', usage: { promptTokens: 1, completionTokens: 1 } });
  const body = JSON.parse(res.body());
  t.is(body.status, 'incomplete');
  t.alike(body.incomplete_details, { reason: 'max_output_tokens' });
});

test('Responses writer streams response.incomplete for a length-limited turn', async function (t) {
  const res = makeRes();
  const writer = createResponsesWriter({ res, model: 'gpt', stream: true });
  writer.text('partial');
  writer.finish({ finishReason: 'length', usage: {} });

  const blocks = res.blocks().map((block) => JSON.parse(block.slice(block.indexOf('data:') + 5).trim()));
  t.alike(blocks.map((block) => block.type).slice(-1), ['response.incomplete']);
  t.is(blocks.at(-1).response.status, 'incomplete');
  t.alike(blocks.at(-1).response.incomplete_details, { reason: 'max_output_tokens' });
});

test('Responses writer keeps completed status for tool-call turns', async function (t) {
  const res = makeRes();
  const writer = createResponsesWriter({ res, model: 'gpt', stream: false, toolNames: createToolRegistry() });
  writer.toolCall({ index: 0, id: 'call_1', name: 'get_time', argumentsDelta: '{}' });
  writer.finish({ finishReason: 'tool_calls', usage: {} });
  const body = JSON.parse(res.body());
  t.is(body.status, 'completed');
  t.absent(body.incomplete_details, 'a completed response carries no incomplete_details');
});
