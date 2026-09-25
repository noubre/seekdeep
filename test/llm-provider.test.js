import test from 'brittle';
import http from 'node:http';
import { createOllama } from '../js/llm/ollama.js';
import { createLMStudio } from '../js/llm/lmstudio.js';
import { createProviderRouter } from '../js/llm/provider.js';

function startStubServer() {
  const server = http.createServer((req, res) => {
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
    if (req.method === 'GET' && req.url === '/api/v0/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'lmstudio-model', created: '2024-02-02' }] }));
      return;
    }
    if (req.method === 'POST' && req.url === '/api/v0/chat/completions') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
      res.write('data: {"choices":[{"delta":{"reasoning_content":"think"}}]}\n\n');
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
  t.alike(await ollama.listModels(), [{ id: 'llama2:7b', name: 'llama2:7b', modified_at: '2024-01-01' }]);

  const chunks = [];
  const text = await ollama.ask('llama2:7b', 'hi', { onChunk: (chunk) => chunks.push(chunk) });
  t.alike(chunks, ['a', 'b']);
  t.is(text, 'ab');
});

test('LM Studio provider lists models and parses SSE content plus reasoning', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());

  const lmstudio = createLMStudio({ baseUrl, fetch: globalThis.fetch });
  t.alike(await lmstudio.listModels(), [{ id: 'lmstudio-model', name: 'lmstudio-model', modified_at: '2024-02-02' }]);

  const chunks = [];
  const text = await lmstudio.ask('lmstudio-model', 'hi', { onChunk: (chunk) => chunks.push(chunk) });
  t.alike(chunks, ['x', ' thinkingthink</think>']);
  t.ok(text.includes('x'));
  t.ok(text.includes(' thinkingthink</think>'));
});

test('provider router routes by provider and auto-selects the first available', async function (t) {
  const { server, baseUrl } = await startStubServer();
  t.teardown(() => server.close());

  const router = createProviderRouter({ fetch: globalThis.fetch, baseUrls: { ollama: baseUrl, lmstudio: baseUrl } });
  t.alike(await router.listModels('ollama'), [{ id: 'llama2:7b', name: 'llama2:7b', modified_at: '2024-01-01' }]);
  t.is(await router.autoSelect(), 'ollama');
  await t.exception.all(() => router.listModels('bogus'), /Unknown provider/);
});

test('provider router treats an unreachable provider as unavailable', async function (t) {
  const router = createProviderRouter({ fetch: globalThis.fetch, baseUrls: { ollama: 'http://127.0.0.1:1', lmstudio: 'http://127.0.0.1:1' } });
  t.is(await router.isAvailable('ollama'), false);
  t.alike(await router.getAvailableProviders(), []);
  await t.exception.all(() => router.autoSelect(), /No LLM providers/);
});