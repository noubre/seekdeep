import test from 'brittle';
import http from 'node:http';
import { createOllama } from '../js/llm/ollama.js';
import { createLMStudio } from '../js/llm/lmstudio.js';
import { createProviderRouter } from '../js/llm/provider.js';

const THINK_OPEN = '<' + 'think>';
const THINK_CLOSE = '<' + '/think>';

function startStubServer(options = {}) {
  const completionEvents = options.completionEvents || [
    { choices: [{ delta: { content: 'x' } }] },
    { choices: [{ delta: { reasoning_content: 'think' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_x', function: { name: 'get_time', arguments: '{"a":1}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }
  ];
  const server = http.createServer((req, res) => {
    if (options.noBody && req.method === 'POST') {
      // 204 is a bodyless success: fetch then reports `response.body === null`.
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === 'GET' && req.url === '/api/tags') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'llama2:7b', modified_at: '2024-01-01' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/generate') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ response: 'a' })}\n`);
      res.write(`${JSON.stringify({ response: 'b' })}\n`);
      res.end(`${JSON.stringify({ done: true })}\n`);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/chat') {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(`${JSON.stringify({ message: { content: 'a' } })}\n`);
      res.write(`${JSON.stringify({ message: { thinking: 't' } })}\n`);
      res.write(`${JSON.stringify({ message: { tool_calls: [{ function: { name: 'get_time', arguments: { a: 1 } } }] } })}\n`);
      res.end(`${JSON.stringify({ done: true, done_reason: 'tool_calls', prompt_eval_count: 3, eval_count: 4 })}\n`);
      return;
    }
    if (req.method === 'GET' && req.url === '/api/v0/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'lmstudio-model', created: '2024-02-02' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v0/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of completionEvents) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      res.end('data: [DONE]\n\n');
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('Ollama provider lists models and streams newline-delimited JSON', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());

  const ollama = createOllama({ baseUrl, fetch: globalThis.fetch });
  t.alike(await ollama.listModels(), [{ id: 'llama2:7b', name: 'llama2:7b', created: 1704067200 }]);

  const chunks = [];
  const text = await ollama.ask('llama2:7b', 'hi', { onChunk: (chunk) => chunks.push(chunk) });
  t.alike(chunks, ['a', 'b']);
  t.is(text, 'ab');
});

test('LM Studio provider lists models and parses SSE content plus reasoning', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());

  const lmstudio = createLMStudio({ baseUrl, fetch: globalThis.fetch });
  t.alike(await lmstudio.listModels(), [{ id: 'lmstudio-model', name: 'lmstudio-model', created: 1706832000 }]);

  const chunks = [];
  const text = await lmstudio.ask('lmstudio-model', 'hi', { onChunk: (chunk) => chunks.push(chunk) });
  t.alike(chunks, ['x', THINK_OPEN, 'think', THINK_CLOSE]);
  t.is(chunks.join(''), text);
  t.is(text, `x${THINK_OPEN}think${THINK_CLOSE}`);
});

test('LM Studio ask streams reasoning as incremental deltas without duplication', async function (t) {
  const { server, baseUrl } = await startStubServer({
    completionEvents: [
      { choices: [{ delta: { reasoning_content: 'th' } }] },
      { choices: [{ delta: { reasoning_content: 'ink' } }] },
      { choices: [{ delta: { content: 'answer' } }] }
    ]
  });
  t.teardown(() => server.close());

  const lmstudio = createLMStudio({ baseUrl, fetch: globalThis.fetch });
  const chunks = [];
  const text = await lmstudio.ask('lmstudio-model', 'hi', { onChunk: (chunk) => chunks.push(chunk) });

  t.alike(chunks, [THINK_OPEN, 'th', 'ink', THINK_CLOSE, 'answer']);
  t.is(chunks.join(''), text);
  t.is(text, `${THINK_OPEN}think${THINK_CLOSE}answer`);
  t.is(text.split(THINK_OPEN).length - 1, 1);
  t.is(text.split(THINK_CLOSE).length - 1, 1);
  const reasoningBody = text.slice(THINK_OPEN.length, text.indexOf(THINK_CLOSE));
  t.is(reasoningBody, 'think');
});

test('provider router routes by provider and auto-selects the first available', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());

  const router = createProviderRouter({ fetch: globalThis.fetch, baseUrls: { ollama: baseUrl, lmstudio: baseUrl } });
  t.alike(await router.listModels('ollama'), [{ id: 'llama2:7b', name: 'llama2:7b', created: 1704067200 }]);
  t.is(await router.autoSelect(), 'ollama');
  await t.exception.all(() => router.listModels('bogus'), /Unknown provider/);
});

test('provider router treats an unreachable provider as unavailable', async function (t) {
  const router = createProviderRouter({ fetch: globalThis.fetch, baseUrls: { ollama: 'http://127.0.0.1:1', lmstudio: 'http://127.0.0.1:1' } });
  t.is(await router.isAvailable('ollama'), false);
  await t.exception.all(() => router.autoSelect(), /No LLM providers/);
});

test('Ollama chat streams text, reasoning, and tool calls with a synthesized id', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());

  const ollama = createOllama({ baseUrl, fetch: globalThis.fetch });
  const events = [];
  const result = await ollama.chat(
    'llama2:7b',
    { messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'get_time', description: '', parametersJson: '{}' }] },
    (event) => events.push(event)
  );

  t.alike(events.map((event) => event.type), ['text', 'reasoning', 'tool_call']);
  t.is(result.text, 'a');
  t.is(result.reasoning, 't');
  t.is(result.finishReason, 'tool_calls');
  t.is(result.toolCalls.length, 1);
  t.is(result.toolCalls[0].name, 'get_time');
  t.ok(result.toolCalls[0].id.startsWith('call_'));
  t.is(result.toolCalls[0].argumentsJson, '{"a":1}');
  t.alike(result.usage, { promptTokens: 3, completionTokens: 4 });
});

test('LM Studio chat falls back from /v1 to /api/v0 on 404 and streams tool calls', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());

  const lmstudio = createLMStudio({ baseUrl, fetch: globalThis.fetch });
  const events = [];
  const result = await lmstudio.chat('lmstudio-model', { messages: [{ role: 'user', content: 'hi' }] }, (event) => events.push(event));

  t.ok(events.some((event) => event.type === 'text' && event.text === 'x'));
  t.ok(events.some((event) => event.type === 'tool_call'));
  t.is(result.text, 'x');
  t.is(result.finishReason, 'tool_calls');
  t.is(result.toolCalls[0].id, 'call_x');
  t.is(result.toolCalls[0].argumentsJson, '{"a":1}');
  t.alike(result.usage, { promptTokens: 2, completionTokens: 3 });
});

test('provider router exposes chat', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());
  const router = createProviderRouter({ fetch: globalThis.fetch, baseUrls: { ollama: baseUrl, lmstudio: baseUrl } });
  const result = await router.chat('ollama', 'llama2:7b', { messages: [{ role: 'user', content: 'hi' }] });
  t.is(result.text, 'a');
});
test('providers reject a successful response with no stream body instead of throwing a raw TypeError', async function (t) {
  const { server, baseUrl } = await startStubServer({ noBody: true });
  t.teardown(() => server.close());

  const ollama = createOllama({ baseUrl, fetch: globalThis.fetch });
  const lmstudio = createLMStudio({ baseUrl, fetch: globalThis.fetch });
  const messages = [{ role: 'user', content: 'hi' }];

  await t.exception.all(() => ollama.ask('llama2:7b', 'hi'), /Ollama ask returned no stream body/);
  await t.exception.all(() => ollama.chat('llama2:7b', { messages }), /Ollama chat returned no stream body/);
  await t.exception.all(() => lmstudio.ask('lmstudio-model', 'hi'), /LM Studio ask returned no stream body/);
  await t.exception.all(() => lmstudio.chat('lmstudio-model', { messages }), /LM Studio chat returned no stream body/);
});
